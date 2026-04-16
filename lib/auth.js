import { createHmac, timingSafeEqual } from 'crypto'

const AUTH_COOKIE_NAME = 'dashboard_auth'
const AUTH_DURATION_MS = 12 * 60 * 60 * 1000
const ALLOWED_DOMAIN = 'zaluzieee.cz'

function getAuthSecret() {
  return process.env.APP_AUTH_SECRET || 'local-dashboard-auth-secret'
}

function toBase64Url(value) {
  return Buffer.from(value).toString('base64url')
}

function fromBase64Url(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function sign(value) {
  return createHmac('sha256', getAuthSecret()).update(value).digest('base64url')
}

export function isAllowedEmail(email) {
  if (typeof email !== 'string') return false
  const normalized = email.trim().toLowerCase()
  return /^[^\s@]+@zaluzieee\.cz$/.test(normalized)
}

export function createAuthToken(email) {
  const normalizedEmail = email.trim().toLowerCase()
  const payload = {
    email: normalizedEmail,
    exp: Date.now() + AUTH_DURATION_MS
  }
  const encodedPayload = toBase64Url(JSON.stringify(payload))
  const signature = sign(encodedPayload)
  return `${encodedPayload}.${signature}`
}

export function verifyAuthToken(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null

  const [encodedPayload, providedSignature] = token.split('.')
  if (!encodedPayload || !providedSignature) return null

  const expectedSignature = sign(encodedPayload)
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload))
    if (!payload?.email || !payload?.exp) return null
    if (!isAllowedEmail(payload.email)) return null
    if (Number(payload.exp) < Date.now()) return null

    return {
      email: payload.email,
      exp: Number(payload.exp)
    }
  } catch {
    return null
  }
}

export function buildAuthCookie(token) {
  return `${AUTH_COOKIE_NAME}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(
    AUTH_DURATION_MS / 1000
  )}`
}

export function buildLogoutCookie() {
  return `${AUTH_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`
}

export function getAuthCookieName() {
  return AUTH_COOKIE_NAME
}

export function getAllowedDomain() {
  return ALLOWED_DOMAIN
}
