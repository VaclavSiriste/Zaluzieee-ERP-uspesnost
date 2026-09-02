/**
 * SLA příchozích linek — detail hovorů / zakázek
 * GET /api/incoming-line-sla-items?metric=all|sla_20s|...&period=month&offset=&limit=
 */

import { lookupOrdersByPhoneKeys, phoneKeyFromClid } from '@/lib/erp-phone-orders'
import { resolveDaktelaDateRange } from '@/lib/metrics-query'
import { resolveOperationsBrand } from '@/lib/operations-brands'
import {
  INCOMING_CALLS_FROM,
  INCOMING_CALLS_WHERE,
  INCOMING_LINE_METRIC_LABELS,
  RESPONSE_SECONDS_SQL,
  SLA_THRESHOLD_SECONDS,
  buildSlaIncomingQueueFilterSql,
  incomingLineMetricFilter,
  queryDaktelaWithRetry
} from '@/lib/incoming-line-sla'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

function mapItem(row, orderMatch = null) {
  const responseSeconds =
    row.response_seconds != null && Number.isFinite(Number(row.response_seconds))
      ? Number(row.response_seconds)
      : null
  const withinSla = row.answered === true && responseSeconds != null && responseSeconds <= SLA_THRESHOLD_SECONDS

  return {
    call_id: row.call_id,
    call_time: row.call_time,
    clid: row.clid || null,
    did: row.did || null,
    answered: row.answered === true,
    response_seconds: responseSeconds,
    wait_time: row.wait_time != null ? Number(row.wait_time) : null,
    ringing_time: row.ringing_time != null ? Number(row.ringing_time) : null,
    duration_seconds: row.duration_seconds != null ? Number(row.duration_seconds) : null,
    within_sla_20s: withinSla,
    operator_id: row.operator_id || null,
    operator_name: row.operator_name || '—',
    queue_id: row.queue_id || null,
    queue_name: row.queue_name || '—',
    order_id: orderMatch?.order_id || null,
    customer_name: orderMatch?.customer_name || null,
    detail_url: orderMatch?.detail_url || null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : ''
  const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : ''
  const metricRaw = typeof req.query.metric === 'string' ? req.query.metric.trim() : 'all'
  const metric = INCOMING_LINE_METRIC_LABELS[metricRaw] ? metricRaw : 'all'
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const brand = resolveOperationsBrand(brandId)
  const queueFilter = buildSlaIncomingQueueFilterSql(brandId)
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  try {
    const { start, end, startDate: rangeStart, endDate: rangeEnd } = resolveDaktelaDateRange({
      startDate,
      endDate,
      period
    })
    const params = [rangeStart, rangeEnd]
    const metricFilter = incomingLineMetricFilter(metric)

    const countSql = `
      SELECT COUNT(*)::int AS total
      ${INCOMING_CALLS_FROM}
      WHERE ${INCOMING_CALLS_WHERE}
        ${queueFilter}
        ${metricFilter}
    `
    const countResult = await queryDaktelaWithRetry(countSql, params)
    const total = Number(countResult.rows[0]?.total) || 0

    const listSql = `
      SELECT
        c.call AS call_id,
        c.call_time,
        c.clid,
        c.did,
        c.answered,
        c.wait_time,
        c.ringing_time,
        c.duration AS duration_seconds,
        (${RESPONSE_SECONDS_SQL})::int AS response_seconds,
        c."user" AS operator_id,
        COALESCE(NULLIF(TRIM(u.title), ''), NULLIF(TRIM(u.name), ''), c."user", 'Neznámý') AS operator_name,
        c.queue AS queue_id,
        COALESCE(NULLIF(TRIM(q.title), ''), NULLIF(TRIM(q.name), ''), c.queue, '—') AS queue_name
      ${INCOMING_CALLS_FROM}
      WHERE ${INCOMING_CALLS_WHERE}
        ${queueFilter}
        ${metricFilter}
      ORDER BY c.call_time DESC NULLS LAST
      LIMIT $3 OFFSET $4
    `
    const listResult = await queryDaktelaWithRetry(listSql, [...params, parsedLimit, parsedOffset])
    const phoneKeys = listResult.rows.map((row) => phoneKeyFromClid(row.clid))
    const orderByPhone = await lookupOrdersByPhoneKeys(phoneKeys)
    const items = listResult.rows.map((row) => {
      const key = phoneKeyFromClid(row.clid)
      return mapItem(row, key ? orderByPhone.get(key) || null : null)
    })

    return res.status(200).json({
      period,
      brand: brand.id,
      sla_line_hint: brand.slaLineHint,
      metric,
      label: INCOMING_LINE_METRIC_LABELS[metric],
      start: start.toISOString(),
      end: end.toISOString(),
      startDate: rangeStart,
      endDate: rangeEnd,
      sla_threshold_seconds: SLA_THRESHOLD_SECONDS,
      total,
      limit: parsedLimit,
      offset: parsedOffset,
      items
    })
  } catch (error) {
    console.error('incoming-line-sla-items:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení detailu SLA příchozích linek' })
  }
}
