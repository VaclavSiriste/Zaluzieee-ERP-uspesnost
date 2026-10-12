/**
 * Callback („Volat později“) u objednávek v seznamech / drilldownech — všechny ERP značky.
 *
 * Callback = status callback NEBO poslední „Důvod ne“ (proc_nedopadl_hovor) = volat-pozdeji / volat-jindy.
 * Kdo nastavil + kdy = poslední záznam v orders_audit_log, který callback nastavil
 *   (status → callback nebo proc_nedopadl_hovor → volat-pozdeji/volat-jindy).
 * Na kdy = preferovane_datum + preferovany_cas.
 *
 * Doplňuje se dodatečně jen pro objednávky na aktuální stránce seznamu (jeden dotaz přes ID).
 * Když instance nemá audit log (SK Railway?), kdo/kdy zůstane prázdné.
 */

export const CALLBACK_STATUS = 'callback'
export const CALLBACK_REASONS = ['volat-pozdeji', 'volat-jindy']

const REASONS_SQL = CALLBACK_REASONS.map((r) => `'${r}'`).join(', ')

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
        AND (
          (a.field = 'status' AND LOWER(a.new_value) = '${CALLBACK_STATUS}')
          OR (a.field = 'proc_nedopadl_hovor' AND LOWER(a.new_value) IN (${REASONS_SQL}))
        )
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
        OR LOWER(duvod.value) IN (${REASONS_SQL})
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
