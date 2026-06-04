/**
 * Test databázového připojení
 * GET /api/db-test
 * GET /api/db-test?db=erp|daktela|all  (výchozí: erp)
 */

import { testConnection, testDaktelaConnection, testAllConnections } from '@/lib/db-esm'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const target = String(req.query.db || 'erp').toLowerCase()

  try {
    if (target === 'all') {
      const results = await testAllConnections()
      const ok = results.erp.ok && results.daktela.ok
      return res.status(ok ? 200 : 500).json({
        status: ok ? 'connected' : 'partial',
        results,
        timestamp: new Date().toISOString()
      })
    }

    if (target === 'daktela') {
      const connectionOk = await testDaktelaConnection()
      return res.status(connectionOk ? 200 : 500).json({
        status: connectionOk ? 'connected' : 'failed',
        database: 'daktela',
        message: connectionOk
          ? '✅ Daktela databáze je připojena'
          : '❌ Nepodařilo se připojit k Daktela databázi',
        timestamp: new Date().toISOString()
      })
    }

    const connectionOk = await testConnection()
    return res.status(connectionOk ? 200 : 500).json({
      status: connectionOk ? 'connected' : 'failed',
      database: 'erp',
      message: connectionOk
        ? '✅ ERP databáze je připojena'
        : '❌ Nepodařilo se připojit k ERP databázi',
      timestamp: new Date().toISOString()
    })
  } catch (error) {
    console.error('❌ Chyba:', error.message)
    return res.status(500).json({
      status: 'error',
      message: `Chyba připojení: ${error.message}`,
      timestamp: new Date().toISOString()
    })
  }
}
