/**
 * SLA do 30 s v pracovní době — důvod u každého záznamu, který SLA nesplnil.
 *
 * Jmenovatel zůstává: všechny příchozí záznamy v pracovní době (i < 5 s).
 * „Volání“ = záznamy stejného čísla (posl. 9 číslic) s odstupem ≤ 2 min — Daktela po vypršení
 * fronty (exitwithtimeout) vrací hovor do fronty jako nový záznam, takže jedno volání = více záznamů.
 * „Vyřešeno později“ = po záznamu přišel náš odchozí hovor na stejné číslo nebo zvednutý příchozí.
 */

import {
  INCOMING_CALLS_FROM,
  INCOMING_CALLS_WHERE,
  RESPONSE_SECONDS_SQL,
  SLA_WORKING_THRESHOLD_SECONDS,
  buildSlaIncomingQueueFilterSql
} from '@/lib/incoming-line-sla'
import { resolveBrandWorkingHoursProfile } from '@/lib/operations-brands'
import { buildIsWorkingHoursSql } from '@/lib/working-hours-sql'

export const SLA30_REASONS = [
  { key: 'answered_late', label: 'Zvednuto, ale po 30 s', hint: 'operátor zvedl, zákazník čekal déle než 30 s' },
  {
    key: 'timeout_answered',
    label: 'Vypršela fronta – volání později zvednuto',
    hint: 'po vypršení fronty se hovor vrátil do fronty a v dalším záznamu ho někdo zvedl'
  },
  {
    key: 'timeout_unanswered',
    label: 'Vypršela fronta – nikdo nezvedl',
    hint: 'fronta vypršela (exitwithtimeout) a celé volání zůstalo nezvednuté'
  },
  { key: 'abandon_short', label: 'Zákazník zavěsil do 5 s', hint: 'abandon, čekání kratší než 5 s' },
  { key: 'abandon_mid', label: 'Zákazník zavěsil po 5–30 s', hint: 'abandon, čekání 5–30 s' },
  { key: 'abandon_long', label: 'Zákazník zavěsil po 30 s', hint: 'abandon, čekání přes 30 s' },
  { key: 'other', label: 'Jiný důvod', hint: 'jiný kód ukončení v Daktele (viz seznam)' }
]

const PHONE_KEY = (expr) => `RIGHT(regexp_replace(COALESCE(${expr}, ''), '[^0-9]', '', 'g'), 9)`

/** CTE `classified`: jeden řádek = jeden příchozí záznam v pracovní době + důvod (nebo 'met'). */
function classifiedCte(brandId) {
  const response = RESPONSE_SECONDS_SQL.trim()
  const queueFilter = buildSlaIncomingQueueFilterSql(brandId)
  const isWorking = buildIsWorkingHoursSql('c.call_time', {
    brandId: resolveBrandWorkingHoursProfile(brandId)
  })
  const limit = SLA_WORKING_THRESHOLD_SECONDS

  return `
    records AS (
      SELECT
        c.call AS call_id,
        c.call_time,
        c.clid,
        c.queue AS queue_id,
        COALESCE(NULLIF(TRIM(q.title), ''), NULLIF(TRIM(q.name), ''), c.queue, '—') AS queue_name,
        c.answered IS TRUE AS answered,
        COALESCE(${response}, 0) AS resp,
        LOWER(COALESCE(c.disconnection_cause, '')) AS cause,
        ${PHONE_KEY('c.clid')} AS phone_key
      ${INCOMING_CALLS_FROM}
      WHERE ${INCOMING_CALLS_WHERE}
        ${queueFilter}
        AND (${isWorking}) IS TRUE
    ),
    chained AS (
      SELECT
        r.*,
        SUM(CASE WHEN prev_time IS NULL OR r.call_time - prev_time > INTERVAL '2 minutes' THEN 1 ELSE 0 END)
          OVER (PARTITION BY r.phone_key ORDER BY r.call_time, r.call_id) AS session_no
      FROM (
        SELECT records.*, LAG(call_time) OVER (PARTITION BY phone_key ORDER BY call_time, call_id) AS prev_time
        FROM records
      ) r
    ),
    sessions AS (
      SELECT phone_key, session_no, BOOL_OR(answered) AS session_answered
      FROM chained
      GROUP BY 1, 2
    ),
    classified AS (
      SELECT
        ch.*,
        s.session_answered,
        CASE
          WHEN ch.answered AND ch.resp <= ${limit} THEN 'met'
          WHEN ch.answered THEN 'answered_late'
          WHEN ch.cause = 'exitwithtimeout' AND s.session_answered THEN 'timeout_answered'
          WHEN ch.cause = 'exitwithtimeout' THEN 'timeout_unanswered'
          WHEN ch.cause = 'abandon' AND ch.resp < 5 THEN 'abandon_short'
          WHEN ch.cause = 'abandon' AND ch.resp <= ${limit} THEN 'abandon_mid'
          WHEN ch.cause = 'abandon' THEN 'abandon_long'
          ELSE 'other'
        END AS reason,
        EXISTS (
          SELECT 1
          FROM call l
          WHERE ${PHONE_KEY('l.clid')} = ch.phone_key
            AND l.call_time > ch.call_time
            AND (
              UPPER(COALESCE(l.direction, '')) = 'OUT'
              OR (UPPER(COALESCE(l.direction, '')) = 'IN' AND l.answered IS TRUE)
            )
        ) AS resolved_later
      FROM chained ch
      JOIN sessions s ON s.phone_key = ch.phone_key AND s.session_no = ch.session_no
    )
  `
}

