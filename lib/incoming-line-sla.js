import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'

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

export const INCOMING_CALLS_WHERE = `
  c.call_time >= $1
  AND c.call_time <= $2
  AND UPPER(COALESCE(c.direction, '')) = 'IN'
`

export const RESPONSE_SECONDS_SQL = `
  COALESCE(NULLIF(c.wait_time, 0), NULLIF(c.ringing_time, 0))
`

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

export function buildIncomingLineSummarySql() {
  const response = RESPONSE_SECONDS_SQL.trim()
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
  `
}

export function normalizeIncomingLineSummary(row = {}) {
  const totalIncoming = Number(row.total_incoming) || 0
  const answered = Number(row.answered) || 0
  const sla20s = Number(row.sla_20s) || 0
  const slaDenominator = totalIncoming > 0 ? totalIncoming : answered
  const slaPct = slaDenominator > 0 ? (sla20s / slaDenominator) * 100 : 0
  const answeredPct = totalIncoming > 0 ? (answered / totalIncoming) * 100 : 0

  return {
    total_incoming: totalIncoming,
    answered,
    missed: Number(row.missed) || 0,
    sla_20s: sla20s,
    over_20s: Number(row.over_20s) || 0,
    sla_20s_pct: slaPct,
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
