/**
 * Zmeškané příchozí hovory a „vyřízení“:
 * 1) první pozdější odchozí na stejné číslo (OUT), nebo
 * 2) první pozdější zvednutý příchozí od stejného čísla (IN answered)
 *    — zákazník zavolá znovu a my to zvedneme.
 * Shoda telefonu: posledních 9 číslic z clid.
 * Bere se dřívější z obou událostí.
 *
 * Pracovní doba dle značky (Europe/Prague, dle času zmeškaného hovoru).
 */

import { resolveBrandWorkingHoursProfile } from '@/lib/operations-brands'
import { buildSlaQueueFilterSql } from '@/lib/incoming-line-sla'
import { buildIsWorkingHoursSql, WORKING_HOURS_TZ } from '@/lib/working-hours-sql'

export { WORKING_HOURS_TZ, buildIsWorkingHoursSql }

/**
 * @param {{ brandId?: string|null }} [options]
 * brandId → filtruje zmeškané IN (a zpětné IN) na fronty značky; OUT callback bez filtru fronty.
 */
export function buildMissedCallbackCte({ brandId = null } = {}) {
  const queueFilter = brandId ? buildSlaQueueFilterSql(brandId) : ''
  const isWorking = buildIsWorkingHoursSql('fc.missed_at', {
    brandId: resolveBrandWorkingHoursProfile(brandId)
  })

  return `
  missed AS (
    SELECT
      c.call AS missed_id,
      c.call_time AS missed_at,
      c.clid,
      RIGHT(regexp_replace(COALESCE(c.clid, ''), '[^0-9]', '', 'g'), 9) AS phone_key
    FROM call c
    LEFT JOIN queue q ON q.queue = c.queue
    WHERE c.call_time >= $1
      AND c.call_time <= $2
      AND UPPER(COALESCE(c.direction, '')) = 'IN'
      AND c.answered = false
      AND LENGTH(regexp_replace(COALESCE(c.clid, ''), '[^0-9]', '', 'g')) >= 9
      ${queueFilter}
  ),
  outbound AS (
    SELECT
      RIGHT(regexp_replace(COALESCE(o.clid, ''), '[^0-9]', '', 'g'), 9) AS phone_key,
      o.call AS event_id,
      o.call_time AS event_at,
      o."user" AS event_user,
      'outbound'::text AS resolution_kind
    FROM call o
    WHERE o.call_time >= $1
      AND UPPER(COALESCE(o.direction, '')) = 'OUT'
      AND LENGTH(regexp_replace(COALESCE(o.clid, ''), '[^0-9]', '', 'g')) >= 9
  ),
  inbound_answered AS (
    SELECT
      RIGHT(regexp_replace(COALESCE(i.clid, ''), '[^0-9]', '', 'g'), 9) AS phone_key,
      i.call AS event_id,
      i.call_time AS event_at,
      i."user" AS event_user,
      'inbound_answered'::text AS resolution_kind
    FROM call i
    LEFT JOIN queue q ON q.queue = i.queue
    WHERE i.call_time >= $1
      AND UPPER(COALESCE(i.direction, '')) = 'IN'
      AND i.answered IS TRUE
      AND LENGTH(regexp_replace(COALESCE(i.clid, ''), '[^0-9]', '', 'g')) >= 9
      ${queueFilter}
  ),
  resolution_events AS (
    SELECT * FROM outbound
    UNION ALL
    SELECT * FROM inbound_answered
  ),
  first_callbacks AS (
    SELECT DISTINCT ON (m.missed_id)
      m.missed_id,
      m.missed_at,
      m.clid,
      m.phone_key,
      e.event_id AS callback_id,
      e.event_at AS callback_at,
      e.event_user AS callback_user,
      e.resolution_kind
    FROM missed m
    LEFT JOIN resolution_events e
      ON e.phone_key = m.phone_key
     AND e.event_at > m.missed_at
    ORDER BY m.missed_id, e.event_at ASC NULLS LAST
  ),
  matched AS (
    SELECT
      fc.missed_id,
      fc.missed_at,
      fc.clid,
      fc.phone_key,
      fc.callback_id,
      fc.callback_at,
      fc.callback_user,
      fc.resolution_kind,
      CASE
        WHEN fc.callback_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fc.callback_at - fc.missed_at)) / 3600.0
        ELSE NULL
      END AS hours_to_callback,
      (${isWorking}) AS is_working_hours
    FROM first_callbacks fc
  )
`
}

/** @deprecated preferuj buildMissedCallbackCte() — ponecháno pro zpětnou kompatibilitu */
export const MISSED_CALLBACK_CTE = buildMissedCallbackCte()

export function missedCallbackVariantFilter(variant) {
  if (variant === 'called_back') return 'AND mc.callback_at IS NOT NULL'
  if (variant === 'open') return 'AND mc.callback_at IS NULL'
  return ''
}

/** @param {'all'|'working'|'outside'} hoursAxis */
export function missedCallbackHoursAxisFilter(hoursAxis) {
  if (hoursAxis === 'working') return 'AND mc.is_working_hours IS TRUE'
  if (hoursAxis === 'outside') return 'AND mc.is_working_hours IS FALSE'
  return ''
}
