import { NextResponse } from 'next/server'

const AUTH_COOKIE_NAME = 'dashboard_auth'
const AUTH_SECRET = process.env.APP_AUTH_SECRET || 'local-dashboard-auth-secret'

function isAllowedPath(pathname) {
  return (
    pathname === '/login' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/api/auth/')
  )
}

function toBase64Url(bytes) {
  let binary = ''
  for (const byte of bytes) {
    binary += String.fromCharCode(byte)
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function sign(value) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(AUTH_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value))
  return toBase64Url(new Uint8Array(signature))
}

function parsePayload(encodedPayload) {
  try {
    const normalized = encodedPayload.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    const json = atob(padded)
    return JSON.parse(json)
  } catch {
    return null
  }
}

function isAllowedEmail(email) {
  return (
    typeof email === 'string' &&
    /^[^\s@]+@(zaluzieee\.cz|demaxia\.cz)$/.test(email.trim().toLowerCase())
  )
}

async function hasValidSession(token) {
  if (!token || !token.includes('.')) return false

  const [encodedPayload, providedSignature] = token.split('.')
  if (!encodedPayload || !providedSignature) return false

  const expectedSignature = await sign(encodedPayload)
  if (providedSignature !== expectedSignature) return false

  const payload = parsePayload(encodedPayload)
  if (!payload?.email || !payload?.exp) return false
  if (!isAllowedEmail(payload.email)) return false
  if (Number(payload.exp) < Date.now()) return false

  return true
}

export async function middleware(request) {
  const { pathname, search } = request.nextUrl

  if (isAllowedPath(pathname)) {
    return NextResponse.next()
  }

  const token = request.cookies.get(AUTH_COOKIE_NAME)?.value
  if (await hasValidSession(token)) {
    return NextResponse.next()
  }

  const loginUrl = request.nextUrl.clone()
  loginUrl.pathname = '/login'
  loginUrl.search = `?next=${encodeURIComponent(`${pathname}${search}`)}`
  return NextResponse.redirect(loginUrl)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image).*)']
}
