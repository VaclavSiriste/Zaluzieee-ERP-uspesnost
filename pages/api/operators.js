import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  const { period = 'month', startDate, endDate } = req.query
  const dateBasis = resolveDateBasis(req.query.dateBasis)

  try {
    const pool = getPool()
    if (!pool) {
      throw new Error('Databázové připojení není dostupné')
    }

    const { start, end } = resolveDateRange({ period, startDate, endDate })
    const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql(dateBasis)

    const result = await pool.query(
      `
      WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
      dopadlo_hodnota AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          LOWER(TRIM(ocv.value)) AS dopadlo_value
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'dopadlo_zamereni'
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
          END AS montaz_with_vat
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
          END AS doprava_with_vat
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'cena_za_dopravu_s_dph'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      dph_rate AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          CASE
            WHEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.') ~ '^-?[0-9]+(\\.[0-9]+)?$'
              THEN CASE
                WHEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric > 1
                  THEN REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric / 100
                ELSE REPLACE(REGEXP_REPLACE(TRIM(ocv.value), '\\s+', '', 'g'), ',', '.')::numeric
              END
            ELSE NULL
          END AS dph_ratio
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'dph'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      order_totals AS (
        SELECT
          o.id AS order_id,
          (
            CASE
              WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
              ELSE COALESCE(ps.products_total_with_vat, 0)
            END
            + COALESCE(m.montaz_with_vat, 0)
            + COALESCE(d.doprava_with_vat, 0)
          ) AS total_with_vat,
          CASE
            WHEN dr.dph_ratio IS NOT NULL AND dr.dph_ratio >= 0
              THEN (
                (
                  CASE
                    WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                    ELSE COALESCE(ps.products_total_with_vat, 0)
                  END
                  + COALESCE(m.montaz_with_vat, 0)
                  + COALESCE(d.doprava_with_vat, 0)
                ) / (1 + dr.dph_ratio)
              )
            ELSE (
              CASE
                WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                ELSE COALESCE(ps.products_total_with_vat, 0)
              END
              + COALESCE(m.montaz_with_vat, 0)
              + COALESCE(d.doprava_with_vat, 0)
            )
          END AS total_without_vat
        FROM orders o
        LEFT JOIN order_products_sum ps ON ps.order_id = o.id
        LEFT JOIN prodejni_cena_s_dph pc ON pc.order_id = o.id
        LEFT JOIN montaz_s_dph m ON m.order_id = o.id
        LEFT JOIN doprava_s_dph d ON d.order_id = o.id
        LEFT JOIN dph_rate dr ON dr.order_id = o.id
      ),
      zamerovac_assign AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          user_id
        FROM order_user_assignments
        WHERE assignment_type = 'zamerovac'
        ORDER BY order_id, id DESC
      ),
      obchodnik_assign AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          user_id
        FROM order_user_assignments
        WHERE assignment_type = 'domluvil_zamereni'
        ORDER BY order_id, id DESC
      )
      SELECT
        COALESCE(NULLIF(op_assigned.name, ''), 'Nepřiřazený operátor') AS operator_name,
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač') AS zamerovac_name,
        COALESCE(dh.dopadlo_value, 'bez_hodnoty') AS dopadlo_value,
        COUNT(DISTINCT o.id) AS cnt,
        COALESCE(
          SUM(
            CASE
              WHEN dh.dopadlo_value = 'ano' THEN COALESCE(ot.total_with_vat, 0)
              ELSE 0
            END
          ),
          0
        ) AS sale_sum,
        COUNT(DISTINCT o.id) AS sale_count,
        COALESCE(
          SUM(
            CASE
              WHEN dh.dopadlo_value = 'ano' THEN COALESCE(ot.total_without_vat, 0)
              ELSE 0
            END
          ),
          0
        ) AS sale_sum_without_vat,
        COUNT(DISTINCT o.id) AS sale_count_without_vat,
        COUNT(
          DISTINCT CASE
            WHEN dh.dopadlo_value = 'ano' AND COALESCE(ot.total_with_vat, 0) > 0 THEN o.id
          END
        ) AS sale_count_nonzero,
        COUNT(
          DISTINCT CASE
            WHEN dh.dopadlo_value = 'ano' AND COALESCE(ot.total_without_vat, 0) > 0 THEN o.id
          END
        ) AS sale_count_without_vat_nonzero
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      LEFT JOIN order_totals ot ON ot.order_id = o.id
      LEFT JOIN obchodnik_assign oa ON oa.order_id = o.id
      LEFT JOIN users op_assigned ON op_assigned.id = oa.user_id
      LEFT JOIN zamerovac_assign za ON za.order_id = o.id
      LEFT JOIN users zu ON zu.id = za.user_id
      WHERE ${dateFilterWhere}
      GROUP BY
        COALESCE(NULLIF(op_assigned.name, ''), 'Nepřiřazený operátor'),
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač'),
        COALESCE(dh.dopadlo_value, 'bez_hodnoty')
      ORDER BY operator_name, zamerovac_name
      `,
      [start, end]
    )

    const byOperator = new Map()
    for (const row of result.rows) {
      const oName = row.operator_name
      const zName = row.zamerovac_name
      const outcome = row.dopadlo_value
      const count = Number(row.cnt || 0)
      const saleSum = Number(row.sale_sum || 0)
      const saleCount = Number(row.sale_count_nonzero || 0)
      const saleSumWithoutVat = Number(row.sale_sum_without_vat || 0)
      const saleCountWithoutVat = Number(row.sale_count_without_vat_nonzero || 0)

      if (!byOperator.has(oName)) {
        byOperator.set(oName, {
          operator_name: oName,
          total_all: 0,
          total_decided: 0,
          ano: 0,
          ne: 0,
          cekame: 0,
          bez_hodnoty: 0,
          success_rate: '0.00',
          avg_sale_with_vat: '0.00',
          avg_sale_without_vat: '0.00',
          sale_sum_with_vat: 0,
          sale_count_with_vat: 0,
          sale_sum_without_vat: 0,
          sale_count_without_vat: 0,
          zamerovaci: new Map()
        })
      }
      const bubble = byOperator.get(oName)
      bubble.total_all += count
      bubble.sale_sum_with_vat += saleSum
      bubble.sale_count_with_vat += saleCount
      bubble.sale_sum_without_vat += saleSumWithoutVat
      bubble.sale_count_without_vat += saleCountWithoutVat
      if (outcome === 'ano') bubble.ano += count
      else if (outcome === 'ne') bubble.ne += count
      else if (outcome === 'cekame') bubble.cekame += count
      else bubble.bez_hodnoty += count

      if (!bubble.zamerovaci.has(zName)) {
        bubble.zamerovaci.set(zName, {
          zamerovac_name: zName,
          total_all: 0,
          total_decided: 0,
          ano: 0,
          ne: 0,
          cekame: 0,
          bez_hodnoty: 0,
          success_rate: '0.00',
          avg_sale_with_vat: '0.00',
          avg_sale_without_vat: '0.00',
          sale_sum_with_vat: 0,
          sale_count_with_vat: 0,
          sale_sum_without_vat: 0,
          sale_count_without_vat: 0
        })
      }
      const z = bubble.zamerovaci.get(zName)
      z.total_all += count
      z.sale_sum_with_vat += saleSum
      z.sale_count_with_vat += saleCount
      z.sale_sum_without_vat += saleSumWithoutVat
      z.sale_count_without_vat += saleCountWithoutVat
      if (outcome === 'ano') z.ano += count
      else if (outcome === 'ne') z.ne += count
      else if (outcome === 'cekame') z.cekame += count
      else z.bez_hodnoty += count
    }

    const bubbles = Array.from(byOperator.values()).map((bubble) => {
      bubble.total_decided = bubble.ano + bubble.ne
      bubble.success_rate = bubble.total_decided > 0
        ? ((bubble.ano / bubble.total_decided) * 100).toFixed(2)
        : '0.00'
      bubble.avg_sale_with_vat = bubble.sale_count_with_vat > 0
        ? (bubble.sale_sum_with_vat / bubble.sale_count_with_vat).toFixed(2)
        : '0.00'
      bubble.avg_sale_without_vat = bubble.sale_count_without_vat > 0
        ? (bubble.sale_sum_without_vat / bubble.sale_count_without_vat).toFixed(2)
        : '0.00'

      bubble.zamerovaci = Array.from(bubble.zamerovaci.values())
        .map((z) => {
          z.total_decided = z.ano + z.ne
          z.success_rate = z.total_decided > 0
            ? ((z.ano / z.total_decided) * 100).toFixed(2)
            : '0.00'
          z.avg_sale_with_vat = z.sale_count_with_vat > 0
            ? (z.sale_sum_with_vat / z.sale_count_with_vat).toFixed(2)
            : '0.00'
          z.avg_sale_without_vat = z.sale_count_without_vat > 0
            ? (z.sale_sum_without_vat / z.sale_count_without_vat).toFixed(2)
            : '0.00'
          return z
        })
        .sort((a, b) => {
          const successDiff = Number(b.success_rate) - Number(a.success_rate)
          if (successDiff !== 0) return successDiff
          return b.total_decided - a.total_decided
        })

      return bubble
    }).sort((a, b) => {
      const successDiff = Number(b.success_rate) - Number(a.success_rate)
      if (successDiff !== 0) return successDiff
      return b.total_decided - a.total_decided
    })

    return res.status(200).json({
      period,
      dateBasis,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      bubbles,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    return res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}

function resolveDateRange({ period, startDate, endDate }) {
  const now = new Date()
  const end = endDate ? new Date(endDate) : now
  let start = startDate ? new Date(startDate) : now

  if (!startDate) {
    if (period === 'week') start = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    else if (period === 'ytd') start = new Date(now.getFullYear(), 0, 1)
    else start = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
  }

  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new Error('Neplatne datum v parametrech')
  }

  return { start, end }
}

function resolveDateBasis(value) {
  if (value === 'created' || value === 'navolani' || value === 'zamereni') return value
  return 'navolani'
}

function getDateFilterSql(dateBasis) {
  if (dateBasis === 'created') {
    return {
      dateFilterCte: '',
      dateFilterJoin: '',
      dateFilterWhere: 'o.created_at::date >= $1::date AND o.created_at::date <= $2::date'
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
    dateFilterWhere: 'df.filter_date >= $1::date AND df.filter_date <= $2::date'
  }
}
