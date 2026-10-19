/**
 * Návrat z Demaxia SSO: ověření, vytvoření session cookie dashboardu, přesměrování.
 * GET /api/auth/sso/callback?code=&state=
 */

import { buildAuthCookie, createAuthToken, isAllowedEmail } from '@/lib/auth'
import { OPERATORS_HOME_PATH } from '@/lib/access-control'
import { canAccessPath, getHomePathForEmail } from '@/lib/access-control-server'
import { clearFlowCookie, finishLogin, readFlowCookie } from '@/lib/sso'

function redirect(res, location, cookies) {
  res.setHeader('Set-Cookie', cookies)
  res.writeHead(302, { Location: location })
  res.end()
}

export default async function handler(req, res) {
  const clear = clearFlowCookie()

  if (typeof req.query.error === 'string') {
    console.warn('sso callback error:', req.query.error, req.query.error_description || '')
    return redirect(res, '/login?error=sso_denied', [clear])
  }

  try {
    const flow = readFlowCookie(req)
    const { email } = await finishLogin({
      code: typeof req.query.code === 'string' ? req.query.code : '',
      state: typeof req.query.state === 'string' ? req.query.state : '',
      flow
    })

    if (!isAllowedEmail(email)) {
      return redirect(res, '/login?error=sso_domain', [clear])
    }

    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : ''
    const session = `${buildAuthCookie(createAuthToken(email))}${secure}`

    // návrat na původní stránku, jen když na ni uživatel smí — stejně jako magický odkaz (auth/verify)
    const requested = flow?.next || '/'
    let next = requested
    try {
      next = (await canAccessPath(email, requested)) ? requested : await getHomePathForEmail(email)
    } catch (error) {
      console.warn('sso callback access:', error.message)
      next = OPERATORS_HOME_PATH
    }

    return redirect(res, next, [clear, session])
  } catch (error) {
    console.error('sso callback:', error.message)
    return redirect(res, '/login?error=sso_failed', [clear])
  }
}
