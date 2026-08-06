/**
 * Skupiny pauz pro sumarizaci / drilldown (Administrativa, Nečinnost).
 * Obsahuje raw i české display názvy (kvůli PAUSE_DISPLAY_NAME_SQL).
 */

export const ADMIN_PAUSE_NAMES = [
  'inactive',
  'neaktivní',
  'konzultace s koordinátorem',
  'konzultace s koordinatorom',
  'nestandartní situace',
  'nestandardní situace',
  'wrap',
  'automatická pauza po hovoru',
  'zápis po hovoru',
  'zapis po hovoru'
]

export const IDLE_PAUSE_NAMES = [
  'obědy',
  'obedy',
  'krátká pauza',
  'kratka pauza',
  'školení',
  'skoleni',
  'pohovor s tl',
  'porada',
  'porada '
]

export function pauseGroupNames(group) {
  if (group === 'admin') return ADMIN_PAUSE_NAMES.map((v) => v.toLowerCase())
  if (group === 'idle') return IDLE_PAUSE_NAMES.map((v) => v.toLowerCase())
  return []
}
