/**
 * Přístupová práva dashboardu podle e-mailu.
 * role "operators" = vidí jen menu sekci Operátoři (+ související stránky).
 *
 * Seznam e-mailů je editovatelný (Činnosti operátorů → Přístup) a ukládá se
 * do .runtime-cache/operators-only-emails.json (jen na serveru).
 *
 * Tento modul je bezpečný i pro klienta (bez fs). Async funkce dynamicky
 * načtou store jen na serveru.
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

export async function getAccessRole(email) {
  const normalized = normalizeEmail(email)
  if (!normalized) return ACCESS_ROLES.FULL
  const { isOperatorsOnlyEmail } = await import('@/lib/operators-only-store')
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
  return {
    email: normalizeEmail(email),
    role,
    homePath: role === ACCESS_ROLES.OPERATORS ? OPERATORS_HOME_PATH : '/',
    canSeeOverview: role === ACCESS_ROLES.FULL,
    canSeeOperators: true,
    canSeeOperations: role === ACCESS_ROLES.FULL,
    canSeeFailedOrders: role === ACCESS_ROLES.FULL,
    canManageOperatorsAccess: role === ACCESS_ROLES.FULL
  }
}
