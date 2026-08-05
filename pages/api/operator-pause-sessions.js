/**
 * Detail pauz (jednotlivé sessions) z Supabase Pohoda CC
 * GET /api/operator-pause-sessions?period=&startDate=&endDate=&operator=&pause=&limit=&offset=
 */

import { getDaktelaPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'
import { PAUSE_DISPLAY_NAME_SQL } from '@/lib/pause-labels'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const DURATION_SQL = `
  CASE
    WHEN ps.duration IS NOT NULL AND ps.duration > 0 THEN ps.duration::bigint
    WHEN ps.start_time IS NOT NULL THEN
      GREATEST(
        0,
        EXTRACT(EPOCH FROM (COALESCE(ps.end_time, NOW()) - ps.start_time))::bigint
      )
    ELSE 0
  END
`

function cleanParam(value) {
  if (typeof value !== 'string') return ''
  return value.trim()
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
  const pause = cleanParam(req.query.pause)
  const pauseName = cleanParam(req.query.pauseName)
  const excludeOperators = String(req.query.excludeOperators || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const params = [start, end]
    let paramIndex = 3
    const where = ['ps.start_time >= $1', 'ps.start_time <= $2']

    if (operator) {
      where.push(`ps."user" = $${paramIndex}`)
      params.push(operator)
      paramIndex += 1
    } else if (excludeOperators.length) {
      where.push(`ps."user" <> ALL($${paramIndex}::text[])`)
      params.push(excludeOperators)
      paramIndex += 1
    }

    if (pause) {
      where.push(`ps.pause = $${paramIndex}`)
      params.push(pause)
      paramIndex += 1
    } else if (pauseName) {
      where.push(`(${PAUSE_DISPLAY_NAME_SQL}) = $${paramIndex}`)
      params.push(pauseName)
      paramIndex += 1
    }

    const whereSql = where.join(' AND ')

    const countResult = await pool.query(
      `
      SELECT COUNT(*)::int AS total,
             COALESCE(SUM(${DURATION_SQL}), 0)::bigint AS duration_seconds
      FROM pause_sessions ps
      LEFT JOIN pause p ON p.pause = ps.pause
      WHERE ${whereSql}
      `,
      params
    )

    const listParams = [...params, parsedLimit, parsedOffset]
    const listResult = await pool.query(
      `
      SELECT
        ps.session,
        ps."user" AS operator_id,
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), ps."user", 'Neznámý') AS operator_name,
        ps.pause AS pause_id,
        (${PAUSE_DISPLAY_NAME_SQL}) AS pause_name,
        ps.start_time,
        ps.end_time,
        (${DURATION_SQL})::bigint AS duration_seconds
      FROM pause_sessions ps
      LEFT JOIN "user" u ON u."user" = ps."user"
      LEFT JOIN pause p ON p.pause = ps.pause
      WHERE ${whereSql}
      ORDER BY ps.start_time DESC NULLS LAST
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `,
      listParams
    )

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      total: countResult.rows[0]?.total || 0,
      duration_seconds: Number(countResult.rows[0]?.duration_seconds) || 0,
      limit: parsedLimit,
      offset: parsedOffset,
      sessions: listResult.rows.map((row) => ({
        session: row.session,
        operator_id: row.operator_id,
        operator_name: row.operator_name,
        pause_id: row.pause_id,
        pause_name: row.pause_name,
        start_time: row.start_time,
        end_time: row.end_time,
        duration_seconds: Number(row.duration_seconds) || 0
      }))
    })
  } catch (error) {
    console.error('operator-pause-sessions:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení detailu pauz' })
  }
}
