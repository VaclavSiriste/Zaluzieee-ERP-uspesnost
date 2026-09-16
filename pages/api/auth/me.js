/**
 * GET /api/auth/me — aktuální uživatel + přístupová práva (live seznam)
 */

import { verifyAuthToken, AUTH_COOKIE_NAME } from '@/lib/auth'
import { ACCESS_ROLES, buildAccessProfile } from '@/lib/access-control'
import { getAccessProfile } from '@/lib/access-control-server'

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const parts = raw.split(';')
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    const token = readCookie(req, AUTH_COOKIE_NAME)
    const session = verifyAuthToken(token)
    if (!session?.email) {
      return res.status(401).json({ error: 'Nejste přihlášeni' })
    }

    try {
      const profile = await getAccessProfile(session.email)
      return res.status(200).json(profile)
    } catch (error) {
      console.error('auth/me profile:', error.message)
      // Fallback — plný přístup, ať UI nespadne
      return res.status(200).json(buildAccessProfile(session.email, ACCESS_ROLES.FULL))
    }
  } catch (error) {
    console.error('auth/me:', error.message)
    return res.status(500).json({ error: 'Chyba načtení session' })
  }
}
