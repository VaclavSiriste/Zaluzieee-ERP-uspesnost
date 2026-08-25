/**
 * ERP Looker metriky po operátorech (datum_navolani + assignment + ano/počet).
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly, getDateFilterSql, SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'
export { normalizeOperatorKey } from '@/lib/normalize-operator'
import { normalizeOperatorKey } from '@/lib/normalize-operator'

const METRIC_DEFS = {
  dopadl_hovor: {
    valueSlug: 'dopadl_hovor',
    assignmentType: 'domluvil_zamereni',
    valueAlias: 'dopadl_hovor',
    anoKey: 'dopadl_hovor_ano',
    neKey: 'dopadl_hovor_ne',
    pocetKey: 'dopadl_hovor_pocet',
    labelAno: 'Dopadl hovor ANO',
    labelPocet: 'Dopadl hovor (ANO+NE)'
  },
  domluveno_zamereni: {
    valueSlug: 'naplanovan_termin_zamereni',
    assignmentType: 'kdo_naplanoval_zamereni',
    valueAlias: 'naplanovan_termin_zamereni',
    anoKey: 'domluveno_zamereni_ano',
    neKey: 'domluveno_zamereni_ne',
    pocetKey: 'domluveno_zamereni_pocet',
    labelAno: 'Naplánován termín zaměření ANO',
    labelPocet: 'Naplánován termín zaměření (ANO+NE)'
  }
}

export function resolveErpMetricKey(metric) {
  if (metric === 'dopadl_hovor_ano' || metric === 'dopadl_hovor_pocet') return 'dopadl_hovor'
  if (metric === 'domluveno_zamereni_ano' || metric === 'domluveno_zamereni_pocet') {
    return 'domluveno_zamereni'
  }
  if (metric === 'erp_hovory_ano' || metric === 'erp_hovory_pocet') return 'erp_hovory'
  if (metric === 'pocet_chyb') return 'pocet_chyb'
  return null
}

export function isErpYesNoMetric(metric) {
  return Boolean(resolveErpMetricKey(metric))
}

/** Looker: vyloučit Matěj Kalkus + Natálie Sawczuková u ERP hovorů */
const ERP_HOVORY_EXCLUDED_OPERATORS = ['Matěj Kalkus', 'Natálie Sawczuková']

/**
 * Looker NOT IN + NOT REGEXP_CONTAINS(proc_nedopadl_hovor, "Svět|dosah")
 * DB hodnoty jsou často slug (4x-nedovolano-poslana-sms), Looker display názvy.
 */
const ERP_HOVORY_REASON_OK_SQL = `
  (
    proc.raw_value IS NULL
    OR (
      regexp_replace(
        translate(
          lower(trim(proc.raw_value)),
          'áäčďéěíľĺňóôŕšťúůýž',
          'aacdeeillnoorstuuyz'
        ),
        '[^a-z0-9]+',
        '-',
        'g'
      ) NOT IN (
        '4x-nedovolano-poslana-sms',
        'doporuceni-nedovolano',
        'duplicita',
        'showroom',
        'venkovky',
        'projekt-mimodosah'
      )
      AND proc.raw_value !~* 'Svět|dosah|svet'
    )
  )
`

