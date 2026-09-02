/**
 * SLA příchozích linek (Daktela) — souhrn
 * GET /api/incoming-line-sla?period=month&startDate=&endDate=
 */

import { resolveDaktelaDateRange } from '@/lib/metrics-query'
import { resolveOperationsBrand } from '@/lib/operations-brands'
import {
  buildIncomingLineSummarySql,
  fetchQueueBreakdown,
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
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const brand = resolveOperationsBrand(brandId)

  try {
    const { start, end, startDate: rangeStart, endDate: rangeEnd } = resolveDaktelaDateRange({
      startDate,
      endDate,
      period
    })
    const result = await queryDaktelaWithRetry(buildIncomingLineSummarySql({ brandId }), [
      rangeStart,
      rangeEnd
    ])
    const metrics = normalizeIncomingLineSummary(result.rows[0] || {})
    const queueBreakdown = await fetchQueueBreakdown({
      brandId,
      startDate: rangeStart,
      endDate: rangeEnd
    })

    return res.status(200).json({
      period,
      brand: brand.id,
      sla_line_hint: brand.slaLineHint,
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: rangeStart,
      endDate: rangeEnd,
      sla_threshold_seconds: SLA_THRESHOLD_SECONDS,
      metrics: {
        ...metrics,
        ...(queueBreakdown ? { queue_breakdown: queueBreakdown } : {})
      }
    })
  } catch (error) {
    console.error('incoming-line-sla:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení SLA příchozích linek' })
  }
}
