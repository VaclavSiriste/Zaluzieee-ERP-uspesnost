/**
 * Splněno targetů z ERP:
 * - celkem = počet zakázek s datum_zamereni v měsíci
 * - technici = stejné + zaměřovač
 * - kraje = stejné + customers.region
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly, getDateFilterSql } from '@/lib/metrics-query'
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

export async function fetchTargetsCompletedFromErp({
  start,
  end,
  regionCatalog = null,
  organizationId = null,
  brandId = 'cz'
}) {
  const pool = getErpPool(brandId)
  if (!pool) {
    return {
      ...emptyCounts(),
      technicians_by_name: [],
      regions_by_name: [],
      source: 'erp-db',
      unavailable: true
    }
  }

  const catalog = regionCatalog || resolveRegionCatalogForBrand(brandId)
  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('zamereni')
  const startDate = formatDateOnly(start)
  const endDate = formatDateOnly(end)
  const org = appendOrganizationFilter([startDate, endDate], organizationId, brandId)

  const [techResult, regionResult, totalResult] = await Promise.all([
    pool.query(
      `
      WITH ${dateFilterCte},
      zamerovac AS (
        SELECT DISTINCT ON (order_id)
          order_id,
          user_id
        FROM order_user_assignments
        WHERE assignment_type = 'zamerovac'
        ORDER BY order_id, id DESC
      )
      SELECT
        COALESCE(NULLIF(TRIM(u.name), ''), 'Nepřiřazený zaměřovač') AS zamerovac_name,
        COUNT(*)::int AS cnt
      FROM orders o
      ${dateFilterJoin}
      JOIN zamerovac za ON za.order_id = o.id
      LEFT JOIN users u ON u.id = za.user_id
      WHERE ${dateFilterWhere}
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
        ${org.sql}
      GROUP BY 1
      ORDER BY cnt DESC, 1
      `,
      org.params
    ),
    pool.query(
      `
      WITH ${dateFilterCte}
      SELECT
        COALESCE(NULLIF(TRIM(c.region), ''), 'N/A') AS region,
        COUNT(*)::int AS cnt
      FROM orders o
      ${dateFilterJoin}
      LEFT JOIN customers c ON c.id = o.customer_id
      WHERE ${dateFilterWhere}
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
        ${org.sql}
      GROUP BY 1
      ORDER BY cnt DESC, 1
      `,
      org.params
    ),
    pool.query(
      `
      WITH ${dateFilterCte}
      SELECT COUNT(*)::int AS cnt
      FROM orders o
      ${dateFilterJoin}
      WHERE ${dateFilterWhere}
        AND LOWER(TRIM(COALESCE(o.status, ''))) <> 'duplikace'
        ${org.sql}
      `,
      org.params
    )
  ])

  const total = Number(totalResult.rows[0]?.cnt) || 0

  const technicians = {}
  const technicians_by_name = techResult.rows.map((row) => {
    const name = row.zamerovac_name
    const count = Number(row.cnt) || 0
    const id = resolveTechnicianId(name)
    if (id) {
      technicians[id] = (technicians[id] || 0) + count
    }
    return { name, count, technician_id: id }
  })

  const regions = {}
  const regions_by_name = regionResult.rows.map((row) => {
    const region = row.region
    const count = Number(row.cnt) || 0
    const id = resolveErpRegionIdForBrand(region, brandId, catalog)
    if (id) {
      regions[id] = (regions[id] || 0) + count
    }
    return { region, count, region_id: id }
  })

  return {
    total,
    technicians,
    regions,
    technicians_by_name,
    regions_by_name,
    source: brandId === 'sk' ? 'erp-sk-db' : 'erp-db',
    unavailable: false
  }
}
