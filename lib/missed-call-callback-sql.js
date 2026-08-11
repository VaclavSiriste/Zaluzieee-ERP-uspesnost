/**
 * Zmeškané příchozí hovory a navolání (první pozdější odchozí na stejné číslo).
 * Shoda telefonu: posledních 9 číslic z clid.
 */

export const MISSED_CALLBACK_CTE = `
  missed AS (
    SELECT
      c.call AS missed_id,
      c.call_time AS missed_at,
      c.clid,
      RIGHT(regexp_replace(COALESCE(c.clid, ''), '[^0-9]', '', 'g'), 9) AS phone_key
    FROM call c
    WHERE c.call_time >= $1
      AND c.call_time <= $2
      AND UPPER(COALESCE(c.direction, '')) = 'IN'
      AND c.answered = false
      AND LENGTH(regexp_replace(COALESCE(c.clid, ''), '[^0-9]', '', 'g')) >= 9
  ),
  outbound AS (
    SELECT
      RIGHT(regexp_replace(COALESCE(o.clid, ''), '[^0-9]', '', 'g'), 9) AS phone_key,
      o.call AS callback_id,
      o.call_time AS callback_at,
      o."user" AS callback_user
    FROM call o
    WHERE o.call_time >= $1
      AND UPPER(COALESCE(o.direction, '')) = 'OUT'
      AND LENGTH(regexp_replace(COALESCE(o.clid, ''), '[^0-9]', '', 'g')) >= 9
  ),
  first_callbacks AS (
    SELECT DISTINCT ON (m.missed_id)
      m.missed_id,
      m.missed_at,
      m.clid,
      m.phone_key,
      o.callback_id,
      o.callback_at,
      o.callback_user
    FROM missed m
    LEFT JOIN outbound o
      ON o.phone_key = m.phone_key
     AND o.callback_at > m.missed_at
    ORDER BY m.missed_id, o.callback_at ASC NULLS LAST
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
      CASE
        WHEN fc.callback_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (fc.callback_at - fc.missed_at)) / 3600.0
        ELSE NULL
      END AS hours_to_callback
    FROM first_callbacks fc
  )
`

export function missedCallbackVariantFilter(variant) {
  if (variant === 'called_back') return 'AND mc.callback_at IS NOT NULL'
  if (variant === 'open') return 'AND mc.callback_at IS NULL'
  return ''
}
