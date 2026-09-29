/**
 * Databázové připojení a utility funkce (ES6 modul)
 * ERP (Systeeem DWH) + Daktela (Supabase)
 */

import pg from 'pg'
import dotenv from 'dotenv'

dotenv.config()

const { Pool } = pg

const pools = {
  erp: null,
  erpSk: null,
  daktela: null
}

/**
 * SK Systeeem (Railway): tabulky order_columns / order_column_values
 * (CZ DWH má orders_columns / orders_column_values).
 * first_iframe_change_at je na SK téměř prázdný → fallback first_status_change_at.
 * id_formulare se na SK nepoužívá → vypnout Looker filtr EXISTS.
 */
function rewriteSkErpSql(sql) {
  if (typeof sql !== 'string') return sql
  return sql
    .replace(
      /AND EXISTS \(\s*SELECT 1\s*FROM orders_column_values ocv_f\s*JOIN orders_columns oc_f ON oc_f\.id = ocv_f\.column_id\s*WHERE ocv_f\.order_id = o\.id\s*AND oc_f\.slug = 'id_formulare'\s*AND NULLIF\(TRIM\(ocv_f\.value\), ''\) IS NOT NULL\s*\)/gi,
      ''
    )
    .replace(/\borders_column_values\b/g, 'order_column_values')
    .replace(/\borders_columns\b/g, 'order_columns')
    .replace(/\bo\.first_iframe_change_at\b/g, 'COALESCE(o.first_iframe_change_at, o.first_status_change_at)')
    .replace(/\bo\.organization_id\b/g, 'NULL::bigint AS organization_id')
}

function wrapPoolQuery(pool, rewriteSql) {
  if (!pool) return null
  return {
    query(text, params) {
      return pool.query(rewriteSql(text), params)
    },
    connect(...args) {
      return pool.connect(...args)
    },
    end(...args) {
      return pool.end(...args)
    },
    on(...args) {
      return pool.on(...args)
    }
  }
}

const DAKTELA_PRIMARY_HOST = 'aws-1-eu-central-1.pooler.supabase.com'
const DAKTELA_FALLBACK_HOST = 'pool-tcp-euc11-e767a54-7ef9d74ec10d99db.elb.eu-central-1.amazonaws.com'
const DAKTELA_FALLBACK_IPS = ['3.71.225.44', '18.196.8.182', '3.65.151.229']
let daktelaMode = 0

