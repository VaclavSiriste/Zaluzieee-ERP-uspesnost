/**
 * Zmeškané příchozí hovory — souhrn a výčet s navoláním
 * GET /api/missed-call-callbacks?period=&startDate=&endDate=&variant=all|called_back|open&offset=&limit=
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import { lookupOrdersByPhoneKeys, phoneKeyFromClid } from '@/lib/erp-phone-orders'
import {
  buildMissedCallbackCte,
  missedCallbackHoursAxisFilter,
  missedCallbackVariantFilter
} from '@/lib/missed-call-callback-sql'
import {
  resolveBrandWorkingHoursProfile,
  resolveOperationsBrand
} from '@/lib/operations-brands'
import { resolveWorkingHoursProfile } from '@/lib/working-hours-sql'
import { resolveDateRange } from '@/lib/metrics-query'
import fs from 'fs/promises'
import path from 'path'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200
const CACHE_DIR = path.join(process.cwd(), '.runtime-cache')
const CACHE_FILE = path.join(CACHE_DIR, 'missed-call-callbacks-last-success.json')

const VARIANT_LABELS = {
  all: 'Všechny zmeškané příchozí',
  called_back: 'Navolané zmeškané',
  open: 'Nenavolané zmeškané'
}

const HOURS_AXIS_LABELS = {
  all: 'Všechny časy',
  working: 'Pracovní doba (Po–Pá 8–20, So–Ne 10–18)',
  outside: 'Mimo pracovní dobu'
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

async function writeCache(payload) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload), 'utf8')
  } catch (error) {
    console.warn('missed-call-callbacks cache write failed:', error.message)
  }
}

async function readCache() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    return null
  }
}

function mapRow(row, orderMatch = null) {
  const hours = row.hours_to_callback != null ? Number(row.hours_to_callback) : null
  const kind = row.resolution_kind || null
  const resolved = Boolean(row.callback_at)
  let label = 'Nenavoláno'
  if (resolved && kind === 'inbound_answered') label = 'Zákazník zavolal znovu (zvednuto)'
  else if (resolved) label = 'Navoláno (odchozí)'

  return {
    id: row.missed_id,
    kind: 'missed_callback',
    label,
    detail: row.clid || null,
    start_time: row.missed_at,
    end_time: row.callback_at,
    duration_seconds: hours != null && Number.isFinite(hours) ? Math.round(hours * 3600) : 0,
    hours_to_callback: hours,
    resolution_kind: kind,
    is_working_hours: row.is_working_hours === true,
    hours_axis_label: row.is_working_hours === true ? 'Pracovní doba' : 'Mimo pracovní dobu',
    callback_operator_id: row.callback_user || null,
    callback_operator_name: row.callback_operator_name || null,
    operator_name: row.callback_operator_name || '—',
    order_id: orderMatch?.order_id || null,
    customer_name: orderMatch?.customer_name || null,
    detail_url: orderMatch?.detail_url || null
  }
}

function numOrNull(value) {
  return value != null && Number.isFinite(Number(value)) ? Number(value) : null
}

function buildSummary(row, { brandId = null } = {}) {
  const hoursProfile = resolveWorkingHoursProfile(resolveBrandWorkingHoursProfile(brandId))
  return {
    total_missed: Number(row.total_missed) || 0,
    called_back: Number(row.called_back) || 0,
    not_called_back: Number(row.not_called_back) || 0,
    avg_hours_to_callback: numOrNull(row.avg_hours_to_callback),
    working: {
      total_missed: Number(row.working_total_missed) || 0,
      called_back: Number(row.working_called_back) || 0,
      not_called_back: Number(row.working_not_called_back) || 0,
      avg_hours_to_callback: numOrNull(row.working_avg_hours)
    },
    outside: {
      total_missed: Number(row.outside_total_missed) || 0,
      called_back: Number(row.outside_called_back) || 0,
      not_called_back: Number(row.outside_not_called_back) || 0,
      avg_hours_to_callback: numOrNull(row.outside_avg_hours)
    },
    working_hours_rule: `${hoursProfile.label} · dle času zmeškaného hovoru`,
    working_hours_short: hoursProfile.shortLabel
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
  const brandRaw = cleanParam(req.query.brand).toLowerCase()
  const brand = brandRaw && resolveOperationsBrand(brandRaw) ? brandRaw : null
  const variantRaw = cleanParam(req.query.variant).toLowerCase() || 'all'
  const variant = VARIANT_LABELS[variantRaw] ? variantRaw : 'all'
  const hoursAxisRaw = cleanParam(req.query.hoursAxis).toLowerCase() || 'all'
  const hoursAxis = HOURS_AXIS_LABELS[hoursAxisRaw] ? hoursAxisRaw : 'all'
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
    const hoursAxisFilter = missedCallbackHoursAxisFilter(hoursAxis)
    const MISSED_CALLBACK_CTE = buildMissedCallbackCte({ brandId: brand })

    const summarySql = `
      WITH ${MISSED_CALLBACK_CTE}
      SELECT
        COUNT(*)::int AS total_missed,
        COUNT(*) FILTER (WHERE mc.callback_at IS NOT NULL)::int AS called_back,
        COUNT(*) FILTER (WHERE mc.callback_at IS NULL)::int AS not_called_back,
        AVG(mc.hours_to_callback) FILTER (WHERE mc.callback_at IS NOT NULL)::float8 AS avg_hours_to_callback,

        COUNT(*) FILTER (WHERE mc.is_working_hours IS TRUE)::int AS working_total_missed,
        COUNT(*) FILTER (WHERE mc.is_working_hours IS TRUE AND mc.callback_at IS NOT NULL)::int AS working_called_back,
        COUNT(*) FILTER (WHERE mc.is_working_hours IS TRUE AND mc.callback_at IS NULL)::int AS working_not_called_back,
        AVG(mc.hours_to_callback) FILTER (
          WHERE mc.is_working_hours IS TRUE AND mc.callback_at IS NOT NULL
        )::float8 AS working_avg_hours,

        COUNT(*) FILTER (WHERE mc.is_working_hours IS FALSE)::int AS outside_total_missed,
        COUNT(*) FILTER (WHERE mc.is_working_hours IS FALSE AND mc.callback_at IS NOT NULL)::int AS outside_called_back,
        COUNT(*) FILTER (WHERE mc.is_working_hours IS FALSE AND mc.callback_at IS NULL)::int AS outside_not_called_back,
        AVG(mc.hours_to_callback) FILTER (
          WHERE mc.is_working_hours IS FALSE AND mc.callback_at IS NOT NULL
        )::float8 AS outside_avg_hours
      FROM matched mc
    `

    const summaryResult = await queryWithRetry(summarySql, params)
    const summary = buildSummary(summaryResult.rows[0] || {}, { brandId: brand })

    if (summaryOnly) {
      const payload = {
        period,
        brand,
        start: start.toISOString(),
        end: end.toISOString(),
        summary
      }
      await writeCache(payload)
      return res.status(200).json(payload)
    }

    const countSql = `
      WITH ${MISSED_CALLBACK_CTE}
      SELECT COUNT(*)::int AS total
      FROM matched mc
      WHERE 1=1
        ${variantFilter}
        ${hoursAxisFilter}
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
        mc.is_working_hours,
        mc.resolution_kind,
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
        ${hoursAxisFilter}
      ORDER BY mc.missed_at DESC NULLS LAST
      LIMIT $3 OFFSET $4
    `
    const listResult = await queryWithRetry(listSql, [...params, parsedLimit, parsedOffset])
    const phoneKeys = listResult.rows.map((row) => phoneKeyFromClid(row.clid))
    const orderByPhone = await lookupOrdersByPhoneKeys(phoneKeys)
    const items = listResult.rows.map((row) => {
      const key = phoneKeyFromClid(row.clid)
      return mapRow(row, key ? orderByPhone.get(key) || null : null)
    })
    const durationSeconds = items.reduce((sum, item) => sum + (item.duration_seconds || 0), 0)

    const axisAvg =
      hoursAxis === 'working'
        ? summary.working.avg_hours_to_callback
        : hoursAxis === 'outside'
          ? summary.outside.avg_hours_to_callback
          : summary.avg_hours_to_callback

    return res.status(200).json({
      period,
      brand,
      variant,
      hoursAxis,
      label: VARIANT_LABELS[variant],
      hours_axis_label: HOURS_AXIS_LABELS[hoursAxis],
      start: start.toISOString(),
      end: end.toISOString(),
      summary: {
        ...summary,
        avg_hours_to_callback_filtered: axisAvg
      },
      total,
      duration_seconds: durationSeconds,
      limit: parsedLimit,
      offset: parsedOffset,
      items
    })
  } catch (error) {
    console.error('missed-call-callbacks:', error.message)
    if (isTransientDbError(error)) {
      const cached = await readCache()
      if (cached && (summaryOnly || variant === 'all')) {
        return res.status(200).json({
          ...cached,
          stale: true,
          stale_reason: error.message
        })
      }
    }
    return res.status(500).json({ error: error.message || 'Chyba načtení zmeškaných hovorů' })
  }
}
