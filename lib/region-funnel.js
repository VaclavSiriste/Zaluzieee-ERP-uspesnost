/**
 * Konverze po krajích (ERP značky CZ / SK / Venkovky) — kohorta leadů vzniklých v období:
 *   leady → dopadl hovor ANO → naplánované zaměření ANO → zakázka (dopadlo zaměření ANO)
 * Zaměření = naplánován termín ANO NEBO vyplněné datum zaměření NEBO jakýkoli výsledek zaměření
 *   (sloupec „naplánován termín“ se plní až od 1/2026).
 * Zakázka = „Dopadlo zaměření = ANO“ (stejně jako stránka Obchodníci); „čekáme“ = výsledek zaměření ještě není.
 * Venkovky sloupce ANO/NE nepoužívají → fáze odvozené z jejich stavů (VENKOVKY_*_STATUSES).
 * Leady z posledních dní ještě nestihly projít celým trychtýřem — konverze za krátké období je nižší.
 */

import { buildDefaultRegionCatalog, resolveErpRegionId } from '@/lib/czech-regions'
import { getErpPool } from '@/lib/db-esm'
import { CALENDAR_DATE_SQL, appendOrganizationFilter } from '@/lib/sla-metrics'

/** SK: kraje, kam se jezdí (zvýrazněné), ostatní zvlášť. */
const SK_REGIONS = [
  { id: 'bratislavsky', name: 'Bratislavský', match: 'bratislav', service: true },
  { id: 'trenciansky', name: 'Trenčianský', match: 'trencian', service: true },
  { id: 'zilinsky', name: 'Žilinský', match: 'zilin', service: true },
  { id: 'trnavsky', name: 'Trnavský', match: 'trnav' },
  { id: 'nitriansky', name: 'Nitrianský', match: 'nitr' },
  { id: 'banskobystricky', name: 'Banskobystrický', match: 'banskobystr' },
  { id: 'presovsky', name: 'Prešovský', match: 'presov' },
  { id: 'kosicky', name: 'Košický', match: 'kosic' }
]

/** Venkovky: stavy, které znamenají „došlo k zaměření“ / „je zakázka“. */
const VENKOVKY_ZAKAZKA_STATUSES = [
  'naplanovat-montaz-venkovky',
  'naplanovana-montaz-venkovky',
  'hotova-realizace-venkovky',
  'prodan-interier-venkovky',
  'objednat-venkovky',
  'zal-fa-venkovky'
]
const VENKOVKY_ZAMERENI_STATUSES = [
  'naplanovano-zamereni-venkovky',
  'zamereno-volat-venkovky',
  'cn-po-zamereni-venkovky',
  ...VENKOVKY_ZAKAZKA_STATUSES
]
const sqlList = (list) => list.map((item) => `'${item}'`).join(', ')

const NO_REGION = { id: 'none', name: 'Bez kraje' }
const OTHER_REGION = { id: 'other', name: 'Jiný / zahraničí' }

function fold(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
}

export function buildResolver(brandId) {
  if (brandId === 'sk') {
    return (raw) => {
      const key = fold(raw)
      if (!key) return NO_REGION
      return SK_REGIONS.find((region) => key.includes(region.match)) || OTHER_REGION
    }
  }
  const catalog = buildDefaultRegionCatalog()
  const byId = new Map(catalog.map((item) => [item.id, item]))
  return (raw) => {
    if (!fold(raw)) return NO_REGION
    const id = resolveErpRegionId(raw, catalog)
    const item = id ? byId.get(id) : null
    return item ? { id: item.id, name: item.name } : OTHER_REGION
  }
}

const LAST_VALUE = (slug) => `
  SELECT DISTINCT ON (ocv.order_id)
    ocv.order_id,
    LOWER(TRIM(ocv.value)) AS value_lc
  FROM orders_column_values ocv
  JOIN orders_columns oc ON oc.id = ocv.column_id
  WHERE oc.slug = '${slug}'
  ORDER BY ocv.order_id, ocv.id DESC
`

