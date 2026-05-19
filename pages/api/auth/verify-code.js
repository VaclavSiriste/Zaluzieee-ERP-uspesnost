import { buildAuthCookie, createAuthToken, isAllowedEmail, getAllowedDomain } from '@/lib/auth'
import { verifyCodeChallenge } from '@/lib/auth-challenge'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  const code = typeof req.body?.code === 'string' ? req.body.code.trim() : ''
  const challengeId = typeof req.body?.challengeId === 'string' ? req.body.challengeId : ''

  if (!isAllowedEmail(email)) {
    return res.status(400).json({
      error: `Povolené jsou pouze e-maily s doménou ${getAllowedDomain()}.`
    })
  }

  if (!/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: 'Zadejte šestimístný kód z e-mailu.' })
  }

  if (!challengeId || !verifyCodeChallenge(challengeId, code, email)) {
    return res.status(401).json({ error: 'Neplatný nebo expirovaný kód. Požádejte o nový.' })
  }

  const token = createAuthToken(email)
  const secure = process.env.NODE_ENV === 'production'
  res.setHeader('Set-Cookie', `${buildAuthCookie(token)}${secure ? '; Secure' : ''}`)

  return res.status(200).json({ ok: true, email })
}
