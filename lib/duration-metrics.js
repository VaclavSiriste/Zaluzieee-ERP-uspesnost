import { getDateFilterSql } from '@/lib/metrics-query'

const NAVOLANI_INVALID = `
  AND NULLIF(TRIM(ocv.value), '') IS NOT NULL
  AND LOWER(TRIM(ocv.value)) NOT IN ('nezadano', 'nezadáno', 'n/a', 'null', '-')
`

const ASSIGN_CTES = `
  zamerovac_assign AS (
    SELECT DISTINCT ON (order_id)
      order_id,
      user_id
    FROM order_user_assignments
    WHERE assignment_type = 'zamerovac'
    ORDER BY order_id, id DESC
  )
`

function latestDateColumnCte(name, slug, extraWhere = '') {
  return `
    ${name} AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        CASE
          WHEN TRIM(ocv.value) ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
            THEN SUBSTRING(TRIM(ocv.value), 1, 10)::date
          ELSE NULL
        END AS date_value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = '${slug}'
        ${extraWhere}
      ORDER BY ocv.order_id, ocv.id DESC
    )
  `
}

export const DURATION_METRIC_KEYS = {
  leadNavolani: 'duration_lead_navolani',
  navolaniZamereni: 'duration_navolani_zamereni',
  leadZamereni: 'duration_lead_zamereni'
}

const DURATION_METRICS = new Set(Object.values(DURATION_METRIC_KEYS))

export function isDurationMetric(metric) {
  return DURATION_METRICS.has(metric)
}

export function formatDurationDays(value) {
  const num = Number(value)
  if (!Number.isFinite(num) || num < 0) return '—'
  const rounded = Math.round(num * 10) / 10
  const label = rounded === 1 ? 'den' : rounded < 5 ? 'dny' : 'dní'
  const formatted = Number.isInteger(rounded)
    ? String(rounded)
    : rounded.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
  return `${formatted} ${label}`
}

export function emptyDurationStats() {
  return {
    avg_days_lead_navolani: null,
    avg_days_navolani_zamereni: null,
    avg_days_lead_zamereni: null,
    count_lead_navolani: 0,
    count_navolani_zamereni: 0,
    count_lead_zamereni: 0
  }
}

function avgFromSumCount(sum, count) {
  const c = Number(count || 0)
  if (c <= 0) return null
  return Math.round((Number(sum || 0) / c) * 10) / 10
}

export function mapDurationRow(row) {
  return {
    avg_days_lead_navolani: avgFromSumCount(row.sum_days_lead_navolani, row.count_lead_navolani),
    avg_days_navolani_zamereni: avgFromSumCount(row.sum_days_navolani_zamereni, row.count_navolani_zamereni),
    avg_days_lead_zamereni: avgFromSumCount(row.sum_days_lead_zamereni, row.count_lead_zamereni),
    count_lead_navolani: Number(row.count_lead_navolani || 0),
    count_navolani_zamereni: Number(row.count_navolani_zamereni || 0),
    count_lead_zamereni: Number(row.count_lead_zamereni || 0),
    sum_days_lead_navolani: Number(row.sum_days_lead_navolani || 0),
    sum_days_navolani_zamereni: Number(row.sum_days_navolani_zamereni || 0),
    sum_days_lead_zamereni: Number(row.sum_days_lead_zamereni || 0)
  }
}

export function getDurationMetricsCte() {
  return `
    ${latestDateColumnCte('datum_navolani_raw', 'datum_navolani', NAVOLANI_INVALID)},
    ${latestDateColumnCte('datum_zamereni_raw', 'datum_zamereni', '')},
    order_dates AS (
      SELECT
        o.id AS order_id,
        o.created_at::date AS lead_date,
        dn.date_value AS navolani_date,
        dz.date_value AS zamereni_date
      FROM orders o
      LEFT JOIN datum_navolani_raw dn ON dn.order_id = o.id
      LEFT JOIN datum_zamereni_raw dz ON dz.order_id = o.id
    ),
    order_durations AS (
      SELECT
        order_id,
        lead_date,
        navolani_date,
        zamereni_date,
        CASE
          WHEN lead_date IS NOT NULL
            AND navolani_date IS NOT NULL
            AND navolani_date >= lead_date
            THEN (navolani_date - lead_date)
        END AS days_lead_navolani,
        CASE
          WHEN navolani_date IS NOT NULL
            AND zamereni_date IS NOT NULL
            AND zamereni_date >= navolani_date
            THEN (zamereni_date - navolani_date)
        END AS days_navolani_zamereni,
        CASE
          WHEN lead_date IS NOT NULL
            AND zamereni_date IS NOT NULL
            AND zamereni_date >= lead_date
            THEN (zamereni_date - lead_date)
        END AS days_lead_zamereni
      FROM order_dates
    )
  `
}

