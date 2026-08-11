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
  matched AS (
    SELECT
      m.missed_id,
      m.missed_at,
      m.clid,
      m.phone_key,
      cb.callback_id,
      cb.callback_at,
      cb.callback_user,
      CASE
        WHEN cb.callback_at IS NOT NULL
          THEN EXTRACT(EPOCH FROM (cb.callback_at - m.missed_at)) / 3600.0
        ELSE NULL
      END AS hours_to_callback
    FROM missed m
    LEFT JOIN LATERAL (
      SELECT
        o.call AS callback_id,
        o.call_time AS callback_at,
        o."user" AS callback_user
      FROM call o
      WHERE RIGHT(regexp_replace(COALESCE(o.clid, ''), '[^0-9]', '', 'g'), 9) = m.phone_key
        AND UPPER(COALESCE(o.direction, '')) = 'OUT'
        AND o.call_time > m.missed_at
      ORDER BY o.call_time ASC
      LIMIT 1
    ) cb ON true
  )
`

export function missedCallbackVariantFilter(variant) {
  if (variant === 'called_back') return 'AND mc.callback_at IS NOT NULL'
  if (variant === 'open') return 'AND mc.callback_at IS NULL'
  return ''
}
