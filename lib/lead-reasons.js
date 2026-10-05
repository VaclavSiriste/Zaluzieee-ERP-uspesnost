/**
 * Leady podle důvodu ne hovoru (proc_nedopadl_hovor) ve třech kategoriích:
 * 1) blocked — nelze ovlivnit / nejdou naplánovat
 * 2) lost    — nedopadly, ale mohli jsme je ovlivnit
 * 3) pending — čekáme na vyřízení (+ „v řešení“ = bez důvodu v otevřeném stavu)
 *
 * Datum = vznik leadu (created_at + 2 h, jako poptávky ve Výčtu SLA).
 * Hodnoty se porovnávají normalizované (bez diakritiky, pomlčky) — ERP má slugy,
 * OVT sheet popisky („4x Nedovoláno + Poslána SMS“) → obojí dá stejný klíč.
 */

import { getErpPool } from '@/lib/db-esm'
import { CALENDAR_DATE_SQL, appendOrganizationFilter } from '@/lib/sla-metrics'

/** Pseudo-důvod pro leady bez důvodu v otevřeném stavu. */
export const IN_PROGRESS_KEY = 'v-reseni'
export const IN_PROGRESS_STATUSES = ['novy-lead', 'bez-stavu', 'callback', 'nedovolano']

export const LEAD_REASON_CATEGORIES = [
  {
    key: 'blocked',
    label: 'Nelze ovlivnit',
    hint: 'mimo dosah, Venkovky, nemožná realizace, špatné údaje, duplicity, nejdou naplánovat',
    reasons: [
      ['mimo-dosah', 'Mimo dosah'],
      ['mimo-dosah-site', 'Mimo dosah – sítě'],
      ['projekt-mimodosah', 'Projekt – mimodosah'],
      ['venkovky', 'Venkovky'],
      ['nemozna-realizace', 'Nemožná realizace'],
      ['poslan-mail-spatne-udaje', 'Poslán mail / špatné údaje'],
      ['duplicita', 'Duplicita'],
      ['duplikace', 'Duplicita'],
      ['odkaz-na-svetstinu', 'Odkaz na Světstínu'],
      ['odkaz-na-svetstinu-cena', 'Odkaz na Světstínu – cena'],
      ['odkaz-na-svetstinu-cena-montaz', 'Odkaz na Světstínu – cena + montáž'],
      ['odkaz-na-svetstinu-dosah', 'Odkaz na Světstínu – dosah'],
      ['odkaz-na-svetstinu-odsah', 'Odkaz na Světstínu – dosah'],
      ['showroom', 'Showroom'],
      ['zamereni-az-za-dlouho', 'Zaměření až za dlouho'],
      // OVT sheety (pokladamee): nejde o zakázku
      ['zadost-o-praci', 'Není zakázka (práce / spolupráce)'],
      ['zajem-o-spolupraci', 'Není zakázka (práce / spolupráce)']
    ]
  },
  {
    key: 'lost',
    label: 'Mohli jsme ovlivnit',
    hint: 'již nemá zájem, min. hodnota, dotazy, vysoká cena, zavolá si',
    reasons: [
      ['jiz-nema-zajem', 'Již nemá zájem'],
      ['jiz-uz-nema-zajem', 'Již nemá zájem'],
      ['minimalni-hodnota-objednavky', 'Minimální hodnota objednávky'],
      ['dotaz-na-produkt', 'Dotaz na produkt'],
      ['dotaz-na-opravy', 'Dotaz na opravy'],
      ['vysoka-cena', 'Vysoká cena'],
      ['dotaz-na-cenu', 'Dotaz na cenu'],
      ['zavola-si', 'Zavolá si'],
      ['zmeskany-hovor-dovolano-ale-ko', 'Zmeškaný hovor + dovoláno, ale KO'],
      ['zruseni-zamereni', 'Zrušení zaměření']
    ]
  },
  {
    key: 'pending',
    label: 'Čeká na vyřízení',
    hint: 'v řešení, 1–4× nedovoláno, volat později, zmeškaný hovor, fotky, mail s CN',
    reasons: [
      [IN_PROGRESS_KEY, 'V řešení (bez důvodu, otevřený stav)'],
      ['1x-nedovolano-1x-poslana-sms', '1× nedovoláno + SMS'],
      ['2x-nedovolano-2x-poslana-sms', '2× nedovoláno + SMS'],
      ['3x-nedovolano-3x-poslana-sms', '3× nedovoláno + SMS'],
      ['4x-nedovolano-poslana-sms', '4× nedovoláno + SMS'],
      // OVT sheety mají popisky bez „+ SMS“
      ['1x-nedovolano', '1× nedovoláno + SMS'],
      ['2x-nedovolano', '2× nedovoláno + SMS'],
      ['3x-nedovolano', '3× nedovoláno + SMS'],
      ['4x-nedovolano', '4× nedovoláno + SMS'],
      ['volat-pozdeji', 'Volat později'],
      ['volat-jindy', 'Volat později'],
      ['zmeskany-hovor-nedovolano', 'Zmeškaný hovor + nedovoláno'],
      ['ceka-se-na-fotky', 'Čeká se na fotky'],
      ['poslan-mail-cn', 'Poslán mail – CN'],
      ['komunikace-chat', 'Komunikace / chat']
    ]
  }
]

