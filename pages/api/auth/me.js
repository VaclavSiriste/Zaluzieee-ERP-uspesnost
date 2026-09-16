/**
 * GET /api/auth/me — aktuální uživatel + přístupová práva (live seznam)
 */

import { verifyAuthToken, AUTH_COOKIE_NAME } from '@/lib/auth'
import { getAccessProfile } from '@/lib/access-control'

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

  const token = readCookie(req, AUTH_COOKIE_NAME)
  const session = verifyAuthToken(token)
  if (!session?.email) {
    return res.status(401).json({ error: 'Nejste přihlášeni' })
  }

  const profile = await getAccessProfile(session.email)
  return res.status(200).json(profile)
}
