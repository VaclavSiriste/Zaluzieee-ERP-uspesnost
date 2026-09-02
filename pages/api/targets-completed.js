/**
 * Splněno targetů z ERP podle data zaměření
 * GET /api/targets-completed?month=2026-01
 */

import {
  fetchTargetsCompletedFromErp
} from '@/lib/targets-completed-erp'
import { buildDefaultRegionCatalog } from '@/lib/czech-regions'
import { getPool } from '@/lib/db-esm'
import { resolveOrganizationId } from '@/lib/operations-brands'
import { monthKeyToDateRange } from '@/lib/targets-storage'

function parseMonthKey(value) {
  const key = String(value || '').trim()
  return /^\d{4}-\d{2}$/.test(key) ? key : null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const monthKey = parseMonthKey(req.query.month)
  if (!monthKey) {
    return res.status(400).json({ error: 'Chybí nebo neplatný parametr month (YYYY-MM)' })
  }

  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })

  if (!getPool()) {
    return res.status(500).json({ error: 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)' })
  }

  try {
    const { startDate, endDate } = monthKeyToDateRange(monthKey)
    const start = new Date(startDate)
    const end = new Date(endDate)
    end.setHours(23, 59, 59, 999)

    const regionCatalog = buildDefaultRegionCatalog()

    const completed = await fetchTargetsCompletedFromErp({
      start,
      end,
      regionCatalog,
      organizationId
    })

    return res.status(200).json({
      month: monthKey,
      brand: brandId,
      organization_id: organizationId,
      start: startDate,
      end: endDate,
      source: completed.source,
      completed: {
        technicians: completed.technicians,
        regions: completed.regions
      },
      details: {
        technicians_by_name: completed.technicians_by_name,
        regions_by_name: completed.regions_by_name
      },
      totals: {
        technicians: Object.values(completed.technicians).reduce((sum, n) => sum + Number(n || 0), 0),
        regions: Object.values(completed.regions).reduce((sum, n) => sum + Number(n || 0), 0)
      }
    })
  } catch (error) {
    console.error('targets-completed:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení splněno z ERP' })
  }
}
