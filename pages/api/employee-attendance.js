/**
 * Docházka zaměstnanců (příchod / odchod)
 * GET  /api/employee-attendance?period=&startDate=&endDate=
 * PUT  /api/employee-attendance  { operator_id, work_date, arrival_at, departure_at, note? }
 *
 * Preferuje ruční záznamy v employee_attendance.
 * Pokud chybí, nabídne návrh z ready_sessions (první start / poslední end daného dne).
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import { resolveDateRange, formatDateInput } from '@/lib/metrics-query'

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

async function ensureAttendanceTable() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS employee_attendance (
      id            BIGSERIAL PRIMARY KEY,
      operator_id   TEXT NOT NULL,
      work_date     DATE NOT NULL,
      arrival_at    TIMESTAMP,
      departure_at  TIMESTAMP,
      note          TEXT,
      updated_at    TIMESTAMP NOT NULL DEFAULT NOW(),
      UNIQUE (operator_id, work_date)
    )
  `)
  await queryWithRetry(`
    CREATE INDEX IF NOT EXISTS idx_employee_attendance_work_date
      ON employee_attendance (work_date)
  `)
}

function toLocalInputValue(value) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parseDateTimeInput(value) {
  if (value == null || value === '') return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date
}

export default async function handler(req, res) {
  const pool = getDaktelaPool()
  if (!pool) {
    return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
  }

  try {
    await ensureAttendanceTable()

    if (req.method === 'PUT' || req.method === 'POST') {
      const body = req.body || {}
      const operatorId = String(body.operator_id || '').trim()
      const workDate = String(body.work_date || '').trim()
      if (!operatorId || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
        return res.status(400).json({ error: 'Chybí operator_id nebo work_date (YYYY-MM-DD)' })
      }

      const arrivalAt = parseDateTimeInput(body.arrival_at)
      const departureAt = parseDateTimeInput(body.departure_at)
      const note = body.note != null ? String(body.note).trim() : null

      if (arrivalAt && departureAt && departureAt < arrivalAt) {
        return res.status(400).json({ error: 'Odchod nemůže být dřív než příchod' })
      }

      const result = await queryWithRetry(
        `
        INSERT INTO employee_attendance (operator_id, work_date, arrival_at, departure_at, note, updated_at)
        VALUES ($1, $2::date, $3, $4, NULLIF($5, ''), NOW())
        ON CONFLICT (operator_id, work_date) DO UPDATE SET
          arrival_at = EXCLUDED.arrival_at,
          departure_at = EXCLUDED.departure_at,
          note = EXCLUDED.note,
          updated_at = NOW()
        RETURNING *
        `,
        [operatorId, workDate, arrivalAt, departureAt, note || '']
      )

      const row = result.rows[0]
      return res.status(200).json({
        ok: true,
        item: {
          id: row.id,
          operator_id: row.operator_id,
          work_date: formatDateInput(row.work_date),
          arrival_at: row.arrival_at,
          departure_at: row.departure_at,
          arrival_input: toLocalInputValue(row.arrival_at),
          departure_input: toLocalInputValue(row.departure_at),
          note: row.note || '',
          source: 'manual',
          updated_at: row.updated_at
        }
      })
    }

    if (req.method !== 'GET') {
      return res.status(405).json({ error: 'Method not allowed' })
    }

    const period = typeof req.query.period === 'string' ? req.query.period : 'month'
    const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
    const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
    const { start, end } = resolveDateRange({ startDate, endDate, period })

    const { rows } = await queryWithRetry(
      `
      WITH ready_days AS (
        SELECT
          rs."user" AS operator_id,
          (rs.start_time::date) AS work_date,
          MIN(rs.start_time) AS suggested_arrival,
          MAX(COALESCE(rs.end_time, rs.start_time)) AS suggested_departure
        FROM ready_sessions rs
        WHERE rs.start_time >= $1
          AND rs.start_time <= $2
          AND rs."user" IS NOT NULL
        GROUP BY rs."user", (rs.start_time::date)
      ),
      login_days AS (
        SELECT
          ls."user" AS operator_id,
          (ls.start_time::date) AS work_date,
          MIN(ls.start_time) AS suggested_arrival,
          MAX(COALESCE(ls.end_time, ls.start_time)) AS suggested_departure
        FROM login_sessions ls
        WHERE ls.start_time >= $1
          AND ls.start_time <= $2
          AND ls."user" IS NOT NULL
          AND NOT EXISTS (
            SELECT 1 FROM ready_days rd
            WHERE rd.operator_id = ls."user"
              AND rd.work_date = (ls.start_time::date)
          )
        GROUP BY ls."user", (ls.start_time::date)
      ),
      suggested AS (
        SELECT * FROM ready_days
        UNION ALL
        SELECT * FROM login_days
      ),
      attendance AS (
        SELECT *
        FROM employee_attendance ea
        WHERE ea.work_date >= ($1::timestamp)::date
          AND ea.work_date <= ($2::timestamp)::date
      ),
      keys AS (
        SELECT operator_id, work_date FROM suggested
        UNION
        SELECT operator_id, work_date FROM attendance
      )
      SELECT
        k.operator_id,
        k.work_date,
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), k.operator_id, 'Neznámý')
          AS operator_name,
        a.id AS attendance_id,
        a.arrival_at AS manual_arrival,
        a.departure_at AS manual_departure,
        a.note,
        a.updated_at,
        s.suggested_arrival,
        s.suggested_departure,
        COALESCE(a.arrival_at, s.suggested_arrival) AS arrival_at,
        COALESCE(a.departure_at, s.suggested_departure) AS departure_at,
        CASE WHEN a.id IS NOT NULL THEN 'manual' ELSE 'suggested' END AS source
      FROM keys k
      LEFT JOIN attendance a
        ON a.operator_id = k.operator_id AND a.work_date = k.work_date
      LEFT JOIN suggested s
        ON s.operator_id = k.operator_id AND s.work_date = k.work_date
      LEFT JOIN "user" u ON u."user" = k.operator_id
      ORDER BY k.work_date DESC, operator_name ASC
      `,
      [start, end]
    )

    const items = rows.map((row) => ({
      id: row.attendance_id || `${row.operator_id}_${formatDateInput(row.work_date)}`,
      attendance_id: row.attendance_id || null,
      operator_id: row.operator_id,
      operator_name: row.operator_name,
      work_date: formatDateInput(row.work_date),
      arrival_at: row.arrival_at,
      departure_at: row.departure_at,
      arrival_input: toLocalInputValue(row.arrival_at),
      departure_input: toLocalInputValue(row.departure_at),
      suggested_arrival: row.suggested_arrival,
      suggested_departure: row.suggested_departure,
      note: row.note || '',
      source: row.source,
      updated_at: row.updated_at
    }))

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      total: items.length,
      items
    })
  } catch (error) {
    console.error('employee-attendance:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba docházky' })
  }
}
