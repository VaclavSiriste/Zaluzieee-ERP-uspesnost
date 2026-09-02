/**
 * Rozpad ERP leadů pro úspěšnost navolání (bez filtru operátora)
 * GET /api/call-success-navolani-orders?metric=dopadl_hovor_ano|dopadl_hovor_ne|dopadl_hovor_pocet&period=&...
 */

import { fetchErpYesNoOrders, isErpYesNoMetric } from '@/lib/dopadl-hovor-metrics'
import { getPool } from '@/lib/db-esm'
import { resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

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
  const operatorName = typeof req.query.operatorName === 'string' ? req.query.operatorName.trim() : ''
  const metric = typeof req.query.metric === 'string' ? req.query.metric : 'dopadl_hovor_pocet'
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  if (
    !isErpYesNoMetric(metric) ||
    (!metric.startsWith('dopadl_hovor_') && !metric.startsWith('domluveno_zamereni_'))
  ) {
    return res.status(400).json({ error: `Neznámá metrika: ${metric}` })
  }

  if (organizationId == null) {
    return res.status(400).json({
      error: 'Chybí organization_id pro zvolenou značku. Doplňte ho v lib/operations-brands.js.'
    })
  }

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const result = await fetchErpYesNoOrders({
      metric,
      start,
      end,
      operatorName: operatorName || undefined,
      organizationId,
      limit: parsedLimit,
      offset: parsedOffset
    })

    return res.status(200).json({
      period,
      brand: brandId,
      organization_id: organizationId,
      metric,
      label: result.label,
      value_alias: result.valueAlias,
      start: start.toISOString(),
      end: end.toISOString(),
      total: result.total,
      limit: parsedLimit,
      offset: parsedOffset,
      orders: result.orders
    })
  } catch (error) {
    console.error('call-success-navolani-orders:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení ERP leadů' })
  }
}
