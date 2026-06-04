import { getPool } from '@/lib/db-esm'
import {
  resolveDateRange,
  resolveDateBasis,
  getDateFilterSql,
  resolveMetricFilter,
  getMetricLabel,
  OPERATOR_NAME_SQL,
  ZAMEROVAC_NAME_SQL,
  DOMLUVIL_NAME_SQL,
  OBCHODNIK_NAME_SQL,
  ASSIGNMENT_JOINS_SQL,
  formatStatusLabel
} from '@/lib/metrics-query'
import {
  isDurationMetric,
  getDurationMetricsCte,
  resolveDurationMetricFilter,
  DURATION_METRIC_KEYS
} from '@/lib/duration-metrics'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const {
    startDate,
    endDate,
    period = 'month',
    region,
    operator,
    zamerovac,
    domluvil,
    obchodnik,
    failedReason,
    category,
    metric = 'scheduled',
    limit = String(DEFAULT_LIMIT),
    offset = '0'
  } = req.query

  const dateBasis = resolveDateBasis(req.query.dateBasis)
  const effectiveDateBasis = metric === 'leads' ? 'created' : dateBasis
  const regionFilter = cleanParam(region)
  const operatorFilter = cleanParam(operator)
  const zamerovacFilter = cleanParam(zamerovac)
  const domluvilFilter = cleanParam(domluvil)
  const obchodnikFilter = cleanParam(obchodnik)
  const failedReasonFilter = cleanParam(failedReason)
  const categoryFilter = cleanParam(category)
  const parsedLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_LIMIT, 1), MAX_LIMIT)
  const parsedOffset = Math.max(parseInt(offset, 10) || 0, 0)

  try {
    const durationMetric = isDurationMetric(metric)
    const metricFilter = durationMetric
      ? resolveDurationMetricFilter(metric)
      : resolveMetricFilter(metric, categoryFilter)
    const pool = getPool()
    if (!pool) {
      throw new Error('Databázové připojení není dostupné')
    }

    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const params = [start, end]
    let paramIndex = 3

    const { dateFilterCte, dateFilterJoin, dateFilterWhere, dateSelect } = getDateFilterSql(effectiveDateBasis)

    let metricSql = metricFilter.sql
    for (const value of metricFilter.extraParams) {
      metricSql = metricSql.replace('$CATEGORY', `$${paramIndex}`)
      params.push(value)
      paramIndex += 1
    }

    const dynamicFilters = [
      regionFilter ? { sql: `AND COALESCE(NULLIF(c.region, ''), 'N/A') = $IDX`, value: regionFilter } : null,
      operatorFilter ? { sql: `AND ${OPERATOR_NAME_SQL} = $IDX`, value: operatorFilter } : null,
      zamerovacFilter ? { sql: `AND ${ZAMEROVAC_NAME_SQL} = $IDX`, value: zamerovacFilter } : null,
      domluvilFilter ? { sql: `AND ${DOMLUVIL_NAME_SQL} = $IDX`, value: domluvilFilter } : null,
      obchodnikFilter ? { sql: `AND ${OBCHODNIK_NAME_SQL} = $IDX`, value: obchodnikFilter } : null,
      failedReasonFilter
        ? {
            sql: `AND LOWER(TRIM(COALESCE(pnh.reason_value, 'bez_duvodu'))) = LOWER($IDX)`,
            value: failedReasonFilter
          }
        : null
    ].filter(Boolean)

    let extraSql = ''
    for (const filter of dynamicFilters) {
      extraSql += `${filter.sql.replace(/\$IDX/g, `$${paramIndex}`)} `
      params.push(filter.value)
      paramIndex += 1
    }

    const limitParam = paramIndex
    const offsetParam = paramIndex + 1
    const queryParams = [...params, parsedLimit, parsedOffset]

    const durationDaysSelect = !durationMetric
      ? 'NULL::int AS duration_days'
      : metric === DURATION_METRIC_KEYS.navolaniZamereni
        ? 'dur.days_navolani_zamereni AS duration_days'
        : metric === DURATION_METRIC_KEYS.leadZamereni
          ? 'dur.days_lead_zamereni AS duration_days'
          : 'dur.days_lead_navolani AS duration_days'

    const baseFrom = `
      WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
      ${durationMetric ? `${getDurationMetricsCte()},` : ''}
      dopadlo_hodnota AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          LOWER(TRIM(ocv.value)) AS dopadlo_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'dopadlo_zamereni'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      proc_nedopadlo_hodnota AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          NULLIF(TRIM(ocv.value), '') AS reason_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'proc_nedopadlo_zamereni'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      order_products_sum AS (
        SELECT
          op.order_id,
          SUM(
            CASE
              WHEN REPLACE(REGEXP_REPLACE(TRIM(op.cena_s_dph::text), '\\s+', '', 'g'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
                THEN REPLACE(REGEXP_REPLACE(TRIM(op.cena_s_dph::text), '\\s+', '', 'g'), ',', '.')::numeric
              ELSE 0
            END
          ) AS products_total_with_vat
        FROM order_products op
        GROUP BY op.order_id
      ),
      prodejni_cena_s_dph AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          CASE
            WHEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN NULLIF(REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric, 0)
            ELSE NULL
          END AS sale_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'prodejni_cena_s_dph'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      montaz_s_dph AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          CASE
            WHEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric
            ELSE 0
          END AS sale_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'cena_za_montaz_s_dph'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      doprava_s_dph AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          CASE
            WHEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric
            ELSE 0
          END AS sale_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'cena_za_dopravu_s_dph'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      filtered_orders AS (
        SELECT
          o.id AS order_id,
          c.name AS customer_name,
          c.phone AS customer_phone,
          c.email AS customer_email,
          COALESCE(NULLIF(c.region, ''), 'N/A') AS region,
          COALESCE(dh.dopadlo_value, 'bez_hodnoty') AS dopadlo_status,
          pnh.reason_value AS failed_reason,
          ${dateSelect},
          ${OPERATOR_NAME_SQL} AS operator_name,
          ${ZAMEROVAC_NAME_SQL} AS zamerovac_name,
          ${DOMLUVIL_NAME_SQL} AS domluvil_name,
          ${OBCHODNIK_NAME_SQL} AS obchodnik_name,
          ${durationMetric ? durationDaysSelect : 'NULL::int AS duration_days'},
          ${durationMetric ? 'dur.lead_date AS lead_date,' : 'NULL::date AS lead_date,'}
          ${durationMetric ? 'dur.navolani_date AS navolani_date,' : 'NULL::date AS navolani_date,'}
          ${durationMetric ? 'dur.zamereni_date AS zamereni_date,' : 'NULL::date AS zamereni_date,'}
          (
            CASE
              WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
              ELSE COALESCE(ps.products_total_with_vat, 0)
            END
            + COALESCE(m.sale_value, 0)
            + COALESCE(d.sale_value, 0)
          ) AS total_with_vat
        FROM orders o
        ${dateFilterJoin}
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
        LEFT JOIN proc_nedopadlo_hodnota pnh ON pnh.order_id = o.id
        LEFT JOIN order_products_sum ps ON ps.order_id = o.id
        LEFT JOIN prodejni_cena_s_dph pc ON pc.order_id = o.id
        LEFT JOIN montaz_s_dph m ON m.order_id = o.id
        LEFT JOIN doprava_s_dph d ON d.order_id = o.id
        LEFT JOIN users u ON (o.created_by::text ~ '^[0-9]+$' AND u.id = o.created_by::bigint)
        LEFT JOIN order_user_assignments oua_assigned
          ON oua_assigned.order_id = o.id
         AND oua_assigned.assignment_type = 'assigned_operator'
        LEFT JOIN users u_assigned ON u_assigned.id = oua_assigned.user_id
        ${ASSIGNMENT_JOINS_SQL}
        ${durationMetric ? 'JOIN order_durations dur ON dur.order_id = o.id' : ''}
        WHERE ${dateFilterWhere}
          ${metricSql}
          ${extraSql}
      )
    `

    const filterParams = params

    const combinedResult = await pool.query(
      `
      ${baseFrom.replace('filtered_orders AS (', 'filtered_orders AS MATERIALIZED (')}
      SELECT
        (SELECT COUNT(*)::int FROM filtered_orders) AS total,
        (
          SELECT COALESCE(json_agg(row_to_json(p)), '[]'::json)
          FROM (
            SELECT *
            FROM filtered_orders
            ORDER BY filter_date DESC NULLS LAST, order_id DESC
            LIMIT $${limitParam} OFFSET $${offsetParam}
          ) p
        ) AS orders,
        (
          SELECT COALESCE(json_agg(row_to_json(s)), '[]'::json)
          FROM (
            SELECT dopadlo_status AS key, COUNT(*)::int AS count
            FROM filtered_orders
            GROUP BY dopadlo_status
            ORDER BY count DESC
          ) s
        ) AS by_status,
        (
          SELECT COALESCE(json_agg(row_to_json(r)), '[]'::json)
          FROM (
            SELECT region, COUNT(*)::int AS count
            FROM filtered_orders
            GROUP BY region
            ORDER BY count DESC
            LIMIT 14
          ) r
        ) AS by_region,
        (
          SELECT COALESCE(json_agg(row_to_json(f)), '[]'::json)
          FROM (
            SELECT
              COALESCE(NULLIF(TRIM(failed_reason), ''), 'bez_duvodu') AS key,
              COUNT(*)::int AS count
            FROM filtered_orders
            WHERE dopadlo_status = 'ne'
            GROUP BY COALESCE(NULLIF(TRIM(failed_reason), ''), 'bez_duvodu')
            ORDER BY count DESC
            LIMIT 12
          ) f
        ) AS by_reason
      `,
      queryParams
    )

    const row = combinedResult.rows[0] || {}
    const total = Number(row.total || 0)
    const ordersRows = Array.isArray(row.orders) ? row.orders : []
    const statusRows = Array.isArray(row.by_status) ? row.by_status : []
    const regionRows = Array.isArray(row.by_region) ? row.by_region : []
    const reasonRows = Array.isArray(row.by_reason) ? row.by_reason : []

    return res.status(200).json({
      metric,
      label: getMetricLabel(metric, categoryFilter),
      region: regionFilter,
      operator: operatorFilter,
      zamerovac: zamerovacFilter,
      domluvil: domluvilFilter,
      obchodnik: obchodnikFilter,
      failedReason: failedReasonFilter,
      category: categoryFilter,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      hasMore: parsedOffset + ordersRows.length < total,
      summary: {
        by_status: statusRows.map((item) => ({
          key: item.key,
          label: formatStatusLabel(item.key),
          count: Number(item.count || 0)
        })),
        by_region: regionRows.map((item) => ({
          region: item.region,
          count: Number(item.count || 0)
        })),
        by_reason: reasonRows.map((item) => ({
          key: item.key,
          label: item.key === 'bez_duvodu' ? 'Bez důvodu' : item.key,
          count: Number(item.count || 0)
        }))
      },
      orders: ordersRows.map((orderRow) => ({
        order_id: String(orderRow.order_id),
        customer_name: orderRow.customer_name || '-',
        customer_phone: orderRow.customer_phone || '',
        customer_email: orderRow.customer_email || '',
        region: orderRow.region,
        dopadlo_status: orderRow.dopadlo_status,
        failed_reason: orderRow.failed_reason || '',
        filter_date: orderRow.filter_date ? String(orderRow.filter_date).slice(0, 10) : '',
        duration_days: orderRow.duration_days != null ? Number(orderRow.duration_days) : null,
        lead_date: orderRow.lead_date ? String(orderRow.lead_date).slice(0, 10) : '',
        navolani_date: orderRow.navolani_date ? String(orderRow.navolani_date).slice(0, 10) : '',
        zamereni_date: orderRow.zamereni_date ? String(orderRow.zamereni_date).slice(0, 10) : '',
        operator_name: orderRow.operator_name,
        zamerovac_name: orderRow.zamerovac_name,
        domluvil_name: orderRow.domluvil_name,
        obchodnik_name: orderRow.obchodnik_name,
        total_with_vat: Number(orderRow.total_with_vat || 0).toFixed(2),
        detail_url: `https://systeeem.cz/orders/${orderRow.order_id}`
      })),
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Metrics orders API error:', error.message)
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

function cleanParam(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}
