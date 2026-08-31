/**
 * Úspěšnost navolání (ERP) — souhrn
 * GET /api/call-success-navolani?period=month&startDate=&endDate=
 */

import { fetchDopadlHovorSummary } from '@/lib/dopadl-hovor-metrics'
import { getPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!getPool()) {
    return res.status(500).json({ error: 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const metrics = await fetchDopadlHovorSummary({ start, end })

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      source: 'erp-db',
      metrics
    })
  } catch (error) {
    console.error('call-success-navolani:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení úspěšnosti navolání' })
  }
}
