/**
 * Rozlišení odmítnutých hovorů (answered = false) podle Daktela disposition/disconnection.
 *
 * Operátor: disposition_cause = agent a zrušení/opuštění (cancel, abandon).
 * Zákazník: disposition_cause = caller, nebo nezvednutí/busy/failed (noanswer, busy, failed).
 * System timeout (exitwithtimeout) zůstává jen v celkovém rejected_calls.
 */

export const REJECTED_BY_OPERATOR_SQL = `
  LOWER(TRIM(COALESCE(c.disposition_cause, ''))) = 'agent'
  AND LOWER(TRIM(COALESCE(c.disconnection_cause, ''))) IN ('cancel', 'abandon')
`

export const REJECTED_BY_CUSTOMER_SQL = `
  (
    LOWER(TRIM(COALESCE(c.disposition_cause, ''))) = 'caller'
    OR LOWER(TRIM(COALESCE(c.disconnection_cause, ''))) IN ('busy', 'noanswer', 'failed')
  )
`

export function rejectedByFilterSql(rejectedBy) {
  const key = String(rejectedBy || '').toLowerCase()
  if (key === 'operator' || key === 'agent') {
    return `AND (${REJECTED_BY_OPERATOR_SQL})`
  }
  if (key === 'customer' || key === 'caller') {
    return `AND (${REJECTED_BY_CUSTOMER_SQL})`
  }
  return ''
}

export const REJECTED_BY_LABELS = {
  operator: 'Odmítnuté operátorem',
  customer: 'Odmítnuté zákazníkem',
  all: 'Odmítnuté hovory'
}
