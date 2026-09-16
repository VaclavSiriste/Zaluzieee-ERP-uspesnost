/**
 * Přístupová práva — jen server (čte .runtime-cache přes fs).
 * Nepoužívej z komponent / _app / AccessGate.
 */

import { isOperatorsOnlyEmail } from '@/lib/operators-only-store'
import {
  ACCESS_ROLES,
  OPERATORS_HOME_PATH,
  buildAccessProfile,
  isOperatorsPathAllowed,
  isPublicOrAuthPath,
  normalizeEmail
} from '@/lib/access-control'

export async function getAccessRole(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return ACCESS_ROLES.FULL
  if (await isOperatorsOnlyEmail(normalized)) return ACCESS_ROLES.OPERATORS
  return ACCESS_ROLES.FULL
}

export async function isOperatorsOnly(email) {
  return (await getAccessRole(email)) === ACCESS_ROLES.OPERATORS
}

export async function canAccessPath(email, pathname) {
  if (isPublicOrAuthPath(pathname)) return true
  if (pathname.startsWith('/api/')) return true
  if (!(await isOperatorsOnly(email))) return true
  return isOperatorsPathAllowed(pathname)
}

export async function getHomePathForEmail(email) {
  return (await isOperatorsOnly(email)) ? OPERATORS_HOME_PATH : '/'
}

export async function getAccessProfile(email) {
  const role = await getAccessRole(email)
  return buildAccessProfile(email, role)
}
