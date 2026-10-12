/**
 * Fronty z ERP (Žaluzieee CZ / SK) — aktuální stav objednávek, ne zmeškané hovory z Daktely.
 *
 * Fronty (podle orders.status):
 * - Nový lead          — novy-lead
 * - Čeká na trasovače  — ceka-na-trasovace
 * - Emailová fronta    — stav obsahující „email“ / „e-mail“ (přesný slug v ERP neznáme,
 *                        ve výpisu je vidět skutečný status)
 * - Volat později      — status callback, nebo lead v některé z front výše s důvodem
 *                        „Volat později“ (proc_nedopadl_hovor = volat-pozdeji / volat-jindy).
 *                        Má přednost před ostatními frontami (lead je jen v jedné).
 *
 * Stáří = od poslední změny statusu na aktuální (orders_audit_log), fallback created_at.
 * Volat později: kdo zadal = autor poslední změny na callback / Volat později v audit logu,
 * na kdy = preferovane_datum + preferovany_cas.
 *
 * Snapshot — filtr období se neuplatní (fronta je to, co čeká teď).
 */

import { SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'
import { AGE_BUCKETS } from '@/lib/queue-backlog'
import { shouldSkipOrganizationFilter } from '@/lib/operations-brands'

export const ERP_QUEUES = [
  { key: 'novy-lead', label: 'Nový lead' },
  { key: 'ceka-na-trasovace', label: 'Čeká na trasovače' },
  { key: 'emailova-fronta', label: 'Emailová fronta' },
  { key: 'volat-pozdeji', label: 'Volat později' }
]

const CALLBACK_STATUS = 'callback'
const VOLAT_POZDEJI_REASONS = ['volat-pozdeji', 'volat-jindy']
const EMAIL_STATUS_PATTERN = 'e-?mail'

const STATUS_SQL = `LOWER(TRIM(COALESCE(o.status, '')))`

function latestColumnLateral(alias, slug) {
  return `
    LEFT JOIN LATERAL (
      SELECT NULLIF(TRIM(ocv.value), '') AS value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE ocv.order_id = o.id
        AND oc.slug = '${slug}'
      ORDER BY ocv.id DESC
      LIMIT 1
    ) ${alias} ON TRUE`
}

function buildSql({ organizationFilter, withAudit }) {
  const reasons = VOLAT_POZDEJI_REASONS.map((r) => `'${r}'`).join(', ')
  const enteredExpr = withAudit ? 'COALESCE(entered.created_at, o.created_at)' : 'o.created_at'
  const auditSelect = withAudit
    ? `cb.created_at AS callback_set_at,
       cb_user.name AS callback_set_by,`
    : `NULL::timestamp AS callback_set_at,
       NULL::text AS callback_set_by,`
  const auditJoins = withAudit
    ? `
    LEFT JOIN LATERAL (
      SELECT a.created_at
      FROM orders_audit_log a
      WHERE a.order_id = o.id
        AND a.action = 'updated'
        AND a.field = 'status'
        AND a.new_value = o.status
      ORDER BY a.created_at DESC
      LIMIT 1
    ) entered ON TRUE
    LEFT JOIN LATERAL (
      SELECT a.created_at, a.user_id
      FROM orders_audit_log a
      WHERE a.order_id = o.id
        AND (
          (a.field = 'status' AND LOWER(a.new_value) = '${CALLBACK_STATUS}')
          OR (a.field = 'proc_nedopadl_hovor' AND LOWER(a.new_value) IN (${reasons}))
        )
      ORDER BY a.created_at DESC
      LIMIT 1
    ) cb ON TRUE
    LEFT JOIN users cb_user ON cb_user.id = cb.user_id`
    : ''

  return `
    WITH base AS (
      SELECT o.id, o.status, o.created_at, o.customer_id
      FROM orders o
      WHERE (
          ${STATUS_SQL} IN ('novy-lead', 'ceka-na-trasovace', '${CALLBACK_STATUS}')
          OR o.status ~* '${EMAIL_STATUS_PATTERN}'
        )
        ${organizationFilter}
    )
    SELECT
      o.id AS order_id,
      o.status,
      o.created_at,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
      NULLIF(TRIM(c.phone), '') AS phone,
      COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
      duvod.value AS duvod_ne,
      pref_datum.value AS preferovane_datum,
      pref_cas.value AS preferovany_cas,
      ${enteredExpr} AS entered_at,
      GREATEST(0, EXTRACT(EPOCH FROM (CURRENT_TIMESTAMP - ${enteredExpr})) / 3600.0) AS age_h,
      ${auditSelect}
      CASE
        WHEN ${STATUS_SQL} = '${CALLBACK_STATUS}' OR LOWER(duvod.value) IN (${reasons}) THEN 'volat-pozdeji'
        WHEN ${STATUS_SQL} = 'novy-lead' THEN 'novy-lead'
        WHEN ${STATUS_SQL} = 'ceka-na-trasovace' THEN 'ceka-na-trasovace'
        ELSE 'emailova-fronta'
      END AS queue_key
    FROM base o
    LEFT JOIN customers c ON c.id = o.customer_id
    ${latestColumnLateral('duvod', 'proc_nedopadl_hovor')}
    ${latestColumnLateral('pref_datum', 'preferovane_datum')}
    ${latestColumnLateral('pref_cas', 'preferovany_cas')}
    ${auditJoins}
  `
}

/** SK Railway může mít jiný audit log — dotaz bez něj místo pádu celé stránky. */
function isMissingAuditError(error) {
  return error?.code === '42P01' || error?.code === '42703'
}

function parseDayValue(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (match) return `${match[1]}-${match[2]}-${match[3]}`
  const cz = String(value || '').match(/^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})/)
  if (cz) return `${cz[3]}-${cz[2].padStart(2, '0')}-${cz[1].padStart(2, '0')}`
  return null
}

