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
          LOWER(TRIM(ocv.value)) AS dopadlo
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
        WHERE assignment_type = 'assigned_operator'
        ORDER BY order_id, id DESC
      )
      SELECT
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač') AS zamerovac_name,
        COALESCE(NULLIF(ou.name, ''), 'Nepřiřazený operátor') AS obchodnik_name,
        COALESCE(dh.dopadlo, 'bez_hodnoty') AS dopadlo,
        COUNT(DISTINCT o.id) AS cnt,
        COALESCE(
          SUM(
            CASE
              WHEN dh.dopadlo = 'ano' THEN COALESCE(ot.total_with_vat, 0)
              ELSE 0
            END
          ),
          0
        ) AS sale_sum,
        COUNT(DISTINCT o.id) AS sale_count,
        COALESCE(
          SUM(
            CASE
              WHEN dh.dopadlo = 'ano' THEN COALESCE(ot.total_without_vat, 0)
              ELSE 0
            END
          ),
          0
        ) AS sale_sum_without_vat,
        COUNT(DISTINCT o.id) AS sale_count_without_vat,
        COUNT(
          DISTINCT CASE
            WHEN dh.dopadlo = 'ano' AND COALESCE(ot.total_with_vat, 0) > 0 THEN o.id
          END
        ) AS sale_count_nonzero,
        COUNT(
          DISTINCT CASE
            WHEN dh.dopadlo = 'ano' AND COALESCE(ot.total_without_vat, 0) > 0 THEN o.id
          END
        ) AS sale_count_without_vat_nonzero
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      LEFT JOIN order_totals ot ON ot.order_id = o.id
      LEFT JOIN zamerovac_assign za ON za.order_id = o.id
      LEFT JOIN users zu ON zu.id = za.user_id
      LEFT JOIN obchodnik_assign oa ON oa.order_id = o.id
      LEFT JOIN users ou ON ou.id = oa.user_id
      WHERE ${dateFilterWhere}
      GROUP BY
        COALESCE(NULLIF(zu.name, ''), 'Nepřiřazený zaměřovač'),
        COALESCE(NULLIF(ou.name, ''), 'Nepřiřazený operátor'),
        COALESCE(dh.dopadlo, 'bez_hodnoty')
      ORDER BY zamerovac_name, obchodnik_name
      `,
      [start, end]
    )

    const byZamerovac = new Map()
    for (const row of result.rows) {
      const zName = row.zamerovac_name
      const oName = row.obchodnik_name
      const count = Number(row.cnt || 0)
      const outcome = row.dopadlo
      const saleSum = Number(row.sale_sum || 0)
      const saleCount = Number(row.sale_count_nonzero || 0)
      const saleSumWithoutVat = Number(row.sale_sum_without_vat || 0)
      const saleCountWithoutVat = Number(row.sale_count_without_vat_nonzero || 0)

      if (!byZamerovac.has(zName)) {
        byZamerovac.set(zName, {
          zamerovac_name: zName,
          total: 0,
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
          obchodnici: new Map()
        })
      }
      const bubble = byZamerovac.get(zName)
      bubble.total += count
      bubble.sale_sum_with_vat += saleSum
      bubble.sale_count_with_vat += saleCount
      bubble.sale_sum_without_vat += saleSumWithoutVat
      bubble.sale_count_without_vat += saleCountWithoutVat
      if (outcome === 'ano') bubble.ano += count
      else if (outcome === 'ne') bubble.ne += count
      else if (outcome === 'cekame') bubble.cekame += count
      else bubble.bez_hodnoty += count

      if (!bubble.obchodnici.has(oName)) {
        bubble.obchodnici.set(oName, {
          obchodnik_name: oName,
          total: 0,
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
      const salesman = bubble.obchodnici.get(oName)
      salesman.total += count
      salesman.sale_sum_with_vat += saleSum
      salesman.sale_count_with_vat += saleCount
      salesman.sale_sum_without_vat += saleSumWithoutVat
      salesman.sale_count_without_vat += saleCountWithoutVat
      if (outcome === 'ano') salesman.ano += count
      else if (outcome === 'ne') salesman.ne += count
      else if (outcome === 'cekame') salesman.cekame += count
      else salesman.bez_hodnoty += count
    }

    const bubbles = Array.from(byZamerovac.values()).map((bubble) => {
      const decided = bubble.ano + bubble.ne
      bubble.success_rate = decided > 0 ? ((bubble.ano / decided) * 100).toFixed(2) : '0.00'
      bubble.avg_sale_with_vat = bubble.sale_count_with_vat > 0
        ? (bubble.sale_sum_with_vat / bubble.sale_count_with_vat).toFixed(2)
        : '0.00'
      bubble.avg_sale_without_vat = bubble.sale_count_without_vat > 0
        ? (bubble.sale_sum_without_vat / bubble.sale_count_without_vat).toFixed(2)
        : '0.00'
      bubble.obchodnici = Array.from(bubble.obchodnici.values())
        .map((salesman) => {
          const dec = salesman.ano + salesman.ne
          return {
            ...salesman,
            success_rate: dec > 0 ? ((salesman.ano / dec) * 100).toFixed(2) : '0.00',
            avg_sale_with_vat: salesman.sale_count_with_vat > 0
              ? (salesman.sale_sum_with_vat / salesman.sale_count_with_vat).toFixed(2)
              : '0.00',
            avg_sale_without_vat: salesman.sale_count_without_vat > 0
              ? (salesman.sale_sum_without_vat / salesman.sale_count_without_vat).toFixed(2)
              : '0.00'
          }
        })
        .sort((a, b) => {
          const successDiff = Number(b.success_rate) - Number(a.success_rate)
          if (successDiff !== 0) return successDiff
          return b.total - a.total
        })
      return bubble
    }).sort((a, b) => {
      const successDiff = Number(b.success_rate) - Number(a.success_rate)
      if (successDiff !== 0) return successDiff
      return b.total - a.total
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
    throw new Error('Neplatné datum v parametrech')
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
