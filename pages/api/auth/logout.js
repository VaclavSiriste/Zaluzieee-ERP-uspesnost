import { buildLogoutCookie } from '@/lib/auth'

export default async function handler(req, res) {
  const redirect = typeof req.query.redirect === 'string' && req.query.redirect.startsWith('/')
    ? req.query.redirect
    : '/login'
  const secure = process.env.NODE_ENV === 'production'

  res.setHeader(
    'Set-Cookie',
    `${buildLogoutCookie()}${secure ? '; Secure' : ''}`
  )
  res.writeHead(302, { Location: redirect })
  res.end()
}
