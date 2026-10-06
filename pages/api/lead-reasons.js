/**
 * Leady podle důvodu ne hovoru — 3 kategorie + souhrn (koláče na Řízení provozu)
 * GET /api/lead-reasons?brand=cz|sk|malujemeee|pokladamee|venkovky&period=&startDate=&endDate=
 */

import { fetchErpLeadReasonCounts, summarizeLeadReasons } from '@/lib/lead-reasons'
import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import { fetchOvtSheetMetrics, isOvtSheetConfigured, resolveOvtSheetBrand } from '@/lib/ovt-sheet'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' && req.query.brand ? req.query.brand : 'cz'

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'month',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const startDate = formatDateOnly(start)
    const endDate = formatDateOnly(end)

    let counts
    let source
    const ovtCfg = resolveOvtSheetBrand(brandId)
    if (ovtCfg) {
      if (!isOvtSheetConfigured(brandId)) {
        return res.status(503).json({ error: `Chybí ${ovtCfg.envWebappUrl} pro ${brandId}.` })
      }
      const data = await fetchOvtSheetMetrics(brandId, { startDate, endDate })
      counts = data.leadReasons || {}
      source = ovtCfg.source
    } else {
      counts = await fetchErpLeadReasonCounts({
        brandId,
        organizationId: resolveOrganizationId({ brandId }),
        start,
        end
      })
      source = 'erp-db'
    }

    return res.status(200).json({
      brand: brandId,
      startDate,
      endDate,
      source,
      ...summarizeLeadReasons(counts)
    })
  } catch (error) {
    console.error('lead-reasons:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení důvodů leadů' })
  }
}
