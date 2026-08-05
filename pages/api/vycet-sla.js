/**
 * KPI Výčet SLA
 * - business datum: přišlo / navoláno / chybí / splněno
 * - kalendářní datum (+2h): poptávky / SLA 24·48·72 + %
 */

import { getPool } from '@/lib/db-esm'
import {
  BUSINESS_DATE_SQL,
  CALENDAR_DATE_SQL,
  NAVOLANO_FLAG_SQL,
  SLA24_FLAG_SQL,
  SLA48_FLAG_SQL,
  SLA72_FLAG_SQL,
  SLA_BASE_FILTERS_SQL,
  SLA_POPTAVKY_FILTERS_SQL,
  SLA_POPTAVKY_FROM_SQL,
  formatSlaPercent,
  resolveSlaRange
} from '@/lib/sla-metrics'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getPool()
  if (!pool) {
    return res.status(500).json({ error: 'ERP databáze není dostupná' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'

  try {
    const { start, end } = resolveSlaRange(req.query)

    const [businessResult, calendarResult] = await Promise.all([
      pool.query(
        `
        SELECT
          COUNT(o.id)::int AS leads,
          COALESCE(SUM(${NAVOLANO_FLAG_SQL}), 0)::int AS navolano
        FROM orders o
        WHERE (${BUSINESS_DATE_SQL}) >= $1::date
          AND (${BUSINESS_DATE_SQL}) <= $2::date
          ${SLA_BASE_FILTERS_SQL}
        `,
        [start, end]
      ),
      pool.query(
        `
        SELECT
          COUNT(o.id)::int AS poptavky,
          COALESCE(SUM(${SLA24_FLAG_SQL}), 0)::int AS sla24,
          COALESCE(SUM(${SLA48_FLAG_SQL}), 0)::int AS sla48,
          COALESCE(SUM(${SLA72_FLAG_SQL}), 0)::int AS sla72
        ${SLA_POPTAVKY_FROM_SQL}
        WHERE (${CALENDAR_DATE_SQL}) >= $1::date
          AND (${CALENDAR_DATE_SQL}) <= $2::date
          ${SLA_POPTAVKY_FILTERS_SQL}
        `,
        [start, end]
      )
    ])

    const leads = Number(businessResult.rows[0]?.leads) || 0
    const navolano = Number(businessResult.rows[0]?.navolano) || 0
    const missing = Math.max(leads - navolano, 0)

    const poptavky = Number(calendarResult.rows[0]?.poptavky) || 0
    const sla24 = Number(calendarResult.rows[0]?.sla24) || 0
    const sla48 = Number(calendarResult.rows[0]?.sla48) || 0
    const sla72 = Number(calendarResult.rows[0]?.sla72) || 0

    return res.status(200).json({
      period,
      start: start.toISOString(),
      end: end.toISOString(),
      metrics: {
        leads,
        navolano,
        missing,
        fulfilled_pct: formatSlaPercent(navolano, leads),
        poptavky,
        sla24,
        sla48,
        sla72,
        sla24_pct: formatSlaPercent(sla24, poptavky),
        sla48_pct: formatSlaPercent(sla48, poptavky),
        sla72_pct: formatSlaPercent(sla72, poptavky)
      }
    })
  } catch (error) {
    console.error('vycet-sla:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení SLA' })
  }
}
