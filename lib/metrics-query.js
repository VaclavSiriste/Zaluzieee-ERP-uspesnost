export function resolveDateRange({ startDate, endDate, period }) {
  const now = new Date()
  const end = endDate ? new Date(endDate) : now
  let start = startDate ? new Date(startDate) : now

  if (!startDate) {
    if (period === 'week') start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    else if (period === 'ytd') start = new Date(now.getFullYear(), 0, 1)
    else start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Neplatné datum v query parametrech')
  }

  return { start, end }
}

export function resolveDateBasis(value) {
  if (value === 'created' || value === 'navolani' || value === 'zamereni') return value
  return 'navolani'
}

export function getDateFilterSql(dateBasis) {
  if (dateBasis === 'created') {
    return {
      dateFilterCte: '',
      dateFilterJoin: '',
      dateFilterWhere: 'o.created_at::date >= $1::date AND o.created_at::date <= $2::date',
      dateSelect: 'o.created_at::date AS filter_date'
    }
  }

  const slug = dateBasis === 'zamereni' ? 'datum_zamereni' : 'datum_navolani'
  const withPlaceholderCleanup = dateBasis === 'navolani'
    ? `
      AND NULLIF(ocv_latest.raw_value, '') IS NOT NULL
      AND LOWER(ocv_latest.raw_value) NOT IN ('nezadano', 'nezadáno', 'n/a', 'null', '-')
    `
    : `
      AND NULLIF(ocv_latest.raw_value, '') IS NOT NULL
    `

  return {
    dateFilterCte: `
      datum_filter AS (
        SELECT
          ocv_latest.order_id,
          ocv_latest.filter_date
        FROM (
          SELECT DISTINCT ON (ocv.order_id)
            ocv.order_id,
            TRIM(ocv.value) AS raw_value,
            CASE
              WHEN TRIM(ocv.value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN SUBSTRING(TRIM(ocv.value), 1, 10)::date
              ELSE NULL
            END AS filter_date
          FROM orders_column_values ocv
          JOIN orders_columns oc ON oc.id = ocv.column_id
          WHERE oc.slug = '${slug}'
          ORDER BY ocv.order_id, ocv.id DESC
        ) ocv_latest
        WHERE ocv_latest.filter_date IS NOT NULL
        ${withPlaceholderCleanup}
      )
    `,
    dateFilterJoin: 'JOIN datum_filter df ON df.order_id = o.id',
    dateFilterWhere: 'df.filter_date >= $1::date AND df.filter_date <= $2::date',
    dateSelect: 'df.filter_date AS filter_date'
  }
}

const METRIC_LABELS = {
  leads: 'Přijaté leady',
  scheduled: 'Celkem navolaných',
  completed: 'Dopadlo',
  cancelled: 'Nedopadlo',
  in_progress: 'V řešení',
  waiting: 'Čekáme',
  missing: 'Bez výsledku',
  decided: 'Komunikováno (Ano + Ne)',
  category: 'Kategorie',
  duration_lead_navolani: 'Průměr: přijetí leadu → navolání',
  duration_navolani_zamereni: 'Průměr: navolání → zaměření',
  duration_lead_zamereni: 'Průměr: přijetí leadu → zaměření'
}

export function getMetricLabel(metric, category) {
  if (metric === 'category' && category) return `Kategorie: ${category}`
  return METRIC_LABELS[metric] || metric
}

export function resolveMetricFilter(metric, category) {
  switch (metric) {
    case 'leads':
    case 'scheduled':
      return { sql: '', extraParams: [] }
    case 'completed':
      return { sql: "AND dh.dopadlo_value = 'ano'", extraParams: [] }
    case 'cancelled':
      return { sql: "AND dh.dopadlo_value = 'ne'", extraParams: [] }
    case 'in_progress':
      return {
        sql: "AND (dh.dopadlo_value IS NULL OR dh.dopadlo_value NOT IN ('ano', 'ne'))",
        extraParams: []
      }
    case 'waiting':
      return { sql: "AND dh.dopadlo_value = 'cekame'", extraParams: [] }
    case 'missing':
      return {
        sql: "AND (dh.dopadlo_value IS NULL OR dh.dopadlo_value NOT IN ('ano', 'ne', 'cekame'))",
        extraParams: []
      }
    case 'decided':
      return { sql: "AND dh.dopadlo_value IN ('ano', 'ne')", extraParams: [] }
    case 'category':
      if (!category) throw new Error('Chybí parametr category')
      return {
        sql: "AND COALESCE(dh.dopadlo_value, 'bez_hodnoty') = $CATEGORY",
        extraParams: [category]
      }
    default:
      throw new Error(`Neplatný typ metriky: ${metric}`)
  }
}

export const OPERATOR_NAME_SQL = `
  COALESCE(
    NULLIF(u_assigned.name, ''),
    NULLIF(u.name, ''),
    COALESCE(NULLIF(o.created_by::TEXT, ''), 'Nepřiřazený operátor')
  )
`

export const ZAMEROVAC_NAME_SQL = `
  COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač')
`

export const DOMLUVIL_NAME_SQL = `
  COALESCE(NULLIF(du.name, ''), 'Nepřiřazený operátor')
`

export const OBCHODNIK_NAME_SQL = `
  COALESCE(NULLIF(ou.name, ''), 'Nepřiřazený operátor')
`

export const ASSIGNMENT_JOINS_SQL = `
  LEFT JOIN order_user_assignments zamerovac_oua
    ON zamerovac_oua.order_id = o.id
   AND zamerovac_oua.assignment_type = 'zamerovac'
  LEFT JOIN users zu ON zu.id = zamerovac_oua.user_id
  LEFT JOIN order_user_assignments domluvil_oua
    ON domluvil_oua.order_id = o.id
   AND domluvil_oua.assignment_type = 'domluvil_zamereni'
  LEFT JOIN users du ON du.id = domluvil_oua.user_id
  LEFT JOIN order_user_assignments obchodnik_oua
    ON obchodnik_oua.order_id = o.id
   AND obchodnik_oua.assignment_type = 'assigned_operator'
  LEFT JOIN users ou ON ou.id = obchodnik_oua.user_id
`

export const SYSTEEEM_ORDER_URL = 'https://systeeem.cz/orders/'

export function formatStatusLabel(value) {
  const map = {
    ano: 'Dopadlo',
    ne: 'Nedopadlo',
    cekame: 'Čekáme',
    bez_hodnoty: 'Bez výsledku'
  }
  return map[value] || value
}
