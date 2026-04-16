/**
 * Databázové připojení a utility funkce (ES6 modul)
 */

import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg
let pool = null

/**
 * Získá nebo vytvoří pool připojení
 */
export function getPool() {
  if (!pool) {
    const connectionString = process.env.ERP_DB_CONNECTION_STRING
    const caCert = normalizeCertificate(process.env.ERP_DB_CA_CERT)

    if (!connectionString) {
      console.error('❌ Chyba: ERP_DB_CONNECTION_STRING není nastavena v .env')
      return null
    }

    console.log('🔌 Připojování k databázi...')
    console.log('URL:', connectionString.split('@')[1] || 'skryto')

    const ssl = caCert && caCert.includes('END CERTIFICATE')
      ? { rejectUnauthorized: true, ca: caCert }
      : { rejectUnauthorized: false }

    if (!caCert || !caCert.includes('END CERTIFICATE')) {
      console.warn('⚠️ ERP_DB_CA_CERT není načtený kompletně, fallback na rejectUnauthorized=false')
    }

    const poolConfig = { connectionString, ssl }

    pool = new Pool(poolConfig)

    pool.on('error', (err) => {
      console.error('❌ Chyba v pool:', err.message)
    })

    pool.on('connect', () => {
      console.log('✅ Klient připojen k databázi')
    })
  }

  return pool
}

/**
 * Testovací dotaz
 */
export async function testConnection() {
  try {
    const pool = getPool()
    if (!pool) {
      console.error('❌ Pool není inicializován')
      return false
    }

    console.log('🧪 Testuji připojení...')
    const result = await pool.query('SELECT NOW() as current_time')
    console.log('✅ Databáze připojena:', result.rows[0])
    return true
  } catch (error) {
    console.error('❌ Chyba připojení:', error.message)
    return false
  }
}

/**
 * Stáhne metriky pro dané období
 */
export async function getMetrics(filters = {}) {
  const pool = getPool()
  if (!pool) {
    throw new Error('Database pool not available')
  }

  try {
    // TODO: Implementovat SQL dotazy
    return []
  } catch (error) {
    console.error('Chyba při získávání metrik:', error.message)
    throw error
  }
}

function normalizeCertificate(value) {
  if (!value || typeof value !== 'string') return ''
  // Supports single-line escaped certs in .env:
  // ERP_DB_CA_CERT="-----BEGIN...-----\n...\n-----END..."
  return value.replace(/\\n/g, '\n').trim()
}
