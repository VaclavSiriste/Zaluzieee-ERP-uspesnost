/**
 * Lidské názvy pauz z Daktely pro UI.
 */
const PAUSE_LABELS = {
  inactive: 'Neaktivní',
  wrap: 'Automatická pauza po hovoru'
}

export function formatPauseLabel(value) {
  const raw = String(value || '').trim()
  if (!raw) return 'Neznámá pauza'

  const key = raw.toLowerCase()
  if (PAUSE_LABELS[key]) return PAUSE_LABELS[key]

  return raw
}

/**
 * SQL výraz: surový název pauzy (title → name → id).
 */
export const PAUSE_RAW_NAME_SQL = `
  COALESCE(NULLIF(TRIM(p.title), ''), NULLIF(TRIM(p.name), ''), ps.pause, 'Neznámá pauza')
`

/**
 * SQL výraz: zobrazený český název.
 */
export const PAUSE_DISPLAY_NAME_SQL = `
  CASE
    WHEN LOWER(COALESCE(NULLIF(TRIM(p.title), ''), NULLIF(TRIM(p.name), ''), ps.pause, '')) = 'inactive'
      OR LOWER(COALESCE(p.type, '')) = 'lajdak'
      OR ps.pause = '666'
      THEN 'Neaktivní'
    WHEN LOWER(COALESCE(NULLIF(TRIM(p.title), ''), NULLIF(TRIM(p.name), ''), ps.pause, '')) = 'wrap'
      OR LOWER(COALESCE(p.type, '')) = 'wrap'
      OR ps.pause = '20'
      THEN 'Automatická pauza po hovoru'
    ELSE COALESCE(NULLIF(TRIM(p.title), ''), NULLIF(TRIM(p.name), ''), ps.pause, 'Neznámá pauza')
  END
`
