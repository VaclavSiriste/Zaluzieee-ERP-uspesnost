/**
 * Splněno targetů z ERP — počet zaměření v měsíci podle zaměřovače a kraje zákazníka.
 */

import { getPool } from '@/lib/db-esm'
import { resolveErpRegionId } from '@/lib/czech-regions'
import { normalizeOperatorKey } from '@/lib/normalize-operator'
import { getDateFilterSql, formatDateOnly } from '@/lib/metrics-query'
import { technicianId } from '@/lib/technician-targets'

function resolveTechnicianId(name) {
  const key = normalizeOperatorKey(name)
  if (!key || key.includes('neprirazen')) return null
  return technicianId(name)
}

function emptyCounts() {
  return { technicians: {}, regions: {} }
}

function appendOrganizationFilter(params, organizationId) {
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
  regionCatalog = [],
  organizationId = null
}) {
  const pool = getPool()
  if (!pool) {
    return {
      ...emptyCounts(),
      technicians_by_name: [],
      regions_by_name: [],
      source: 'erp-db',
      unavailable: true
    }
  }

  const { dateFilterCte, dateFilterJoin, dateFilterWhere } = getDateFilterSql('zamereni')
  const startDate = formatDateOnly(start)
  const endDate = formatDateOnly(end)
  const org = appendOrganizationFilter([startDate, endDate], organizationId)

  const [techResult, regionResult] = await Promise.all([
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
    )
  ])

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
    const id = resolveErpRegionId(region, regionCatalog)
    if (id) {
      regions[id] = (regions[id] || 0) + count
    }
    return { region, count, region_id: id }
  })

  return {
    technicians,
    regions,
    technicians_by_name,
    regions_by_name,
    source: 'erp-db',
    unavailable: false
  }
}