async function fetchErpHovoryByOperator({ start, end }) {
  const pool = getPool()
  if (!pool) return []

  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('navolani')

  const { rows } = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    dopadl AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'dopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    proc AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'proc_nedopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'domluvil_zamereni'
      ORDER BY order_id, id DESC
    )
    SELECT
      COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený operátor') AS operator_name,
      COUNT(*) FILTER (
        WHERE d.value_lc IN ('ano', 'ne')
          AND ${ERP_HOVORY_REASON_OK_SQL}
      )::int AS erp_hovory_pocet,
      COUNT(*) FILTER (
        WHERE d.value_lc = 'ano'
          AND ${ERP_HOVORY_REASON_OK_SQL}
      )::int AS erp_hovory_ano
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN dopadl d ON d.order_id = o.id
    LEFT JOIN proc ON proc.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(u.name, ''))) <> ALL($3::text[])
    GROUP BY 1
    ORDER BY 1
    `,
    [formatDateOnly(start), formatDateOnly(end), ERP_HOVORY_EXCLUDED_OPERATORS.map((n) => n.toLowerCase())]
  )

  return rows.map((row) => ({
    operator_name: row.operator_name,
    operator_key: normalizeOperatorKey(row.operator_name),
    erp_hovory_pocet: Number(row.erp_hovory_pocet) || 0,
    erp_hovory_ano: Number(row.erp_hovory_ano) || 0
  }))
}

async function fetchErpHovoryOrders({
  start,
  end,
  operatorName,
  mode = 'ano',
  limit = 50,
  offset = 0
}) {
  const pool = getPool()
  if (!pool) throw new Error('Chybí ERP_DB_CONNECTION_STRING')

  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('navolani')
  const params = [
    formatDateOnly(start),
    formatDateOnly(end),
    ERP_HOVORY_EXCLUDED_OPERATORS.map((n) => n.toLowerCase())
  ]
  let paramIndex = 4
  const operatorFilter = operatorName
    ? `AND LOWER(TRIM(COALESCE(u.name, ''))) = LOWER(TRIM($${paramIndex++}))`
    : ''
  if (operatorName) params.push(operatorName)

  const valueFilter =
    mode === 'ano'
      ? `AND d.value_lc = 'ano' AND ${ERP_HOVORY_REASON_OK_SQL}`
      : `AND d.value_lc IN ('ano', 'ne') AND ${ERP_HOVORY_REASON_OK_SQL}`

  const countResult = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    dopadl AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'dopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    proc AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'proc_nedopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'domluvil_zamereni'
      ORDER BY order_id, id DESC
    )
    SELECT COUNT(*)::int AS total
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN dopadl d ON d.order_id = o.id
    LEFT JOIN proc ON proc.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(u.name, ''))) <> ALL($3::text[])
      ${operatorFilter}
      ${valueFilter}
    `,
    params
  )

  const listParams = [...params, limit, offset]
  const listResult = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    dopadl AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'dopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    proc AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'proc_nedopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'domluvil_zamereni'
      ORDER BY order_id, id DESC
    )
    SELECT
      o.id AS order_id,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
      COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
      COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený operátor') AS operator_name,
      d.raw_value AS dopadl_hovor,
      proc.raw_value AS proc_nedopadl_hovor,
      df.filter_date AS filter_date
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN dopadl d ON d.order_id = o.id
    LEFT JOIN proc ON proc.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(u.name, ''))) <> ALL($3::text[])
      ${operatorFilter}
      ${valueFilter}
    ORDER BY df.filter_date DESC NULLS LAST, o.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    listParams
  )

  return {
    total: countResult.rows[0]?.total || 0,
    orders: listResult.rows.map((row) => ({
      order_id: row.order_id,
      customer_name: row.customer_name,
      region: row.region,
      operator_name: row.operator_name,
      dopadl_hovor: row.dopadl_hovor,
      proc_nedopadl_hovor: row.proc_nedopadl_hovor,
      metric_value: row.dopadl_hovor,
      filter_date: row.filter_date ? String(row.filter_date).slice(0, 10) : null,
      detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
    }))
  }
}

