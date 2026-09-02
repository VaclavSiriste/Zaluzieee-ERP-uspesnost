/**
 * Metriky požadavků operátora.
 *
 * 1. čistý čas (h) = doba přihlášení − nečinnost (ve filtrovaném období)
 * 2. čistý čas ve dnech = (h × 3) ÷ 24
 * 3. požadavky / den = celkem požadavků ÷ čistý čas ve dnech
 */

export function computeCleanDays(clean_hours) {
  const hours = Number(clean_hours) || 0
  if (hours <= 0) return 0
  return (hours * 3) / 24
}

/** Součet požadavků ve filtrovaném období: příchozí + odchozí hovory + maily. */
export function computeTotalRequests({ outgoing_calls = 0, incoming_calls = 0, email_count = 0 }) {
  return (Number(outgoing_calls) || 0) + (Number(incoming_calls) || 0) + (Number(email_count) || 0)
}

export function computeRequestsPerDay({ total_requests, clean_hours, clean_days }) {
  const total = Number(total_requests) || 0
  const days = Number(clean_days) || computeCleanDays(clean_hours)
  if (total <= 0 || days <= 0) return 0
  return total / days
}

/** Popisek vzorce pod metrikou Požadavky / den. */
export function formatRequestsFormulaHint({ total_requests, clean_hours, clean_days }) {
  const total = Number(total_requests) || 0
  const hours = Number(clean_hours) || 0
  const days = Number(clean_days) || computeCleanDays(hours)
  if (total <= 0 || days <= 0) return 'rozkliknout požadavky'
  const hoursLabel = hours.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })
  const daysLabel = days.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })
  return `${total.toLocaleString('cs-CZ')} ÷ ${daysLabel} d (${hoursLabel} h × 3 ÷ 24)`
}
