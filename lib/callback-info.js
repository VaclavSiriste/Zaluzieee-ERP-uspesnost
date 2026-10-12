/**
 * Callback („Volat později“) u objednávek v seznamech / drilldownech — všechny ERP značky.
 *
 * Callback = status callback NEBO poslední „Důvod ne“ (proc_nedopadl_hovor) = Volat později.
 *   Hodnota se porovnává normalizovaně (slug „volat-pozdeji“ i text „Volat později“)
 *   a přes číselník sloupce (orders_columns.options — klíč volby s popiskem Volat později).
 * Kdo nastavil + kdy = poslední záznam v orders_audit_log, který callback nastavil
 *   (status → callback nebo změna důvodu na Volat později).
 * Na kdy = preferovane_datum + preferovany_cas.
 *
 * Doplňuje se dodatečně jen pro objednávky na aktuální stránce seznamu (jeden dotaz přes ID).
 * Když instance nemá audit log (SK Railway?), kdo/kdy zůstane prázdné.
 */

export const CALLBACK_STATUS = 'callback'
export const CALLBACK_REASONS = ['volat-pozdeji', 'volat-jindy']

const REASONS_SQL = CALLBACK_REASONS.map((r) => `'${r}'`).join(', ')

/** Normalizace jako lead-reasons: malá písmena, bez diakritiky, mezery → pomlčky („Volat později“ → volat-pozdeji). */
function reasonKeySql(expr) {
  return `trim(both '-' from regexp_replace(
    translate(lower(trim(COALESCE(${expr}, ''))), 'áäčďéěíľĺňóôŕšťúůýž', 'aacdeeillnoorstuuyz'),
    '[^a-z0-9]+', '-', 'g'
  ))`
}

/** Klíče z číselníku sloupce Důvod ne, jejichž popisek je „Volat později“ (ERP může ukládat klíč volby). */
const CALLBACK_OPTION_KEYS_SQL = `
  SELECT opt.key
  FROM orders_columns oc_opt
  CROSS JOIN LATERAL jsonb_each_text(
    CASE WHEN jsonb_typeof(oc_opt.options::jsonb) = 'object' THEN oc_opt.options::jsonb ELSE '{}'::jsonb END
  ) opt
  WHERE oc_opt.slug = 'proc_nedopadl_hovor'
    AND ${reasonKeySql('opt.value')} IN (${REASONS_SQL})
`

/** SQL podmínka: hodnota důvodu = Volat později (slug, popisek i klíč volby). */
export function isCallbackReasonSql(expr) {
  return `(${reasonKeySql(expr)} IN (${REASONS_SQL}) OR TRIM(${expr}) IN (${CALLBACK_OPTION_KEYS_SQL}))`
}

/** SQL podmínka pro audit log: změna, která nastavila callback (status nebo důvod Volat později). */
export function auditSetsCallbackSql(alias = 'a') {
  return `(
    (${alias}.field = 'status' AND LOWER(${alias}.new_value) = '${CALLBACK_STATUS}')
    OR (${alias}.field <> 'status' AND ${reasonKeySql(`${alias}.new_value`)} IN (${REASONS_SQL}))
    OR (
      (${alias}.field ILIKE '%nedopadl%' OR ${alias}.field ILIKE '%duvod%' OR ${alias}.field ILIKE '%důvod%')
      AND TRIM(${alias}.new_value) IN (${CALLBACK_OPTION_KEYS_SQL})
    )
  )`
}

function latestColumn(alias, slug) {
  return `
    LEFT JOIN LATERAL (
      SELECT NULLIF(TRIM(ocv.value), '') AS value
      FROM orders_column_values ocv
      JOIN orders_columns oc ON oc.id = ocv.column_id
      WHERE ocv.order_id = o.id AND oc.slug = '${slug}'
      ORDER BY ocv.id DESC
      LIMIT 1
    ) ${alias} ON TRUE`
}

function buildSql(withAudit) {
  const auditSelect = withAudit
    ? 'cb.created_at AS callback_set_at, cb_user.name AS callback_set_by'
    : 'NULL::timestamp AS callback_set_at, NULL::text AS callback_set_by'
  const auditJoin = withAudit
    ? `
    LEFT JOIN LATERAL (
      SELECT a.created_at, a.user_id
      FROM orders_audit_log a
      WHERE a.order_id = o.id
        AND ${auditSetsCallbackSql('a')}
      ORDER BY a.created_at DESC
      LIMIT 1
    ) cb ON TRUE
    LEFT JOIN users cb_user ON cb_user.id = cb.user_id`
    : ''
  return `
    SELECT
      o.id AS order_id,
      pref_datum.value AS callback_date,
      pref_cas.value AS callback_time,
      ${auditSelect}
    FROM orders o
    ${latestColumn('duvod', 'proc_nedopadl_hovor')}
    ${latestColumn('pref_datum', 'preferovane_datum')}
    ${latestColumn('pref_cas', 'preferovany_cas')}
    ${auditJoin}
    WHERE o.id = ANY($1::bigint[])
      AND (
        LOWER(TRIM(COALESCE(o.status, ''))) = '${CALLBACK_STATUS}'
        OR ${isCallbackReasonSql('duvod.value')}
      )
  `
}

function isMissingAuditError(error) {
  return error?.code === '42P01' || error?.code === '42703'
}

/** Map order_id → { callback_set_by, callback_set_at, callback_date, callback_time } jen pro callbacky. */
export async function fetchCallbackInfo(pool, orderIds) {
  const ids = [...new Set((orderIds || []).map(Number).filter(Number.isFinite))]
  const result = new Map()
  if (!pool || !ids.length) return result

  let rows
  try {
    ;({ rows } = await pool.query(buildSql(true), [ids]))
  } catch (error) {
    if (!isMissingAuditError(error)) throw error
    ;({ rows } = await pool.query(buildSql(false), [ids]))
  }

  for (const row of rows) {
    result.set(Number(row.order_id), {
      is_callback: true,
      callback_set_by: row.callback_set_by || null,
      callback_set_at: row.callback_set_at || null,
      callback_date: row.callback_date || null,
      callback_time: row.callback_time || null
    })
  }
  return result
}

/**
 * Doplní callback pole do seznamu objednávek (mutuje kopie). Chyba dotazu seznam nerozbije —
 * callback sloupce pak jen zůstanou prázdné.
 */
export async function withCallbackInfo(pool, orders) {
  if (!Array.isArray(orders) || !orders.length) return orders
  let info
  try {
    info = await fetchCallbackInfo(
      pool,
      orders.map((order) => order.order_id)
    )
  } catch (error) {
    console.error('callback-info:', error.message)
    return orders
  }
  return orders.map((order) => ({ ...order, ...(info.get(Number(order.order_id)) || {}) }))
}
