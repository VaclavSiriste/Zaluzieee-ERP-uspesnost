/**
 * Konverze po krajích — „Metodika ERP“ (vychází ze Systeeem → Nástěnka → Metriky, upravená):
 *
 * Leady = objednávky vytvořené v období (orders.created_at — zapíše se automaticky a nedá se
 *         přepsat; dřív datum_prijeti_leadu), nesmazané, bez duplikací a reklamací;
 *         každá objednávka zvlášť (dřív víc leadů jednoho zákazníka = 1 lead).
 * Naplánované zaměřovačky PZ = count(distinct order) nesmazané, bez duplikací a reklamací, dopadl_hovor = 'ano',
 *         datum_navolani v období, datum_zamereni vyplněné (na hodnotě nezáleží).
 * Konverze lead → zaměřovačka = PZ / leady × 100, zaokrouhleno na 0,1.
 *
 * Kraj = kraj zákazníka (customers.region), sloučený přes katalog krajů.
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { buildResolver } from '@/lib/region-funnel'
import { CALENDAR_DATE_SQL, appendOrganizationFilter } from '@/lib/sla-metrics'

const ISO_DATE = `'^\\d{4}-\\d{2}-\\d{2}'`
/** Stejné vyřazení jako kohorta: duplikace a reklamace mezi leady nepatří. */
const EXCLUDED_STATUS_SQL = `LOWER(TRIM(COALESCE(o.status, ''))) NOT LIKE 'duplikace%'
        AND LOWER(COALESCE(o.status, '')) NOT LIKE '%reklamace%'`

/** Hodnota sloupce zakázky (join jako v ERP — přes slug sloupce). */
const COLUMN_JOIN = (alias, slug) => `
  JOIN orders_column_values ${alias} ON ${alias}.order_id = o.id
  JOIN orders_columns ${alias}_c ON ${alias}_c.id = ${alias}.column_id AND ${alias}_c.slug = '${slug}'
`

/** Stejné zaokrouhlení jako ERP pct(): na jedno desetinné místo, bez leadů null. */
export function erpPct(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : null
}

export async function fetchRegionFunnelErp({ brandId, organizationId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')

  // ERP: >= from AND < to (to = den po konci období)
  const from = formatDateOnly(start)
  const toExclusive = formatDateOnly(new Date(end.getFullYear(), end.getMonth(), end.getDate() + 1))
  const org = appendOrganizationFilter([from, toExclusive], organizationId, { brandId })

  const [leadsResult, pzResult] = await Promise.all([
    pool.query(
      `
      SELECT COALESCE(cu.region, '') AS region_raw, COUNT(*)::int AS n
      FROM orders o
      LEFT JOIN customers cu ON cu.id = o.customer_id
      WHERE o.deleted_at IS NULL
        AND (${CALENDAR_DATE_SQL}) >= $1::date
        AND (${CALENDAR_DATE_SQL}) < $2::date
        AND ${EXCLUDED_STATUS_SQL}
        ${org.sql}
      GROUP BY 1
      `,
      org.params
    ),
    pool.query(
      `
      WITH pz AS (
        SELECT DISTINCT o.id, o.customer_id
        FROM orders o
        ${COLUMN_JOIN('nav', 'datum_navolani')}
        ${COLUMN_JOIN('h', 'dopadl_hovor')}
        ${COLUMN_JOIN('zam', 'datum_zamereni')}
        WHERE o.deleted_at IS NULL
          AND ${EXCLUDED_STATUS_SQL}
          AND lower(btrim(h.value)) = 'ano'
          AND nav.value ~ ${ISO_DATE}
          AND substring(nav.value, 1, 10)::date >= $1::date
          AND substring(nav.value, 1, 10)::date < $2::date
          AND zam.value ~ ${ISO_DATE}
          ${org.sql}
      )
      SELECT COALESCE(cu.region, '') AS region_raw, COUNT(*)::int AS n
      FROM pz
      LEFT JOIN customers cu ON cu.id = pz.customer_id
      GROUP BY 1
      `,
      org.params
    )
  ])

  const resolve = buildResolver(brandId)
  const merged = new Map()
  const add = (rows, key) => {
    for (const row of rows) {
      const region = resolve(row.region_raw)
      const acc = merged.get(region.id) || {
        id: region.id,
        name: region.name,
        service: Boolean(region.service),
        leads: 0,
        pz: 0
      }
      acc[key] += Number(row.n) || 0
      merged.set(region.id, acc)
    }
  }
  add(leadsResult.rows, 'leads')
  add(pzResult.rows, 'pz')

  const special = new Set(['none', 'other'])
  const regions = [...merged.values()]
    .map((r) => ({ ...r, conv_pct: erpPct(r.pz, r.leads) }))
    .sort((a, b) => {
      if (special.has(a.id) !== special.has(b.id)) return special.has(a.id) ? 1 : -1
      if (a.service !== b.service) return a.service ? -1 : 1
      return b.leads - a.leads
    })

  const totalLeads = regions.reduce((sum, r) => sum + r.leads, 0)
  const totalPz = regions.reduce((sum, r) => sum + r.pz, 0)

  return {
    regions,
    totals: { id: 'total', name: 'Celkem', leads: totalLeads, pz: totalPz, conv_pct: erpPct(totalPz, totalLeads) }
  }
}