const REASON_INDEX = new Map(
  LEAD_REASON_CATEGORIES.flatMap((category) =>
    category.reasons.map(([key, label]) => [key, { category: category.key, label }])
  )
)

/** Normalizace popisku/slugu (JS) — stejná jako REASON_KEY_SQL. */
export function normalizeReasonKey(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

const REASON_KEY_SQL = (expr) => `
  trim(both '-' from regexp_replace(
    translate(lower(trim(${expr})), 'áäčďéěíľĺňóôŕšťúůýž', 'aacdeeillnoorstuuyz'),
    '[^a-z0-9]+', '-', 'g'
  ))
`

/**
 * Z mapy { klíč důvodu → počet } složí kategorie pro koláče.
 * Neznámé klíče (a „domluveno ZAM“ = dopadlo) se nepočítají, vrací se v `unassigned`.
 */
export function summarizeLeadReasons(counts) {
  const categories = LEAD_REASON_CATEGORIES.map((category) => {
    const merged = new Map()
    for (const [key, label] of category.reasons) {
      const count = Number(counts[key]) || 0
      if (!count) continue
      // více slugů se stejným popiskem (překlep „odsah“) → jedna výseč
      merged.set(label, (merged.get(label) || 0) + count)
    }
    const reasons = [...merged.entries()]
      .map(([label, count]) => ({ key: normalizeReasonKey(label), label, count }))
      .sort((a, b) => b.count - a.count)
    return {
      key: category.key,
      label: category.label,
      hint: category.hint,
      total: reasons.reduce((sum, reason) => sum + reason.count, 0),
      reasons
    }
  })

  const unassigned = Object.entries(counts)
    .filter(([key]) => key && !REASON_INDEX.has(key))
    .map(([key, count]) => ({ key, count: Number(count) || 0 }))
    .sort((a, b) => b.count - a.count)

  return {
    total: categories.reduce((sum, category) => sum + category.total, 0),
    categories,
    unassigned
  }
}

/** ERP (CZ / SK / Venkovky): počty leadů podle důvodu za období vzniku leadu. */
export async function fetchErpLeadReasonCounts({ brandId, organizationId, start, end }) {
  const pool = getErpPool(brandId)
  if (!pool) throw new Error('ERP databáze není dostupná')
  const base = appendOrganizationFilter([start, end], organizationId, { brandId })
  const statusList = IN_PROGRESS_STATUSES.map((status) => `'${status}'`).join(', ')

  const { rows } = await pool.query(
    `
    WITH reason AS (
      SELECT DISTINCT ON (ocv.order_id)
        ocv.order_id,
        NULLIF(${REASON_KEY_SQL('ocv.value')}, '') AS reason_key
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE oc.slug = 'proc_nedopadl_hovor'
      ORDER BY ocv.order_id, ocv.id DESC
    )
    SELECT
      CASE
        WHEN r.reason_key IS NOT NULL THEN r.reason_key
        WHEN LOWER(TRIM(COALESCE(o.status, ''))) IN (${statusList}) THEN '${IN_PROGRESS_KEY}'
      END AS reason_key,
      COUNT(*)::int AS n
    FROM orders o
    LEFT JOIN reason r ON r.order_id = o.id
    WHERE (${CALENDAR_DATE_SQL}) >= $1::date
      AND (${CALENDAR_DATE_SQL}) <= $2::date
      ${base.sql}
    GROUP BY 1
    `,
    base.params
  )

  return Object.fromEntries(
    rows.filter((row) => row.reason_key).map((row) => [row.reason_key, Number(row.n) || 0])
  )
}
