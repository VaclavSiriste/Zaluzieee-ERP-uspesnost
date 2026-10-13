/**
 * Den OVT z kalendáře ERP (SK): zaměření a přejezdy na OVT a den směny — plánovaný čas, ne skutečná jízda.
 *
 * Den OVT = OVT × den, kdy má v kalendáři událost „smena“ (proběhlé dny v období filtru).
 * Za každý takový den: počet zaměření (události „zamereni“), počet přejezdů a jejich čas.
 * Přejezd = mezera mezi koncem schůzky a začátkem další schůzky téhož OVT ten den
 *   (seřazeno podle začátku; překryv schůzek = 0 min). N schůzek = N − 1 přejezdů.
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
    zamereni AS (
      SELECT DISTINCT ON (e.id)
        e.id,
        p.user_id,
        ${LOCAL_DAY('e.starts_at')} AS den,
        e.starts_at,
        e.ends_at,
        e.order_id
      FROM calendar_events e
      JOIN calendar_event_participants p ON p.event_id = e.id AND p.role::text = 'owner'
      WHERE e.event_type::text = 'zamereni'
        AND e.status::text <> 'cancelled'
        AND ${LOCAL_DAY('e.starts_at')} BETWEEN $1::date AND $2::date
      ORDER BY e.id, p.id
    ),
    s_mezerou AS (
      -- přejezd = začátek schůzky − konec předchozí schůzky téhož OVT ten den (překryv = 0)
      SELECT
        z.*,
        -- první schůzka dne mezeru nemá (GREATEST by z NULL udělal 0)
        CASE
          WHEN LAG(z.ends_at) OVER w IS NULL THEN NULL
          ELSE GREATEST(0, EXTRACT(EPOCH FROM (z.starts_at - LAG(z.ends_at) OVER w)) / 60.0)
        END AS mezera_min
      FROM zamereni z
      WINDOW w AS (PARTITION BY z.user_id, z.den ORDER BY z.starts_at, z.id)
    )
    SELECT
      sd.user_id,
      sd.den,
      COUNT(sm.id)::int AS zamereni,
      COUNT(sm.mezera_min)::int AS prejezdu,
      COALESCE(SUM(sm.mezera_min), 0) AS prejezd_min,
      MODE() WITHIN GROUP (ORDER BY NULLIF(TRIM(cu.region), '')) AS region_raw
    FROM smena_den sd
    LEFT JOIN s_mezerou sm ON sm.user_id = sd.user_id AND sm.den = sd.den
    LEFT JOIN orders o ON o.id = sm.order_id
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
