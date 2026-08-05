/**
 * Pauzy operátorů z Daktela / Pohoda CC (Supabase)
 * GET /api/operator-pauses?period=week|month|ytd|custom&startDate=&endDate=
 */

import { getDaktelaPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'
import { PAUSE_DISPLAY_NAME_SQL } from '@/lib/pause-labels'

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

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })

    const { rows } = await pool.query(
      `
      SELECT
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), ps."user", 'Neznámý') AS operator_name,
        ps."user" AS operator_id,
        ps.pause AS pause_id,
        (${PAUSE_DISPLAY_NAME_SQL}) AS pause_name,
        COUNT(*)::int AS sessions,
        COALESCE(SUM(${DURATION_SQL}), 0)::bigint AS duration_seconds
      FROM pause_sessions ps
      LEFT JOIN "user" u ON u."user" = ps."user"
      LEFT JOIN pause p ON p.pause = ps.pause
      WHERE ps.start_time >= $1
        AND ps.start_time <= $2
      GROUP BY 1, 2, 3, 4
      ORDER BY operator_name ASC, duration_seconds DESC
      `,
      [start, end]
    )

    const byOperator = new Map()
    for (const row of rows) {
      const key = row.operator_id || row.operator_name
      if (!byOperator.has(key)) {
        byOperator.set(key, {
          operator_id: row.operator_id,
          operator_name: row.operator_name,
          sessions: 0,
          duration_seconds: 0,
          pauses: []
        })
      }
      const bubble = byOperator.get(key)
      const sessions = Number(row.sessions) || 0
      const durationSeconds = Number(row.duration_seconds) || 0
      bubble.sessions += sessions
      bubble.duration_seconds += durationSeconds
      bubble.pauses.push({
        pause_id: row.pause_id,
        pause_name: row.pause_name,
        sessions,
        duration_seconds: durationSeconds
      })
    }

    const bubbles = Array.from(byOperator.values()).sort(
      (a, b) => b.duration_seconds - a.duration_seconds
    )

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      bubbles,
      totals: {
        operators: bubbles.length,
        sessions: bubbles.reduce((sum, b) => sum + b.sessions, 0),
        duration_seconds: bubbles.reduce((sum, b) => sum + b.duration_seconds, 0)
      }
    })
  } catch (error) {
    console.error('operator-pauses:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení pauz' })
  }
}
