/**
 * Časový rozpad SLA
 * GET /api/sla-time-breakdown?kind=incoming|vycet&groupBy=hour|day|month&brand=cz&period=&startDate=&endDate=
 */

import { GROUP_BY, fetchSlaTimeBreakdown } from '@/lib/sla-time-breakdown'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const kind = req.query.kind === 'vycet' ? 'vycet' : 'incoming'
  const groupBy = GROUP_BY.includes(req.query.groupBy) ? req.query.groupBy : 'hour'
  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'cz'

  try {
    const data = await fetchSlaTimeBreakdown({
      kind,
      groupBy,
      brandId,
      query: {
        period: typeof req.query.period === 'string' ? req.query.period : 'month',
        startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
        endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
      }
    })
    return res.status(200).json(data)
  } catch (error) {
    console.error('sla-time-breakdown:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba časového rozpadu SLA' })
  }
}
