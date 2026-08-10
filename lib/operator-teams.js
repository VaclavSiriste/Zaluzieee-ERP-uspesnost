/**
 * Týmy operátorů (Činnosti operátorů).
 * Výchozí rozřazení + override z localStorage.
 */

import { normalizeOperatorKey } from '@/lib/dopadl-hovor-metrics'

export const OPERATOR_TEAMS_KEY = 'prvni.operatorTeams.assignments'
export const OPERATOR_TEAM_FILTER_KEY = 'prvni.operatorTeams.activeFilter'

export const TEAM_IDS = {
  ALL: 'all',
  LUCIE: 'lucie',
  STEPAN: 'stepan',
  NONE: 'none'
}

export const TEAM_OPTIONS = [
  { id: TEAM_IDS.ALL, label: 'Všichni' },
  { id: TEAM_IDS.LUCIE, label: 'Tým Lucie' },
  { id: TEAM_IDS.STEPAN, label: 'Tým Štěpán' }
]

export const TEAM_ASSIGN_OPTIONS = [
  { id: TEAM_IDS.LUCIE, label: 'Tým Lucie' },
  { id: TEAM_IDS.STEPAN, label: 'Tým Štěpán' },
  { id: TEAM_IDS.NONE, label: 'Bez týmu' }
]

const DEFAULT_TEAM_NAMES = {
  [TEAM_IDS.LUCIE]: [
    'Veronika Kubínová',
    'Veronika Prchlíková',
    'Eva Kurečková',
    'Karolína Sachmerdová',
    'Katrin Slivoňová',
    'Martina Štendová',
    'Matěj Minárik',
    'Lenka Herrmannová'
  ],
  [TEAM_IDS.STEPAN]: [
    'Sandra Poslušná',
    'Barbora Kaločová',
    'Kristýna Kluzová',
    'Lucie Burdová',
    'Kristýna Poranská',
    'Eliška Sandany',
    'Denis Hošala',
    'Radka Hrnčířová',
    'Veronika Ondrušová'
  ]
}

const DEFAULT_TEAM_BY_NAME = (() => {
  const map = new Map()
  for (const [teamId, names] of Object.entries(DEFAULT_TEAM_NAMES)) {
    for (const name of names) {
      map.set(normalizeOperatorKey(name), teamId)
    }
  }
  return map
})()

export function teamLabel(teamId) {
  if (teamId === TEAM_IDS.LUCIE) return 'Tým Lucie'
  if (teamId === TEAM_IDS.STEPAN) return 'Tým Štěpán'
  if (teamId === TEAM_IDS.NONE) return 'Bez týmu'
  return 'Všichni'
}

export function readTeamAssignments() {
  if (typeof window === 'undefined') return {}
  try {
    const raw = localStorage.getItem(OPERATOR_TEAMS_KEY)
    const parsed = raw ? JSON.parse(raw) : {}
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {}
    const out = {}
    for (const [id, team] of Object.entries(parsed)) {
      if (team === TEAM_IDS.LUCIE || team === TEAM_IDS.STEPAN || team === TEAM_IDS.NONE) {
        out[String(id)] = team
      }
    }
    return out
  } catch {
    return {}
  }
}

export function writeTeamAssignments(assignments) {
  if (typeof window === 'undefined') return
  localStorage.setItem(OPERATOR_TEAMS_KEY, JSON.stringify(assignments || {}))
}

export function readActiveTeamFilter() {
  if (typeof window === 'undefined') return TEAM_IDS.ALL
  try {
    const value = localStorage.getItem(OPERATOR_TEAM_FILTER_KEY)
    if (value === TEAM_IDS.LUCIE || value === TEAM_IDS.STEPAN || value === TEAM_IDS.ALL) {
      return value
    }
  } catch {
    /* ignore */
  }
  return TEAM_IDS.ALL
}

export function writeActiveTeamFilter(teamId) {
  if (typeof window === 'undefined') return
  localStorage.setItem(OPERATOR_TEAM_FILTER_KEY, teamId)
}

export function resolveOperatorTeam(operator, assignments = {}) {
  const id = String(operator?.operator_id || '')
  if (id && Object.prototype.hasOwnProperty.call(assignments, id)) {
    return assignments[id]
  }
  const byName = DEFAULT_TEAM_BY_NAME.get(normalizeOperatorKey(operator?.operator_name))
  return byName || TEAM_IDS.NONE
}

export function operatorMatchesTeamFilter(operator, teamFilter, assignments = {}) {
  if (!teamFilter || teamFilter === TEAM_IDS.ALL) return true
  return resolveOperatorTeam(operator, assignments) === teamFilter
}
