/**
 * Konverze po krajích — leady → dopadl hovor → zaměření → zakázka
 * GET /api/region-funnel?brand=cz|sk|venkovky&period=&startDate=&endDate=
 */

import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import { resolveOvtSheetBrand } from '@/lib/ovt-sheet'
import { fetchRegionFunnel } from '@/lib/region-funnel'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'cz'
  if (resolveOvtSheetBrand(brandId)) {
    return res.status(400).json({ error: 'Konverze po krajích je jen pro ERP značky (CZ, SK, Venkovky).' })
  }

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const data = await fetchRegionFunnel({
      brandId,
      organizationId: resolveOrganizationId({ brandId }),
      start,
      end
    })
    return res.status(200).json({
      brand: brandId,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      ...data
    })
  } catch (error) {
    console.error('region-funnel:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba konverze po krajích' })
  }
}