function appendQueryParam(connectionString, key, value) {
  const sep = connectionString.includes('?') ? '&' : '?'
  return `${connectionString}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

function buildDaktelaConnectionString() {
  const primary = process.env.DAKTELA_DB_CONNECTION_STRING || ''
  const fallbackHost = primary.includes(DAKTELA_PRIMARY_HOST)
    ? primary.replace(DAKTELA_PRIMARY_HOST, DAKTELA_FALLBACK_HOST)
    : primary

  // 0: primární DNS, 1: fallback DNS, 2..N: fallback DNS + hostaddr IP
  if (daktelaMode === 0) return { connectionString: primary, label: 'Daktela' }
  if (daktelaMode === 1) return { connectionString: fallbackHost, label: 'Daktela fallback DNS' }

  const ipIndex = Math.max(0, Math.min(DAKTELA_FALLBACK_IPS.length - 1, daktelaMode - 2))
  const hostaddr = DAKTELA_FALLBACK_IPS[ipIndex]
  return {
    connectionString: appendQueryParam(fallbackHost, 'hostaddr', hostaddr),
    label: `Daktela fallback IP ${hostaddr}`
  }
}

function normalizeCertificate(value) {
  if (!value || typeof value !== 'string') return ''
  return value.replace(/\\n/g, '\n').trim()
}

function resolveSsl({ caCert, requireSsl }) {
  if (caCert && caCert.includes('END CERTIFICATE')) {
    return { rejectUnauthorized: true, ca: caCert }
  }
  if (requireSsl) {
    return { rejectUnauthorized: false }
  }
  return false
}

function createPool({ connectionString, caCert, requireSsl, label }) {
  if (!connectionString) {
    console.error(`❌ Chyba: connection string pro ${label} není nastavena v .env`)
    return null
  }

  console.log(`🔌 Připojování k databázi (${label})...`)
  console.log('URL:', connectionString.split('@')[1] || 'skryto')

  const ssl = resolveSsl({ caCert, requireSsl })
  const instance = new Pool({ connectionString, ssl })

  instance.on('error', (err) => {
    console.error(`❌ Chyba v pool (${label}):`, err.message)
  })

  instance.on('connect', () => {
    console.log(`✅ Klient připojen (${label})`)
  })

  return instance
}

/**
 * Pool ERP / Systeeem DWH (CZ)
 */
export function getPool() {
  if (!pools.erp) {
    pools.erp = createPool({
      connectionString: process.env.ERP_DB_CONNECTION_STRING,
      caCert: normalizeCertificate(process.env.ERP_DB_CA_CERT),
      requireSsl: Boolean(process.env.ERP_DB_CONNECTION_STRING),
      label: 'ERP'
    })
  }
  return pools.erp
}

/**
 * Pool SK Systeeem (Railway reporting_ro)
 */
export function getSkPool() {
  if (!pools.erpSk) {
    const raw = createPool({
      connectionString: process.env.ERP_SK_DB_CONNECTION_STRING,
      caCert: normalizeCertificate(process.env.ERP_SK_DB_CA_CERT),
      requireSsl:
        process.env.ERP_SK_DB_SSL !== 'false' &&
        Boolean(process.env.ERP_SK_DB_CONNECTION_STRING),
      label: 'ERP SK'
    })
    pools.erpSk = wrapPoolQuery(raw, rewriteSkErpSql)
  }
  return pools.erpSk
}

/**
 * ERP pool podle značky — sk → Railway, jinak CZ DWH.
 */
export function getErpPool(brandId) {
  if (String(brandId || '').toLowerCase() === 'sk') {
    return getSkPool()
  }
  return getPool()
}

/**
 * Pool Daktela (Supabase)
 */
export function getDaktelaPool() {
  if (!pools.daktela) {
    const requireSsl =
      process.env.DAKTELA_DB_SSL !== 'false' &&
      Boolean(process.env.DAKTELA_DB_CONNECTION_STRING)
    const { connectionString, label } = buildDaktelaConnectionString()

    pools.daktela = createPool({
      connectionString,
      caCert: normalizeCertificate(process.env.DAKTELA_DB_CA_CERT),
      requireSsl,
      label
    })
  }
  return pools.daktela
}

export async function resetDaktelaPool({ useFallbackOnNext = false } = {}) {
  if (pools.daktela) {
    try {
      await pools.daktela.end()
    } catch (error) {
      console.warn('⚠️ Nepodařilo se korektně ukončit Daktela pool:', error.message)
    }
  }
  pools.daktela = null
  if (useFallbackOnNext) {
    daktelaMode = Math.min(daktelaMode + 1, 1 + DAKTELA_FALLBACK_IPS.length)
  }
  return getDaktelaPool()
}

async function pingPool(pool, label) {
  if (!pool) {
    return { label, ok: false, error: 'Pool není inicializován (chybí connection string)' }
  }
  try {
    const result = await pool.query('SELECT NOW() AS current_time')
    return { label, ok: true, current_time: result.rows[0]?.current_time }
  } catch (error) {
    return { label, ok: false, error: error.message }
  }
}

/**
 * Test ERP připojení
 */
export async function testConnection() {
  const result = await pingPool(getPool(), 'ERP')
  if (result.ok) {
    console.log('✅ ERP databáze připojena:', result.current_time)
  } else {
    console.error('❌ ERP připojení:', result.error)
  }
  return result.ok
}

/**
 * Test Daktela připojení
 */
export async function testDaktelaConnection() {
  const result = await pingPool(getDaktelaPool(), 'Daktela')
  if (result.ok) {
    console.log('✅ Daktela databáze připojena:', result.current_time)
  } else {
    console.error('❌ Daktela připojení:', result.error)
  }
  return result.ok
}

/**
 * Test obou databází najednou
 */
export async function testAllConnections() {
  const [erp, daktela] = await Promise.all([
    pingPool(getPool(), 'ERP'),
    pingPool(getDaktelaPool(), 'Daktela')
  ])
  return { erp, daktela }
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
    return []
  } catch (error) {
    console.error('Chyba při získávání metrik:', error.message)
    throw error
  }
}