export function resolveDurationMetricFilter(metric) {
  switch (metric) {
    case DURATION_METRIC_KEYS.leadNavolani:
      return { sql: 'AND dur.days_lead_navolani IS NOT NULL', extraParams: [] }
    case DURATION_METRIC_KEYS.navolaniZamereni:
      return { sql: 'AND dur.days_navolani_zamereni IS NOT NULL', extraParams: [] }
    case DURATION_METRIC_KEYS.leadZamereni:
      return { sql: 'AND dur.days_lead_zamereni IS NOT NULL', extraParams: [] }
    default:
      throw new Error(`Neplatná metrika délky: ${metric}`)
  }
}

function buildDurationQuery({ dateFilterCte, dateFilterJoin, dateFilterWhere, grouping }) {
  const isOperators = grouping === 'operators'
  const obchodnikAssignType = isOperators ? 'domluvil_zamereni' : 'assigned_operator'
  const primaryName = isOperators
    ? `COALESCE(NULLIF(op_assigned.name, ''), 'Nepřiřazený operátor')`
    : `COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač')`
  const secondaryName = isOperators
    ? `COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač')`
    : `COALESCE(NULLIF(ou.name, ''), 'Nepřiřazený operátor')`

  return `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    ${ASSIGN_CTES},
    obchodnik_assign AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = '${obchodnikAssignType}'
      ORDER BY order_id, id DESC
    ),
    ${latestDateColumnCte('datum_navolani_raw', 'datum_navolani', NAVOLANI_INVALID)},
    ${latestDateColumnCte('datum_zamereni_raw', 'datum_zamereni', '')},
    order_dates AS (
      SELECT
        o.id AS order_id,
        o.created_at::date AS lead_date,
        dn.date_value AS navolani_date,
        dz.date_value AS zamereni_date
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN datum_navolani_raw dn ON dn.order_id = o.id
      LEFT JOIN datum_zamereni_raw dz ON dz.order_id = o.id
      WHERE ${dateFilterWhere}
    ),
    order_durations AS (
      SELECT
        order_id,
        CASE
          WHEN lead_date IS NOT NULL
            AND navolani_date IS NOT NULL
            AND navolani_date >= lead_date
            THEN (navolani_date - lead_date)
        END AS days_lead_navolani,
        CASE
          WHEN navolani_date IS NOT NULL
            AND zamereni_date IS NOT NULL
            AND zamereni_date >= navolani_date
            THEN (zamereni_date - navolani_date)
        END AS days_navolani_zamereni,
        CASE
          WHEN lead_date IS NOT NULL
            AND zamereni_date IS NOT NULL
            AND zamereni_date >= lead_date
            THEN (zamereni_date - lead_date)
        END AS days_lead_zamereni
      FROM order_dates
    )
    SELECT
      ${primaryName} AS primary_name,
      ${secondaryName} AS secondary_name,
      COALESCE(SUM(odur.days_lead_navolani), 0) AS sum_days_lead_navolani,
      COUNT(odur.days_lead_navolani) AS count_lead_navolani,
      COALESCE(SUM(odur.days_navolani_zamereni), 0) AS sum_days_navolani_zamereni,
      COUNT(odur.days_navolani_zamereni) AS count_navolani_zamereni,
      COALESCE(SUM(odur.days_lead_zamereni), 0) AS sum_days_lead_zamereni,
      COUNT(odur.days_lead_zamereni) AS count_lead_zamereni
    FROM orders o
    ${dateFilterJoin}
    JOIN order_durations odur ON odur.order_id = o.id
    LEFT JOIN obchodnik_assign oa ON oa.order_id = o.id
    LEFT JOIN users op_assigned ON op_assigned.id = oa.user_id
    LEFT JOIN zamerovac_assign za ON za.order_id = o.id
    LEFT JOIN users zu ON zu.id = za.user_id
    ${isOperators ? '' : 'LEFT JOIN users ou ON ou.id = oa.user_id'}
    WHERE ${dateFilterWhere}
    GROUP BY ${primaryName}, ${secondaryName}
    ORDER BY primary_name, secondary_name
  `
}

