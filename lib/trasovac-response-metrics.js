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

export const TRASOVAC_ORDER_METRICS = {
  waiting: 'Čeká na trasovače (aktuálně)',
  with_response: 'S reakcí trasovače',
  entered: 'Vešlo do fronty',
  avg: 'Průměr — leady s reakcí',
  median: 'Medián — leady s reakcí'
}

function toHours(value) {
  if (value == null || Number.isNaN(Number(value))) return null
  return Number(value)
}

function mapOrderRow(row) {
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
    detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
  }
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
       ) FROM durations) AS median_hours
    `,
    [rangeStart, rangeEnd, CEKA_NA_TRASOVACE_STATUS, organizationId, TRASOVAC_GRACE_INTERVAL]
  )

  const row = rows[0] || {}
  return {
    waiting_now: Number(row.waiting_now) || 0,
    entered_in_period: Number(row.entered_in_period) || 0,
    with_response: Number(row.with_response) || 0,
    avg_hours: toHours(row.avg_hours),
    median_hours: toHours(row.median_hours),
    grace_minutes: 15,
    status: CEKA_NA_TRASOVACE_STATUS
  }
}

/**
 * @param {{
 *   metric: keyof typeof TRASOVAC_ORDER_METRICS,
 *   start: Date,
 *   end: Date,
 *   organizationId: number,
 *   limit?: number,
 *   offset?: number
 * }} params
 */
export async function fetchTrasovacResponseOrders({
  metric,
  start,
  end,
  organizationId,
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
  const label = TRASOVAC_ORDER_METRICS[metric]

  if (metric === 'waiting') {
    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total
      FROM orders o
      WHERE o.organization_id = $1
        AND o.status = $2
      `,
      [organizationId, CEKA_NA_TRASOVACE_STATUS]
    )

    const listResult = await pool.query(
      `
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
        NULL::text AS first_change_new
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
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
      ORDER BY entered.entered_at DESC NULLS LAST, o.id DESC
      LIMIT $3 OFFSET $4
      `,
      [organizationId, CEKA_NA_TRASOVACE_STATUS, limit, offset]
    )

    return {
      label,
      total: Number(countResult.rows[0]?.total) || 0,
      orders: listResult.rows.map(mapOrderRow)
    }
  }

  const withResponseOnly = metric === 'with_response' || metric === 'avg' || metric === 'median'

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
        e.enter_id
      FROM entered e
      JOIN orders_audit_log a
        ON a.order_id = e.order_id
       AND a.created_at >= e.entered_at + ($5::interval)
      ORDER BY e.enter_id, a.created_at ASC, a.id ASC
    )
    SELECT COUNT(*)::int AS total
    FROM entered e
    ${withResponseOnly ? 'JOIN first_change fc ON fc.enter_id = e.enter_id' : ''}
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
    )
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
      fc.first_change_new
    FROM entered e
    JOIN orders o ON o.id = e.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    ${withResponseOnly ? 'JOIN' : 'LEFT JOIN'} first_change fc ON fc.enter_id = e.enter_id
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
    orders: listResult.rows.map(mapOrderRow)
  }
}
