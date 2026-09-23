/**
 * Seznam leadů fronty trasovačů
 * GET /api/trasovac-response-orders?metric=waiting|with_response|entered|avg|median&period=&brand=cz
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly, resolveDateRange } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import {
  fetchTrasovacResponseOrders,
  TRASOVAC_ORDER_METRICS
} from '@/lib/trasovac-response-metrics'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

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
  const metric = typeof req.query.metric === 'string' ? req.query.metric : 'with_response'

  if (!TRASOVAC_ORDER_METRICS[metric]) {
    return res.status(400).json({
      error: `Neznámá metrika: ${metric}. Povolené: ${Object.keys(TRASOVAC_ORDER_METRICS).join(', ')}`
    })
  }

  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })

  if (organizationId == null) {
    return res.status(400).json({ error: 'Chybí organization_id pro zvolenou značku.' })
  }

  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)
  const duvodReason =
    typeof req.query.duvodReason === 'string' && req.query.duvodReason.trim()
      ? req.query.duvodReason.trim()
      : null

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const result = await fetchTrasovacResponseOrders({
      metric,
      start,
      end,
      organizationId,
      duvodReason,
      limit: parsedLimit,
      offset: parsedOffset
    })

    return res.status(200).json({
      period,
      brand: brandId,
      organization_id: organizationId,
      metric,
      duvod_reason: result.duvod_reason || null,
      label: result.label,
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      total: result.total,
      limit: parsedLimit,
      offset: parsedOffset,
      orders: result.orders
    })
  } catch (error) {
    console.error('trasovac-response-orders:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení leadů trasovačů' })
  }
}
