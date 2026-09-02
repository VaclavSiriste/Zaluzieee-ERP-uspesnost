import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import {
  OPERATIONS_BRANDS,
  VENKOVKY_ALL_QUEUE_IDS,
  VENKOVKY_QUEUE_NAME_PATTERN,
  resolveOperationsBrand
} from '@/lib/operations-brands'

export const SLA_THRESHOLD_SECONDS = 20

export const INCOMING_LINE_METRIC_LABELS = {
  all: 'Všechny příchozí linky',
  answered: 'Zvednuté hovory',
  sla_20s: 'Do 20 s (SLA splněno)',
  over_20s: 'Zvednuté nad 20 s',
  missed: 'Nezvednuté / zmeškané',
  interval_0_20: 'Interval 0–20 s',
  interval_21_40: 'Interval 21–40 s',
  interval_41_60: 'Interval 41–60 s',
  interval_60_plus: 'Interval nad 60 s'
}

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

export const INCOMING_CALLS_FROM = `
  FROM call c
  LEFT JOIN "user" u ON u."user" = c."user"
  LEFT JOIN queue q ON q.queue = c.queue
`

export const DAKTELA_CALLS_DATE_WHERE = `
  (c.call_time AT TIME ZONE 'Europe/Prague')::date >= $1::date
  AND (c.call_time AT TIME ZONE 'Europe/Prague')::date <= $2::date
`

export const INCOMING_CALLS_WHERE = `
  ${DAKTELA_CALLS_DATE_WHERE}
  AND UPPER(COALESCE(c.direction, '')) = 'IN'
`

export const RESPONSE_SECONDS_SQL = `
  COALESCE(NULLIF(c.wait_time, 0), NULLIF(c.ringing_time, 0))
`

/** Název linky / fronty v Daktela (lowercase pro porovnání). */
export const QUEUE_LABEL_SQL = `
  LOWER(COALESCE(NULLIF(TRIM(q.title), ''), NULLIF(TRIM(q.name), ''), c.queue::text, ''))
`

function sqlLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

