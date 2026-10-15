/**
 * Termín callbacku (preferované datum + čas) — normalizace, „po termínu“ a řazení.
 * Bez importů, použitelné na serveru i v prohlížeči.
 *
 * ERP ukládá datum jako YYYY-MM-DD (občas „Invalid DateTime“ → bez termínu),
 * čas jako HH:MM nebo HH:MM:SS (občas text typu „odpoledne“ → čas se ignoruje).
 */

const DAY_RE = /^(\d{4})-(\d{2})-(\d{2})/
const CZ_DAY_RE = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/
const TIME_RE = /^(\d{1,2}):(\d{2})/

export function normalizeCallbackDay(value) {
  const text = String(value || '').trim()
  const iso = text.match(DAY_RE)
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`
  const cz = text.match(CZ_DAY_RE)
  if (cz) return `${cz[3]}-${cz[2].padStart(2, '0')}-${cz[1].padStart(2, '0')}`
  return null
}

export function normalizeCallbackTime(value) {
  const match = String(value || '').trim().match(TIME_RE)
  if (!match) return null
  return `${match[1].padStart(2, '0')}:${match[2]}`
}

/** „Teď“ v Praze jako YYYY-MM-DD HH:MM (porovnatelné jako řetězec). */
export function pragueNowKey(now = new Date()) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: 'Europe/Prague',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`
}

/**
 * Klíč termínu pro řazení: „YYYY-MM-DD HH:MM“ (bez času → konec dne), bez data → null.
 */
export function callbackDueKey(date, time) {
  const day = normalizeCallbackDay(date)
  if (!day) return null
  return `${day} ${normalizeCallbackTime(time) || '23:59'}`
}

/** overdue (po termínu) / today (dnes, ještě ne) / planned / missing (bez termínu) */
export function callbackDueState(date, time, nowKey = pragueNowKey()) {
  const key = callbackDueKey(date, time)
  if (!key) return 'missing'
  if (key < nowKey) return 'overdue'
  if (key.slice(0, 10) === nowKey.slice(0, 10)) return 'today'
  return 'planned'
}

/** Vzestupně podle termínu, bez termínu na konec. */
export function compareCallbackDue(a, b) {
  const ka = callbackDueKey(a.callback_date, a.callback_time)
  const kb = callbackDueKey(b.callback_date, b.callback_time)
  if (ka === kb) return 0
  if (!ka) return 1
  if (!kb) return -1
  return ka < kb ? -1 : 1
}
