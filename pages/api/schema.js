/**
 * Endpoint pro zjištění schéma databáze
 * GET /api/schema
 */

import { getPool } from '@/lib/db-esm'

export default async function handler(req, res) {
  try {
    const pool = getPool()
    
    // Zjistí všechny tabulky
    const tablesResult = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `)
    
    const tables = {}
    
    // Pro každou tabulku zjistí sloupce
    for (const table of tablesResult.rows) {
      const columnsResult = await pool.query(`
        SELECT 
          column_name, 
          data_type,
          is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = $1
        ORDER BY ordinal_position
      `, [table.table_name])
      
      tables[table.table_name] = columnsResult.rows
    }
    
    res.status(200).json({
      database: 'ERP Database',
      timestamp: new Date().toISOString(),
      tables
    })
  } catch (error) {
    console.error('❌ Chyba:', error.message)
    res.status(500).json({
      error: error.message,
      timestamp: new Date().toISOString()
    })
  }
}
