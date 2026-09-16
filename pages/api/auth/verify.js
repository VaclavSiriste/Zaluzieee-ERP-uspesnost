import { buildAuthCookie, createAuthToken, isAllowedEmail } from '@/lib/auth'
import { verifyMagicLoginToken } from '@/lib/auth-challenge'
import { canAccessPath, getHomePathForEmail } from '@/lib/access-control-server'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const token = typeof req.query.token === 'string' ? req.query.token : ''
  const nextFromQuery =
    typeof req.query.next === 'string' && req.query.next.startsWith('/') ? req.query.next : '/'

  const payload = verifyMagicLoginToken(token)
  if (!payload || !isAllowedEmail(payload.email)) {
    const loginUrl = `/login?error=${encodeURIComponent('Odkaz je neplatný nebo vypršel.')}`
    res.writeHead(302, { Location: loginUrl })
    res.end()
    return
  }

  const sessionToken = createAuthToken(payload.email)
  const secure = process.env.NODE_ENV === 'production'
  const requested = payload.next || nextFromQuery
  const allowed = await canAccessPath(payload.email, requested)
  const nextPath = allowed ? requested : await getHomePathForEmail(payload.email)

  res.setHeader('Set-Cookie', `${buildAuthCookie(sessionToken)}${secure ? '; Secure' : ''}`)
  res.writeHead(302, { Location: nextPath })
  res.end()
}
