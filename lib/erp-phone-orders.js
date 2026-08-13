/**
 * Batch lookup Systeeem orders by phone (last 9 digits).
 */

import { getPool } from '@/lib/db-esm'
import { SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'

export function phoneKeyFromClid(clid) {
  const digits = String(clid || '').replace(/\D/g, '')
  if (digits.length < 9) return ''
  return digits.slice(-9)
}

/**
 * @param {string[]} phoneKeys - last 9 digits
 * @returns {Promise<Map<string, { order_id: number|string, customer_name: string|null, detail_url: string }>>}
 */
export async function lookupOrdersByPhoneKeys(phoneKeys = []) {
  const unique = Array.from(
    new Set((phoneKeys || []).map((k) => String(k || '').trim()).filter((k) => k.length === 9))
  )
  const map = new Map()
  if (!unique.length) return map

  const pool = getPool()
  if (!pool) return map

  try {
    const { rows } = await pool.query(
      `
      WITH keys AS (
        SELECT UNNEST($1::text[]) AS phone_key
      ),
      matched AS (
        SELECT DISTINCT ON (k.phone_key)
          k.phone_key,
          c.id AS customer_id,
          NULLIF(TRIM(CONCAT_WS(' ', c.firstname, c.lastname)), '') AS customer_name,
          o.id AS order_id
        FROM keys k
        JOIN customers c
          ON RIGHT(REGEXP_REPLACE(COALESCE(c.phone, ''), '\\D', '', 'g'), 9) = k.phone_key
        JOIN orders o ON o.customer_id = c.id
        ORDER BY k.phone_key, o.updated_at DESC NULLS LAST, o.id DESC
      )
      SELECT phone_key, customer_id, customer_name, order_id
      FROM matched
      `,
      [unique]
    )

    for (const row of rows) {
      map.set(String(row.phone_key), {
        order_id: row.order_id,
        customer_id: row.customer_id,
        customer_name: row.customer_name || null,
        detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
      })
    }
  } catch (error) {
    console.warn('lookupOrdersByPhoneKeys:', error.message)
  }

  return map
}
