/**
 * KPI Výčet SLA
 * - ERP značky: business datum + kalendářní SLA 24/48/72
 * - OVT sheet (pokladamee / malujemeee): B = přijetí leadu, K = datum navolání
 */

import { getPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { resolveOrganizationId } from '@/lib/operations-brands'
import {
  fetchOvtSheetMetrics,
  isOvtSheetConfigured,
  resolveOvtSheetBrand
} from '@/lib/ovt-sheet'
import {
  BUSINESS_DATE_SQL,
  CALENDAR_DATE_SQL,
  NAVOLANO_FLAG_SQL,
  SLA24_FLAG_SQL,
  SLA48_FLAG_SQL,
  SLA72_FLAG_SQL,
  SLA_BASE_FILTERS_SQL,
  SLA_POPTAVKY_FROM_SQL,
  appendOrganizationFilter,
  buildSlaPoptavkyFiltersSql,
  formatSlaPercent,
  resolveSlaRange,
  shouldExcludeVenkovkyReason
} from '@/lib/sla-metrics'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const period = typeof req.query.period === 'string' ? req.query.period : 'month'
  const brandId = typeof req.query.brand === 'string' ? req.query.brand : ''
  const ovtCfg = resolveOvtSheetBrand(brandId)

  if (ovtCfg) {
    if (!isOvtSheetConfigured(brandId)) {
      return res.status(503).json({
        error: `${brandId} Výčet SLA čte Google Sheet. Nastavte ${ovtCfg.envWebappUrl}.`
      })
    }
    try {
      const { start, end } = resolveSlaRange(req.query)
      const rangeStart = formatDateOnly(start)
      const rangeEnd = formatDateOnly(end)
      const data = await fetchOvtSheetMetrics(brandId, {
        startDate: rangeStart,
        endDate: rangeEnd
      })
      if (!data.vycetSla) {
        return res.status(500).json({
          error: 'Sheet nevrátil Výčet SLA (zkuste mode=raw / přenačíst Apps Script).'
        })
      }
      return res.status(200).json({
        period,
        brand: brandId || null,
        organization_id: resolveOrganizationId({ brandId }),
        start: start.toISOString(),
        end: end.toISOString(),
        startDate: rangeStart,
        endDate: rangeEnd,
        source: ovtCfg.source,
        metrics: data.vycetSla
      })
    } catch (error) {
      console.error(`vycet-sla (${brandId} sheet):`, error.message)
      return res.status(500).json({ error: error.message || 'Chyba načtení Výčtu SLA ze sheetu' })
    }
  }

  const pool = getPool()
  if (!pool) {
    return res.status(500).json({ error: 'ERP databáze není dostupná' })
  }

  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })
  const requireBrand =
    Boolean(brandId) ||
    (req.query.organizationId != null && String(req.query.organizationId).trim() !== '')

  if (requireBrand && organizationId == null) {
    return res.status(400).json({
      error:
        'Chybí organization_id (company ID) pro zvolenou značku. Doplňte ho v lib/operations-brands.js.'
    })
  }

  try {
    const { start, end } = resolveSlaRange(req.query)
    const excludeVenkovky = shouldExcludeVenkovkyReason(organizationId, brandId)
    const poptavkyFilters = buildSlaPoptavkyFiltersSql({
      excludeVenkovkyReason: excludeVenkovky
    })

    const businessBase = appendOrganizationFilter([start, end], organizationId)
    const calendarBase = appendOrganizationFilter([start, end], organizationId)

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
          ${businessBase.sql}
        `,
        businessBase.params
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
          ${poptavkyFilters}
          ${calendarBase.sql}
        `,
        calendarBase.params
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
      brand: brandId || null,
      organization_id: organizationId,
      start: start.toISOString(),
      end: end.toISOString(),
      source: 'erp-db',
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
