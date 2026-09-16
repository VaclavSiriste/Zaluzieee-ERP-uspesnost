/**
 * Pokladamee OVT sheet — technici (Q) + úspěšnost (L/K) + targety (P datum zaměření)
 * GET /api/pokladamee-ovt-sheet?period=&startDate=&endDate=
 */

import { resolveDateRange, formatDateOnly } from '@/lib/metrics-query'
import {
  fetchPokladameeOvtMetrics,
  isPokladameeOvtSheetConfigured,
  POKLADAMEE_OVT_SHEET
} from '@/lib/pokladamee-ovt-sheet'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!isPokladameeOvtSheetConfigured()) {
    return res.status(503).json({
      error:
        'Sheet není napojený. Nastavte POKLADAMEE_OVT_SHEET_WEBAPP_URL (+ token) podle scripts/google-apps-script-pokladamee-ovt.gs',
      sheet: POKLADAMEE_OVT_SHEET
    })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const rangeStart = formatDateOnly(start)
    const rangeEnd = formatDateOnly(end)
    const data = await fetchPokladameeOvtMetrics({
      startDate: rangeStart,
      endDate: rangeEnd
    })

    return res.status(200).json({
      period,
      brand: 'pokladamee',
      sheet: POKLADAMEE_OVT_SHEET.sheetNameFallback,
      spreadsheet_id: POKLADAMEE_OVT_SHEET.spreadsheetId,
      gid: POKLADAMEE_OVT_SHEET.gid,
      startDate: rangeStart,
      endDate: rangeEnd,
      date_basis: 'datum_navolani',
      fetch_source: data.fetch_source,
      technicians: data.technicians,
      metrics: data.success,
      targets: data.targets,
      source: 'pokladamee-ovt-sheet'
    })
  } catch (error) {
    console.error('pokladamee-ovt-sheet:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení OVT sheetu' })
  }
}
