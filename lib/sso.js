/**
 * Přihlášení přes Demaxia SSO (access.systeeem.cz) — OpenID Connect, Authorization Code + PKCE.
 * Stejné nastavení jako SK ERP: scope `openid profile email`, ochrana state + nonce + PKCE.
 *
 * Po ověření se vytvoří stejná session cookie jako u přihlášení e-mailovým kódem (lib/auth),
 * takže role a omezení sekcí (access-control) fungují beze změny.
 *
 * Zapne se, jakmile jsou nastavené DEMAXIA_ISSUER, DEMAXIA_CLIENT_ID, DEMAXIA_CLIENT_SECRET a APP_URL.
 * Přihlášení e-mailovým kódem je pak vypnuté, dokud AUTH_EMAIL_LOGIN=on (nouzový návrat).
 */

import { createHash, createHmac, randomBytes, timingSafeEqual } from 'crypto'

const FLOW_COOKIE = 'dashboard_sso_flow'
const FLOW_MAX_AGE_S = 10 * 60
const DISCOVERY_TTL_MS = 60 * 60 * 1000

let discoveryCache = null

function env(name) {
  return (process.env[name] || '').trim()
}

export function getSsoConfig() {
  const issuer = env('DEMAXIA_ISSUER').replace(/\/+$/, '')
  const clientId = env('DEMAXIA_CLIENT_ID')
  const clientSecret = env('DEMAXIA_CLIENT_SECRET')
  const appUrl = env('APP_URL').replace(/\/+$/, '')
  if (!issuer || !clientId || !clientSecret || !appUrl) return null
  return {
    issuer,
    clientId,
    clientSecret,
    redirectUri: `${appUrl}/api/auth/sso/callback`,
    postLogoutRedirectUri: `${appUrl}/login`
  }
}

export function isSsoEnabled() {
  return getSsoConfig() !== null
}

/** E-mailový kód jen bez SSO, nebo když je výslovně povolen (AUTH_EMAIL_LOGIN=on). */
export function isEmailLoginEnabled() {
  return !isSsoEnabled() || env('AUTH_EMAIL_LOGIN').toLowerCase() === 'on'
}

async function getDiscovery(config) {
  if (discoveryCache && discoveryCache.issuer === config.issuer && discoveryCache.expires > Date.now()) {
    return discoveryCache.doc
  }
  const response = await fetch(`${config.issuer}/.well-known/openid-configuration`, {
    headers: { Accept: 'application/json' }
  })
  if (!response.ok) throw new Error(`SSO discovery HTTP ${response.status}`)
  const doc = await response.json()
  if (!doc.authorization_endpoint || !doc.token_endpoint) throw new Error('SSO discovery bez endpointů')
  discoveryCache = { issuer: config.issuer, doc, expires: Date.now() + DISCOVERY_TTL_MS }
  return doc
}

// ---------- podepsaná krátkodobá cookie s průběhem přihlášení (state, nonce, PKCE, kam se vrátit)

function secret() {
  return process.env.APP_AUTH_SECRET || 'local-dashboard-auth-secret'
}

function signValue(value) {
  return createHmac('sha256', secret()).update(value).digest('base64url')
}

function encodeFlow(flow) {
  const payload = Buffer.from(JSON.stringify(flow)).toString('base64url')
  return `${payload}.${signValue(payload)}`
}

function decodeFlow(raw) {
  if (!raw || !raw.includes('.')) return null
  const [payload, signature] = raw.split('.')
  const expected = signValue(payload)
  const a = Buffer.from(signature || '')
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  try {
    const flow = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'))
    if (!flow?.exp || flow.exp < Date.now()) return null
    return flow
  } catch {
    return null
  }
}

function cookieSuffix() {
  return process.env.NODE_ENV === 'production' ? '; Secure' : ''
}

export function readFlowCookie(req) {
  const header = req.headers.cookie || ''
  const match = header.split(/;\s*/).find((part) => part.startsWith(`${FLOW_COOKIE}=`))
  return decodeFlow(match ? decodeURIComponent(match.slice(FLOW_COOKIE.length + 1)) : '')
}

export function clearFlowCookie() {
  return `${FLOW_COOKIE}=; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=0${cookieSuffix()}`
}

