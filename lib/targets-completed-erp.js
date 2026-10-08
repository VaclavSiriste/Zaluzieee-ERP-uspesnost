/**
 * Splněno targetů z ERP:
 * - celkem = počet zakázek s datum_zamereni v měsíci
 * - technici = stejné + zaměřovač
 * - kraje = stejné + customers.region
 *
 * Jeden dotaz (dřív 3 paralelní, každý s DISTINCT ON přes celou historii
 * datum_zamereni všech organizací) — datum_zamereni se bere jen pro zakázky
 * organizace a výsledek je rozpadnutý po měsících, takže stejný dotaz obslouží
 * jeden měsíc i zpětný přehled za víc měsíců.
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { normalizeOperatorKey } from '@/lib/normalize-operator'
import { shouldSkipOrganizationFilter } from '@/lib/operations-brands'
import { resolveErpRegionIdForBrand, resolveRegionCatalogForBrand } from '@/lib/targets-storage'
import { technicianId } from '@/lib/technician-targets'

function resolveTechnicianId(name) {
  const key = normalizeOperatorKey(name)
  if (!key || key.includes('neprirazen')) return null
  return technicianId(name)
}

function emptyCounts() {
  return { total: 0, technicians: {}, regions: {} }
}

function appendOrganizationFilter(params, organizationId, brandId) {
  if (shouldSkipOrganizationFilter(brandId)) {
    return { sql: '', params }
  }
  if (organizationId == null || organizationId === '') {
    return { sql: '', params }
  }
  const parsed = Number(organizationId)
  if (!Number.isFinite(parsed)) {
    return { sql: '', params }
  }
  const nextParams = [...params, parsed]
  return {
    sql: `AND o.organization_id = $${nextParams.length}`,
    params: nextParams
  }
}

async function queryCompletedRows(pool, { start, end, organizationId, brandId }) {
  const org = appendOrganizationFilter([formatDateOnly(start), formatDateOnly(end)], organizationId, brandId)
  const { rows } = await pool.query(
    `
    WITH zamereni_latest AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        TRIM(ocv.value) AS raw_value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      JOIN orders o ON o.id = ocv.order_id
      WHERE oc.slug = 'datum_zamereni'
        ${org.sql}
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    zamereni AS (
      SELECT order_id, SUBSTRING(raw_value, 1, 10)::date AS zamereni_date
      FROM zamereni_latest
      WHERE raw_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND SUBSTRING(raw_value, 1, 10)::date >= $1::date
        AND SUBSTRING(raw_value, 1, 10)::date <= $2::date
    ),
    zamerovac AS (
      SELECT DISTINCT ON (a.order_id)
        a.order_id,
        a.user_id
      FROM order_user_assignments a
      JOIN zamereni z ON z.order_id = a.order_id
      WHERE a.assignment_type = 'zamerovac'
      ORDER BY a.order_id, a.id DESC
    )
    SELECT
      TO_CHAR(z.zamereni_date, 'YYYY-MM') AS month_key,
      za.order_id IS NOT NULL AS has_zamerovac,
      COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený zaměřovač') AS zamerovac_name,
      COALESCE(NULLIF(TRIM(c.region), ''), 'N/A') AS region,
      COUNT(*)::int AS cnt
    FROM zamereni z
    JOIN orders o ON o.id = z.order_id
    LEFT JOIN zamerovac za ON za.order_id = z.order_id
    LEFT JOIN users u ON u.id = za.user_id
    LEFT JOIN customers c ON c.id = o.customer_id
    WHERE LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
    GROUP BY 1, 2, 3, 4
    `,
    org.params
  )
  return rows
}

function summarizeRows(rows, brandId, catalog) {
  let total = 0
  const techCounts = new Map()
  const regionCounts = new Map()
  for (const row of rows) {
    const count = Number(row.cnt) || 0
    total += count
    if (row.has_zamerovac) {
      techCounts.set(row.zamerovac_name, (techCounts.get(row.zamerovac_name) || 0) + count)
    }
    regionCounts.set(row.region, (regionCounts.get(row.region) || 0) + count)
  }

  const byCountThenName = (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs')

  const technicians = {}
  const technicians_by_name = [...techCounts.entries()].sort(byCountThenName).map(([name, count]) => {
    const id = resolveTechnicianId(name)
    if (id) {
      technicians[id] = (technicians[id] || 0) + count
    }
    return { name, count, technician_id: id }
  })

  const regions = {}
  const regions_by_name = [...regionCounts.entries()].sort(byCountThenName).map(([region, count]) => {
    const id = resolveErpRegionIdForBrand(region, brandId, catalog)
    if (id) {
      regions[id] = (regions[id] || 0) + count
    }
    return { region, count, region_id: id }
  })

  return { total, technicians, regions, technicians_by_name, regions_by_name }
}

function unavailableResult() {
  return {
    ...emptyCounts(),
    technicians_by_name: [],
    regions_by_name: [],
    source: 'erp-db',
    unavailable: true
  }
}

export async function fetchTargetsCompletedFromErp({
  start,
  end,
  regionCatalog = null,
  organizationId = null,
  brandId = 'cz'
}) {
  const pool = getErpPool(brandId)
  if (!pool) return unavailableResult()

  const catalog = regionCatalog || resolveRegionCatalogForBrand(brandId)
  const rows = await queryCompletedRows(pool, { start, end, organizationId, brandId })

  return {
    ...summarizeRows(rows, brandId, catalog),
    source: brandId === 'sk' ? 'erp-sk-db' : 'erp-db',
    unavailable: false
  }
}

/**
 * Zpětný přehled — splněno po měsících v rozsahu (jeden dotaz).
 * @returns {{ months: Record<string, ReturnType<typeof summarizeRows>>, source: string, unavailable: boolean }}
 */
export async function fetchTargetsCompletedByMonthFromErp({
  start,
  end,
  regionCatalog = null,
  organizationId = null,
  brandId = 'cz'
}) {
  const pool = getErpPool(brandId)
  if (!pool) return { months: {}, source: 'erp-db', unavailable: true }

  const catalog = regionCatalog || resolveRegionCatalogForBrand(brandId)
  const rows = await queryCompletedRows(pool, { start, end, organizationId, brandId })

  const rowsByMonth = new Map()
  for (const row of rows) {
    if (!rowsByMonth.has(row.month_key)) rowsByMonth.set(row.month_key, [])
    rowsByMonth.get(row.month_key).push(row)
  }

  const months = {}
  for (const [monthKey, monthRows] of rowsByMonth) {
    months[monthKey] = summarizeRows(monthRows, brandId, catalog)
  }

  return {
    months,
    source: brandId === 'sk' ? 'erp-sk-db' : 'erp-db',
    unavailable: false
  }
}
