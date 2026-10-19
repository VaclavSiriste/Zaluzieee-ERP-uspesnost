/**
 * Začátek přihlášení přes Demaxia SSO → přesměrování na access.systeeem.cz
 * GET /api/auth/sso/login?next=/cesta
 */

import { isSsoEnabled, startLogin } from '@/lib/sso'

export default async function handler(req, res) {
  if (!isSsoEnabled()) {
    res.writeHead(302, { Location: '/login?error=sso_off' })
    return res.end()
  }
  try {
    const next = typeof req.query.next === 'string' ? req.query.next : '/'
    const { url, cookie } = await startLogin(next)
    res.setHeader('Set-Cookie', cookie)
    res.writeHead(302, { Location: url })
    return res.end()
  } catch (error) {
    console.error('sso login:', error.message)
    res.writeHead(302, { Location: '/login?error=sso_unavailable' })
    return res.end()
  }
}
