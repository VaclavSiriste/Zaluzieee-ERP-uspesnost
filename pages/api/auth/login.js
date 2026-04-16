import { buildAuthCookie, createAuthToken, getAllowedDomain, isAllowedEmail } from '@/lib/auth'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''

  if (!isAllowedEmail(email)) {
    return res.status(400).json({
      error: `Povolené jsou pouze e-maily s doménou ${getAllowedDomain()}.`
    })
  }

  const token = createAuthToken(email)
  const secure = process.env.NODE_ENV === 'production'

  res.setHeader(
    'Set-Cookie',
    `${buildAuthCookie(token)}${secure ? '; Secure' : ''}`
  )

  return res.status(200).json({
    ok: true,
    email
  })
}
