/**
 * Pracovní doba (Europe/Prague):
 *   Po–Pá 08:00–20:00 · So–Ne 10:00–18:00
 */

export const WORKING_HOURS_TZ = 'Europe/Prague'
export const WORKING_HOURS_RULE =
  'Po–Pá 8:00–20:00 · So–Ne 10:00–18:00 · Europe/Prague'

/** SQL boolean výraz — `tsExpr` je timestamptz sloupec/výraz. */
export function buildIsWorkingHoursSql(tsExpr) {
  const local = `(${tsExpr} AT TIME ZONE '${WORKING_HOURS_TZ}')`
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
