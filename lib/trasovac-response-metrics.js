/**
 * Metriky fronty „Čeká na trasovače“ (ERP orders_audit_log).
 *
 * Start: status → ceka-na-trasovace (created_at v logu)
 * Konec: první jakákoli další změna v logu nejdříve 15 min po startu
 *        (odfiltruje doplňování polí navoláčem hned po změně stavu)
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly, SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'

export const CEKA_NA_TRASOVACE_STATUS = 'ceka-na-trasovace'
export const TRASOVAC_GRACE_INTERVAL = '15 minutes'
export const DUVOD_NE_SLUG = 'proc_nedopadl_hovor'
export const DUVOD_EMPTY_KEY = '__empty__'

export const TRASOVAC_ORDER_METRICS = {
  waiting: 'Čeká na trasovače (aktuálně)',
  with_response: 'S reakcí trasovače',
  entered: 'Vešlo do fronty',
  avg: 'Průměr — leady s reakcí',
  median: 'Medián — leady s reakcí',
  sla12: 'SLA 12 h',
  sla24: 'SLA 24 h',
  sla36: 'SLA 36 h'
}

export const TRASOVAC_SLA_HOURS = {
  sla12: 12,
  sla24: 24,
  sla36: 36
}

function formatPercent(part, total) {
  const p = Number(part) || 0
  const t = Number(total) || 0
  if (t <= 0) return 0
  return Math.round((p / t) * 10000) / 100
}

function toHours(value) {
  if (value == null || Number.isNaN(Number(value))) return null
  return Number(value)
}

function normalizeDuvodRaw(value) {
  if (value == null) return null
  const trimmed = String(value).trim()
  return trimmed ? trimmed : null
}

async function loadDuvodOptions(pool, organizationId) {
  const { rows } = await pool.query(
    `
    SELECT options
    FROM orders_columns
    WHERE slug = $1
      AND (organization_id = $2 OR organization_id IS NULL)
      AND archived_at IS NULL
    ORDER BY CASE WHEN organization_id = $2 THEN 0 ELSE 1 END, id
    LIMIT 1
    `,
    [DUVOD_NE_SLUG, organizationId]
  )
  const options = rows[0]?.options
  if (!options || typeof options !== 'object' || Array.isArray(options)) return {}
  return options
}

function resolveDuvodLabel(raw, optionsMap) {
  const key = normalizeDuvodRaw(raw)
  if (!key) return 'Bez důvodu ne'
  if (optionsMap[key]) return optionsMap[key]
  const match = Object.values(optionsMap).find((label) => label === key)
  return match || key
}

function mapOrderRow(row, optionsMap = {}) {
  const duvodRaw = normalizeDuvodRaw(row.duvod_ne)
  return {
    order_id: Number(row.order_id),
    customer_name: row.customer_name || 'Bez jména',
    region: row.region || '—',
    status: row.status || null,
    entered_at: row.entered_at || null,
    first_change_at: row.first_change_at || null,
    hours_to_response: toHours(row.hours_to_response),
    first_change_action: row.first_change_action || null,
    first_change_field: row.first_change_field || null,
    first_change_new: row.first_change_new || null,
    duvod_ne: duvodRaw,
    duvod_ne_label: resolveDuvodLabel(duvodRaw, optionsMap),
    detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
  }
}

const LATEST_DUVOD_CTE = `
duvod_latest AS (
  SELECT DISTINCT ON (ocv.order_id)
    ocv.order_id,
    NULLIF(TRIM(ocv.value), '') AS duvod_ne
  FROM orders_column_values ocv
  JOIN orders_columns oc ON oc.id = ocv.column_id
  WHERE oc.slug = '${DUVOD_NE_SLUG}'
  ORDER BY ocv.order_id, ocv.id DESC
)
`

function buildDuvodFilterSql(duvodReason, paramIndex) {
  if (!duvodReason) return { sql: '', params: [] }
  if (duvodReason === DUVOD_EMPTY_KEY) {
    return {
      sql: ` AND (d.duvod_ne IS NULL OR NULLIF(TRIM(d.duvod_ne), '') IS NULL) `,
      params: []
    }
  }
  return {
    sql: ` AND d.duvod_ne = $${paramIndex} `,
    params: [duvodReason]
  }
}

async function fetchWaitingDuvodBreakdown(pool, organizationId, optionsMap) {
  const { rows } = await pool.query(
    `
    WITH ${LATEST_DUVOD_CTE}
    SELECT
      COALESCE(NULLIF(TRIM(d.duvod_ne), ''), '${DUVOD_EMPTY_KEY}') AS duvod_key,
      COUNT(*)::int AS cnt
    FROM orders o
    LEFT JOIN duvod_latest d ON d.order_id = o.id
    WHERE o.organization_id = $1
      AND o.status = $2
    GROUP BY 1
    ORDER BY
      CASE WHEN COALESCE(NULLIF(TRIM(d.duvod_ne), ''), '${DUVOD_EMPTY_KEY}') = '${DUVOD_EMPTY_KEY}' THEN 0 ELSE 1 END,
      cnt DESC,
      duvod_key ASC
    `,
    [organizationId, CEKA_NA_TRASOVACE_STATUS]
  )

  return rows.map((row) => {
    const key = row.duvod_key || DUVOD_EMPTY_KEY
    return {
      key,
      label: key === DUVOD_EMPTY_KEY ? 'Bez důvodu ne' : resolveDuvodLabel(key, optionsMap),
      count: Number(row.cnt) || 0
    }
  })
}

/**
 * @param {{ start: Date, end: Date, organizationId: number }} params
 */
