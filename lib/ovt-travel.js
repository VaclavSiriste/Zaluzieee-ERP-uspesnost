/**
 * Přejezdy OVT z kalendáře ERP (SK) — plánovaný čas, ne skutečná jízda.
 *
 * Přejezd = událost kalendáře typu „prejezd“ (zapisují ji operátoři při plánování
 * přes Daktela widget, případně „Trasy zaměřovačů“), délka = konec − začátek bloku.
 * Kraj = kraj zákazníka navazujícího zaměření stejného OVT ve stejný den
 *   (první zaměření, které začíná nejdříve 15 min před koncem přejezdu).
 * Přejezd bez navazujícího zaměření (např. na montáž, domů) se vypisuje zvlášť.
 * Období = začátek přejezdu v období filtru (jen proběhlé, ne budoucí plán).
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { buildResolver } from '@/lib/region-funnel'

const NO_NEXT_ID = 'bez-navazujiciho'
const SPECIAL_REGIONS = new Set(['none', 'other', NO_NEXT_ID])

function round1(value) {
  return value == null ? null : Math.round(value * 10) / 10
}

function median(values) {
  if (!values.length) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function summarize(id, name, service, items) {
  const minutes = items.map((item) => item.minutes)
  return {
    id,
    name,
    service,
    prejezdu: items.length,
    ovt_count: new Set(items.map((item) => item.userId)).size,
    avg_min: minutes.length ? round1(minutes.reduce((sum, m) => sum + m, 0) / minutes.length) : null,
    median_min: round1(median(minutes))
  }
}

export async function fetchOvtTravel({ brandId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')

  const { rows } = await pool.query(
    `
    WITH prejezd AS (
      SELECT DISTINCT ON (e.id) e.id, e.starts_at, e.ends_at, p.user_id
      FROM calendar_events e
      JOIN calendar_event_participants p ON p.event_id = e.id AND p.role::text = 'owner'
      WHERE e.event_type::text = 'prejezd'
        AND e.status::text <> 'cancelled'
        AND e.starts_at >= $1::date
        AND e.starts_at < ($2::date + INTERVAL '1 day')
        AND e.starts_at < now()
        AND e.ends_at > e.starts_at
      ORDER BY e.id, p.id
    )
    SELECT
      pr.user_id,
      EXTRACT(EPOCH FROM (pr.ends_at - pr.starts_at)) / 60.0 AS minutes,
      (nx.event_id IS NOT NULL) AS has_next,
      COALESCE(cu.region, '') AS region_raw
    FROM prejezd pr
    LEFT JOIN LATERAL (
      SELECT z.id AS event_id, z.order_id, zp.customer_id
      FROM calendar_events z
      JOIN calendar_event_participants zo
        ON zo.event_id = z.id AND zo.role::text = 'owner' AND zo.user_id = pr.user_id
      LEFT JOIN calendar_event_participants zp
        ON zp.event_id = z.id AND zp.customer_id IS NOT NULL
      WHERE z.event_type::text = 'zamereni'
        AND z.status::text <> 'cancelled'
        AND z.starts_at >= pr.ends_at - INTERVAL '15 minutes'
        AND z.starts_at::date = pr.starts_at::date
      ORDER BY z.starts_at
      LIMIT 1
    ) nx ON TRUE
    LEFT JOIN orders o ON o.id = nx.order_id
    LEFT JOIN customers cu ON cu.id = COALESCE(o.customer_id, nx.customer_id)
    `,
    [formatDateOnly(start), formatDateOnly(end)]
  )

  const resolve = buildResolver(brandId)
  const groups = new Map()
  const all = []
  for (const row of rows) {
    const item = { userId: String(row.user_id), minutes: Number(row.minutes) || 0 }
    all.push(item)
    const region = row.has_next
      ? resolve(row.region_raw)
      : { id: NO_NEXT_ID, name: 'Bez navazujícího zaměření' }
    const group = groups.get(region.id) || { region, items: [] }
    group.items.push(item)
    groups.set(region.id, group)
  }

  const regions = [...groups.values()]
    .map(({ region, items }) => summarize(region.id, region.name, Boolean(region.service), items))
    .sort((a, b) => {
      if (SPECIAL_REGIONS.has(a.id) !== SPECIAL_REGIONS.has(b.id)) return SPECIAL_REGIONS.has(a.id) ? 1 : -1
      if (a.service !== b.service) return a.service ? -1 : 1
      return b.prejezdu - a.prejezdu
    })

  return {
    regions,
    totals: summarize('total', 'Celkem', false, all)
  }
}
