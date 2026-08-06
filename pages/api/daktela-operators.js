/**
 * Číselník operátorů z Daktela / Pohoda CC
 * GET /api/daktela-operators
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

function isTransientDbError(error) {
  const message = String(error?.message || '')
  return TRANSIENT_DB_ERRORS.some((needle) => message.includes(needle))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function queryWithRetry(sql, params = [], attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const pool = getDaktelaPool()
      if (!pool) throw new Error('Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)')
      return await pool.query(sql, params)
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || i === attempts - 1) throw error
      const shouldUseFallback = String(error?.message || '').includes('ENOTFOUND')
      await resetDaktelaPool({ useFallbackOnNext: shouldUseFallback })
      await sleep(250 * (i + 1))
    }
  }
  throw lastError
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getDaktelaPool()
  if (!pool) {
    return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
  }

  try {
    const { rows } = await queryWithRetry(`
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
