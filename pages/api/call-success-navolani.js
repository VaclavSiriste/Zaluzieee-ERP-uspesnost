/**
 * Úspěšnost navolání (ERP) — souhrn
 * GET /api/call-success-navolani?period=month&startDate=&endDate=
 */

import { fetchDopadlHovorSummary } from '@/lib/dopadl-hovor-metrics'
import { getPool } from '@/lib/db-esm'
import { resolveDateRange, formatDateOnly } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import {
  fetchOvtSheetMetrics,
  isOvtSheetConfigured,
  resolveOvtSheetBrand
} from '@/lib/ovt-sheet'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'

  // pokladamee / malujemeee: úspěšnost z OVT sheetu (L / K), ne z ERP
  const ovtCfg = resolveOvtSheetBrand(brandId)
  if (ovtCfg) {
    if (!isOvtSheetConfigured(brandId)) {
      return res.status(503).json({
        error: `${brandId} úspěšnost čte Google Sheet (gid=${ovtCfg.gid}). Nastavte ${ovtCfg.envWebappUrl}.`
      })
    }
    try {
      const { start, end } = resolveDateRange({ startDate, endDate, period })
      const rangeStart = formatDateOnly(start)
      const rangeEnd = formatDateOnly(end)
      const data = await fetchOvtSheetMetrics(brandId, {
        startDate: rangeStart,
        endDate: rangeEnd
      })
      return res.status(200).json({
        period,
        brand: brandId,
        organization_id: resolveOrganizationId({ brandId }),
        start: start.toISOString(),
        end: end.toISOString(),
        startDate: rangeStart,
        endDate: rangeEnd,
        source: ovtCfg.source,
        date_basis: 'datum_navolani',
        metrics: data.success,
        technicians: data.technicians,
        targets: data.targets
      })
    } catch (error) {
      console.error(`call-success-navolani (${brandId} sheet):`, error.message)
      return res.status(500).json({ error: error.message || 'Chyba načtení úspěšnosti ze sheetu' })
    }
  }

  if (!getPool()) {
    return res.status(500).json({ error: 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)' })
  }

  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })

  if (organizationId == null) {
    return res.status(400).json({
      error: 'Chybí organization_id pro zvolenou značku. Doplňte ho v lib/operations-brands.js.'
    })
  }

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const metrics = await fetchDopadlHovorSummary({ start, end, organizationId })

    return res.status(200).json({
      period,
      brand: brandId,
      organization_id: organizationId,
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
