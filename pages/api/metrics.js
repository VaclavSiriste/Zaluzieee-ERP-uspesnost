import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  const { startDate, endDate, period = 'month', region } = req.query
  const dateBasis = resolveDateBasis(req.query.dateBasis)

  try {
    const pool = getPool()
    if (!pool) {
      throw new Error('Databázové připojení není dostupné')
    }

    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const params = [start, end]
    const regionFilter = typeof region === 'string' && region.trim() ? region.trim() : null
    if (regionFilter) params.push(regionFilter)

    const regionSql = regionFilter ? 'AND c.region = $3' : ''
    const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql(dateBasis)

    const totalsResult = await pool.query(
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
      )
      SELECT
        COUNT(DISTINCT o.id) AS scheduled,
        COUNT(DISTINCT CASE WHEN dh.dopadlo_value = 'ano' THEN o.id END) AS completed,
        COUNT(DISTINCT CASE WHEN dh.dopadlo_value = 'ne' THEN o.id END) AS cancelled
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      WHERE ${dateFilterWhere}
        ${regionSql}
      `,
      params
    )

    const regionsResult = await pool.query(
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
      )
      SELECT
        COALESCE(NULLIF(c.region, ''), 'N/A') AS region,
        COUNT(DISTINCT o.id) AS scheduled,
        COUNT(DISTINCT CASE WHEN dh.dopadlo_value = 'ano' THEN o.id END) AS completed,
        COUNT(DISTINCT CASE WHEN dh.dopadlo_value = 'ne' THEN o.id END) AS cancelled,
        COUNT(DISTINCT CASE WHEN dh.dopadlo_value = 'cekame' THEN o.id END) AS waiting,
        COUNT(
          DISTINCT CASE
            WHEN dh.dopadlo_value IS NULL OR dh.dopadlo_value NOT IN ('ano', 'ne', 'cekame')
              THEN o.id
          END
        ) AS missing
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      WHERE ${dateFilterWhere}
        ${regionSql}
      GROUP BY COALESCE(NULLIF(c.region, ''), 'N/A')
      ORDER BY scheduled DESC
      `,
      params
    )

    const salesTotalsResult = await pool.query(
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
            + COALESCE(m.sale_value, 0)
            + COALESCE(d.sale_value, 0)
          ) AS total_with_vat,
          CASE
            WHEN dr.dph_ratio IS NOT NULL AND dr.dph_ratio >= 0
              THEN (
                (
                  CASE
                    WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                    ELSE COALESCE(ps.products_total_with_vat, 0)
                  END
                  + COALESCE(m.sale_value, 0)
                  + COALESCE(d.sale_value, 0)
                ) / (1 + dr.dph_ratio)
              )
            ELSE (
              CASE
                WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                ELSE COALESCE(ps.products_total_with_vat, 0)
              END
              + COALESCE(m.sale_value, 0)
              + COALESCE(d.sale_value, 0)
            )
          END AS total_without_vat
        FROM orders o
        LEFT JOIN order_products_sum ps ON ps.order_id = o.id
        LEFT JOIN prodejni_cena_s_dph pc ON pc.order_id = o.id
        LEFT JOIN montaz_s_dph m ON m.order_id = o.id
        LEFT JOIN doprava_s_dph d ON d.order_id = o.id
        LEFT JOIN dph_rate dr ON dr.order_id = o.id
      )
      SELECT
        AVG(
          CASE
            WHEN dh.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ot.total_with_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_with_vat,
        AVG(
          CASE
            WHEN dh.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ot.total_without_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_without_vat
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      LEFT JOIN order_totals ot ON ot.order_id = o.id
      WHERE ${dateFilterWhere}
        ${regionSql}
      `,
      params
    )

    const salesByRegionResult = await pool.query(
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
            + COALESCE(m.sale_value, 0)
            + COALESCE(d.sale_value, 0)
          ) AS total_with_vat,
          CASE
            WHEN dr.dph_ratio IS NOT NULL AND dr.dph_ratio >= 0
              THEN (
                (
                  CASE
                    WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                    ELSE COALESCE(ps.products_total_with_vat, 0)
                  END
                  + COALESCE(m.sale_value, 0)
                  + COALESCE(d.sale_value, 0)
                ) / (1 + dr.dph_ratio)
              )
            ELSE (
              CASE
                WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                ELSE COALESCE(ps.products_total_with_vat, 0)
              END
              + COALESCE(m.sale_value, 0)
              + COALESCE(d.sale_value, 0)
            )
          END AS total_without_vat
        FROM orders o
        LEFT JOIN order_products_sum ps ON ps.order_id = o.id
        LEFT JOIN prodejni_cena_s_dph pc ON pc.order_id = o.id
        LEFT JOIN montaz_s_dph m ON m.order_id = o.id
        LEFT JOIN doprava_s_dph d ON d.order_id = o.id
        LEFT JOIN dph_rate dr ON dr.order_id = o.id
      )
      SELECT
        COALESCE(NULLIF(c.region, ''), 'N/A') AS region,
        AVG(
          CASE
            WHEN dh.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ot.total_with_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_with_vat,
        AVG(
          CASE
            WHEN dh.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ot.total_without_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_without_vat
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      LEFT JOIN order_totals ot ON ot.order_id = o.id
      WHERE ${dateFilterWhere}
        ${regionSql}
      GROUP BY COALESCE(NULLIF(c.region, ''), 'N/A')
      `,
      params
    )

    const operatorsResult = await pool.query(
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
            + COALESCE(m.sale_value, 0)
            + COALESCE(d.sale_value, 0)
          ) AS total_with_vat,
          CASE
            WHEN dr.dph_ratio IS NOT NULL AND dr.dph_ratio >= 0
              THEN (
                (
                  CASE
                    WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                    ELSE COALESCE(ps.products_total_with_vat, 0)
                  END
                  + COALESCE(m.sale_value, 0)
                  + COALESCE(d.sale_value, 0)
                ) / (1 + dr.dph_ratio)
              )
            ELSE (
              CASE
                WHEN COALESCE(pc.sale_value, 0) <> 0 THEN COALESCE(pc.sale_value, 0)
                ELSE COALESCE(ps.products_total_with_vat, 0)
              END
              + COALESCE(m.sale_value, 0)
              + COALESCE(d.sale_value, 0)
            )
          END AS total_without_vat
        FROM orders o
        LEFT JOIN order_products_sum ps ON ps.order_id = o.id
        LEFT JOIN prodejni_cena_s_dph pc ON pc.order_id = o.id
        LEFT JOIN montaz_s_dph m ON m.order_id = o.id
        LEFT JOIN doprava_s_dph d ON d.order_id = o.id
        LEFT JOIN dph_rate dr ON dr.order_id = o.id
      ),
      operator_base AS (
        SELECT
          o.id,
          COALESCE(
            NULLIF(u_assigned.name, ''),
            NULLIF(u.name, ''),
            COALESCE(NULLIF(o.created_by::TEXT, ''), 'Nepřiřazený operátor')
          ) AS operator_name,
          COALESCE(NULLIF(c.region, ''), 'N/A') AS region,
          dh.dopadlo_value,
          pnh.reason_value,
          ot.total_with_vat,
          ot.total_without_vat
        FROM orders o
        ${dateFilterJoin}
        LEFT JOIN customers c ON c.id = o.customer_id
        LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
        LEFT JOIN proc_nedopadlo_hodnota pnh ON pnh.order_id = o.id
        LEFT JOIN order_totals ot ON ot.order_id = o.id
        LEFT JOIN users u ON (o.created_by::text ~ '^[0-9]+$' AND u.id = o.created_by::bigint)
        LEFT JOIN order_user_assignments oua_assigned
          ON oua_assigned.order_id = o.id
         AND oua_assigned.assignment_type = 'assigned_operator'
        LEFT JOIN users u_assigned ON u_assigned.id = oua_assigned.user_id
        WHERE ${dateFilterWhere}
          ${regionSql}
      ),
      operator_reason_counts AS (
        SELECT
          operator_name,
          region,
          COALESCE(reason_value, 'Bez důvodu') AS top_failed_reason,
          COUNT(*) AS top_failed_reason_count
        FROM operator_base
        WHERE dopadlo_value = 'ne'
        GROUP BY operator_name, region, COALESCE(reason_value, 'Bez důvodu')
      ),
      operator_reason_top AS (
        SELECT DISTINCT ON (operator_name, region)
          operator_name,
          region,
          top_failed_reason,
          top_failed_reason_count
        FROM operator_reason_counts
        ORDER BY operator_name, region, top_failed_reason_count DESC, top_failed_reason ASC
      )
      SELECT
        ob.operator_name,
        ob.region,
        COUNT(DISTINCT ob.id) AS scheduled,
        COUNT(DISTINCT CASE WHEN ob.dopadlo_value = 'ano' THEN ob.id END) AS completed,
        COUNT(DISTINCT CASE WHEN ob.dopadlo_value = 'ne' THEN ob.id END) AS cancelled,
        AVG(
          CASE
            WHEN ob.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ob.total_with_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_with_vat,
        AVG(
          CASE
            WHEN ob.dopadlo_value = 'ano' THEN NULLIF(COALESCE(ob.total_without_vat, 0), 0)
            ELSE NULL
          END
        ) AS avg_sale_without_vat,
        COALESCE(ort.top_failed_reason, '-') AS top_failed_reason,
        COALESCE(ort.top_failed_reason_count, 0) AS top_failed_reason_count
      FROM operator_base ob
      LEFT JOIN operator_reason_top ort
        ON ort.operator_name = ob.operator_name
       AND ort.region = ob.region
      GROUP BY
        ob.operator_name,
        ob.region,
        ort.top_failed_reason,
        ort.top_failed_reason_count
      ORDER BY completed DESC, scheduled DESC
      `,
      params
    )

    const categoryResult = await pool.query(
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
      )
      SELECT
        COALESCE(dh.dopadlo_value, 'bez_hodnoty') AS category,
        COUNT(DISTINCT o.id) AS count
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN dopadlo_hodnota dh ON dh.order_id = o.id
      WHERE ${dateFilterWhere}
        ${regionSql}
      GROUP BY COALESCE(dh.dopadlo_value, 'bez_hodnoty')
      ORDER BY count DESC
      `,
      params
    )

    const totals = totalsResult.rows[0] || { scheduled: 0, completed: 0, cancelled: 0 }
    const salesTotals = salesTotalsResult.rows[0] || { avg_sale_with_vat: 0, avg_sale_without_vat: 0 }
    const scheduled = Number(totals.scheduled || 0)
    const completed = Number(totals.completed || 0)
    const cancelled = Number(totals.cancelled || 0)
    const avgSaleWithVat = Number(salesTotals.avg_sale_with_vat || 0)
    const avgSaleWithoutVat = Number(salesTotals.avg_sale_without_vat || 0)

    const salesByRegion = new Map(
      salesByRegionResult.rows.map((row) => ([
        row.region,
        {
          avg_sale_with_vat: Number(row.avg_sale_with_vat || 0),
          avg_sale_without_vat: Number(row.avg_sale_without_vat || 0)
        }
      ]))
    )

    const byRegion = {}
    for (const row of regionsResult.rows) {
      const regScheduled = Number(row.scheduled || 0)
      const regCompleted = Number(row.completed || 0)
      const regCancelled = Number(row.cancelled || 0)
      const regWaiting = Number(row.waiting || 0)
      const regMissing = Number(row.missing || 0)
      const regDecided = regCompleted + regCancelled
      const regSuccessRate = regDecided > 0
        ? ((regCompleted / regDecided) * 100).toFixed(2)
        : '0.00'
      const regSales = salesByRegion.get(row.region) || { avg_sale_with_vat: 0, avg_sale_without_vat: 0 }
      byRegion[row.region] = {
        scheduled: regScheduled,
        completed: regCompleted,
        cancelled: regCancelled,
        waiting: regWaiting,
        missing: regMissing,
        avg_sale_with_vat: Number(regSales.avg_sale_with_vat || 0).toFixed(2),
        avg_sale_without_vat: Number(regSales.avg_sale_without_vat || 0).toFixed(2),
        success_rate: regSuccessRate
      }
    }

    const leaderboard = operatorsResult.rows.map((row, index) => {
      const opScheduled = Number(row.scheduled || 0)
      const opCompleted = Number(row.completed || 0)
      const opCancelled = Number(row.cancelled || 0)
      return {
        rank: index + 1,
        operator_name: row.operator_name,
        region: row.region,
        scheduled: opScheduled,
        completed: opCompleted,
        cancelled: opCancelled,
        avg_sale_with_vat: Number(row.avg_sale_with_vat || 0).toFixed(2),
        avg_sale_without_vat: Number(row.avg_sale_without_vat || 0).toFixed(2),
        top_failed_reason: row.top_failed_reason || '-',
        top_failed_reason_count: Number(row.top_failed_reason_count || 0),
        success_rate: (opCompleted + opCancelled) > 0
          ? ((opCompleted / (opCompleted + opCancelled)) * 100).toFixed(2)
          : '0.00'
      }
    })

    const categoryBreakdown = categoryResult.rows.map((row) => ({
      category: row.category,
      count: Number(row.count || 0)
    }))

    const inProgressBreakdown = categoryBreakdown.filter(
      (row) => row.category !== 'ano' && row.category !== 'ne'
    )

    return res.status(200).json({
      period,
      dateBasis,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      totals: {
        scheduled,
        completed,
        cancelled,
        avg_sale_with_vat: avgSaleWithVat.toFixed(2),
        avg_sale_without_vat: avgSaleWithoutVat.toFixed(2),
        success_rate: (completed + cancelled) > 0
          ? ((completed / (completed + cancelled)) * 100).toFixed(2)
          : '0.00'
      },
      byRegion,
      leaderboard,
      in_progress_breakdown: inProgressBreakdown,
      source: 'erp-db',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('Metrics API error:', error.message)
    return res.status(500).json({
      error: error.message,
      source: 'erp-db',
      timestamp: new Date().toISOString()
    })
  }
}

function resolveDateRange({ startDate, endDate, period }) {
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
