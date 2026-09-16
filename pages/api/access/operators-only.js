/**
 * Správa e-mailů s přístupem jen k sekci Operátoři
 * GET /api/access/operators-only
 * POST { email }
 * DELETE { email }  (nebo ?email=)
 */

import { verifyAuthToken, AUTH_COOKIE_NAME } from '@/lib/auth'
import { getAccessProfile } from '@/lib/access-control-server'
import {
  addOperatorsOnlyEmail,
  listOperatorsOnlyEmails,
  removeOperatorsOnlyEmail
} from '@/lib/operators-only-store'

function readCookie(req, name) {
  const raw = req.headers.cookie || ''
  const parts = raw.split(';')
  for (const part of parts) {
    const [key, ...rest] = part.trim().split('=')
    if (key === name) return decodeURIComponent(rest.join('='))
  }
  return ''
}

async function requireFullAccess(req, res) {
  const token = readCookie(req, AUTH_COOKIE_NAME)
  const session = verifyAuthToken(token)
  if (!session?.email) {
    res.status(401).json({ error: 'Nejste přihlášeni' })
    return null
  }
  const profile = await getAccessProfile(session.email)
  if (!profile.canManageOperatorsAccess) {
    res.status(403).json({ error: 'Spravovat přístup smí jen uživatelé s plným oprávněním.' })
    return null
  }
  return profile
}

export default async function handler(req, res) {
  if (req.method === 'GET') {
    const profile = await requireFullAccess(req, res)
    if (!profile) return
    const emails = await listOperatorsOnlyEmails()
    return res.status(200).json({ emails, count: emails.length })
  }

  if (req.method === 'POST') {
    const profile = await requireFullAccess(req, res)
    if (!profile) return
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    try {
      const result = await addOperatorsOnlyEmail(email)
      return res.status(200).json(result)
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Nepodařilo se přidat e-mail' })
    }
  }

  if (req.method === 'DELETE') {
    const profile = await requireFullAccess(req, res)
    if (!profile) return
    const email =
      typeof req.body?.email === 'string'
        ? req.body.email
        : typeof req.query?.email === 'string'
          ? req.query.email
          : ''
    try {
      const result = await removeOperatorsOnlyEmail(email)
      return res.status(200).json(result)
    } catch (error) {
      return res.status(400).json({ error: error.message || 'Nepodařilo se odebrat e-mail' })
    }
  }

  res.setHeader('Allow', 'GET, POST, DELETE')
  return res.status(405).json({ error: 'Method not allowed' })
}