export async function fetchTrasovacResponseSummary({ start, end, organizationId }) {
  const pool = getPool()
  if (!pool) throw new Error('Chybí ERP_DB_CONNECTION_STRING')
  if (organizationId == null) throw new Error('Chybí organization_id')

  const rangeStart = formatDateOnly(start)
  const rangeEnd = formatDateOnly(end)
  const optionsMap = await loadDuvodOptions(pool, organizationId)

  const { rows } = await pool.query(
    `
    WITH entered AS (
      SELECT
        a.order_id,
        a.id AS enter_id,
        a.created_at AS entered_at
      FROM orders_audit_log a
      JOIN orders o ON o.id = a.order_id
      WHERE a.action = 'updated'
        AND a.field = 'status'
        AND a.new_value = $3
        AND o.organization_id = $4
        AND a.created_at >= $1::timestamp
        AND a.created_at < ($2::date + INTERVAL '1 day')
    ),
    first_change AS (
      SELECT
        e.order_id,
        e.enter_id,
        e.entered_at,
        MIN(a.created_at) AS first_change_at
      FROM entered e
      JOIN orders_audit_log a
        ON a.order_id = e.order_id
       AND a.created_at >= e.entered_at + ($5::interval)
      GROUP BY e.order_id, e.enter_id, e.entered_at
    ),
    durations AS (
      SELECT
        EXTRACT(EPOCH FROM (first_change_at - entered_at)) / 3600.0 AS hours_to_response
      FROM first_change
    )
    SELECT
      (SELECT COUNT(*)::int
         FROM orders
        WHERE organization_id = $4
          AND status = $3) AS waiting_now,
      (SELECT COUNT(*)::int FROM entered) AS entered_in_period,
      (SELECT COUNT(*)::int FROM first_change) AS with_response,
      (SELECT ROUND(AVG(hours_to_response)::numeric, 4) FROM durations) AS avg_hours,
      (SELECT ROUND(
         (PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY hours_to_response))::numeric,
         4
       ) FROM durations) AS median_hours,
      (SELECT COUNT(*)::int FROM durations WHERE hours_to_response <= 12) AS sla12,
      (SELECT COUNT(*)::int FROM durations WHERE hours_to_response <= 24) AS sla24,
      (SELECT COUNT(*)::int FROM durations WHERE hours_to_response <= 36) AS sla36
    `,
    [rangeStart, rangeEnd, CEKA_NA_TRASOVACE_STATUS, organizationId, TRASOVAC_GRACE_INTERVAL]
  )

  const row = rows[0] || {}
  const entered = Number(row.entered_in_period) || 0
  const withResponse = Number(row.with_response) || 0
  const sla12 = Number(row.sla12) || 0
  const sla24 = Number(row.sla24) || 0
  const sla36 = Number(row.sla36) || 0
  const duvod_breakdown = await fetchWaitingDuvodBreakdown(pool, organizationId, optionsMap)

  return {
    waiting_now: Number(row.waiting_now) || 0,
    entered_in_period: entered,
    with_response: withResponse,
    avg_hours: toHours(row.avg_hours),
    median_hours: toHours(row.median_hours),
    sla12,
    sla24,
    sla36,
    /** % z leadů s reakcí ve filtru (odbavené) */
    sla12_pct: formatPercent(sla12, withResponse),
    sla24_pct: formatPercent(sla24, withResponse),
    sla36_pct: formatPercent(sla36, withResponse),
    grace_minutes: 15,
    status: CEKA_NA_TRASOVACE_STATUS,
    duvod_breakdown
  }
}

