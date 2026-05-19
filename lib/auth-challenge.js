import { createHmac, createHash, randomInt, timingSafeEqual } from 'crypto'

const CHALLENGE_TTL_MS = 15 * 60 * 1000

function getSecret() {
  return process.env.APP_AUTH_SECRET || 'local-dashboard-auth-secret'
}

function signPayload(payload) {
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url')
  const signature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  return `${encoded}.${signature}`
}

export function verifySignedPayload(token) {
  if (!token || typeof token !== 'string' || !token.includes('.')) return null

  const [encoded, providedSignature] = token.split('.')
  if (!encoded || !providedSignature) return null

  const expectedSignature = createHmac('sha256', getSecret()).update(encoded).digest('base64url')
  const providedBuffer = Buffer.from(providedSignature)
  const expectedBuffer = Buffer.from(expectedSignature)

  if (
    providedBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null
  }

  try {
    return JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

export function generateLoginCode() {
  return String(randomInt(100000, 999999))
}

function hashCode(code) {
  return createHash('sha256').update(String(code).trim()).digest('base64url')
}

export function createCodeChallenge(email, code) {
  return signPayload({
    type: 'code',
    email,
    codeHash: hashCode(code),
    exp: Date.now() + CHALLENGE_TTL_MS
  })
}

export function verifyCodeChallenge(challengeId, code, email) {
  const payload = verifySignedPayload(challengeId)
  if (!payload || payload.type !== 'code') return false
  if (payload.email !== email) return false
  if (Number(payload.exp) < Date.now()) return false
  return hashCode(code) === payload.codeHash
}

export function createMagicLoginToken(email, nextPath = '/') {
  const safeNext = typeof nextPath === 'string' && nextPath.startsWith('/') ? nextPath : '/'
  return signPayload({
    type: 'magic',
    email,
    next: safeNext,
    exp: Date.now() + CHALLENGE_TTL_MS
  })
}

export function verifyMagicLoginToken(token) {
  const payload = verifySignedPayload(token)
  if (!payload || payload.type !== 'magic') return null
  if (Number(payload.exp) < Date.now()) return null
  return payload
}
