/**
 * POST /api/daktela-sync – spustí stahování dat z Daktely do Supabase
 * GET  /api/daktela-sync – stav syncu + čerstvost dat v DB
 */
import { startDaktelaSync, getDaktelaSyncStatus } from '@/lib/daktela-sync'

export default async function handler(req, res) {
  if (req.method === 'GET') {
    try {
      const status = await getDaktelaSyncStatus()
      return res.status(200).json(status)
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Nepodařilo se načíst stav syncu' })
    }
  }

  if (req.method === 'POST') {
    try {
      const result = await startDaktelaSync()
      const status = await getDaktelaSyncStatus()
      return res.status(result.alreadyRunning ? 409 : 200).json({
        ok: true,
        ...result,
        status
      })
    } catch (err) {
      return res.status(500).json({ error: err.message || 'Nepodařilo se spustit synchronizaci' })
    }
  }

  res.setHeader('Allow', 'GET, POST')
  return res.status(405).json({ error: 'Method not allowed' })
}
