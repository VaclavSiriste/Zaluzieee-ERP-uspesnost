/**
 * Fronty Daktela — nenavolané leady a jejich stáří.
 *
 * Lead = telefonní číslo (posledních 9 číslic) se zmeškaným příchozím hovorem,
 * ke kterému zatím není vyřízení (odchozí zpět ani zvednutý příchozí) —
 * stejná logika jako „Ještě nenavolané“ v Průměrné době do navolání.
 * Stáří = od PRVNÍHO nevyřízeného zmeškaného hovoru do teď.
 * Fronta = fronta prvního nevyřízeného hovoru.
 *
 * Daktela call_time je nástěnný čas Europe/Prague bez TZ → „teď“ převádíme stejně.
 */

import { buildMissedCallbackCte } from '@/lib/missed-call-callback-sql'

export const AGE_BUCKETS = [
  { key: 'h0_2', label: 'do 2 h', from: 0, to: 2 },
  { key: 'h2_8', label: '2–8 h', from: 2, to: 8 },
  { key: 'h8_24', label: '8–24 h', from: 8, to: 24 },
  { key: 'h24_48', label: '24–48 h', from: 24, to: 48 },
  { key: 'h48_72', label: '48–72 h', from: 48, to: 72 },
  { key: 'h72', label: 'nad 72 h', from: 72, to: null }
]

function bucketSql(bucket) {
  const upper = bucket.to == null ? '' : ` AND age_h < ${bucket.to}`
  return `COUNT(*) FILTER (WHERE age_h >= ${bucket.from}${upper})::int AS ${bucket.key}`
}

function backlogCte(brandId) {
  return `
    ${buildMissedCallbackCte({ brandId })},
    open_calls AS (
      SELECT
        mc.missed_at,
        mc.clid,
        mc.phone_key,
        c.queue::text AS queue_id,
        COALESCE(NULLIF(TRIM(q.title), ''), NULLIF(TRIM(q.name), ''), c.queue::text, '—') AS queue_label
      FROM matched mc
      JOIN call c ON c.call = mc.missed_id
      LEFT JOIN queue q ON q.queue = c.queue
      WHERE mc.callback_at IS NULL
    ),
    leads AS (
      SELECT
        phone_key,
        MIN(missed_at) AS first_missed_at,
        MAX(missed_at) AS last_missed_at,
        COUNT(*)::int AS missed_calls,
        (ARRAY_AGG(queue_id ORDER BY missed_at))[1] AS queue_id,
        (ARRAY_AGG(queue_label ORDER BY missed_at))[1] AS queue_label,
        (ARRAY_AGG(clid ORDER BY missed_at DESC))[1] AS clid
      FROM open_calls
      GROUP BY phone_key
    ),
    aged AS (
      SELECT
        *,
        EXTRACT(EPOCH FROM ((now() AT TIME ZONE 'Europe/Prague') - first_missed_at)) / 3600.0 AS age_h
      FROM leads
    )
  `
}

export async function fetchQueueBacklog(pool, { start, end, brandId = null, listLimit = 200 }) {
  const cte = backlogCte(brandId)
  const params = [start, end]

  const [byQueue, list] = await Promise.all([
    pool.query(
      `
      WITH ${cte}
      SELECT
        queue_id,
        queue_label,
        COUNT(*)::int AS leads,
        SUM(missed_calls)::int AS missed_calls,
        ${AGE_BUCKETS.map(bucketSql).join(',\n        ')},
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY age_h) AS median_age_h,
        MAX(age_h) AS max_age_h
      FROM aged
      GROUP BY queue_id, queue_label
      ORDER BY leads DESC
      `,
      params
    ),
    pool.query(
      `
      WITH ${cte}
      SELECT phone_key, clid, queue_label, first_missed_at, last_missed_at, missed_calls, age_h
      FROM aged
      ORDER BY age_h DESC
      LIMIT ${Number(listLimit) || 200}
      `,
      params
    )
  ])

  const num = (value) => (value == null ? null : Number(value))
  const queues = byQueue.rows.map((row) => ({
    queue_id: row.queue_id,
    queue_label: row.queue_label,
    leads: num(row.leads) || 0,
    missed_calls: num(row.missed_calls) || 0,
    buckets: Object.fromEntries(AGE_BUCKETS.map((b) => [b.key, num(row[b.key]) || 0])),
    median_age_h: num(row.median_age_h),
    max_age_h: num(row.max_age_h)
  }))

  const totals = {
    leads: queues.reduce((sum, q) => sum + q.leads, 0),
    missed_calls: queues.reduce((sum, q) => sum + q.missed_calls, 0),
    buckets: Object.fromEntries(
      AGE_BUCKETS.map((b) => [b.key, queues.reduce((sum, q) => sum + q.buckets[b.key], 0)])
    ),
    max_age_h: queues.reduce((max, q) => Math.max(max, q.max_age_h || 0), 0) || null
  }

  return {
    buckets: AGE_BUCKETS.map(({ key, label }) => ({ key, label })),
    queues,
    totals,
    oldest: list.rows.map((row) => ({
      phone_key: row.phone_key,
      clid: row.clid,
      queue_label: row.queue_label,
      first_missed_at: row.first_missed_at,
      last_missed_at: row.last_missed_at,
      missed_calls: num(row.missed_calls) || 0,
      age_h: num(row.age_h)
    }))
  }
}