/** OR podmínka: DID, ID fronty nebo text v názvu fronty. */
export function buildLinesOrSql({ dids = [], queueIds = [], queueContains = [] } = {}) {
  const parts = []
  const label = QUEUE_LABEL_SQL.trim()
  const didExpr = `NULLIF(TRIM(c.did), '')`
  const queueExpr = `NULLIF(TRIM(c.queue), '')`

  if (dids.length) {
    parts.push(`${didExpr} IN (${dids.map(sqlLiteral).join(', ')})`)
  }
  if (queueIds.length) {
    parts.push(`${queueExpr} IN (${queueIds.map(sqlLiteral).join(', ')})`)
  }
  for (const pattern of queueContains) {
    const needle = String(pattern).toLowerCase().replace(/'/g, "''")
    parts.push(`${label} LIKE '%${needle}%'`)
  }
  if (!parts.length) return ''
  return parts.length === 1 ? parts[0] : `(${parts.join(' OR ')})`
}

/** Venkovky fronty nepatří do jiných značek — vyloučit podle ID i názvu fronty. */
export function buildVenkovkyExcludeSql() {
  const label = QUEUE_LABEL_SQL.trim()
  const queueExpr = `NULLIF(TRIM(c.queue), '')`
  const idParts = VENKOVKY_ALL_QUEUE_IDS.map((queueId) => `${queueExpr} = ${sqlLiteral(queueId)}`)
  const needle = VENKOVKY_QUEUE_NAME_PATTERN.replace(/'/g, "''")
  const matchSql =
    idParts.length === 1
      ? idParts[0]
      : `(${idParts.join(' OR ')})`
  return `AND NOT (${matchSql} OR ${label} LIKE '%${needle}%')`
}

function withVenkovkyExclusion(brandId, filterSql) {
  if (brandId === 'venkovky') return filterSql
  const excludeSql = buildVenkovkyExcludeSql()
  return filterSql ? `${filterSql}\n      ${excludeSql}` : excludeSql
}

export function buildSlaQueueFilterSql(brandId = 'cz') {
  const brand = resolveOperationsBrand(brandId) || OPERATIONS_BRANDS.cz
  const match = brand.slaQueueMatch
  let filterSql = ''

  if (match?.mode === 'lines') {
    const orSql = buildLinesOrSql(match)
    filterSql = orSql ? `AND ${orSql}` : ''
  } else if (match?.mode === 'contains' && match.value) {
    const needle = String(match.value).toLowerCase().replace(/'/g, "''")
    const label = QUEUE_LABEL_SQL.trim()
    filterSql = `AND ${label} LIKE '%${needle}%'`
  } else if (match?.mode === 'default_cz') {
    const excludeParts = ['pokladamee', 'malujemeee', 'sk', 'venkovky']
      .map((id) => {
        const other = OPERATIONS_BRANDS[id]
        if (other?.slaQueueMatch?.mode === 'lines') {
          return buildLinesOrSql(other.slaQueueMatch)
        }
        return null
      })
      .filter(Boolean)
    if (excludeParts.length) {
      const excludeSql =
        excludeParts.length === 1 ? excludeParts[0] : `(${excludeParts.join(' OR ')})`
      filterSql = `AND NOT ${excludeSql}`
    }
  }

  return withVenkovkyExclusion(brandId, filterSql)
}

/** Filtr pro SLA souhrn a drilldown — jen fronty označené countsForSla, jinak celý brand filtr. */
export function buildSlaIncomingQueueFilterSql(brandId = 'cz') {
  const brand = resolveOperationsBrand(brandId) || OPERATIONS_BRANDS.cz
  const slaSegments = brand.slaQueueBreakdown?.filter((segment) => segment.countsForSla)
  if (slaSegments?.length) {
    const orSql = buildLinesOrSql({ queueIds: slaSegments.map((segment) => segment.queueId) })
    const filterSql = orSql ? `AND ${orSql}` : ''
    return withVenkovkyExclusion(brandId, filterSql)
  }
  return buildSlaQueueFilterSql(brandId)
}

function isTransientDbError(error) {
  const message = String(error?.message || '')
  return TRANSIENT_DB_ERRORS.some((needle) => message.includes(needle))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function queryDaktelaWithRetry(sql, params = [], attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const pool = getDaktelaPool()
      if (!pool) throw new Error('Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)')
      return await pool.query(sql, params)
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || i === attempts - 1) throw error
      const shouldUseFallback = String(error?.message || '').includes('ENOTFOUND')
      await resetDaktelaPool({ useFallbackOnNext: shouldUseFallback })
      await sleep(250 * (i + 1))
    }
  }
  throw lastError
}

export function incomingLineMetricFilter(metric) {
  const response = RESPONSE_SECONDS_SQL.trim()
  switch (metric) {
    case 'answered':
      return 'AND c.answered IS TRUE'
    case 'sla_20s':
    case 'interval_0_20':
      return `AND c.answered IS TRUE AND COALESCE(${response}, 999999) <= ${SLA_THRESHOLD_SECONDS}`
    case 'over_20s':
      return `AND c.answered IS TRUE AND COALESCE(${response}, 0) > ${SLA_THRESHOLD_SECONDS}`
    case 'missed':
      return 'AND COALESCE(c.answered, false) IS NOT TRUE'
    case 'interval_21_40':
      return `AND c.answered IS TRUE AND COALESCE(${response}, 0) BETWEEN 21 AND 40`
    case 'interval_41_60':
      return `AND c.answered IS TRUE AND COALESCE(${response}, 0) BETWEEN 41 AND 60`
    case 'interval_60_plus':
      return `AND c.answered IS TRUE AND COALESCE(${response}, 0) > 60`
    case 'all':
    default:
      return ''
  }
}

export function buildIncomingLineSummarySql({ brandId = 'cz' } = {}) {
  const response = RESPONSE_SECONDS_SQL.trim()
  const queueFilter = buildSlaIncomingQueueFilterSql(brandId)
  return `
    SELECT
      COUNT(*)::int AS total_incoming,
      COUNT(*) FILTER (WHERE c.answered IS TRUE)::int AS answered,
      COUNT(*) FILTER (WHERE COALESCE(c.answered, false) IS NOT TRUE)::int AS missed,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 999999) <= ${SLA_THRESHOLD_SECONDS}
      )::int AS sla_20s,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 0) > ${SLA_THRESHOLD_SECONDS}
      )::int AS over_20s,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 999999) <= ${SLA_THRESHOLD_SECONDS}
      )::int AS interval_0_20,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 0) BETWEEN 21 AND 40
      )::int AS interval_21_40,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 0) BETWEEN 41 AND 60
      )::int AS interval_41_60,
      COUNT(*) FILTER (
        WHERE c.answered IS TRUE AND COALESCE(${response}, 0) > 60
      )::int AS interval_60_plus,
      AVG(${response}) FILTER (WHERE c.answered IS TRUE)::float8 AS avg_response_seconds
    ${INCOMING_CALLS_FROM}
    WHERE ${INCOMING_CALLS_WHERE}
      ${queueFilter}
  `
}

export function buildQueueBreakdownSql(segments = []) {
  const queueIds = segments.map((segment) => segment.queueId).filter(Boolean)
  if (!queueIds.length) return null

  const response = RESPONSE_SECONDS_SQL.trim()
  return `
    SELECT
      c.queue AS queue_id,
      COUNT(*)::int AS total_calls,
      COUNT(*) FILTER (WHERE c.answered IS TRUE)::int AS answered,
      COUNT(*) FILTER (WHERE COALESCE(c.answered, false) IS NOT TRUE)::int AS unanswered,
      COUNT(*) FILTER (
        WHERE UPPER(COALESCE(c.direction, '')) = 'IN'
          AND c.answered IS TRUE
          AND COALESCE(${response}, 999999) <= ${SLA_THRESHOLD_SECONDS}
      )::int AS sla_20s
    FROM call c
    WHERE ${DAKTELA_CALLS_DATE_WHERE.trim()}
      AND NULLIF(TRIM(c.queue), '') IN (${queueIds.map(sqlLiteral).join(', ')})
    GROUP BY c.queue
  `
}

export function normalizeQueueBreakdown(rows = [], segments = []) {
  const byQueueId = new Map(rows.map((row) => [String(row.queue_id), row]))

  const items = segments
    .map((segment) => {
      const row = byQueueId.get(String(segment.queueId)) || {}
      const totalCalls = Number(row.total_calls) || 0
      const answered = Number(row.answered) || 0
      const unanswered = Number(row.unanswered) || 0

      return {
        queue_id: segment.queueId,
        label: segment.label,
        counts_for_sla: segment.countsForSla === true,
        total_calls: totalCalls,
        answered,
        unanswered,
        answered_pct: totalCalls > 0 ? (answered / totalCalls) * 100 : 0,
        sla_20s: Number(row.sla_20s) || 0
      }
    })
    .filter((item) => item.total_calls > 0)

  const totals = items.reduce(
    (acc, item) => ({
      total_calls: acc.total_calls + item.total_calls,
      answered: acc.answered + item.answered,
      unanswered: acc.unanswered + item.unanswered
    }),
    { total_calls: 0, answered: 0, unanswered: 0 }
  )

  return { items, totals }
}

export async function fetchQueueBreakdown({ brandId, startDate, endDate }) {
  const brand = resolveOperationsBrand(brandId) || OPERATIONS_BRANDS.cz
  const segments = brand.slaQueueBreakdown
  if (!Array.isArray(segments) || !segments.length) return null

  const sql = buildQueueBreakdownSql(segments)
  if (!sql) return null

  const result = await queryDaktelaWithRetry(sql, [startDate, endDate])
  return normalizeQueueBreakdown(result.rows, segments)
}

export function normalizeIncomingLineSummary(row = {}) {
  const totalIncoming = Number(row.total_incoming) || 0
  const answered = Number(row.answered) || 0
  const sla20s = Number(row.sla_20s) || 0
  const slaDenominator = answered
  const slaPct = slaDenominator > 0 ? (sla20s / slaDenominator) * 100 : 0
  const answeredPct = totalIncoming > 0 ? (answered / totalIncoming) * 100 : 0

  return {
    total_incoming: totalIncoming,
    answered,
    missed: Number(row.missed) || 0,
    sla_20s: sla20s,
    over_20s: Number(row.over_20s) || 0,
    sla_20s_pct: slaPct,
    sla_20s_denominator: slaDenominator,
    answered_pct: answeredPct,
    avg_response_seconds:
      row.avg_response_seconds != null ? Number(row.avg_response_seconds) : null,
    intervals: {
      interval_0_20: Number(row.interval_0_20) || 0,
      interval_21_40: Number(row.interval_21_40) || 0,
      interval_41_60: Number(row.interval_41_60) || 0,
      interval_60_plus: Number(row.interval_60_plus) || 0
    }
  }
}
