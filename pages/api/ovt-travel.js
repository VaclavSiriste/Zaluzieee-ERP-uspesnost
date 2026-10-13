/**
 * Přejezdy OVT z kalendáře ERP po krajích (plánovaný čas)
 * GET /api/ovt-travel?brand=sk&period=&startDate=&endDate=
 */

import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'
import { fetchOvtTravel } from '@/lib/ovt-travel'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'sk'
  if (!OPERATIONS_BRANDS[brandId]?.showOvtTravel) {
    return res.status(400).json({ error: 'Přejezdy OVT jsou zatím jen pro zaluzieee SK.' })
  }

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const data = await fetchOvtTravel({ brandId, start, end })
    return res.status(200).json({
      brand: brandId,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      ...data
    })
  } catch (error) {
    console.error('ovt-travel:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení přejezdů OVT' })
  }
}
