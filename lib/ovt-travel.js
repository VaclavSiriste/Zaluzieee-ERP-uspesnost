/**
 * Den OVT z kalendáře ERP (SK): zaměření a přejezdy na OVT a den směny — plánovaný čas, ne skutečná jízda.
 *
 * Den OVT = OVT × den, kdy má v kalendáři událost „smena“ (proběhlé dny v období filtru).
 * Za každý takový den: počet zaměření (události „zamereni“), počet přejezdů (události „prejezd“
 *   — zapisují je operátoři při plánování přes Daktela widget) a součet minut přejezdů.
 * Průměry = součet / počet dní OVT (tj. na OVT a den směny).
 * Kraj dne = kraj zákazníků, kde měl OVT ten den nejvíc zaměření.
 * Dny počítané v čase Europe/Bratislava (kalendář ukládá UTC).
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { buildResolver } from '@/lib/region-funnel'

const NO_ZAMERENI_ID = 'bez-zamereni'
const SPECIAL_REGIONS = new Set(['none', 'other', NO_ZAMERENI_ID])
const LOCAL_DAY = (expr) => `(${expr} AT TIME ZONE 'UTC' AT TIME ZONE 'Europe/Bratislava')::date`

function round(value, digits) {
  if (value == null || !Number.isFinite(value)) return null
  const f = 10 ** digits
  return Math.round(value * f) / f
}

function summarize(id, name, service, days) {
  const count = days.length
  const zamereni = days.reduce((sum, d) => sum + d.zamereni, 0)
  const prejezdu = days.reduce((sum, d) => sum + d.prejezdu, 0)
  const minutes = days.reduce((sum, d) => sum + d.prejezdMin, 0)
  return {
    id,
    name,
    service,
    dni_ovt: count,
    ovt_count: new Set(days.map((d) => d.userId)).size,
    zamereni,
    prejezdu,
    zamereni_na_den: count ? round(zamereni / count, 2) : null,
    prejezdu_na_den: count ? round(prejezdu / count, 2) : null,
    prejezd_min_na_den: count ? round(minutes / count, 1) : null,
    min_na_prejezd: prejezdu ? round(minutes / prejezdu, 1) : null
  }
}

export async function fetchOvtTravel({ brandId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')

  const { rows } = await pool.query(
    `
    WITH smena_den AS (
      SELECT DISTINCT sp.user_id, ${LOCAL_DAY('s.starts_at')} AS den
      FROM calendar_events s
      JOIN calendar_event_participants sp ON sp.event_id = s.id AND sp.role::text = 'owner'
      WHERE s.event_type::text = 'smena'
        AND s.status::text <> 'cancelled'
        AND ${LOCAL_DAY('s.starts_at')} BETWEEN $1::date AND $2::date
        AND ${LOCAL_DAY('s.starts_at')} < ${LOCAL_DAY('now()')}
    ),
    ev AS (
      SELECT DISTINCT ON (e.id)
        e.id,
        e.event_type::text AS typ,
        p.user_id,
        ${LOCAL_DAY('e.starts_at')} AS den,
        GREATEST(0, EXTRACT(EPOCH FROM (e.ends_at - e.starts_at)) / 60.0) AS minut,
        e.order_id
      FROM calendar_events e
      JOIN calendar_event_participants p ON p.event_id = e.id AND p.role::text = 'owner'
      WHERE e.event_type::text IN ('zamereni', 'prejezd')
        AND e.status::text <> 'cancelled'
        AND ${LOCAL_DAY('e.starts_at')} BETWEEN $1::date AND $2::date
      ORDER BY e.id, p.id
    )
    SELECT
      sd.user_id,
      sd.den,
      COUNT(ev.id) FILTER (WHERE ev.typ = 'zamereni')::int AS zamereni,
      COUNT(ev.id) FILTER (WHERE ev.typ = 'prejezd')::int AS prejezdu,
      COALESCE(SUM(ev.minut) FILTER (WHERE ev.typ = 'prejezd'), 0) AS prejezd_min,
      MODE() WITHIN GROUP (ORDER BY NULLIF(TRIM(cu.region), '')) FILTER (WHERE ev.typ = 'zamereni') AS region_raw
    FROM smena_den sd
    LEFT JOIN ev ON ev.user_id = sd.user_id AND ev.den = sd.den
    LEFT JOIN orders o ON o.id = ev.order_id
    LEFT JOIN customers cu ON cu.id = o.customer_id
    GROUP BY sd.user_id, sd.den
    `,
    [formatDateOnly(start), formatDateOnly(end)]
  )

  const resolve = buildResolver(brandId)
  const groups = new Map()
  const all = []
  for (const row of rows) {
    const day = {
      userId: String(row.user_id),
      zamereni: Number(row.zamereni) || 0,
      prejezdu: Number(row.prejezdu) || 0,
      prejezdMin: Number(row.prejezd_min) || 0
    }
    all.push(day)
    const region = day.zamereni
      ? resolve(row.region_raw || '')
      : { id: NO_ZAMERENI_ID, name: 'Den bez zaměření' }
    const group = groups.get(region.id) || { region, days: [] }
    group.days.push(day)
    groups.set(region.id, group)
  }

  const regions = [...groups.values()]
    .map(({ region, days }) => summarize(region.id, region.name, Boolean(region.service), days))
    .sort((a, b) => {
      if (SPECIAL_REGIONS.has(a.id) !== SPECIAL_REGIONS.has(b.id)) return SPECIAL_REGIONS.has(a.id) ? 1 : -1
      if (a.service !== b.service) return a.service ? -1 : 1
      return b.dni_ovt - a.dni_ovt
    })

  return {
    regions,
    totals: summarize('total', 'Celkem', false, all)
  }
}