export async function fetchRegionFunnel({ brandId, organizationId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')
  const base = appendOrganizationFilter([start, end], organizationId, { brandId })

  const { rows } = await pool.query(
    `
    WITH
      dopadl AS (${LAST_VALUE('dopadl_hovor')}),
      zamereni AS (${LAST_VALUE('naplanovan_termin_zamereni')}),
      vysledek AS (${LAST_VALUE('dopadlo_zamereni')}),
      datum_zam AS (${LAST_VALUE('datum_zamereni')}),
      flags AS (
        SELECT
          o.id,
          o.customer_id,
          d.value_lc AS dopadl,
          (
            z.value_lc = 'ano'
            OR NULLIF(dz.value_lc, '') IS NOT NULL
            OR v.value_lc IN ('ano', 'ne', 'cekame')
            OR LOWER(TRIM(COALESCE(o.status, ''))) IN (${sqlList(VENKOVKY_ZAMERENI_STATUSES)})
          ) AS zamereni,
          (
            v.value_lc = 'ano'
            OR LOWER(TRIM(COALESCE(o.status, ''))) IN (${sqlList(VENKOVKY_ZAKAZKA_STATUSES)})
          ) AS zakazka,
          v.value_lc = 'cekame' AS ceka
        FROM orders o
        LEFT JOIN dopadl d ON d.order_id = o.id
        LEFT JOIN zamereni z ON z.order_id = o.id
        LEFT JOIN vysledek v ON v.order_id = o.id
        LEFT JOIN datum_zam dz ON dz.order_id = o.id
        WHERE (${CALENDAR_DATE_SQL}) >= $1::date
          AND (${CALENDAR_DATE_SQL}) <= $2::date
          AND o.deleted_at IS NULL
          AND LOWER(TRIM(COALESCE(o.status, ''))) NOT LIKE 'duplikace%'
          AND LOWER(COALESCE(o.status, '')) NOT LIKE '%reklamace%'
          ${base.sql}
      )
    SELECT
      COALESCE(cu.region, '') AS region_raw,
      COUNT(*)::int AS leads,
      COUNT(*) FILTER (WHERE f.dopadl = 'ano')::int AS dopadl_ano,
      COUNT(*) FILTER (WHERE f.dopadl = 'ne')::int AS dopadl_ne,
      COUNT(*) FILTER (WHERE f.zamereni)::int AS zamereni_ano,
      COUNT(*) FILTER (WHERE f.zakazka)::int AS zakazka,
      COUNT(*) FILTER (WHERE f.ceka)::int AS ceka_vysledek
    FROM flags f
    LEFT JOIN customers cu ON cu.id = f.customer_id
    GROUP BY 1
    `,
    base.params
  )

  // Sloučit varianty názvů (Praha / Hlavní město Praha…) přes katalog krajů
  const resolve = buildResolver(brandId)
  const merged = new Map()
  for (const row of rows) {
    const region = resolve(row.region_raw)
    const acc = merged.get(region.id) || {
      id: region.id,
      name: region.name,
      service: Boolean(region.service),
      leads: 0,
      dopadl_ano: 0,
      dopadl_ne: 0,
      zamereni_ano: 0,
      zakazka: 0,
      ceka_vysledek: 0
    }
    for (const key of ['leads', 'dopadl_ano', 'dopadl_ne', 'zamereni_ano', 'zakazka', 'ceka_vysledek']) {
      acc[key] += Number(row[key]) || 0
    }
    merged.set(region.id, acc)
  }

  const withRates = (r) => ({
    ...r,
    navolani_pct: r.dopadl_ano + r.dopadl_ne ? (r.dopadl_ano / (r.dopadl_ano + r.dopadl_ne)) * 100 : null,
    lead_to_zamereni_pct: r.leads ? (r.zamereni_ano / r.leads) * 100 : null,
    lead_to_zakazka_pct: r.leads ? (r.zakazka / r.leads) * 100 : null,
    zamereni_to_zakazka_pct: r.zamereni_ano ? (r.zakazka / r.zamereni_ano) * 100 : null
  })

  const special = new Set([NO_REGION.id, OTHER_REGION.id])
  const regions = [...merged.values()]
    .map(withRates)
    .sort((a, b) => {
      if (special.has(a.id) !== special.has(b.id)) return special.has(a.id) ? 1 : -1
      if (a.service !== b.service) return a.service ? -1 : 1
      return b.leads - a.leads
    })

  const totals = withRates(
    regions.reduce(
      (acc, r) => {
        for (const key of ['leads', 'dopadl_ano', 'dopadl_ne', 'zamereni_ano', 'zakazka', 'ceka_vysledek']) {
          acc[key] += r[key]
        }
        return acc
      },
      { id: 'total', name: 'Celkem', leads: 0, dopadl_ano: 0, dopadl_ne: 0, zamereni_ano: 0, zakazka: 0, ceka_vysledek: 0 }
    )
  )

  return { regions, totals }
}
