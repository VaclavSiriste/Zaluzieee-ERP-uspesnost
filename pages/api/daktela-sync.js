/**
 * POST /api/daktela-sync – spustí stahování dat z Daktely do Supabase
 * GET  /api/daktela-sync – stav syncu + čerstvost dat v DB
 *
 * Body POST (volitelné): { pathname, scripts[] }
 * Spouštění (POST) jen pro vybrané e-maily (canTriggerDaktelaSync).
 */
import { AUTH_COOKIE_NAME, verifyAuthToken } from '@/lib/auth'
import { canTriggerDaktelaSync } from '@/lib/access-control'
import { startDaktelaSync, getDaktelaSyncStatus } from '@/lib/daktela-sync'
import { resolveSyncScopeForPath } from '@/lib/daktela-sync-scope'

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const parts = raw.split(';')
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

function getSessionEmail(req) {
  const token = readCookie(req, AUTH_COOKIE_NAME)
  const session = verifyAuthToken(token)
  return session?.email || ''
}

function readJsonBody(req) {
  if (!req.body) return {}
  if (typeof req.body === 'object') return req.body
  try {
    return JSON.parse(req.body)
  } catch {
    return {}
  }
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const pathname = typeof req.query?.pathname === 'string' ? req.query.pathname : ''
      const status = await getDaktelaSyncStatus()
      const scope = pathname ? resolveSyncScopeForPath(pathname) : null
      return res.status(200).json({
        ...status,
        pageScope: scope
      })
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Nepodařilo se načíst stav syncu' })
    }
  }

  if (req.method === 'POST') {
    try {
      const email = getSessionEmail(req)
      if (!email) {
        return res.status(401).json({ error: 'Nejste přihlášeni' })
      }
      if (!canTriggerDaktelaSync(email)) {
        return res.status(403).json({
          error: 'Nemáte oprávnění spouštět stahování dat z Daktely.'
        })
      }

      const body = readJsonBody(req)
      const pathname = typeof body.pathname === 'string' ? body.pathname : ''
      const scripts = Array.isArray(body.scripts) ? body.scripts : undefined

      const result = await startDaktelaSync({ pathname, scripts })
      if (result.skipped) {
        return res.status(200).json({
          ok: true,
          ...result,
          status: await getDaktelaSyncStatus()
        })
      }
      const status = await getDaktelaSyncStatus()
      return res.status(result.alreadyRunning ? 409 : 200).json({
        ok: true,
        ...result,
        status
      })
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Nepodařilo se spustit synchronizaci' })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
