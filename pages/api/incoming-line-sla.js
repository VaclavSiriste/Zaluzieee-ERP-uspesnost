/**
 * SLA příchozích linek (Daktela) — souhrn
 * GET /api/incoming-line-sla?period=month&startDate=&endDate=
 */

import { resolveDateRange } from '@/lib/metrics-query'
import {
  buildIncomingLineSummarySql,
  normalizeIncomingLineSummary,
  queryDaktelaWithRetry,
  SLA_THRESHOLD_SECONDS
} from '@/lib/incoming-line-sla'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const result = await queryDaktelaWithRetry(buildIncomingLineSummarySql(), [start, end])
    const metrics = normalizeIncomingLineSummary(result.rows[0] || {})

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      sla_threshold_seconds: SLA_THRESHOLD_SECONDS,
      metrics
    })
  } catch (error) {
    console.error('incoming-line-sla:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení SLA příchozích linek' })
  }
}