function safeNext(next) {
  return typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') ? next : '/'
}

/** Začátek přihlášení: URL na SSO + cookie s průběhem. */
export async function startLogin(next) {
  const config = getSsoConfig()
  if (!config) throw new Error('SSO není nastavené')
  const discovery = await getDiscovery(config)

  const state = randomBytes(24).toString('base64url')
  const nonce = randomBytes(24).toString('base64url')
  const verifier = randomBytes(48).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')

  const url = new URL(discovery.authorization_endpoint)
  url.search = new URLSearchParams({
    response_type: 'code',
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    scope: 'openid profile email',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString()

  const flow = encodeFlow({ state, nonce, verifier, next: safeNext(next), exp: Date.now() + FLOW_MAX_AGE_S * 1000 })
  const cookie = `${FLOW_COOKIE}=${encodeURIComponent(flow)}; Path=/api/auth/sso; HttpOnly; SameSite=Lax; Max-Age=${FLOW_MAX_AGE_S}${cookieSuffix()}`
  return { url: url.toString(), cookie }
}

function decodeJwtPayload(jwt) {
  const part = String(jwt || '').split('.')[1]
  if (!part) return null
  try {
    return JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

/**
 * Dokončení přihlášení: výměna kódu za tokeny a ověření ID tokenu.
 * ID token přichází přímo z token endpointu přes TLS s autentizací klienta (OIDC Core 3.1.3.7 —
 * podpis lze nahradit ověřením TLS); kontroluje se iss, aud, exp a nonce.
 * @returns {{ email: string, name: string|null, idToken: string|null }}
 */
export async function finishLogin({ code, state, flow }) {
  const config = getSsoConfig()
  if (!config) throw new Error('SSO není nastavené')
  if (!flow) throw new Error('Přihlášení vypršelo, zkuste to znovu.')
  if (!code || !state || state !== flow.state) throw new Error('Neplatný stav přihlášení, zkuste to znovu.')

  const discovery = await getDiscovery(config)
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')
  const response = await fetch(discovery.token_endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
      Authorization: `Basic ${basic}`
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: flow.verifier
    }).toString()
  })
  const tokens = await response.json().catch(() => null)
  if (!response.ok || !tokens?.id_token) {
    throw new Error(`SSO token: ${tokens?.error_description || tokens?.error || `HTTP ${response.status}`}`)
  }

  const claims = decodeJwtPayload(tokens.id_token)
  if (!claims) throw new Error('SSO: neplatný ID token')
  const expectedIssuer = (discovery.issuer || config.issuer).replace(/\/+$/, '')
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (String(claims.iss || '').replace(/\/+$/, '') !== expectedIssuer) throw new Error('SSO: nesedí vydavatel tokenu')
  if (!audiences.includes(config.clientId)) throw new Error('SSO: token není pro tuto aplikaci')
  if (!claims.exp || claims.exp * 1000 < Date.now()) throw new Error('SSO: token vypršel')
  if (claims.nonce !== flow.nonce) throw new Error('SSO: nesedí nonce')

  let email = typeof claims.email === 'string' ? claims.email : ''
  let name = typeof claims.name === 'string' ? claims.name : null
  if (!email && discovery.userinfo_endpoint && tokens.access_token) {
    const info = await fetch(discovery.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' }
    }).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    email = typeof info?.email === 'string' ? info.email : ''
    name = name || (typeof info?.name === 'string' ? info.name : null)
  }
  if (!email) throw new Error('SSO nevrátilo e-mail')

  return { email: email.trim().toLowerCase(), name, idToken: tokens.id_token || null }
}

/** URL odhlášení z SSO (ukončí i SSO session), nebo null bez SSO. */
export async function buildSsoLogoutUrl() {
  const config = getSsoConfig()
  if (!config) return null
  let endpoint = `${config.issuer}/end_session`
  try {
    const discovery = await getDiscovery(config)
    if (discovery.end_session_endpoint) endpoint = discovery.end_session_endpoint
  } catch {
    // výchozí /end_session jako SK ERP
  }
  const url = new URL(endpoint)
  url.search = new URLSearchParams({
    client_id: config.clientId,
    post_logout_redirect_uri: config.postLogoutRedirectUri
  }).toString()
  return url.toString()
}
