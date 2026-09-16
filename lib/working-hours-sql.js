/**
 * Pracovní doba (Europe/Prague) — profily podle značky.
 *
 * Daktela `call.call_time` je `timestamp without time zone` a ukládá
 * už nástěnné hodiny Europe/Prague (session DB = UTC). Proto NEPŘEVÁDÍME
 * přes `AT TIME ZONE` — to by posunulo hodiny (např. So 10:00 → „mimo“).
 *
 * default:     Po–Pá 08:00–20:00 · So–Ne 10:00–18:00
 * weekday_8_16: Po–Pá 08:00–16:00 · víkendy = mimo (pokladamee)
 */

export const WORKING_HOURS_TZ = 'Europe/Prague'

export const WORKING_HOURS_PROFILES = {
  default: {
    id: 'default',
    label: 'Po–Pá 8:00–20:00 · So–Ne 10:00–18:00 · Europe/Prague',
    shortLabel: 'Po–Pá 8–20 · So–Ne 10–18'
  },
  weekday_8_16: {
    id: 'weekday_8_16',
    label: 'Po–Pá 8:00–16:00 · víkendy mimo · Europe/Prague',
    shortLabel: 'Po–Pá 8–16 (jen pracovní dny)'
  }
}

export const WORKING_HOURS_RULE = WORKING_HOURS_PROFILES.default.label

export function resolveWorkingHoursProfile(profileOrBrandId) {
  const raw = String(profileOrBrandId || '').trim().toLowerCase()
  if (WORKING_HOURS_PROFILES[raw]) return WORKING_HOURS_PROFILES[raw]
  if (raw === 'pokladamee') return WORKING_HOURS_PROFILES.weekday_8_16
  return WORKING_HOURS_PROFILES.default
}

/**
 * Lokální nástěnné hodiny z Daktela call_time (už Prague, bez TZ).
 * Neměnit na AT TIME ZONE — DB session je UTC a posunulo by to hodiny.
 */
export function buildPragueLocalTimestampSql(tsExpr) {
  return `(${tsExpr})::timestamp`
}

/**
 * SQL boolean výraz — `tsExpr` je Daktela call_time (timestamp without time zone).
 * @param {string} tsExpr
 * @param {{ profile?: string, brandId?: string }} [options]
 */
export function buildIsWorkingHoursSql(tsExpr, options = {}) {
  const profile = resolveWorkingHoursProfile(options.profile || options.brandId)
  const local = buildPragueLocalTimestampSql(tsExpr)

  if (profile.id === 'weekday_8_16') {
    return `
    CASE
      WHEN EXTRACT(ISODOW FROM ${local}) BETWEEN 1 AND 5
        THEN EXTRACT(HOUR FROM ${local}) >= 8
         AND EXTRACT(HOUR FROM ${local}) < 16
      ELSE FALSE
    END
  `
  }

  return `
    CASE
      WHEN EXTRACT(ISODOW FROM ${local}) BETWEEN 1 AND 5
        THEN EXTRACT(HOUR FROM ${local}) >= 8
         AND EXTRACT(HOUR FROM ${local}) < 20
      ELSE EXTRACT(HOUR FROM ${local}) >= 10
         AND EXTRACT(HOUR FROM ${local}) < 18
    END
  `
}
