/**
 * SLA do 30 s v pracovní době — důvody nesplnění
 * GET /api/sla30-reasons?brand=&period=&startDate=&endDate=[&reason=<key> → seznam záznamů]
 */

import { queryDaktelaWithRetry } from '@/lib/incoming-line-sla'
import { resolveDaktelaDateRange } from '@/lib/metrics-query'
import { SLA30_REASONS, fetchSla30ReasonItems, fetchSla30Reasons } from '@/lib/sla30-reasons'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'cz'
  const reason = typeof req.query.reason === 'string' ? req.query.reason : ''

  try {
    const { startDate, endDate } = resolveDaktelaDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const query = (sql, params) => queryDaktelaWithRetry(sql, params)

    if (reason) {
      if (!SLA30_REASONS.some((item) => item.key === reason)) {
        return res.status(400).json({ error: 'Neznámý důvod' })
      }
      const items = await fetchSla30ReasonItems(query, { brandId, startDate, endDate, reason })
      return res.status(200).json({ brand: brandId, startDate, endDate, reason, items })
    }

    const data = await fetchSla30Reasons(query, { brandId, startDate, endDate })
    return res.status(200).json({ brand: brandId, startDate, endDate, ...data })
  } catch (error) {
    console.error('sla30-reasons:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba důvodů SLA 30 s' })
  }
}