async function fetchYesNoByOperator(def, { start, end }) {
  const pool = getPool()
  if (!pool) return []

  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('navolani')

  const { rows } = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    metric_value AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = $3
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = $4
      ORDER BY order_id, id DESC
    )
    SELECT
      COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený operátor') AS operator_name,
      COUNT(*) FILTER (WHERE mv.value_lc = 'ano')::int AS ano,
      COUNT(*) FILTER (WHERE mv.value_lc = 'ne')::int AS ne,
      COUNT(*) FILTER (WHERE mv.value_lc IN ('ano', 'ne'))::int AS decided
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN metric_value mv ON mv.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
    GROUP BY 1
    ORDER BY 1
    `,
    [formatDateOnly(start), formatDateOnly(end), def.valueSlug, def.assignmentType]
  )

  return rows.map((row) => {
    const ano = Number(row.ano) || 0
    const ne = Number(row.ne) || 0
    const decided = Number(row.decided) || ano + ne
    const out = {
      operator_name: row.operator_name,
      operator_key: normalizeOperatorKey(row.operator_name),
      [def.pocetKey]: decided,
      [def.anoKey]: ano
    }
    if (def.neKey) out[def.neKey] = ne
    return out
  })
}

async function fetchYesNoOrders(def, { start, end, operatorName, mode = 'ano', limit = 50, offset = 0 }) {
  const pool = getPool()
  if (!pool) throw new Error('Chybí ERP_DB_CONNECTION_STRING')

  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('navolani')
  const params = [formatDateOnly(start), formatDateOnly(end), def.valueSlug, def.assignmentType]
  let paramIndex = 5
  const operatorFilter = operatorName
    ? `AND LOWER(TRIM(COALESCE(u.name, ''))) = LOWER(TRIM($${paramIndex++}))`
    : ''
  if (operatorName) params.push(operatorName)

  const valueFilter =
    mode === 'ano'
      ? `AND mv.value_lc = 'ano'`
      : mode === 'ne'
        ? `AND mv.value_lc = 'ne'`
        : `AND mv.value_lc IN ('ano', 'ne')`

  const countResult = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    metric_value AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = $3
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = $4
      ORDER BY order_id, id DESC
    )
    SELECT COUNT(*)::int AS total
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN metric_value mv ON mv.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
      ${operatorFilter}
      ${valueFilter}
    `,
    params
  )

  const listParams = [...params, limit, offset]
  const listResult = await pool.query(
    `
    WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
    metric_value AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = $3
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    assignee AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = $4
      ORDER BY order_id, id DESC
    )
    SELECT
      o.id AS order_id,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
      COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
      COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený operátor') AS operator_name,
      mv.raw_value AS metric_value,
      df.filter_date AS filter_date
    FROM orders o
    ${dateFilterJoin}
    JOIN assignee a ON a.order_id = o.id
    LEFT JOIN users u ON u.id = a.user_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN metric_value mv ON mv.order_id = o.id
    WHERE ${dateFilterWhere}
      AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
      ${operatorFilter}
      ${valueFilter}
    ORDER BY df.filter_date DESC NULLS LAST, o.id DESC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    listParams
  )

  return {
    total: countResult.rows[0]?.total || 0,
    orders: listResult.rows.map((row) => ({
      order_id: row.order_id,
      customer_name: row.customer_name,
      region: row.region,
      operator_name: row.operator_name,
      [def.valueAlias]: row.metric_value,
      metric_value: row.metric_value,
      filter_date: row.filter_date ? String(row.filter_date).slice(0, 10) : null,
      detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
    }))
  }
}

export async function fetchDopadlHovorByOperator(args) {
  return fetchYesNoByOperator(METRIC_DEFS.dopadl_hovor, args)
}

export async function fetchDopadlHovorOrders(args) {
  return fetchYesNoOrders(METRIC_DEFS.dopadl_hovor, args)
}

export async function fetchDomluvenoZamereniByOperator(args) {
  return fetchYesNoByOperator(METRIC_DEFS.domluveno_zamereni, args)
}

export async function fetchDomluvenoZamereniOrders(args) {
  return fetchYesNoOrders(METRIC_DEFS.domluveno_zamereni, args)
}

export { fetchErpHovoryByOperator, fetchErpHovoryOrders, fetchPocetChybByOperator, fetchPocetChybOrders }

const CHYBY_COLUMN_SLUGS = [
  'dopadl_hovor',
  'proc_nedopadl_hovor',
  'preferovane_datum',
  'preferovany_cas',
  'datum_navolani',
  'naplanovan_termin_zamereni',
  'datum_zamereni',
  'cas_zamereni'
]

const IS_EMPTY_SQL = (expr) => `NULLIF(TRIM(COALESCE(${expr}, '')), '') IS NULL`

/**
 * Looker „Počet chyb“ = součet 5 CASE (jedna zakázka může přispět vícekrát).
 * Operátor: domluvil_zamereni (1–4) / kdo_naplanoval_zamereni (5).
 * Datum filtru: created_at (kvůli chybám bez datum_navolani).
 */
async function fetchPocetChybByOperator({ start, end }) {
  const pool = getPool()
  if (!pool) return []

  const { rows } = await pool.query(
    `
    WITH latest_col AS (
      SELECT DISTINCT ON (ocv.order_id, oc.slug)
        ocv.order_id,
        oc.slug,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = ANY($3::text[])
      ORDER BY ocv.order_id, oc.slug, ocv.id DESC
    ),
    col AS (
      SELECT
        order_id,
        MAX(raw_value) FILTER (WHERE slug = 'dopadl_hovor') AS dopadl_hovor,
        MAX(value_lc) FILTER (WHERE slug = 'dopadl_hovor') AS dopadl_hovor_lc,
        MAX(raw_value) FILTER (WHERE slug = 'proc_nedopadl_hovor') AS proc_nedopadl_hovor,
        MAX(raw_value) FILTER (WHERE slug = 'preferovane_datum') AS preferovane_datum,
        MAX(raw_value) FILTER (WHERE slug = 'preferovany_cas') AS preferovany_cas,
        MAX(raw_value) FILTER (WHERE slug = 'datum_navolani') AS datum_navolani,
        MAX(value_lc) FILTER (WHERE slug = 'naplanovan_termin_zamereni') AS naplanovan_termin_lc,
        MAX(raw_value) FILTER (WHERE slug = 'datum_zamereni') AS datum_zamereni,
        MAX(raw_value) FILTER (WHERE slug = 'cas_zamereni') AS cas_zamereni
      FROM latest_col
      GROUP BY order_id
    ),
    domluvil AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'domluvil_zamereni'
      ORDER BY order_id, id DESC
    ),
    naplanoval AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'kdo_naplanoval_zamereni'
      ORDER BY order_id, id DESC
    ),
    zamerovac AS (
      SELECT DISTINCT ON (order_id)
        order_id,
        user_id
      FROM order_user_assignments
      WHERE assignment_type = 'zamerovac'
      ORDER BY order_id, id DESC
    ),
    flagged AS (
      SELECT
        o.id AS order_id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor') AS operator_name,
        'Chybí dopadl hovor'::text AS error_type
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND ${IS_EMPTY_SQL('c.dopadl_hovor')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Dopadl Ne bez důvodu'
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND c.dopadl_hovor_lc = 'ne'
        AND ${IS_EMPTY_SQL('c.proc_nedopadl_hovor')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Callback bez preferovaného termínu'
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND LOWER(TRIM(COALESCE(o.status, ''))) = 'callback'
        AND (
          ${IS_EMPTY_SQL('c.preferovane_datum')}
          OR ${IS_EMPTY_SQL('c.preferovany_cas')}
        )

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Chybí datum navolání'
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'novy-lead'
        AND ${IS_EMPTY_SQL('c.datum_navolani')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(nu.name), ''), 'Nepřiřazený operátor'),
        'Naplánováno bez data/času/zaměřovače'
      FROM orders o
      JOIN naplanoval n ON n.order_id = o.id
      LEFT JOIN users nu ON nu.id = n.user_id
      LEFT JOIN col c ON c.order_id = o.id
      LEFT JOIN zamerovac z ON z.order_id = o.id
      LEFT JOIN users zu ON zu.id = z.user_id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND c.naplanovan_termin_lc = 'ano'
        AND (
          ${IS_EMPTY_SQL('c.datum_zamereni')}
          OR ${IS_EMPTY_SQL('c.cas_zamereni')}
          OR ${IS_EMPTY_SQL('zu.name')}
        )
    )
    SELECT
      operator_name,
      COUNT(*)::int AS pocet_chyb
    FROM flagged
    GROUP BY 1
    ORDER BY 1
    `,
    [formatDateOnly(start), formatDateOnly(end), CHYBY_COLUMN_SLUGS]
  )

  return rows.map((row) => ({
    operator_name: row.operator_name,
    operator_key: normalizeOperatorKey(row.operator_name),
    pocet_chyb: Number(row.pocet_chyb) || 0
  }))
}

async function fetchPocetChybOrders({ start, end, operatorName, limit = 50, offset = 0 }) {
  const pool = getPool()
  if (!pool) throw new Error('Chybí ERP_DB_CONNECTION_STRING')

  const params = [formatDateOnly(start), formatDateOnly(end), CHYBY_COLUMN_SLUGS]
  let paramIndex = 4
  let operatorParam = null
  if (operatorName) {
    operatorParam = paramIndex
    params.push(operatorName)
    paramIndex += 1
  }
  const operatorFilterBare = operatorParam
    ? `AND LOWER(TRIM(operator_name)) = LOWER(TRIM($${operatorParam}))`
    : ''
  const operatorFilterAliased = operatorParam
    ? `AND LOWER(TRIM(f.operator_name)) = LOWER(TRIM($${operatorParam}))`
    : ''

  const flaggedCte = `
    WITH latest_col AS (
      SELECT DISTINCT ON (ocv.order_id, oc.slug)
        ocv.order_id,
        oc.slug,
        NULLIF(TRIM(ocv.value), '') AS raw_value,
        LOWER(TRIM(ocv.value)) AS value_lc
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = ANY($3::text[])
      ORDER BY ocv.order_id, oc.slug, ocv.id DESC
    ),
    col AS (
      SELECT
        order_id,
        MAX(raw_value) FILTER (WHERE slug = 'dopadl_hovor') AS dopadl_hovor,
        MAX(value_lc) FILTER (WHERE slug = 'dopadl_hovor') AS dopadl_hovor_lc,
        MAX(raw_value) FILTER (WHERE slug = 'proc_nedopadl_hovor') AS proc_nedopadl_hovor,
        MAX(raw_value) FILTER (WHERE slug = 'preferovane_datum') AS preferovane_datum,
        MAX(raw_value) FILTER (WHERE slug = 'preferovany_cas') AS preferovany_cas,
        MAX(raw_value) FILTER (WHERE slug = 'datum_navolani') AS datum_navolani,
        MAX(value_lc) FILTER (WHERE slug = 'naplanovan_termin_zamereni') AS naplanovan_termin_lc,
        MAX(raw_value) FILTER (WHERE slug = 'datum_zamereni') AS datum_zamereni,
        MAX(raw_value) FILTER (WHERE slug = 'cas_zamereni') AS cas_zamereni
      FROM latest_col
      GROUP BY order_id
    ),
    domluvil AS (
      SELECT DISTINCT ON (order_id) order_id, user_id
      FROM order_user_assignments
      WHERE assignment_type = 'domluvil_zamereni'
      ORDER BY order_id, id DESC
    ),
    naplanoval AS (
      SELECT DISTINCT ON (order_id) order_id, user_id
      FROM order_user_assignments
      WHERE assignment_type = 'kdo_naplanoval_zamereni'
      ORDER BY order_id, id DESC
    ),
    zamerovac AS (
      SELECT DISTINCT ON (order_id) order_id, user_id
      FROM order_user_assignments
      WHERE assignment_type = 'zamerovac'
      ORDER BY order_id, id DESC
    ),
    flagged AS (
      SELECT
        o.id AS order_id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor') AS operator_name,
        'Chybí dopadl hovor'::text AS error_type,
        o.created_at::date AS filter_date,
        o.status,
        c.dopadl_hovor,
        c.proc_nedopadl_hovor
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND ${IS_EMPTY_SQL('c.dopadl_hovor')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Dopadl Ne bez důvodu',
        o.created_at::date,
        o.status,
        c.dopadl_hovor,
        c.proc_nedopadl_hovor
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND c.dopadl_hovor_lc = 'ne'
        AND ${IS_EMPTY_SQL('c.proc_nedopadl_hovor')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Callback bez preferovaného termínu',
        o.created_at::date,
        o.status,
        c.dopadl_hovor,
        c.proc_nedopadl_hovor
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND LOWER(TRIM(COALESCE(o.status, ''))) = 'callback'
        AND (
          ${IS_EMPTY_SQL('c.preferovane_datum')}
          OR ${IS_EMPTY_SQL('c.preferovany_cas')}
        )

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(du.name), ''), 'Nepřiřazený operátor'),
        'Chybí datum navolání',
        o.created_at::date,
        o.status,
        c.dopadl_hovor,
        c.proc_nedopadl_hovor
      FROM orders o
      JOIN domluvil d ON d.order_id = o.id
      LEFT JOIN users du ON du.id = d.user_id
      LEFT JOIN col c ON c.order_id = o.id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'novy-lead'
        AND ${IS_EMPTY_SQL('c.datum_navolani')}

      UNION ALL

      SELECT
        o.id,
        COALESCE(NULLIF(TRIM(nu.name), ''), 'Nepřiřazený operátor'),
        'Naplánováno bez data/času/zaměřovače',
        o.created_at::date,
        o.status,
        c.dopadl_hovor,
        c.proc_nedopadl_hovor
      FROM orders o
      JOIN naplanoval n ON n.order_id = o.id
      LEFT JOIN users nu ON nu.id = n.user_id
      LEFT JOIN col c ON c.order_id = o.id
      LEFT JOIN zamerovac z ON z.order_id = o.id
      LEFT JOIN users zu ON zu.id = z.user_id
      WHERE o.created_at::date >= $1::date
        AND o.created_at::date <= $2::date
        AND c.naplanovan_termin_lc = 'ano'
        AND (
          ${IS_EMPTY_SQL('c.datum_zamereni')}
          OR ${IS_EMPTY_SQL('c.cas_zamereni')}
          OR ${IS_EMPTY_SQL('zu.name')}
        )
    )
  `

  const countResult = await pool.query(
    `
    ${flaggedCte}
    SELECT COUNT(*)::int AS total
    FROM flagged
    WHERE 1=1
      ${operatorFilterBare}
    `,
    params
  )

  const listParams = [...params, limit, offset]
  const listResult = await pool.query(
    `
    ${flaggedCte}
    SELECT
      f.order_id,
      COALESCE(NULLIF(TRIM(c.name), ''), 'Bez jména') AS customer_name,
      COALESCE(NULLIF(TRIM(c.region), ''), '—') AS region,
      f.operator_name,
      f.error_type,
      f.status,
      f.dopadl_hovor,
      f.proc_nedopadl_hovor,
      f.filter_date
    FROM flagged f
    LEFT JOIN orders o ON o.id = f.order_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE 1=1
      ${operatorFilterAliased}
    ORDER BY f.filter_date DESC NULLS LAST, f.order_id DESC, f.error_type ASC
    LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `,
    listParams
  )

  return {
    total: countResult.rows[0]?.total || 0,
    orders: listResult.rows.map((row) => ({
      order_id: row.order_id,
      customer_name: row.customer_name,
      region: row.region,
      operator_name: row.operator_name,
      dopadl_hovor: row.dopadl_hovor,
      proc_nedopadl_hovor: row.proc_nedopadl_hovor,
      metric_value: row.error_type,
      error_type: row.error_type,
      status: row.status,
      filter_date: row.filter_date ? String(row.filter_date).slice(0, 10) : null,
      detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
    }))
  }
}

export async function fetchErpYesNoOrders({ metric, ...args }) {
  const key = resolveErpMetricKey(metric)
  if (!key) throw new Error(`Neznámá ERP metrika: ${metric}`)
  const mode = String(metric || '').endsWith('_pocet') ? 'pocet' : 'ano'

  if (key === 'pocet_chyb') {
    const result = await fetchPocetChybOrders(args)
    return {
      ...result,
      label: 'Počet chyb',
      valueAlias: 'error_type'
    }
  }

  if (key === 'erp_hovory') {
    const result = await fetchErpHovoryOrders({ ...args, mode })
    return {
      ...result,
      label: mode === 'ano' ? 'ANO' : 'ERP hovory (Ano + Ne)',
      valueAlias: 'dopadl_hovor'
    }
  }

  const def = METRIC_DEFS[key]
  const result = await fetchYesNoOrders(def, { ...args, mode })
  return {
    ...result,
    label: mode === 'ano' ? def.labelAno : def.labelPocet,
    valueAlias: def.valueAlias
  }
}
