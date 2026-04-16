/**
 * Test databázového připojení
 * GET /api/db-test
 */

import { testConnection } from '@/lib/db-esm'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  try {
    console.log('🔍 Testování databázového připojení...')
    const connectionOk = await testConnection()
    
    if (connectionOk) {
      return res.status(200).json({
        status: 'connected',
        message: '✅ Databáze je připojena a dostupná',
        timestamp: new Date().toISOString()
      })
    } else {
      return res.status(500).json({
        status: 'failed',
        message: '❌ Nepodařilo se připojit k databázi - zkontrolujte credentials a certifikát',
        timestamp: new Date().toISOString()
      })
    }
  } catch (error) {
    console.error('❌ Chyba:', error.message)
    return res.status(500).json({
      status: 'error',
      message: `Chyba připojení: ${error.message}`,
      timestamp: new Date().toISOString()
    })
  }
}
