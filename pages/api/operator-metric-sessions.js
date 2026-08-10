/**
 * Detail metrik operátora (login / hovory / maily)
 * GET /api/operator-metric-sessions?metric=login|outgoing|incoming|calls|emails|activity&operator=&period=&...
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const LOGIN_DURATION_SQL = `
  CASE
    WHEN ls.duration IS NOT NULL AND ls.duration > 0 THEN ls.duration::bigint
    WHEN ls.start_time IS NOT NULL THEN
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (COALESCE(ls.end_time, NOW()) - ls.start_time))::bigint
      )
    ELSE 0
  END
`

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

const METRIC_LABELS = {
  login: 'Přihlášení',
  outgoing: 'Odchozí hovory',
  incoming: 'Příchozí hovory',
  calls: 'Hovory',
  rejected: 'Odmítnuté hovory',
  emails: 'Maily',
  activity: 'Požadavky (hovory + maily)'
}

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

function mapLoginRow(row) {
  return {
    id: row.id,
    kind: 'login',
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    label: 'Přihlášení',
    detail: null,
    start_time: row.start_time,
    end_time: row.end_time,
    duration_seconds: Number(row.duration_seconds) || 0
  }
}

function mapCallRow(row) {
  const direction = String(row.direction || '').toUpperCase()
  const cause = [row.disconnection_cause, row.disposition_cause].filter(Boolean).join(' / ')
  const detailParts = [row.clid, cause || null, row.queue || null].filter(Boolean)
  return {
    id: row.id,
    kind: 'call',
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    label: direction === 'IN' ? 'Příchozí hovor' : direction === 'OUT' ? 'Odchozí hovor' : 'Hovor',
    detail: detailParts.length ? detailParts.join(' · ') : null,
    start_time: row.start_time,
    end_time: null,
    duration_seconds: Number(row.duration_seconds) || 0,
    answered: row.answered
  }
}

function mapEmailRow(row) {
  const direction = String(row.direction || '').toUpperCase()
  return {
    id: row.id,
    kind: 'email',
    operator_id: row.operator_id,
    operator_name: row.operator_name,
    label: direction === 'IN' ? 'Příchozí mail' : direction === 'OUT' ? 'Odchozí mail' : 'Mail',
    detail: row.address || row.title || row.name || null,
    start_time: row.start_time,
    end_time: null,
    duration_seconds: Number(row.duration_seconds) || 0,
    answered: row.answered
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
  const operator = cleanParam(req.query.operator)
  const metric = cleanParam(req.query.metric).toLowerCase() || 'login'
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  if (!METRIC_LABELS[metric]) {
    return res.status(400).json({ error: `Neznámá metrika: ${metric}` })
  }

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const params = [start, end]
    let paramIndex = 3

    if (operator) {
      params.push(operator)
      paramIndex += 1
    }

    let countSql
    let listSql
    let mapRow

    if (metric === 'login') {
      countSql = `
        SELECT COUNT(*)::int AS total,
               COALESCE(SUM(${LOGIN_DURATION_SQL}), 0)::bigint AS duration_seconds
        FROM login_sessions ls
        WHERE ls.start_time >= $1
          AND ls.start_time <= $2
          ${operator ? `AND ls."user" = $3` : ''}
      `
      listSql = `
        SELECT
          ls.session AS id,
          ls."user" AS operator_id,
          COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), ls."user", 'Neznámý') AS operator_name,
          ls.start_time,
          ls.end_time,
          (${LOGIN_DURATION_SQL})::bigint AS duration_seconds
        FROM login_sessions ls
        LEFT JOIN "user" u ON u."user" = ls."user"
        WHERE ls.start_time >= $1
          AND ls.start_time <= $2
          ${operator ? `AND ls."user" = $3` : ''}
        ORDER BY ls.start_time DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      mapRow = mapLoginRow
    } else if (metric === 'emails') {
      countSql = `
        SELECT COUNT(*)::int AS total,
               COALESCE(SUM(COALESCE(NULLIF(e.wait_time, 0), 0)), 0)::bigint AS duration_seconds
        FROM email e
        WHERE e.time >= $1
          AND e.time <= $2
          ${operator ? `AND e."user" = $3` : ''}
      `
      listSql = `
        SELECT
          e.email AS id,
          e."user" AS operator_id,
          COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), e."user", 'Neznámý') AS operator_name,
          e.time AS start_time,
          NULL::timestamp AS end_time,
          COALESCE(NULLIF(e.wait_time, 0), 0)::bigint AS duration_seconds,
          e.direction,
          e.address,
          e.title,
          e.name,
          e.answered
        FROM email e
        LEFT JOIN "user" u ON u."user" = e."user"
        WHERE e.time >= $1
          AND e.time <= $2
          ${operator ? `AND e."user" = $3` : ''}
        ORDER BY e.time DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      mapRow = mapEmailRow
    } else if (metric === 'activity') {
      // sjednocený rozpad hovorů + mailů (pro Požadavky / den)
      countSql = `
        SELECT
          (
            (SELECT COUNT(*)::int FROM call c WHERE c.call_time >= $1 AND c.call_time <= $2 ${operator ? 'AND c."user" = $3' : ''})
            +
            (SELECT COUNT(*)::int FROM email e WHERE e.time >= $1 AND e.time <= $2 ${operator ? 'AND e."user" = $3' : ''})
          )::int AS total,
          (
            COALESCE((SELECT SUM(COALESCE(NULLIF(c.duration, 0), 0)) FROM call c WHERE c.call_time >= $1 AND c.call_time <= $2 ${operator ? 'AND c."user" = $3' : ''}), 0)
            +
            COALESCE((SELECT SUM(COALESCE(NULLIF(e.wait_time, 0), 0)) FROM email e WHERE e.time >= $1 AND e.time <= $2 ${operator ? 'AND e."user" = $3' : ''}), 0)
          )::bigint AS duration_seconds
      `
      listSql = `
        SELECT * FROM (
          SELECT
            c.call AS id,
            'call'::text AS kind,
            c."user" AS operator_id,
            COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), c."user", 'Neznámý') AS operator_name,
            c.call_time AS start_time,
            NULL::timestamp AS end_time,
            COALESCE(NULLIF(c.duration, 0), 0)::bigint AS duration_seconds,
            c.direction,
            c.clid,
            c.queue,
            NULL::text AS address,
            NULL::text AS title,
            NULL::text AS name,
            c.answered
          FROM call c
          LEFT JOIN "user" u ON u."user" = c."user"
          WHERE c.call_time >= $1
            AND c.call_time <= $2
            ${operator ? 'AND c."user" = $3' : ''}
          UNION ALL
          SELECT
            e.email AS id,
            'email'::text AS kind,
            e."user" AS operator_id,
            COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), e."user", 'Neznámý') AS operator_name,
            e.time AS start_time,
            NULL::timestamp AS end_time,
            COALESCE(NULLIF(e.wait_time, 0), 0)::bigint AS duration_seconds,
            e.direction,
            NULL::text AS clid,
            NULL::text AS queue,
            e.address,
            e.title,
            e.name,
            e.answered
          FROM email e
          LEFT JOIN "user" u ON u."user" = e."user"
          WHERE e.time >= $1
            AND e.time <= $2
            ${operator ? 'AND e."user" = $3' : ''}
        ) t
        ORDER BY start_time DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      mapRow = (row) => (row.kind === 'email' ? mapEmailRow(row) : mapCallRow(row))
    } else if (metric === 'rejected') {
      countSql = `
        SELECT COUNT(*)::int AS total,
               COALESCE(SUM(COALESCE(NULLIF(c.duration, 0), 0)), 0)::bigint AS duration_seconds
        FROM call c
        WHERE c.call_time >= $1
          AND c.call_time <= $2
          AND c.answered = false
          ${operator ? `AND c."user" = $3` : ''}
      `
      listSql = `
        SELECT
          c.call AS id,
          c."user" AS operator_id,
          COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), c."user", 'Neznámý') AS operator_name,
          c.call_time AS start_time,
          NULL::timestamp AS end_time,
          COALESCE(NULLIF(c.duration, 0), 0)::bigint AS duration_seconds,
          c.direction,
          c.clid,
          c.queue,
          c.answered,
          c.disconnection_cause,
          c.disposition_cause
        FROM call c
        LEFT JOIN "user" u ON u."user" = c."user"
        WHERE c.call_time >= $1
          AND c.call_time <= $2
          AND c.answered = false
          ${operator ? `AND c."user" = $3` : ''}
        ORDER BY c.call_time DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      mapRow = mapCallRow
    } else {
      // outgoing | incoming | calls
      const directionFilter =
        metric === 'outgoing'
          ? `AND UPPER(COALESCE(c.direction, '')) = 'OUT'`
          : metric === 'incoming'
            ? `AND UPPER(COALESCE(c.direction, '')) = 'IN'`
            : ''

      countSql = `
        SELECT COUNT(*)::int AS total,
               COALESCE(SUM(COALESCE(NULLIF(c.duration, 0), 0)), 0)::bigint AS duration_seconds
        FROM call c
        WHERE c.call_time >= $1
          AND c.call_time <= $2
          ${operator ? `AND c."user" = $3` : ''}
          ${directionFilter}
      `
      listSql = `
        SELECT
          c.call AS id,
          c."user" AS operator_id,
          COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), c."user", 'Neznámý') AS operator_name,
          c.call_time AS start_time,
          NULL::timestamp AS end_time,
          COALESCE(NULLIF(c.duration, 0), 0)::bigint AS duration_seconds,
          c.direction,
          c.clid,
          c.queue,
          c.answered,
          c.disconnection_cause,
          c.disposition_cause
        FROM call c
        LEFT JOIN "user" u ON u."user" = c."user"
        WHERE c.call_time >= $1
          AND c.call_time <= $2
          ${operator ? `AND c."user" = $3` : ''}
          ${directionFilter}
        ORDER BY c.call_time DESC NULLS LAST
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `
      mapRow = mapCallRow
    }

    const countResult = await queryWithRetry(countSql, params)
    const listParams = [...params, parsedLimit, parsedOffset]
    const listResult = await queryWithRetry(listSql, listParams)

    return res.status(200).json({
      period,
      metric,
      label: METRIC_LABELS[metric],
      start: start.toISOString(),
      end: end.toISOString(),
      total: countResult.rows[0]?.total || 0,
      duration_seconds: Number(countResult.rows[0]?.duration_seconds) || 0,
      limit: parsedLimit,
      offset: parsedOffset,
      items: listResult.rows.map(mapRow)
    })
  } catch (error) {
    console.error('operator-metric-sessions:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení detailu metriky' })
  }
}
