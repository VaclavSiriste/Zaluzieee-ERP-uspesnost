import { buildLogoutCookie } from '@/lib/auth'
import { buildSsoLogoutUrl } from '@/lib/sso'

export default async function handler(req, res) {
  const redirect = typeof req.query.redirect === 'string' && req.query.redirect.startsWith('/')
    ? req.query.redirect
    : '/login'
  const secure = process.env.NODE_ENV === 'production'

  res.setHeader('Set-Cookie', `${buildLogoutCookie()}${secure ? '; Secure' : ''}`)

  // se SSO odhlásit i z access.systeeem.cz, jinak by další „Přihlásit přes SSO“ proběhlo bez dotazu
  let location = redirect
  try {
    location = (await buildSsoLogoutUrl()) || redirect
  } catch (error) {
    console.warn('logout sso:', error.message)
  }
  res.writeHead(302, { Location: location })
  res.end()
}
