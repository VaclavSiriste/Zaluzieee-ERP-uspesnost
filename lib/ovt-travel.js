/**
 * Den OVT z kalendáře ERP (SK): zaměření a přejezdy na OVT a den směny — plánovaný čas, ne skutečná jízda.
 *
 * Den OVT = OVT × den, kdy má v kalendáři událost „smena“ (proběhlé dny v období filtru).
 * Za každý takový den: počet zaměření (události „zamereni“), počet přejezdů a jejich čas.
 * Přejezd = aktivita v kalendáři s názvem přesně „Přejezd“ / „přejezd“ (velikost písmen nerozhoduje,
 *   typ události nerozhoduje), délka = konec − začátek. Jiné názvy („12,8“, „Přejezd domů“…) se nepočítají.
 * (Mezery mezi schůzkami pro srovnání s GPS → jednorázový CSV export, ne panel.)
 * Průměry = součet / počet dní OVT (tj. na OVT a den směny).
 * Kraj dne = kraj zákazníků, kde měl OVT ten den nejvíc zaměření.
 * Dny počítané v čase Europe/Bratislava (kalendář ukládá timestamptz).
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { buildResolver } from '@/lib/region-funnel'

/** Název aktivity přejezdu v kalendáři — OVT/operátoři ho mají zadávat přesně takto. */
const PREJEZD_TITLE = 'přejezd'
const NO_ZAMERENI_ID = 'bez-zamereni'
const SPECIAL_REGIONS = new Set(['none', 'other', NO_ZAMERENI_ID])
// starts_at je timestamptz → jeden převod na místní čas (dvojí převod posouval o 4 h)
const LOCAL_DAY = (expr) => `(${expr} AT TIME ZONE 'Europe/Bratislava')::date`

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
        e.order_id
      FROM calendar_events e
      JOIN calendar_event_participants p ON p.event_id = e.id AND p.role::text = 'owner'
      WHERE e.event_type::text = 'zamereni'
        AND e.status::text <> 'cancelled'
        AND ${LOCAL_DAY('e.starts_at')} BETWEEN $1::date AND $2::date
      ORDER BY e.id, p.id
    ),
    zamereni_den AS (
      SELECT
        z.user_id,
        z.den,
        COUNT(*)::int AS zamereni,
        MODE() WITHIN GROUP (ORDER BY NULLIF(TRIM(cu.region), '')) AS region_raw
      FROM zamereni z
      LEFT JOIN orders o ON o.id = z.order_id
      LEFT JOIN customers cu ON cu.id = o.customer_id
      GROUP BY z.user_id, z.den
    ),
    prejezd AS (
      -- jen aktivity s názvem přesně „Přejezd“ / „přejezd“ (bez ohledu na velikost písmen a typ události)
      SELECT DISTINCT ON (e.id)
        e.id,
        p.user_id,
        ${LOCAL_DAY('e.starts_at')} AS den,
        GREATEST(0, EXTRACT(EPOCH FROM (e.ends_at - e.starts_at)) / 60.0) AS minut
      FROM calendar_events e
      JOIN calendar_event_participants p ON p.event_id = e.id AND p.role::text = 'owner'
      WHERE LOWER(TRIM(e.title)) = '${PREJEZD_TITLE}'
        AND e.status::text <> 'cancelled'
        AND ${LOCAL_DAY('e.starts_at')} BETWEEN $1::date AND $2::date
      ORDER BY e.id, p.id
    ),
    prejezd_den AS (
      SELECT user_id, den, COUNT(*)::int AS prejezdu, SUM(minut) AS prejezd_min
      FROM prejezd
      GROUP BY user_id, den
    )
    SELECT
      sd.user_id,
      sd.den,
      COALESCE(zd.zamereni, 0) AS zamereni,
      COALESCE(pd.prejezdu, 0) AS prejezdu,
      COALESCE(pd.prejezd_min, 0) AS prejezd_min,
      zd.region_raw
    FROM smena_den sd
    LEFT JOIN zamereni_den zd ON zd.user_id = sd.user_id AND zd.den = sd.den
    LEFT JOIN prejezd_den pd ON pd.user_id = sd.user_id AND pd.den = sd.den
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
