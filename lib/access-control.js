/**
 * Přístupová práva — klientsky bezpečná část (bez fs).
 */

export const ACCESS_ROLES = {
  FULL: 'full',
  OPERATORS: 'operators'
}

/** Domovská stránka pro uživatele s rolí operators. */
export const OPERATORS_HOME_PATH = '/pauzy-operatoru'

/** Stránky v sekci Operátoři (prefixy cest). */
export const OPERATORS_ALLOWED_PATHS = [
  '/operators',
  '/pauzy-operatoru',
  '/dochazka',
  '/vycet-sla',
  '/targety'
]

export function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

/** Kdo smí spouštět stahování dat z Daktely. */
export const DAKTELA_SYNC_ALLOWED_EMAILS = [
  'filip.vymyslicky@zaluzieee.cz',
  'lucie.francisci@zaluzieee.cz',
  'stepan.nedoma@zaluzieee.cz',
  'bara.tkacova@zaluzieee.cz'
]

export function canTriggerDaktelaSync(email) {
  return DAKTELA_SYNC_ALLOWED_EMAILS.includes(normalizeEmail(email))
}

export function isOperatorsPathAllowed(pathname) {
  const path = String(pathname || '').split('?')[0]
  if (!path) return false
  return OPERATORS_ALLOWED_PATHS.some(
    (allowed) => path === allowed || path.startsWith(`${allowed}/`)
  )
}

/** Cesty vždy povolené (auth, assety). */
export function isPublicOrAuthPath(pathname) {
  return (
    pathname === '/login' ||
    pathname.startsWith('/_next/') ||
    pathname === '/favicon.ico' ||
    pathname.startsWith('/api/auth/')
  )
}

/** Synchronní kontrola cesty při známé roli (AccessGate). */
export function canAccessPathWithRole(role, pathname) {
  if (isPublicOrAuthPath(pathname)) return true
  if (pathname.startsWith('/api/')) return true
  if (role !== ACCESS_ROLES.OPERATORS) return true
  return isOperatorsPathAllowed(pathname)
}

export function buildAccessProfile(email, role) {
  const resolvedRole = role || ACCESS_ROLES.FULL
  const normalized = normalizeEmail(email)
  return {
    email: normalized,
    role: resolvedRole,
    homePath: resolvedRole === ACCESS_ROLES.OPERATORS ? OPERATORS_HOME_PATH : '/',
    canSeeOverview: resolvedRole === ACCESS_ROLES.FULL,
    canSeeOperators: true,
    canSeeOperations: resolvedRole === ACCESS_ROLES.FULL,
    canSeeFailedOrders: resolvedRole === ACCESS_ROLES.FULL,
    canManageOperatorsAccess: resolvedRole === ACCESS_ROLES.FULL,
    canTriggerDaktelaSync: canTriggerDaktelaSync(normalized)
  }
}