export async function fetchSla30Reasons(query, { brandId, startDate, endDate }) {
  const { rows } = await query(
    `
    WITH ${classifiedCte(brandId)}
    SELECT
      reason,
      COUNT(*)::int AS records,
      COUNT(DISTINCT (phone_key, session_no))::int AS calls,
      COUNT(*) FILTER (WHERE resolved_later)::int AS resolved_later,
      STRING_AGG(DISTINCT NULLIF(cause, ''), ', ') AS causes
    FROM classified
    GROUP BY reason
    `,
    [startDate, endDate]
  )

  const byKey = new Map(rows.map((row) => [row.reason, row]))
  const met = byKey.get('met')
  const total = rows.reduce((sum, row) => sum + (Number(row.records) || 0), 0)
  const totals = await query(
    `
    WITH ${classifiedCte(brandId)}
    SELECT
      COUNT(DISTINCT (phone_key, session_no))::int AS calls,
      COUNT(DISTINCT (phone_key, session_no)) FILTER (WHERE session_answered)::int AS calls_answered
    FROM classified
    `,
    [startDate, endDate]
  )

  return {
    total_records: total,
    met_records: Number(met?.records) || 0,
    customer_calls: Number(totals.rows[0]?.calls) || 0,
    customer_calls_answered: Number(totals.rows[0]?.calls_answered) || 0,
    reasons: SLA30_REASONS.map((reason) => {
      const row = byKey.get(reason.key)
      return {
        ...reason,
        records: Number(row?.records) || 0,
        calls: Number(row?.calls) || 0,
        resolved_later: Number(row?.resolved_later) || 0,
        causes: row?.causes || ''
      }
    })
  }
}

export async function fetchSla30ReasonItems(query, { brandId, startDate, endDate, reason, limit = 200 }) {
  const { rows } = await query(
    `
    WITH ${classifiedCte(brandId)}
    SELECT call_id, to_char(call_time, 'YYYY-MM-DD HH24:MI') AS call_time, clid, queue_name, resp, cause, answered, resolved_later
    FROM classified
    WHERE reason = $3
    ORDER BY call_time DESC
    LIMIT ${Number(limit) || 200}
    `,
    [startDate, endDate, reason]
  )
  return rows.map((row) => ({
    call_id: row.call_id,
    call_time: row.call_time,
    clid: row.clid,
    queue_name: row.queue_name,
    wait_seconds: Number(row.resp) || 0,
    cause: row.cause || null,
    answered: row.answered,
    resolved_later: row.resolved_later
  }))
}
