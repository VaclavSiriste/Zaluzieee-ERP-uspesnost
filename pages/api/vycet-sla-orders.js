/**
 * Drilldown Výčet SLA — seznam leadů
 * metric:
 *   leads|navolano|missing  → business datum
 *   poptavky|sla24|sla48|sla72 → kalendářní datum (+2h)
 */

import { getPool } from '@/lib/db-esm'
import { SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'
import {
  BUSINESS_DATE_SQL,
  CALENDAR_DATE_SQL,
  HOURS_TO_CONTACT_SQL,
  NAVOLANO_FLAG_SQL,
  SLA24_FLAG_SQL,
  SLA48_FLAG_SQL,
  SLA72_FLAG_SQL,
  SLA_BASE_FILTERS_SQL,
  SLA_POPTAVKY_FILTERS_SQL,
  SLA_POPTAVKY_FROM_SQL,
  resolveSlaRange
} from '@/lib/sla-metrics'

const DEFAULT_LIMIT = 50
const MAX_LIMIT = 200

const BUSINESS_METRICS = new Set(['leads', 'navolano', 'missing', 'fulfilled'])
const CALENDAR_METRICS = new Set(['poptavky', 'sla24', 'sla48', 'sla72'])

function resolveMetric(value) {
  if (value === 'fulfilled') return 'navolano'
  if (BUSINESS_METRICS.has(value) || CALENDAR_METRICS.has(value)) return value
  return 'leads'
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getPool()
  if (!pool) {
    return res.status(500).json({ error: 'ERP databáze není dostupná' })
  }

  const metric = resolveMetric(req.query.metric)
  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const useCalendar = CALENDAR_METRICS.has(metric)
  const dateSql = useCalendar ? CALENDAR_DATE_SQL : BUSINESS_DATE_SQL
  const parsedLimit = Math.min(
    Math.max(parseInt(String(req.query.limit || DEFAULT_LIMIT), 10) || DEFAULT_LIMIT, 1),
    MAX_LIMIT
  )
  const parsedOffset = Math.max(parseInt(String(req.query.offset || '0'), 10) || 0, 0)

  try {
    const { start, end } = resolveSlaRange(req.query)

    let metricWhere = ''
    if (metric === 'navolano') metricWhere = `AND (${NAVOLANO_FLAG_SQL}) = 1`
    else if (metric === 'missing') metricWhere = `AND (${NAVOLANO_FLAG_SQL}) = 0`
    else if (metric === 'sla24') metricWhere = `AND (${SLA24_FLAG_SQL}) = 1`
    else if (metric === 'sla48') metricWhere = `AND (${SLA48_FLAG_SQL}) = 1`
    else if (metric === 'sla72') metricWhere = `AND (${SLA72_FLAG_SQL}) = 1`

    const filtersSql = useCalendar ? SLA_POPTAVKY_FILTERS_SQL : SLA_BASE_FILTERS_SQL
    // vždy join customers — seznam ukazuje region; poptávky filtry ho potřebují
    const fromSql = SLA_POPTAVKY_FROM_SQL

    const countResult = await pool.query(
      `
      SELECT COUNT(o.id)::int AS total
      ${fromSql}
      WHERE (${dateSql}) >= $1::date
        AND (${dateSql}) <= $2::date
        ${filtersSql}
        ${metricWhere}
      `,
      [start, end]
    )

    const { rows } = await pool.query(
      `
      SELECT
        o.id AS order_id,
        o.created_at,
        o.first_iframe_change_at,
        o.status,
        COALESCE(NULLIF(TRIM(c.region), ''), 'N/A') AS region,
        (${BUSINESS_DATE_SQL}) AS business_date,
        (${CALENDAR_DATE_SQL}) AS calendar_date,
        (${NAVOLANO_FLAG_SQL})::int AS called_flag,
        (${SLA24_FLAG_SQL})::int AS sla24,
        (${SLA48_FLAG_SQL})::int AS sla48,
        (${SLA72_FLAG_SQL})::int AS sla72,
        (${HOURS_TO_CONTACT_SQL}) AS hours_to_contact,
        (
          SELECT NULLIF(TRIM(ocv.value), '')
          FROM orders_column_values ocv
          JOIN orders_columns oc ON oc.id = ocv.column_id
          WHERE ocv.order_id = o.id
            AND oc.slug = 'id_formulare'
          ORDER BY ocv.id DESC
          LIMIT 1
        ) AS form_id
      ${fromSql}
      WHERE (${dateSql}) >= $1::date
        AND (${dateSql}) <= $2::date
        ${filtersSql}
        ${metricWhere}
      ORDER BY o.created_at DESC
      LIMIT $3 OFFSET $4
      `,
      [start, end, parsedLimit, parsedOffset]
    )

    const labels = {
      leads: 'Přišlo leadů',
      navolano: 'Dnes navoláno',
      missing: 'Dnes chybí',
      poptavky: 'Poptávky',
      sla24: 'SLA 24',
      sla48: 'SLA 48',
      sla72: 'SLA 72'
    }

    return res.status(200).json({
      metric,
      label: labels[metric] || labels.leads,
      mode: useCalendar ? 'calendar' : 'business',
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      total: countResult.rows[0]?.total || 0,
      limit: parsedLimit,
      offset: parsedOffset,
      orders: rows.map((row) => ({
        order_id: row.order_id,
        business_date: row.business_date,
        calendar_date: row.calendar_date,
        created_at: row.created_at,
        first_iframe_change_at: row.first_iframe_change_at,
        called_flag: Number(row.called_flag) || 0,
        sla24: Number(row.sla24) || 0,
        sla48: Number(row.sla48) || 0,
        sla72: Number(row.sla72) || 0,
        hours_to_contact:
          row.hours_to_contact == null ? null : Number(row.hours_to_contact),
        status: row.status,
        region: row.region,
        form_id: row.form_id,
        detail_url: `${SYSTEEEM_ORDER_URL}${row.order_id}`
      }))
    })
  } catch (error) {
    console.error('vycet-sla-orders:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení seznamu SLA' })
  }
}
