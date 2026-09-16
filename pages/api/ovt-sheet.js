/**
 * OVT sheet (pokladamee / malujemeee)
 * GET /api/ovt-sheet?brand=pokladamee|malujemeee&period=&startDate=&endDate=
 */

import { resolveDateRange, formatDateOnly } from '@/lib/metrics-query'
import {
  fetchOvtSheetMetrics,
  isOvtSheetConfigured,
  resolveOvtSheetBrand
} from '@/lib/ovt-sheet'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId =
    typeof req.query.brand === 'string' ? req.query.brand.trim().toLowerCase() : 'pokladamee'
  const cfg = resolveOvtSheetBrand(brandId)
  if (!cfg) {
    return res.status(400).json({ error: `Neznámá OVT značka: ${brandId}` })
  }

  if (!isOvtSheetConfigured(brandId)) {
    return res.status(503).json({
      error: `Sheet není napojený. Nastavte ${cfg.envWebappUrl} (+ token).`,
      sheet: {
        spreadsheetId: cfg.spreadsheetId,
        gid: cfg.gid,
        sheetNameFallback: cfg.sheetNameFallback
      }
    })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''

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
      sheet: cfg.sheetNameFallback,
      spreadsheet_id: cfg.spreadsheetId,
      gid: cfg.gid,
      startDate: rangeStart,
      endDate: rangeEnd,
      date_basis: 'datum_navolani',
      fetch_source: data.fetch_source,
      technicians: data.technicians,
      metrics: data.success,
      targets: data.targets,
      source: cfg.source
    })
  } catch (error) {
    console.error('ovt-sheet:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení OVT sheetu' })
  }
}
