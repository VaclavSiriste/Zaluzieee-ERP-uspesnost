/**
 * Úspěšnost navolání (Dopadl hovor ANO / (ANO + NE)) podle krajů — SK provoz.
 * Stejná množina jako souhrn Úspěšnosti navolání (datum navolání, přiřazený operátor,
 * bez duplikací), jen rozdělená podle kraje zákazníka.
 * GET /api/navolani-regions?brand=sk&period=&startDate=&endDate=
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly, getDateFilterSql, resolveDateRange } from '@/lib/metrics-query'

/** Kraje, kam SK provoz jezdí — ostatní se sčítají do „Ostatní kraje“. */
const SK_SERVICE_REGIONS = [
  { key: 'bratislavsky', label: 'Bratislavský', match: 'bratislav' },
  { key: 'trenciansky', label: 'Trenčianský', match: 'trencian' },
  { key: 'zilinsky', label: 'Žilinský', match: 'zilin' }
]

const REGION_NORM_SQL = `translate(lower(trim(COALESCE(cu.region, ''))), 'áäčďéěíľĺňóôŕšťúůýž', 'aacdeeillnoorstuuyz')`

const REGION_BUCKET_SQL = `
  CASE
    ${SK_SERVICE_REGIONS.map((r) => `WHEN ${REGION_NORM_SQL} LIKE '%${r.match}%' THEN '${r.key}'`).join('\n    ')}
    WHEN ${REGION_NORM_SQL} = '' THEN 'none'
    ELSE 'other'
  END
`

const LABELS = {
  ...Object.fromEntries(SK_SERVICE_REGIONS.map((r) => [r.key, r.label])),
  other: 'Ostatní kraje',
  none: 'Bez kraje'
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = 'sk'
  const pool = getErpPool(brandId)
  if (!pool) {
    return res.status(500).json({ error: 'SK ERP databáze není dostupná (chybí ERP_SK_DB_CONNECTION_STRING)' })
  }

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('navolani')

    const { rows } = await pool.query(
      `
      WITH ${dateFilterCte ? `${dateFilterCte},` : ''}
      dopadl AS (
        SELECT DISTINCT ON (ocv.order_id)
          ocv.order_id,
          LOWER(TRIM(ocv.value)) AS value_lc
        FROM orders_column_values ocv
        JOIN orders_columns oc ON oc.id = ocv.column_id
        WHERE oc.slug = 'dopadl_hovor'
        ORDER BY ocv.order_id, ocv.id DESC
      ),
      assignee AS (
        SELECT DISTINCT ON (order_id) order_id
        FROM order_user_assignments
        WHERE assignment_type = 'domluvil_zamereni'
        ORDER BY order_id, id DESC
      )
      SELECT
        ${REGION_BUCKET_SQL} AS region,
        COUNT(*) FILTER (WHERE d.value_lc = 'ano')::int AS ano,
        COUNT(*) FILTER (WHERE d.value_lc = 'ne')::int AS ne
      FROM orders o
      ${dateFilterJoin}
      JOIN assignee a ON a.order_id = o.id
      LEFT JOIN customers cu ON cu.id = o.customer_id
      LEFT JOIN dopadl d ON d.order_id = o.id
      WHERE ${dateFilterWhere}
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
      GROUP BY 1
      `,
      [formatDateOnly(start), formatDateOnly(end)]
    )

    const byKey = new Map(rows.map((row) => [row.region, row]))
    const order = [...SK_SERVICE_REGIONS.map((r) => r.key), 'other', 'none']
    const regions = order.map((key) => {
      const row = byKey.get(key) || {}
      const ano = Number(row.ano) || 0
      const ne = Number(row.ne) || 0
      return {
        key,
        label: LABELS[key],
        service: SK_SERVICE_REGIONS.some((r) => r.key === key),
        ano,
        ne,
        decided: ano + ne,
        success_pct: ano + ne ? (ano / (ano + ne)) * 100 : null
      }
    })

    return res.status(200).json({
      brand: brandId,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      regions
    })
  } catch (error) {
    console.error('navolani-regions:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba úspěšnosti podle krajů' })
  }
}
