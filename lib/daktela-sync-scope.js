/**
 * Mapování stránky Prvni → Daktela sync skripty (jen co stránka potřebuje).
 */

export const ALLOWED_SYNC_SCRIPTS = [
  'user',
  'pause',
  'pause-sessions',
  'login-sessions',
  'ready-sessions',
  'call',
  'email'
]

export const SCRIPT_LABELS = {
  user: 'Uživatelé',
  pause: 'Typy pauz',
  'pause-sessions': 'Pauzy',
  'login-sessions': 'Přihlášení (login)',
  'ready-sessions': 'Doba přihlášení (ready)',
  call: 'Hovory',
  email: 'Maily'
}

const FULL_DASHBOARD = [
  'user',
  'pause',
  'pause-sessions',
  'login-sessions',
  'ready-sessions',
  'call',
  'email'
]

/** SLA příchozí + nedovolané callbacky → hlavně hovory */
const OPS_CALL = ['call', 'user']

/** Docházka → operátoři + ready/login */
const DOCHAZKA = ['user', 'ready-sessions', 'login-sessions']

/**
 * @param {string} pathname
 * @returns {{
 *   scripts: string[],
 *   label: string,
 *   needsDaktela: boolean,
 *   estimateMinutes: number
 * }}
 */
export function resolveSyncScopeForPath(pathname) {
  const path = String(pathname || '').split('?')[0].replace(/\/$/, '') || '/'

  if (
    path === '/rizeni-provozu' ||
    path === '/rizeni-provozu-sk' ||
    path === '/rizeni-provozu-malujemeee' ||
    path === '/rizeni-provozu-pokladamee' ||
    path === '/rizeni-provozu-venkovky'
  ) {
    return {
      scripts: [...OPS_CALL],
      label: 'Hovory (SLA / nedovoláno)',
      needsDaktela: true,
      estimateMinutes: 5
    }
  }

  if (path === '/pauzy-operatoru') {
    return {
      scripts: [...FULL_DASHBOARD],
      label: 'Pauzy + hovory + maily',
      needsDaktela: true,
      estimateMinutes: 12
    }
  }

  if (path === '/dochazka') {
    return {
      scripts: [...DOCHAZKA],
      label: 'Docházka (ready / login)',
      needsDaktela: true,
      estimateMinutes: 6
    }
  }

  // ERP-only stránky — Daktela sync není potřeba
  return {
    scripts: [],
    label: 'Tato stránka bere data z ERP (Daktela sync netřeba)',
    needsDaktela: false,
    estimateMinutes: 0
  }
}

export function normalizeSyncScripts(input) {
  const allowed = new Set(ALLOWED_SYNC_SCRIPTS)
  const list = Array.isArray(input)
    ? input
    : String(input || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)

  const unique = []
  for (const id of list) {
    if (!allowed.has(id)) continue
    if (!unique.includes(id)) unique.push(id)
  }
  return unique
}

export function formatScriptsLabel(scripts) {
  if (!scripts?.length) return 'nic'
  return scripts.map((id) => SCRIPT_LABELS[id] || id).join(', ')
}
