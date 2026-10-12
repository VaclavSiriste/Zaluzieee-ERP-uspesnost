/**
 * Průměrný počet zaměření na OVT za pracovní den
 * GET /api/ovt-daily-load?brand=cz|sk|venkovky&period=&startDate=&endDate=
 * Konec období se omezí na včerejšek (dnešní den ještě není uzavřený).
 */

import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import { fetchOvtDailyLoad } from '@/lib/ovt-daily-load'
import { resolveOvtSheetBrand } from '@/lib/ovt-sheet'

function yesterdayPrague() {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'cz'
  if (resolveOvtSheetBrand(brandId)) {
    return res.status(400).json({ error: 'Zaměření na OVT je jen pro ERP značky (CZ, SK, Venkovky).' })
  }

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const yesterday = yesterdayPrague()
    const startDay = formatDateOnly(start)
    const endDay = formatDateOnly(end) > yesterday ? yesterday : formatDateOnly(end)

    if (startDay > endDay) {
      return res.status(200).json({
        brand: brandId,
        startDate: startDay,
        endDate: endDay,
        working_days: 0,
        regions: [],
        totals: { id: 'total', name: 'Celkem', zamereni: 0, bez_ovt: 0, ovt_count: 0, avg_per_ovt_day: null, ovt: [] }
      })
    }

    const data = await fetchOvtDailyLoad({
      brandId,
      organizationId: resolveOrganizationId({ brandId }),
      startDay,
      endDay
    })
    return res.status(200).json({ brand: brandId, startDate: startDay, endDate: endDay, ...data })
  } catch (error) {
    console.error('ovt-daily-load:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení zaměření na OVT' })
  }
}
