/**
 * Úspěšnost navolání (ERP) — souhrn
 * GET /api/call-success-navolani?period=month&startDate=&endDate=
 */

import { fetchDopadlHovorSummary } from '@/lib/dopadl-hovor-metrics'
import { getPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  if (!getPool()) {
    return res.status(500).json({ error: 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)' })
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
