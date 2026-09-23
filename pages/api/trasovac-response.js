/**
 * Fronta trasovačů — počet ve stavu + průměr/medián doby do první změny
 * GET /api/trasovac-response?period=month&startDate=&endDate=&brand=cz
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import { fetchTrasovacResponseSummary } from '@/lib/trasovac-response-metrics'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!getPool()) {
    return res.status(500).json({
      error: 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)'
    })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'

  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })

  if (organizationId == null) {
    return res.status(400).json({
      error: 'Chybí organization_id pro zvolenou značku.'
    })
  }

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const metrics = await fetchTrasovacResponseSummary({ start, end, organizationId })

    return res.status(200).json({
      period,
      brand: brandId,
      organization_id: organizationId,
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      source: 'erp-audit-log',
      metrics
    })
  } catch (error) {
    console.error('trasovac-response:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení metriky trasovačů' })
  }
}
