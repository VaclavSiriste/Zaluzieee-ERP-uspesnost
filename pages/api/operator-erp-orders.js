/**
 * Rozpad ERP leadů pro metriky Dopadl hovor / Domluveno zaměření / Počet chyb
 * GET /api/operator-erp-orders?metric=dopadl_hovor_ano|pocet_chyb&operatorName=&period=&...
 */

import { fetchErpYesNoOrders, isErpYesNoMetric } from '@/lib/dopadl-hovor-metrics'
import { resolveDateRange } from '@/lib/metrics-query'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
  const operatorName = typeof req.query.operatorName === 'string' ? req.query.operatorName.trim() : ''
  const metric = typeof req.query.metric === 'string' ? req.query.metric : 'dopadl_hovor_ano'
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  if (!operatorName) {
    return res.status(400).json({ error: 'Chybí operatorName' })
  }
  if (!isErpYesNoMetric(metric)) {
    return res.status(400).json({ error: `Neznámá metrika: ${metric}` })
  }

  try {
    const { start, end } = resolveDateRange({ startDate, endDate, period })
    const result = await fetchErpYesNoOrders({
      metric,
      start,
      end,
      operatorName,
      limit: parsedLimit,
      offset: parsedOffset
    })

    return res.status(200).json({
      period,
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
    console.error('operator-erp-orders:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení ERP leadů' })
  }
}
