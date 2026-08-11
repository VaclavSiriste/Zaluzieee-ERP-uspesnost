/**
 * Zmeškané příchozí hovory — souhrn a výčet s navoláním
 * GET /api/missed-call-callbacks?period=&startDate=&endDate=&variant=all|called_back|open&offset=&limit=
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import {
  MISSED_CALLBACK_CTE,
  missedCallbackVariantFilter
} from '@/lib/missed-call-callback-sql'
import { resolveDateRange } from '@/lib/metrics-query'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const VARIANT_LABELS = {
  all: 'Všechny zmeškané příchozí',
  called_back: 'Navolané zmeškané',
  open: 'Nenavolané zmeškané'
}

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

function isTransientDbError(error) {
  const message = String(error?.message || '')
  return TRANSIENT_DB_ERRORS.some((needle) => message.includes(needle))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function queryWithRetry(sql, params = [], attempts = 4) {
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

function cleanParam(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
}

function mapRow(row) {
  const hours = row.hours_to_callback != null ? Number(row.hours_to_callback) : null
  return {
    id: row.missed_id,
    kind: 'missed_callback',
    label: row.callback_at ? 'Navoláno' : 'Nenavoláno',
    detail: row.clid || null,
    start_time: row.missed_at,
    end_time: row.callback_at,
    duration_seconds: hours != null && Number.isFinite(hours) ? Math.round(hours * 3600) : 0,
    hours_to_callback: hours,
    callback_operator_id: row.callback_user || null,
    callback_operator_name: row.callback_operator_name || null,
    operator_name: row.callback_operator_name || '—'
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getDaktelaPool()
  if (!pool) {
    return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
  const variantRaw = cleanParam(req.query.variant).toLowerCase() || 'all'
  const variant = VARIANT_LABELS[variantRaw] ? variantRaw : 'all'
  const summaryOnly = req.query.summary === '1' || req.query.summary === 'true'
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const params = [start, end]
    const variantFilter = missedCallbackVariantFilter(variant)

    const summarySql = `
      WITH ${MISSED_CALLBACK_CTE}
      SELECT
        COUNT(*)::int AS total_missed,
        COUNT(*) FILTER (WHERE mc.callback_at IS NOT NULL)::int AS called_back,
        COUNT(*) FILTER (WHERE mc.callback_at IS NULL)::int AS not_called_back,
        AVG(mc.hours_to_callback) FILTER (WHERE mc.callback_at IS NOT NULL)::float8 AS avg_hours_to_callback
      FROM matched mc
    `

    const summaryResult = await queryWithRetry(summarySql, params)
    const summaryRow = summaryResult.rows[0] || {}

    const summary = {
      total_missed: Number(summaryRow.total_missed) || 0,
      called_back: Number(summaryRow.called_back) || 0,
      not_called_back: Number(summaryRow.not_called_back) || 0,
      avg_hours_to_callback:
        summaryRow.avg_hours_to_callback != null
          ? Number(summaryRow.avg_hours_to_callback)
          : null
    }

    if (summaryOnly) {
      return res.status(200).json({
        period,
        start: start.toISOString(),
        end: end.toISOString(),
        summary
      })
    }

    const countSql = `
      WITH ${MISSED_CALLBACK_CTE}
      SELECT COUNT(*)::int AS total
      FROM matched mc
      WHERE 1=1
        ${variantFilter}
    `
    const countResult = await queryWithRetry(countSql, params)
    const total = Number(countResult.rows[0]?.total) || 0

    const listSql = `
      WITH ${MISSED_CALLBACK_CTE}
      SELECT
        mc.missed_id,
        mc.missed_at,
        mc.clid,
        mc.callback_id,
        mc.callback_at,
        mc.callback_user,
        mc.hours_to_callback,
        COALESCE(
          NULLIF(TRIM(u.title), ''),
          NULLIF(TRIM(u.name), ''),
          mc.callback_user,
          NULL
        ) AS callback_operator_name
      FROM matched mc
      LEFT JOIN "user" u ON u."user" = mc.callback_user
      WHERE 1=1
        ${variantFilter}
      ORDER BY mc.missed_at DESC NULLS LAST
      LIMIT $3 OFFSET $4
    `
    const listResult = await queryWithRetry(listSql, [...params, parsedLimit, parsedOffset])
    const items = listResult.rows.map(mapRow)
    const durationSeconds = items.reduce((sum, item) => sum + (item.duration_seconds || 0), 0)

    return res.status(200).json({
      period,
      variant,
      label: VARIANT_LABELS[variant],
      start: start.toISOString(),
      end: end.toISOString(),
      summary,
      total,
      duration_seconds: durationSeconds,
      limit: parsedLimit,
      offset: parsedOffset,
      items
    })
  } catch (error) {
    console.error('missed-call-callbacks:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení zmeškaných hovorů' })
  }
}
