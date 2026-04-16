/**
 * Debug endpoint 2 - Počty záznamů v tabulkách
 * GET /api/debug2
 */

import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  try {
    const pool = getPool()
    
    const tables = [
      'events', 'orders', 'customers', 'users', 
      'daktela_call_activities', 'order_comments'
    ]

    const counts = {}
    
    for (const table of tables) {
      try {
        const result = await pool.query(`SELECT COUNT(*) as cnt FROM ${table}`)
        counts[table] = parseInt(result.rows[0].cnt)
      } catch (e) {
        counts[table] = 'error'
      }
    }

    // Podívej se na orders tabulku - jaké má sloupce související se schůzkami
    const ordersResult = await pool.query(`
      SELECT * FROM orders LIMIT 1
    `)
    const ordersColumns = ordersResult.fields ? 
      ordersResult.fields.map(f => f.name) : 
      []

    res.status(200).json({
      tableCounts: counts,
      ordersColumns,
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Chyba:', error.message)
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}
