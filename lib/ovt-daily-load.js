/**
 * Průměrný počet zaměření na OVT za den, po krajích (ERP značky CZ / SK / Venkovky).
 *
 * Zaměření = zakázky s (posledním) datum_zamereni = den, nesmazané, bez duplikací a reklamací.
 * OVT = zaměřovač (order_user_assignments.assignment_type = 'zamerovac', poslední přiřazení).
 * OVT v kraji = různí zaměřovači, kteří ten den měli zaměření u zákazníka z kraje
 *   (pevné přiřazení OVT ke kraji v ERP není). Jeden OVT může být ve víc krajích.
 * Průměr = zaměření s přiřazeným OVT / počet OVT. Zaměření bez OVT se vypisují zvlášť.
 * Kraj = customers.region, sloučený stejně jako Konverze po krajích.
 */

import { getErpPool } from '@/lib/db-esm'
import { appendOrganizationFilter } from '@/lib/sla-metrics'
import { buildResolver } from '@/lib/region-funnel'

const SPECIAL_REGIONS = new Set(['none', 'other'])

function average(count, ovt) {
  return ovt > 0 ? Math.round((count / ovt) * 100) / 100 : null
}

export async function fetchOvtDailyLoad({ brandId, organizationId, date }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')

  const org = appendOrganizationFilter([date], organizationId, { brandId })
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
        AND o.deleted_at IS NULL
        AND LOWER(TRIM(COALESCE(o.status, ''))) NOT LIKE 'duplikace%'
        AND LOWER(COALESCE(o.status, '')) NOT LIKE '%reklamace%'
        ${org.sql}
      ORDER BY ocv.order_id, ocv.id DESC
    ),
    zamereni AS (
      SELECT order_id
      FROM zamereni_latest
      WHERE raw_value ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
        AND SUBSTRING(raw_value, 1, 10)::date = $1::date
    ),
    zamerovac AS (
      SELECT DISTINCT ON (a.order_id) a.order_id, a.user_id
      FROM order_user_assignments a
      JOIN zamereni z ON z.order_id = a.order_id
      WHERE a.assignment_type = 'zamerovac'
      ORDER BY a.order_id, a.id DESC
    )
    SELECT
      COALESCE(cu.region, '') AS region_raw,
      za.user_id,
      NULLIF(TRIM(u.name), '') AS ovt_name,
      COUNT(*)::int AS n
    FROM zamereni z
    JOIN orders o ON o.id = z.order_id
    LEFT JOIN customers cu ON cu.id = o.customer_id
    LEFT JOIN zamerovac za ON za.order_id = z.order_id
    LEFT JOIN users u ON u.id = za.user_id
    GROUP BY 1, 2, 3
    `,
    org.params
  )

  const resolve = buildResolver(brandId)
  const byRegion = new Map()
  const allOvt = new Map()
  let unassignedTotal = 0

  for (const row of rows) {
    const region = resolve(row.region_raw)
    const acc = byRegion.get(region.id) || {
      id: region.id,
      name: region.name,
      service: Boolean(region.service),
      zamereni: 0,
      bez_ovt: 0,
      ovt: new Map()
    }
    const n = Number(row.n) || 0
    acc.zamereni += n
    if (row.user_id == null) {
      acc.bez_ovt += n
      unassignedTotal += n
    } else {
      const key = String(row.user_id)
      const name = row.ovt_name || `OVT #${key}`
      acc.ovt.set(key, { name, count: (acc.ovt.get(key)?.count || 0) + n })
      allOvt.set(key, { name, count: (allOvt.get(key)?.count || 0) + n })
    }
    byRegion.set(region.id, acc)
  }

  const toOvtList = (map) =>
    [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'cs'))

  const regions = [...byRegion.values()]
    .map((r) => {
      const ovtCount = r.ovt.size
      return {
        id: r.id,
        name: r.name,
        service: r.service,
        zamereni: r.zamereni,
        bez_ovt: r.bez_ovt,
        ovt_count: ovtCount,
        avg_per_ovt: average(r.zamereni - r.bez_ovt, ovtCount),
        ovt: toOvtList(r.ovt)
      }
    })
    .sort((a, b) => {
      if (SPECIAL_REGIONS.has(a.id) !== SPECIAL_REGIONS.has(b.id)) return SPECIAL_REGIONS.has(a.id) ? 1 : -1
      if (a.service !== b.service) return a.service ? -1 : 1
      return b.zamereni - a.zamereni || a.name.localeCompare(b.name, 'cs')
    })

  const totalZamereni = regions.reduce((sum, r) => sum + r.zamereni, 0)
  return {
    regions,
    totals: {
      id: 'total',
      name: 'Celkem',
      zamereni: totalZamereni,
      bez_ovt: unassignedTotal,
      ovt_count: allOvt.size,
      avg_per_ovt: average(totalZamereni - unassignedTotal, allOvt.size),
      ovt: toOvtList(allOvt)
    }
  }
}
