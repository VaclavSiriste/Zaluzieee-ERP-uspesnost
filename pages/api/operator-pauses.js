/**
 * Pauzy operátorů z Daktela / Pohoda CC (Supabase)
 * GET /api/operator-pauses?period=week|month|ytd|custom&startDate=&endDate=
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import {
  fetchDopadlHovorByOperator,
  fetchDomluvenoZamereniByOperator,
  fetchErpHovoryByOperator,
  fetchPocetChybByOperator,
  normalizeOperatorKey
} from '@/lib/dopadl-hovor-metrics'
import { resolveDateRange } from '@/lib/metrics-query'
import { ADMIN_PAUSE_NAMES, IDLE_PAUSE_NAMES } from '@/lib/operator-metric-groups'
import { PAUSE_DISPLAY_NAME_SQL } from '@/lib/pause-labels'
import fs from 'fs/promises'
import path from 'path'

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

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

const CACHE_DIR = path.join(process.cwd(), '.runtime-cache')
const CACHE_FILE = path.join(CACHE_DIR, 'operator-pauses-last-success.json')

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

async function writeCache(payload) {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true })
    await fs.writeFile(CACHE_FILE, JSON.stringify(payload), 'utf8')
  } catch (error) {
    console.warn('operator-pauses cache write failed:', error.message)
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
    const adminPauseNames = ADMIN_PAUSE_NAMES.map((v) => v.toLowerCase())
    const idlePauseNames = IDLE_PAUSE_NAMES.map((v) => v.toLowerCase())

    const { rows } = await queryWithRetry(
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

    const summaryResult = await queryWithRetry(
      `
      WITH pause_base AS (
        SELECT
          ps."user" AS operator_id,
          LOWER(TRIM((${PAUSE_DISPLAY_NAME_SQL}))) AS pause_display_lc,
          LOWER(TRIM(COALESCE(NULLIF(TRIM(p.title), ''), NULLIF(TRIM(p.name), ''), ps.pause, ''))) AS pause_raw_lc,
          (${DURATION_SQL})::bigint AS duration_seconds
        FROM pause_sessions ps
        LEFT JOIN pause p ON p.pause = ps.pause
        WHERE ps.start_time >= $1
          AND ps.start_time <= $2
      ),
      pause_agg AS (
        SELECT
          operator_id,
          COALESCE(SUM(duration_seconds), 0)::bigint AS pause_total_seconds,
          COALESCE(
            SUM(
              CASE
                WHEN pause_display_lc = ANY($3::text[]) OR pause_raw_lc = ANY($3::text[]) THEN duration_seconds
                ELSE 0
              END
            ),
            0
          )::bigint AS admin_seconds,
          COALESCE(
            SUM(
              CASE
                WHEN pause_display_lc = ANY($4::text[]) OR pause_raw_lc = ANY($4::text[]) THEN duration_seconds
                ELSE 0
              END
            ),
            0
          )::bigint AS idle_seconds
        FROM pause_base
        GROUP BY operator_id
      ),
      ready_agg AS (
        SELECT
          rs."user" AS operator_id,
          COALESCE(
            SUM(
              CASE
                WHEN rs.duration IS NOT NULL AND rs.duration > 0 THEN rs.duration
                WHEN rs.start_time IS NOT NULL THEN GREATEST(
                  0,
                  EXTRACT(EPOCH FROM (COALESCE(rs.end_time, NOW()) - rs.start_time))::bigint
                )
                ELSE 0
              END
            ),
            0
          )::bigint AS ready_seconds
        FROM ready_sessions rs
        WHERE rs.start_time >= $1
          AND rs.start_time <= $2
        GROUP BY rs."user"
      ),
      login_raw AS (
        SELECT
          ls."user" AS operator_id,
          COALESCE(
            SUM(
              CASE
                WHEN ls.duration IS NOT NULL AND ls.duration > 0 THEN ls.duration
                WHEN ls.start_time IS NOT NULL THEN GREATEST(
                  0,
                  EXTRACT(EPOCH FROM (COALESCE(ls.end_time, NOW()) - ls.start_time))::bigint
                )
                ELSE 0
              END
            ),
            0
          )::bigint AS login_seconds
        FROM login_sessions ls
        WHERE ls.start_time >= $1
          AND ls.start_time <= $2
        GROUP BY ls."user"
      ),
      -- Primárně readySessions (Daktela Ready); fallback loginSessions pokud ready chybí.
      login_agg AS (
        SELECT
          COALESCE(r.operator_id, l.operator_id) AS operator_id,
          CASE
            WHEN COALESCE(r.ready_seconds, 0) > 0 THEN r.ready_seconds
            ELSE COALESCE(l.login_seconds, 0)
          END::bigint AS login_seconds
        FROM ready_agg r
        FULL OUTER JOIN login_raw l ON l.operator_id = r.operator_id
      ),
      call_agg AS (
        SELECT
          c."user" AS operator_id,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(c.direction, '')) = 'OUT')::int AS outgoing_calls,
          COUNT(*) FILTER (WHERE UPPER(COALESCE(c.direction, '')) = 'IN')::int AS incoming_calls,
          COUNT(*) FILTER (WHERE c.answered = false)::int AS rejected_calls,
          -- Průměr včetně 0 → O×P (= počet všech × průměr) = skutečný součet dob
          AVG(COALESCE(c.duration, 0)) FILTER (
            WHERE UPPER(COALESCE(c.direction, '')) = 'OUT'
          )::float8 AS outgoing_avg_seconds,
          AVG(COALESCE(c.duration, 0)) FILTER (
            WHERE UPPER(COALESCE(c.direction, '')) = 'IN'
          )::float8 AS incoming_avg_seconds,
          SUM(COALESCE(c.duration, 0)) FILTER (
            WHERE UPPER(COALESCE(c.direction, '')) = 'OUT'
          )::bigint AS outgoing_duration_seconds_sum,
          SUM(COALESCE(c.duration, 0)) FILTER (
            WHERE UPPER(COALESCE(c.direction, '')) = 'IN'
          )::bigint AS incoming_duration_seconds_sum
        FROM call c
        WHERE c.call_time >= $1
          AND c.call_time <= $2
          AND c."user" IS NOT NULL
        GROUP BY c."user"
      ),
      email_agg AS (
        SELECT
          e."user" AS operator_id,
          COUNT(*)::int AS email_count,
          -- Průměr včetně 0 → T×U = skutečný součet wait_time
          AVG(COALESCE(e.wait_time, 0))::float8 AS email_avg_seconds,
          SUM(COALESCE(e.wait_time, 0))::bigint AS email_wait_seconds_sum
        FROM email e
        WHERE e.time >= $1
          AND e.time <= $2
        GROUP BY e."user"
      ),
      operators AS (
        SELECT operator_id FROM pause_agg
        UNION
        SELECT operator_id FROM login_agg
        UNION
        SELECT operator_id FROM call_agg
        UNION
        SELECT operator_id FROM email_agg
      )
      SELECT
        o.operator_id,
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), o.operator_id, 'Neznámý') AS operator_name,
        COALESCE(l.login_seconds, 0)::bigint AS login_seconds,
        COALESCE(p.admin_seconds, 0)::bigint AS admin_seconds,
        COALESCE(p.idle_seconds, 0)::bigint AS idle_seconds,
        GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)::bigint AS clean_seconds,
        (GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)::float8 / 3600.0) AS clean_hours,
        ((GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)::float8 / 3600.0) * 3.0) AS clean_days,
        COALESCE(c.outgoing_calls, 0)::int AS outgoing_calls,
        COALESCE(c.incoming_calls, 0)::int AS incoming_calls,
        COALESCE(c.rejected_calls, 0)::int AS rejected_calls,
        COALESCE(c.outgoing_avg_seconds, 0)::float8 AS outgoing_avg_seconds,
        COALESCE(c.incoming_avg_seconds, 0)::float8 AS incoming_avg_seconds,
        COALESCE(c.outgoing_duration_seconds_sum, 0)::bigint AS outgoing_duration_seconds_sum,
        COALESCE(c.incoming_duration_seconds_sum, 0)::bigint AS incoming_duration_seconds_sum,
        (COALESCE(c.outgoing_calls, 0) + COALESCE(c.incoming_calls, 0))::int AS total_calls,
        COALESCE(e.email_count, 0)::int AS email_count,
        COALESCE(e.email_avg_seconds, 0)::float8 AS email_avg_seconds,
        COALESCE(e.email_wait_seconds_sum, 0)::bigint AS email_wait_seconds_sum,
        CASE
          WHEN ((GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)::float8 / 3600.0) * 3.0) > 0
            THEN ((COALESCE(c.outgoing_calls, 0) + COALESCE(c.incoming_calls, 0) + COALESCE(e.email_count, 0))::float8
              / ((GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)::float8 / 3600.0) * 3.0))
          ELSE 0
        END AS requests_per_day,
        -- Excel: (K + O×P + Q×R + T×U) / M × 100
        -- O/Q/T = všechny záznamy; P/R/U = průměr včetně 0 → O×P = skutečný součet dob.
        -- K max = M; výsledek max 100 % (překryv admin + hovory).
        CASE
          WHEN (GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0))::bigint > 0
            THEN LEAST(
              (
                (
                  LEAST(
                    COALESCE(p.admin_seconds, 0),
                    GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0)
                  )
                  + (COALESCE(c.outgoing_calls, 0) * COALESCE(c.outgoing_avg_seconds, 0))
                  + (COALESCE(c.incoming_calls, 0) * COALESCE(c.incoming_avg_seconds, 0))
                  + (COALESCE(e.email_count, 0) * COALESCE(e.email_avg_seconds, 0))
                )
                / NULLIF(GREATEST(COALESCE(l.login_seconds, 0) - COALESCE(p.idle_seconds, 0), 0), 0)::float8
              ) * 100.0,
              100.0
            )
          ELSE 0
        END AS utilization_pct,
        NULL::int AS dopadl_hovor_ano,
        NULL::int AS dopadl_hovor_pocet,
        NULL::int AS domluveno_zamereni_ano,
        NULL::int AS erp_hovory_ano
      FROM operators o
      LEFT JOIN "user" u ON u."user" = o.operator_id
      LEFT JOIN pause_agg p ON p.operator_id = o.operator_id
      LEFT JOIN login_agg l ON l.operator_id = o.operator_id
      LEFT JOIN call_agg c ON c.operator_id = o.operator_id
      LEFT JOIN email_agg e ON e.operator_id = o.operator_id
      ORDER BY operator_name ASC
      `,
      [start, end, adminPauseNames, idlePauseNames]
    )

    let dopadlByKey = new Map()
    let domluvenoByKey = new Map()
    let erpHovoryByKey = new Map()
    let chybyByKey = new Map()
    try {
      const dopadlRows = await fetchDopadlHovorByOperator({ start, end })
      dopadlByKey = new Map(dopadlRows.map((row) => [row.operator_key, row]))
    } catch (error) {
      console.warn('operator-pauses ERP dopadl_hovor:', error.message)
    }
    try {
      const domluvenoRows = await fetchDomluvenoZamereniByOperator({ start, end })
      domluvenoByKey = new Map(domluvenoRows.map((row) => [row.operator_key, row]))
    } catch (error) {
      console.warn('operator-pauses ERP domluveno_zamereni:', error.message)
    }
    try {
      const erpHovoryRows = await fetchErpHovoryByOperator({ start, end })
      erpHovoryByKey = new Map(erpHovoryRows.map((row) => [row.operator_key, row]))
    } catch (error) {
      console.warn('operator-pauses ERP erp_hovory:', error.message)
    }
    try {
      const chybyRows = await fetchPocetChybByOperator({ start, end })
      chybyByKey = new Map(chybyRows.map((row) => [row.operator_key, row]))
    } catch (error) {
      console.warn('operator-pauses ERP pocet_chyb:', error.message)
    }

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

    const payload = {
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      bubbles,
      summary: summaryResult.rows.map((row) => {
        const outgoingCalls = Number(row.outgoing_calls) || 0
        const incomingCalls = Number(row.incoming_calls) || 0
        const totalCalls = Number(row.total_calls) || outgoingCalls + incomingCalls
        const emailCount = Number(row.email_count) || 0
        const dopadl = dopadlByKey.get(normalizeOperatorKey(row.operator_name))
        const domluveno = domluvenoByKey.get(normalizeOperatorKey(row.operator_name))
        const erpHovory = erpHovoryByKey.get(normalizeOperatorKey(row.operator_name))
        const chyby = chybyByKey.get(normalizeOperatorKey(row.operator_name))
        const dopadlHovorAno = dopadl ? dopadl.dopadl_hovor_ano : 0
        const dopadlHovorNe = dopadl ? dopadl.dopadl_hovor_ne : 0
        const dopadlHovorPocet = dopadl
          ? dopadl.dopadl_hovor_pocet
          : dopadlHovorAno + dopadlHovorNe
        const domluvenoZamereniAno = domluveno ? domluveno.domluveno_zamereni_ano : 0
        const domluvenoZamereniNe = domluveno ? domluveno.domluveno_zamereni_ne : 0
        const domluvenoZamereniPocet = domluveno
          ? domluveno.domluveno_zamereni_pocet
          : domluvenoZamereniAno + domluvenoZamereniNe
        const erpHovoryAno = erpHovory ? erpHovory.erp_hovory_ano : 0
        const erpHovoryPocet = erpHovory ? erpHovory.erp_hovory_pocet : 0
        const pocetChyb = chyby ? chyby.pocet_chyb : 0
        const erpOperatorName =
          erpHovory?.operator_name ||
          dopadl?.operator_name ||
          chyby?.operator_name ||
          domluveno?.operator_name ||
          row.operator_name
        const domluvenoOperatorName = domluveno?.operator_name || erpOperatorName
        const chybyOperatorName = chyby?.operator_name || erpOperatorName

        return {
          operator_id: row.operator_id,
          operator_name: row.operator_name,
          erp_operator_name: erpOperatorName,
          domluveno_operator_name: domluvenoOperatorName,
          chyby_operator_name: chybyOperatorName,
          login_seconds: Number(row.login_seconds) || 0,
          admin_seconds: Number(row.admin_seconds) || 0,
          idle_seconds: Number(row.idle_seconds) || 0,
          clean_seconds: Number(row.clean_seconds) || 0,
          clean_hours: Number(row.clean_hours) || 0,
          clean_days: Number(row.clean_days) || 0,
          outgoing_calls: outgoingCalls,
          incoming_calls: incomingCalls,
          outgoing_avg_seconds: Number(row.outgoing_avg_seconds) || 0,
          incoming_avg_seconds: Number(row.incoming_avg_seconds) || 0,
          outgoing_duration_seconds_sum: Number(row.outgoing_duration_seconds_sum) || 0,
          incoming_duration_seconds_sum: Number(row.incoming_duration_seconds_sum) || 0,
          total_calls: totalCalls,
          rejected_calls: Number(row.rejected_calls) || 0,
          email_count: emailCount,
          email_avg_seconds: Number(row.email_avg_seconds) || 0,
          email_wait_seconds_sum: Number(row.email_wait_seconds_sum) || 0,
          requests_per_day: Number(row.requests_per_day) || 0,
          utilization_pct: Number(row.utilization_pct) || 0,
          dopadl_hovor_ano: dopadlHovorAno,
          dopadl_hovor_ne: dopadlHovorNe,
          dopadl_hovor_pocet: dopadlHovorPocet,
          domluveno_zamereni_ano: domluvenoZamereniAno,
          domluveno_zamereni_ne: domluvenoZamereniNe,
          domluveno_zamereni_pocet: domluvenoZamereniPocet,
          erp_hovory_ano: erpHovoryAno,
          erp_hovory_pocet: erpHovoryPocet,
          pocet_chyb: pocetChyb,
          // ERP: Dopadl hovor ANO / (ANO+NE)
          success_navolani_pct:
            dopadlHovorPocet > 0 ? (dopadlHovorAno / dopadlHovorPocet) * 100 : null,
          // ERP: Naplánován termín zaměření ANO / (ANO+NE)
          success_natrasovani_pct:
            domluvenoZamereniPocet > 0
              ? (domluvenoZamereniAno / domluvenoZamereniPocet) * 100
              : null,
          // Looker: Dopadl hovor ANO / odchozí hovory (Daktela)
          success_dopadl_hovor_pct:
            outgoingCalls > 0 ? (dopadlHovorAno / outgoingCalls) * 100 : null,
          success_domluveni_zamereni_pct:
            totalCalls > 0 ? (domluvenoZamereniAno / totalCalls) * 100 : null,
          success_erp_hovory_pct:
            erpHovoryPocet > 0 ? (erpHovoryAno / erpHovoryPocet) * 100 : null,
          // Looker: ERP hovory / Daktela hovory celkem
          erp_vs_daktela_pct: totalCalls > 0 ? (erpHovoryPocet / totalCalls) * 100 : null,
          // Looker: ANO / ERP hovory
          success_zamereni_z_erp_pct:
            erpHovoryPocet > 0 ? (erpHovoryAno / erpHovoryPocet) * 100 : null
        }
      }),
      totals: {
        operators: bubbles.length,
        sessions: bubbles.reduce((sum, b) => sum + b.sessions, 0),
        duration_seconds: bubbles.reduce((sum, b) => sum + b.duration_seconds, 0)
      }
    }

    await writeCache(payload)
    return res.status(200).json(payload)
  } catch (error) {
    console.error('operator-pauses:', error.message)
    if (isTransientDbError(error)) {
      const cached = await readCache()
      if (cached) {
        return res.status(200).json({
          ...cached,
          stale: true,
          stale_reason: error.message,
          stale_generated_at: new Date().toISOString()
        })
      }
      return res.status(200).json({
        period,
        start: null,
        end: null,
        bubbles: [],
        summary: [],
        totals: {
          operators: 0,
          sessions: 0,
          duration_seconds: 0
        },
        stale: true,
        stale_reason: error.message,
        stale_generated_at: new Date().toISOString()
      })
    }
    return res.status(500).json({ error: error.message || 'Chyba načtení pauz' })
  }
}
