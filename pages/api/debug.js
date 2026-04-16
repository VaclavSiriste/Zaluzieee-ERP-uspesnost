/**
 * Debug endpoint - zjištění dostupných dat
 * GET /api/debug
 */

import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  try {
    const pool = getPool()
    
    // Kolik je schůzek celkem
    const countResult = await pool.query('SELECT COUNT(*) as total FROM events')
    const totalEvents = countResult.rows[0].total

    // Poslední schůzky
    const recentResult = await pool.query(`
      SELECT 
        id, title, status, created_by, scheduled_from, completed_at, customer_id
      FROM events
      ORDER BY created_at DESC
      LIMIT 20
    `)

    // Unikátní operátoři
    const operatorsResult = await pool.query(`
      SELECT DISTINCT created_by
      FROM events
      WHERE created_by IS NOT NULL
      LIMIT 20
    `)

    // Unikátní regiony
    const regionsResult = await pool.query(`
      SELECT DISTINCT region
      FROM customers
      WHERE region IS NOT NULL
      LIMIT 20
    `)

    // Stat schůzek po statusech
    const statusResult = await pool.query(`
      SELECT status, COUNT(*) as count
      FROM events
      GROUP BY status
    `)

    // Statistika completed_at
    const completedResult = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(CASE WHEN completed_at IS NOT NULL THEN 1 END) as with_completed_at,
        COUNT(CASE WHEN completed_at IS NULL THEN 1 END) as without_completed_at
      FROM events
    `)

    res.status(200).json({
      totalEvents: parseInt(totalEvents),
      recentEvents: recentResult.rows.slice(0, 5),
      uniqueOperators: operatorsResult.rows.map(r => r.created_by),
      uniqueRegions: regionsResult.rows.map(r => r.region),
      statusDistribution: statusResult.rows,
      completedAtStats: completedResult.rows[0],
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
