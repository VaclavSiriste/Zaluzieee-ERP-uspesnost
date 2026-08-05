import { resolveDateRange } from '@/lib/metrics-query'

/** Business datum: created_at + 2h, po 20:00 → další kalendářní den. */
export const BUSINESS_DATE_SQL = `
  CASE
    WHEN EXTRACT(HOUR FROM (o.created_at + INTERVAL '2 hours')) >= 20
      THEN ((o.created_at + INTERVAL '2 hours') + INTERVAL '1 day')::date
    ELSE (o.created_at + INTERVAL '2 hours')::date
  END
`

/** Kalendářní datum po +2h posunu (bez cutoff 20:00). */
export const CALENDAR_DATE_SQL = `(o.created_at + INTERVAL '2 hours')::date`

/** 1 = navoláno ve stejný business den (Looker: DATE(first_iframe_change_at)). */
export const NAVOLANO_FLAG_SQL = `
  CASE
    WHEN (${BUSINESS_DATE_SQL}) = (o.first_iframe_change_at)::date THEN 1
    ELSE 0
  END
`

/** Rozdíl hodin mezi prvním kontaktem a vznikem leadu (oba +2h). */
export const HOURS_TO_CONTACT_SQL = `
  CASE
    WHEN o.first_iframe_change_at IS NULL THEN NULL
    ELSE EXTRACT(
      EPOCH FROM (
        (o.first_iframe_change_at + INTERVAL '2 hours')
        - (o.created_at + INTERVAL '2 hours')
      )
    ) / 3600.0
  END
`

export function slaFlagSql(hours) {
  return `
    CASE
      WHEN (${HOURS_TO_CONTACT_SQL}) IS NOT NULL
       AND (${HOURS_TO_CONTACT_SQL}) <= ${Number(hours)}
        THEN 1
      ELSE 0
    END
  `
}

export const SLA24_FLAG_SQL = slaFlagSql(24)
export const SLA48_FLAG_SQL = slaFlagSql(48)
export const SLA72_FLAG_SQL = slaFlagSql(72)

/**
 * Looker: stav != duplikace
 * - Vyloučit status = duplikace
 * - Vyloučit status obsahuje reklamace
 * Looker: ID formuláře != null → Vyloučit id_formulare Je nula
 */
export const SLA_BASE_FILTERS_SQL = `
  AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
  AND LOWER(COALESCE(o.status, '')) NOT LIKE '%reklamace%'
  AND EXISTS (
    SELECT 1
    FROM orders_column_values ocv_f
    JOIN orders_columns oc_f ON oc_f.id = ocv_f.column_id
    WHERE ocv_f.order_id = o.id
      AND oc_f.slug = 'id_formulare'
      AND NULLIF(TRIM(ocv_f.value), '') IS NOT NULL
  )
`

/**
 * Filtry poptávky / SLA 24·48·72 (Looker rozpad filtrů):
 * - stav: vyloučit duplikace + obsahuje reklamace
 * - ID formuláře: vyloučit null
 * - customer_region: Vyloučit Rovno Karlovarský kraj
 * - proc_nedopadl_hovor: Vyloučit Rovno Venkovky OR Zahrnout Je nula
 */
export const SLA_POPTAVKY_FILTERS_SQL = `
  ${SLA_BASE_FILTERS_SQL}
  AND COALESCE(NULLIF(TRIM(c.region), ''), '') <> 'Karlovarský kraj'
  AND NOT EXISTS (
    SELECT 1
    FROM orders_column_values ocv_d
    JOIN orders_columns oc_d ON oc_d.id = ocv_d.column_id
    WHERE ocv_d.order_id = o.id
      AND oc_d.slug = 'proc_nedopadl_hovor'
      AND LOWER(TRIM(ocv_d.value)) = 'venkovky'
  )
`

export const SLA_POPTAVKY_FROM_SQL = `
  FROM orders o
  LEFT JOIN customers c ON c.id = o.customer_id
`

export function resolveSlaRange(query = {}) {
  return resolveDateRange({
    period: typeof query.period === 'string' ? query.period : 'month',
    startDate: typeof query.startDate === 'string' ? query.startDate : '',
    endDate: typeof query.endDate === 'string' ? query.endDate : ''
  })
}

export function formatSlaPercent(part, total) {
  const all = Number(total) || 0
  const done = Number(part) || 0
  if (!all) return 0
  // bez zaokrouhlení – přesný podíl * 100
  return (done / all) * 100
}
