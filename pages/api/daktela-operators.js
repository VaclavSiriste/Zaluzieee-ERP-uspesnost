/**
 * Číselník operátorů z Daktela / Pohoda CC
 * GET /api/daktela-operators
 */

import { getDaktelaPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getDaktelaPool()
  if (!pool) {
    return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
  }

  try {
    const { rows } = await pool.query(`
      SELECT
        u."user" AS operator_id,
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), u."user", 'Neznámý') AS operator_name,
        u.email
      FROM "user" u
      WHERE NULLIF(TRIM(u."user"), '') IS NOT NULL
      ORDER BY operator_name ASC
    `)

    return res.status(200).json({
      operators: rows.map((row) => ({
        operator_id: row.operator_id,
        operator_name: row.operator_name,
        email: row.email || null
      }))
    })
  } catch (error) {
    console.error('daktela-operators:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení operátorů' })
  }
}
