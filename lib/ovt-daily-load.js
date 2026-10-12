/**
 * Průměrný počet zaměření na OVT za pracovní den (ERP značky CZ / SK / Venkovky).
 *
 * Průměr = zaměření s přiřazeným OVT / (počet OVT × počet pracovních dní v období).
 * Zaměření = zakázky s (posledním) datum_zamereni v období, nesmazané, bez duplikací a reklamací.
 * OVT = zaměřovač (order_user_assignments.assignment_type = 'zamerovac', poslední přiřazení);
 *   počet OVT = různí zaměřovači, kteří v období měli aspoň jedno zaměření.
 * Pracovní dny = Po–Pá v období (svátky se neodečítají).
 * SK: rozpad po krajích (OVT v kraji = kdo v kraji v období zaměřoval), ostatní značky jen celkem.
 * Kraj = customers.region, sloučený stejně jako Konverze po krajích.
 */

import { getErpPool } from '@/lib/db-esm'
import { appendOrganizationFilter } from '@/lib/sla-metrics'
import { buildResolver } from '@/lib/region-funnel'

const SPECIAL_REGIONS = new Set(['none', 'other'])

/** Po–Pá mezi dvěma dny YYYY-MM-DD včetně. */
export function countWorkingDays(startDay, endDay) {
  const toUtc = (day) => {
    const [y, m, d] = day.split('-').map(Number)
    return Date.UTC(y, m - 1, d)
  }
  let count = 0
  for (let t = toUtc(startDay); t <= toUtc(endDay); t += 86400000) {
    const weekday = new Date(t).getUTCDay()
    if (weekday !== 0 && weekday !== 6) count += 1
  }
  return count
}

function average(count, ovt, workingDays) {
  const denominator = ovt * workingDays
  return denominator > 0 ? Math.round((count / denominator) * 100) / 100 : null
}

export async function fetchOvtDailyLoad({ brandId, organizationId, startDay, endDay }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')

  const workingDays = countWorkingDays(startDay, endDay)
  const org = appendOrganizationFilter([startDay, endDay], organizationId, { brandId })
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
        AND SUBSTRING(raw_value, 1, 10)::date >= $1::date
        AND SUBSTRING(raw_value, 1, 10)::date <= $2::date
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

  const summarize = (acc, ovtMap) => ({
    id: acc.id,
    name: acc.name,
    service: Boolean(acc.service),
    zamereni: acc.zamereni,
    bez_ovt: acc.bez_ovt,
    ovt_count: ovtMap.size,
    avg_per_ovt_day: average(acc.zamereni - acc.bez_ovt, ovtMap.size, workingDays),
    ovt: toOvtList(ovtMap)
  })

  // Rozpad po krajích jen u SK, ostatní značky jen celkem
  const regions =
    brandId === 'sk'
      ? [...byRegion.values()]
          .map((r) => summarize(r, r.ovt))
          .sort((a, b) => {
            if (SPECIAL_REGIONS.has(a.id) !== SPECIAL_REGIONS.has(b.id)) return SPECIAL_REGIONS.has(a.id) ? 1 : -1
            if (a.service !== b.service) return a.service ? -1 : 1
            return b.zamereni - a.zamereni || a.name.localeCompare(b.name, 'cs')
          })
      : []

  const totalZamereni = [...byRegion.values()].reduce((sum, r) => sum + r.zamereni, 0)
  return {
    working_days: workingDays,
    regions,
    totals: summarize(
      { id: 'total', name: 'Celkem', zamereni: totalZamereni, bez_ovt: unassignedTotal },
      allOvt
    )
  }
}