export async function fetchDurationByGroup(pool, { start, end, dateBasis, grouping }) {
  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql(dateBasis)
  const sql = buildDurationQuery({ dateFilterCte, dateFilterJoin, dateFilterWhere, grouping })
  const result = await pool.query(sql, [start, end])
  return result.rows.map((row) => ({
    primary_name: row.primary_name,
    secondary_name: row.secondary_name,
    ...mapDurationRow(row)
  }))
}

function aggregateBubbleDuration(children, getKey) {
  const sums = {
    sum_days_lead_navolani: 0,
    count_lead_navolani: 0,
    sum_days_navolani_zamereni: 0,
    count_navolani_zamereni: 0,
    sum_days_lead_zamereni: 0,
    count_lead_zamereni: 0
  }

  for (const child of children) {
    const row = getKey(child)
    if (!row) {
      Object.assign(child, emptyDurationStats())
      continue
    }
    Object.assign(child, {
      avg_days_lead_navolani: row.avg_days_lead_navolani,
      avg_days_navolani_zamereni: row.avg_days_navolani_zamereni,
      avg_days_lead_zamereni: row.avg_days_lead_zamereni,
      count_lead_navolani: row.count_lead_navolani,
      count_navolani_zamereni: row.count_navolani_zamereni,
      count_lead_zamereni: row.count_lead_zamereni
    })
    sums.sum_days_lead_navolani += row.sum_days_lead_navolani
    sums.count_lead_navolani += row.count_lead_navolani
    sums.sum_days_navolani_zamereni += row.sum_days_navolani_zamereni
    sums.count_navolani_zamereni += row.count_navolani_zamereni
    sums.sum_days_lead_zamereni += row.sum_days_lead_zamereni
    sums.count_lead_zamereni += row.count_lead_zamereni
  }

  return {
    avg_days_lead_navolani: avgFromSumCount(sums.sum_days_lead_navolani, sums.count_lead_navolani),
    avg_days_navolani_zamereni: avgFromSumCount(sums.sum_days_navolani_zamereni, sums.count_navolani_zamereni),
    avg_days_lead_zamereni: avgFromSumCount(sums.sum_days_lead_zamereni, sums.count_lead_zamereni),
    count_lead_navolani: sums.count_lead_navolani,
    count_navolani_zamereni: sums.count_navolani_zamereni,
    count_lead_zamereni: sums.count_lead_zamereni
  }
}

export function mergeOperatorDuration(bubbles, durationRows) {
  const byPair = new Map(
    durationRows.map((row) => [`${row.primary_name}\0${row.secondary_name}`, row])
  )

  for (const bubble of bubbles) {
    Object.assign(
      bubble,
      aggregateBubbleDuration(bubble.zamerovaci, (z) =>
        byPair.get(`${bubble.operator_name}\0${z.zamerovac_name}`)
      )
    )
  }

  return bubbles
}

export function mergeObchodniciDuration(bubbles, durationRows) {
  const byPair = new Map(
    durationRows.map((row) => [`${row.primary_name}\0${row.secondary_name}`, row])
  )

  for (const bubble of bubbles) {
    Object.assign(
      bubble,
      aggregateBubbleDuration(bubble.obchodnici, (salesman) =>
        byPair.get(`${bubble.zamerovac_name}\0${salesman.obchodnik_name}`)
      )
    )
  }

  return bubbles
}
