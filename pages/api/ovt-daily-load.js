/**
 * Průměrný počet zaměření na OVT za den, po krajích
 * GET /api/ovt-daily-load?brand=cz|sk|venkovky&date=YYYY-MM-DD (výchozí = včera, Europe/Prague)
 */

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

  const rawDate = typeof req.query.date === 'string' ? req.query.date.trim() : ''
  const date = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : yesterdayPrague()

  try {
    const data = await fetchOvtDailyLoad({
      brandId,
      organizationId: resolveOrganizationId({ brandId }),
      date
    })
    return res.status(200).json({ brand: brandId, date, ...data })
  } catch (error) {
    console.error('ovt-daily-load:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení zaměření na OVT' })
  }
}
