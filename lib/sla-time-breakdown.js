/**
 * Časový rozpad hlavních SLA metrik:
 * - hour  = hodina dne (0–23) přes celé zvolené období
 * - day   = jednotlivé dny zvoleného období
 * - month = měsíce letošního roku (filtr období se ignoruje — jinak by byl 1 sloupec)
 *
 * kind:
 * - incoming = SLA příchozí linky (Daktela, do 20 s / zvednuté)
 * - vycet    = Výčet SLA 24 (ERP poptávky, kontakt do 24 h)
 */

import { getErpPool } from '@/lib/db-esm'
import {
  INCOMING_CALLS_FROM,
  INCOMING_CALLS_WHERE,
  RESPONSE_SECONDS_SQL,
  SLA_THRESHOLD_SECONDS,
  buildSlaIncomingQueueFilterSql,
  queryDaktelaWithRetry
} from '@/lib/incoming-line-sla'
import { formatDateInput, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import {
  CALENDAR_DATE_SQL,
  SLA24_FLAG_SQL,
  appendOrganizationFilter,
  buildSlaPoptavkyFiltersSql,
  shouldExcludeVenkovkyReason
} from '@/lib/sla-metrics'

export const GROUP_BY = ['hour', 'day', 'month']

/** Rozsah: month = 1. 1. letošního roku až dnes, jinak dle filtru. */
export function resolveBreakdownRange(groupBy, query) {
  if (groupBy === 'month') {
    const now = new Date()
    return {
      start: new Date(now.getFullYear(), 0, 1),
      end: new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999)
    }
  }
  return resolveDateRange(query)
}

function bucketSql(groupBy, tsExpr) {
  if (groupBy === 'hour') return `EXTRACT(HOUR FROM ${tsExpr})::int`
  if (groupBy === 'month') return `to_char(date_trunc('month', ${tsExpr}), 'YYYY-MM')`
  return `to_char((${tsExpr})::date, 'YYYY-MM-DD')`
}

async function fetchIncoming({ groupBy, brandId, start, end }) {
  const response = RESPONSE_SECONDS_SQL.trim()
  const slaFilter = buildSlaIncomingQueueFilterSql(brandId)
  const { rows } = await queryDaktelaWithRetry(
    `
    SELECT
      ${bucketSql(groupBy, 'c.call_time')} AS bucket,
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE c.answered IS TRUE)::int AS base,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE
          AND COALESCE(${response}, 999999) <= ${SLA_THRESHOLD_SECONDS}
      )::int AS met
    ${INCOMING_CALLS_FROM}
    WHERE ${INCOMING_CALLS_WHERE}
      ${slaFilter}
    GROUP BY 1
    ORDER BY 1
    `,
    [formatDateInput(start), formatDateInput(end)]
  )
  return rows
}

async function fetchVycet({ groupBy, brandId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')
  const organizationId = resolveOrganizationId({ brandId })
  const base = appendOrganizationFilter([start, end], organizationId, { brandId })
  const filters = buildSlaPoptavkyFiltersSql({
    excludeVenkovkyReason: shouldExcludeVenkovkyReason(organizationId, brandId)
  })
  const { rows } = await pool.query(
    `
    SELECT
      ${bucketSql(groupBy, "(o.created_at + INTERVAL '2 hours')")} AS bucket,
      COUNT(*)::int AS total,
      COUNT(*)::int AS base,
      COALESCE(SUM(${SLA24_FLAG_SQL}), 0)::int AS met
    FROM orders o
    WHERE (${CALENDAR_DATE_SQL}) >= $1::date
      AND (${CALENDAR_DATE_SQL}) <= $2::date
      ${filters}
      ${base.sql}
    GROUP BY 1
    ORDER BY 1
    `,
    base.params
  )
  return rows
}

/** Doplní chybějící hodiny 0–23, aby graf neměl díry. */
function fillHours(rows) {
  const byHour = new Map(rows.map((row) => [Number(row.bucket), row]))
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) || { bucket: hour, total: 0, base: 0, met: 0 })
}

export async function fetchSlaTimeBreakdown({ kind, groupBy, brandId, query }) {
  const { start, end } = resolveBreakdownRange(groupBy, query)
  const rows =
    kind === 'vycet'
      ? await fetchVycet({ groupBy, brandId, start, end })
      : await fetchIncoming({ groupBy, brandId, start, end })

  const filled = groupBy === 'hour' ? fillHours(rows) : rows
  return {
    kind,
    groupBy,
    startDate: formatDateInput(start),
    endDate: formatDateInput(end),
    buckets: filled.map((row) => {
      const base = Number(row.base) || 0
      const met = Number(row.met) || 0
      return {
        bucket: String(row.bucket),
        total: Number(row.total) || 0,
        base,
        met,
        pct: base ? (met / base) * 100 : null
      }
    })
  }
}