/**
 * @param {{
 *   metric: keyof typeof TRASOVAC_ORDER_METRICS,
 *   start: Date,
 *   end: Date,
 *   organizationId: number,
 *   duvodReason?: string | null,
 *   limit?: number,
 *   offset?: number
 * }} params
 */
export async function fetchTrasovacResponseOrders({
  metric,
  start,
  end,
  organizationId,
  duvodReason = null,
  limit = 50,
  offset = 0
}) {
  const pool = getPool()
  if (!pool) throw new Error('Chybí ERP_DB_CONNECTION_STRING')
  if (organizationId == null) throw new Error('Chybí organization_id')
  if (!TRASOVAC_ORDER_METRICS[metric]) {
    throw new Error(`Neznámá metrika: ${metric}`)
  }

  const rangeStart = formatDateOnly(start)
  const rangeEnd = formatDateOnly(end)
  const optionsMap = await loadDuvodOptions(pool, organizationId)
  const reasonKey = !duvodReason
    ? null
    : duvodReason === DUVOD_EMPTY_KEY || !normalizeDuvodRaw(duvodReason)
      ? DUVOD_EMPTY_KEY
      : normalizeDuvodRaw(duvodReason)

  let label = TRASOVAC_ORDER_METRICS[metric]
  if (reasonKey) {
    const reasonLabel =
      reasonKey === DUVOD_EMPTY_KEY ? 'Bez důvodu ne' : resolveDuvodLabel(reasonKey, optionsMap)
    label = `${label} · ${reasonLabel}`
  }

  if (metric === 'waiting') {
    const duvodFilter = buildDuvodFilterSql(reasonKey, 3)
    const baseParams = [organizationId, CEKA_NA_TRASOVACE_STATUS, ...duvodFilter.params]

    const countResult = await pool.query(
      `
      WITH ${LATEST_DUVOD_CTE}
      SELECT COUNT(*)::int AS total
      FROM orders o
      LEFT JOIN duvod_latest d ON d.order_id = o.id
      WHERE o.organization_id = $1
        AND o.status = $2
        ${duvodFilter.sql}
      `,
      baseParams
    )

    const limitParam = baseParams.length + 1
    const listResult = await pool.query(
      `
      WITH ${LATEST_DUVOD_CTE}
      SELECT
        o.id AS order_id,
        COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
        COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
        o.status,
        entered.entered_at,
        NULL::timestamp AS first_change_at,
        NULL::float AS hours_to_response,
        NULL::text AS first_change_action,
        NULL::text AS first_change_field,
        NULL::text AS first_change_new,
        d.duvod_ne
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN duvod_latest d ON d.order_id = o.id
      LEFT JOIN LATERAL (
        SELECT a.created_at AS entered_at
        FROM orders_audit_log a
        WHERE a.order_id = o.id
          AND a.action = 'updated'
          AND a.field = 'status'
          AND a.new_value = $2
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT 1
      ) entered ON TRUE
      WHERE o.organization_id = $1
        AND o.status = $2
        ${duvodFilter.sql}
      ORDER BY entered.entered_at DESC NULLS LAST, o.id DESC
      LIMIT $${limitParam} OFFSET $${limitParam + 1}
      `,
      [...baseParams, limit, offset]
    )

    return {
      label,
      total: Number(countResult.rows[0]?.total) || 0,
      orders: listResult.rows.map((row) => mapOrderRow(row, optionsMap)),
      duvod_reason: reasonKey
    }
  }

  if (reasonKey) {
    throw new Error('Filtr Důvod ne je dostupný jen u aktuální fronty (waiting).')
  }

  const slaMaxHours = TRASOVAC_SLA_HOURS[metric] ?? null
  const withResponseOnly =
    metric === 'with_response' ||
    metric === 'avg' ||
    metric === 'median' ||
    slaMaxHours != null

  const countResult = await pool.query(
    `
    WITH entered AS (
      SELECT
        a.order_id,
        a.id AS enter_id,
        a.created_at AS entered_at
      FROM orders_audit_log a
      JOIN orders o ON o.id = a.order_id
      WHERE a.action = 'updated'
        AND a.field = 'status'
        AND a.new_value = $3
        AND o.organization_id = $4
        AND a.created_at >= $1::timestamp
        AND a.created_at < ($2::date + INTERVAL '1 day')
    ),
    first_change AS (
      SELECT DISTINCT ON (e.enter_id)
        e.enter_id,
        EXTRACT(EPOCH FROM (a.created_at - e.entered_at)) / 3600.0 AS hours_to_response
      FROM entered e
      JOIN orders_audit_log a
        ON a.order_id = e.order_id
       AND a.created_at >= e.entered_at + ($5::interval)
      ORDER BY e.enter_id, a.created_at ASC, a.id ASC
    ),
    ${LATEST_DUVOD_CTE}
    SELECT COUNT(*)::int AS total
    FROM entered e
    ${withResponseOnly ? 'JOIN first_change fc ON fc.enter_id = e.enter_id' : ''}
    LEFT JOIN duvod_latest d ON d.order_id = e.order_id
    ${slaMaxHours != null ? `WHERE fc.hours_to_response <= ${Number(slaMaxHours)}` : ''}
    `,
    [rangeStart, rangeEnd, CEKA_NA_TRASOVACE_STATUS, organizationId, TRASOVAC_GRACE_INTERVAL]
  )

  const listResult = await pool.query(
    `
    WITH entered AS (
      SELECT
        a.order_id,
        a.id AS enter_id,
        a.created_at AS entered_at
      FROM orders_audit_log a
      JOIN orders o ON o.id = a.order_id
      WHERE a.action = 'updated'
        AND a.field = 'status'
        AND a.new_value = $3
        AND o.organization_id = $4
        AND a.created_at >= $1::timestamp
        AND a.created_at < ($2::date + INTERVAL '1 day')
    ),
    first_change AS (
      SELECT DISTINCT ON (e.enter_id)
        e.order_id,
        e.enter_id,
        e.entered_at,
        a.created_at AS first_change_at,
        a.action AS first_change_action,
        a.field AS first_change_field,
        a.new_value AS first_change_new,
        EXTRACT(EPOCH FROM (a.created_at - e.entered_at)) / 3600.0 AS hours_to_response
      FROM entered e
      JOIN orders_audit_log a
        ON a.order_id = e.order_id
       AND a.created_at >= e.entered_at + ($5::interval)
      ORDER BY e.enter_id, a.created_at ASC, a.id ASC
    ),
    ${LATEST_DUVOD_CTE}
    SELECT
      e.order_id,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
      COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
      o.status,
      e.entered_at,
      fc.first_change_at,
      fc.hours_to_response,
      fc.first_change_action,
      fc.first_change_field,
      fc.first_change_new,
      d.duvod_ne
    FROM entered e
    JOIN orders o ON o.id = e.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN duvod_latest d ON d.order_id = e.order_id
    ${withResponseOnly ? 'JOIN' : 'LEFT JOIN'} first_change fc ON fc.enter_id = e.enter_id
    ${slaMaxHours != null ? `WHERE fc.hours_to_response <= ${Number(slaMaxHours)}` : ''}
    ORDER BY
      ${withResponseOnly ? 'fc.first_change_at DESC NULLS LAST' : 'e.entered_at DESC'},
      e.order_id DESC
    LIMIT $6 OFFSET $7
    `,
    [
      rangeStart,
      rangeEnd,
      CEKA_NA_TRASOVACE_STATUS,
      organizationId,
      TRASOVAC_GRACE_INTERVAL,
      limit,
      offset
    ]
  )

  return {
    label,
    total: Number(countResult.rows[0]?.total) || 0,
    orders: listResult.rows.map((row) => mapOrderRow(row, optionsMap)),
    duvod_reason: reasonKey
  }
}