function pragueTodayKey(now = new Date()) {
  return now.toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })
}

/** po termínu / dnes / naplánováno / bez termínu */
function callbackDue(dayKey, todayKey) {
  if (!dayKey) return 'missing'
  if (dayKey < todayKey) return 'overdue'
  if (dayKey === todayKey) return 'today'
  return 'planned'
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function bucketKeyForAge(ageH) {
  const bucket = AGE_BUCKETS.find((b) => ageH >= b.from && (b.to == null || ageH < b.to))
  return bucket ? bucket.key : AGE_BUCKETS[AGE_BUCKETS.length - 1].key
}

export async function fetchErpQueueBacklog(pool, { brandId, organizationId, listLimit = 200 }) {
  const params = []
  let organizationFilter = ''
  if (!shouldSkipOrganizationFilter(brandId) && organizationId != null) {
    params.push(Number(organizationId))
    organizationFilter = `AND o.organization_id = $${params.length}`
  }

  let rows
  let auditAvailable = true
  try {
    ;({ rows } = await pool.query(buildSql({ organizationFilter, withAudit: true }), params))
  } catch (error) {
    if (!isMissingAuditError(error)) throw error
    auditAvailable = false
    ;({ rows } = await pool.query(buildSql({ organizationFilter, withAudit: false }), params))
  }

  const todayKey = pragueTodayKey()

  const orders = rows.map((row) => {
    const ageH = row.age_h == null ? null : Number(row.age_h)
    const callbackDay = parseDayValue(row.preferovane_datum)
    return {
      order_id: Number(row.order_id),
      customer_name: row.customer_name,
      phone: row.phone,
      region: row.region,
      status: row.status,
      queue_key: row.queue_key,
      queue_label: ERP_QUEUES.find((q) => q.key === row.queue_key)?.label || row.queue_key,
      duvod_ne: row.duvod_ne,
      entered_at: row.entered_at,
      age_h: ageH,
      callback_set_by: row.callback_set_by || null,
      callback_set_at: row.callback_set_at || null,
      callback_date: row.preferovane_datum || null,
      callback_time: row.preferovany_cas || null,
      callback_due: row.queue_key === 'volat-pozdeji' ? callbackDue(callbackDay, todayKey) : null,
      callback_day: callbackDay,
      detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
    }
  })

  const queues = ERP_QUEUES.map(({ key, label }) => {
    const inQueue = orders.filter((o) => o.queue_key === key)
    const ages = inQueue.map((o) => o.age_h).filter((v) => v != null)
    const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, 0]))
    for (const age of ages) buckets[bucketKeyForAge(age)] += 1
    return {
      queue_id: key,
      queue_label: label,
      leads: inQueue.length,
      buckets,
      median_age_h: median(ages),
      max_age_h: ages.length ? Math.max(...ages) : null,
      statuses: [...new Set(inQueue.map((o) => o.status).filter(Boolean))]
    }
  })

  const totals = {
    leads: orders.length,
    buckets: Object.fromEntries(
      AGE_BUCKETS.map((b) => [b.key, queues.reduce((sum, q) => sum + q.buckets[b.key], 0)])
    ),
    max_age_h: queues.reduce((max, q) => Math.max(max, q.max_age_h || 0), 0) || null
  }

  const dueOrder = { overdue: 0, today: 1, missing: 2, planned: 3 }
  const callbacks = orders
    .filter((o) => o.queue_key === 'volat-pozdeji')
    .sort(
      (a, b) =>
        dueOrder[a.callback_due] - dueOrder[b.callback_due] ||
        String(a.callback_day || '').localeCompare(String(b.callback_day || '')) ||
        (b.age_h || 0) - (a.age_h || 0)
    )

  const oldest = orders
    .filter((o) => o.queue_key !== 'volat-pozdeji')
    .sort((a, b) => (b.age_h || 0) - (a.age_h || 0))
    .slice(0, Number(listLimit) || 200)

  return {
    buckets: AGE_BUCKETS.map(({ key, label }) => ({ key, label })),
    queues,
    totals,
    oldest,
    callbacks: callbacks.slice(0, 500),
    callbacks_total: callbacks.length,
    callbacks_overdue: callbacks.filter((o) => o.callback_due === 'overdue').length,
    audit_available: auditAvailable
  }
}
