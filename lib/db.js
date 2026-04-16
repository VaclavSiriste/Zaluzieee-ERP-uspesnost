/**
 * Databázové připojení a utility funkce
 */

const { Pool } = require('pg')
require('dotenv').config()

let pool = null

/**
 * Získá nebo vytvoří pool připojení
 */
function getPool() {
  if (!pool) {
    const connectionString = process.env.ERP_DB_CONNECTION_STRING
    const caCert = process.env.ERP_DB_CA_CERT

    if (!connectionString) {
      console.error('❌ Chyba: ERP_DB_CONNECTION_STRING není nastavena v .env')
      return null
    }

    const poolConfig = {
      connectionString,
      ssl: caCert ? {
        rejectUnauthorized: true,
        ca: caCert
      } : false
    }

    pool = new Pool(poolConfig)

    pool.on('error', (err) => {
      console.error('Chyba v databázi pool:', err.message)
    })

    pool.on('connect', () => {
      console.log('✅ Databáze připojena')
    })
  }

  return pool
}

/**
 * Testovací dotaz
 */
async function testConnection() {
  const pool = getPool()
  try {
    const result = await pool.query('SELECT NOW()')
    console.log('✅ Databáze připojena:', result.rows[0])
    return true
  } catch (error) {
    console.error('❌ Chyba připojení:', error)
    return false
  }
}

/**
 * Stáhne metriky pro dané období
 */
async function getMetrics(filters = {}) {
  const {
    startDate,
    endDate,
    operatorId,
    region,
    product,
    excludeTechnical = true
  } = filters

  const pool = getPool()

  // TODO: Implementovat SQL dotazy
  // Toto je placeholder
  
  try {
    // Příklad dotazu (upravit podle schémy):
    /*
    const query = `
      SELECT 
        o.id, o.name,
        COUNT(DISTINCT m.id) as scheduled,
        COUNT(DISTINCT CASE WHEN mr.result = 'completed' THEN m.id END) as completed,
        COUNT(DISTINCT CASE WHEN mr.result = 'offered' THEN m.id END) as offered,
        COUNT(DISTINCT CASE WHEN mr.result = 'closed' THEN m.id END) as closed
      FROM meetings m
      JOIN operators o ON m.operator_id = o.id
      LEFT JOIN meeting_results mr ON m.id = mr.meeting_id
      WHERE m.scheduled_date BETWEEN $1 AND $2
      ${operatorId ? 'AND o.id = $3' : ''}
      ${region ? 'AND m.region = $4' : ''}
      ${excludeTechnical ? 'AND mr.is_technical_stop = false' : ''}
      GROUP BY o.id, o.name
    `
    */

    // Po implementaci:
    // const result = await pool.query(query, params)
    // return result.rows

    return []
  } catch (error) {
    console.error('Chyba při získávání metrik:', error)
    throw error
  }
}

module.exports = {
  getPool,
  testConnection,
  getMetrics
}
