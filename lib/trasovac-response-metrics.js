/**
 * Metriky fronty „Čeká na trasovače“ (ERP orders_audit_log).
 *
 * Start: status → ceka-na-trasovace (created_at v logu)
 * Konec: první jakákoli další změna v logu nejdříve 15 min po startu
 *        (odfiltruje doplňování polí navoláčem hned po změně stavu)
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'

export const CEKA_NA_TRASOVACE_STATUS = 'ceka-na-trasovace'
export const TRASOVAC_GRACE_INTERVAL = '15 minutes'

function toHours(value) {
  if (value == null || Number.isNaN(Number(value))) return null
  return Number(value)
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
