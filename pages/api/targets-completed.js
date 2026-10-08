/**
 * Splněno targetů z ERP podle data zaměření
 * GET /api/targets-completed?month=2026-01
 * GET /api/targets-completed?fromMonth=2026-01&toMonth=2026-09  → zpětný přehled po měsících
 */

import {
  fetchTargetsCompletedByMonthFromErp,
  fetchTargetsCompletedFromErp
} from '@/lib/targets-completed-erp'
import { getErpPool } from '@/lib/db-esm'
import { resolveOrganizationId } from '@/lib/operations-brands'
import {
  listMonthKeysInRange,
  monthKeyToDateRange,
  resolveRegionCatalogForBrand
} from '@/lib/targets-storage'

/** Panel targetů se načítá na každé stránce Řízení provozu (CZ i SK) — krátká cache šetří ERP. */
const CACHE_TTL_MS = 5 * 60 * 1000
const cache = new Map()

async function cached(key, load) {
  const hit = cache.get(key)
  if (hit && hit.expires > Date.now()) return hit.promise
  const promise = load()
  cache.set(key, { promise, expires: Date.now() + CACHE_TTL_MS })
  promise.catch(() => cache.delete(key))
  return promise
}

function parseMonthKey(value) {
  const key = String(value || '').trim()
  return /^\d{4}-\d{2}$/.test(key) ? key : null
}

function toDateRange(fromKey, toKey) {
  const start = new Date(monthKeyToDateRange(fromKey).startDate)
  const { endDate } = monthKeyToDateRange(toKey)
  const end = new Date(endDate)
  end.setHours(23, 59, 59, 999)
  return { start, end, startDate: monthKeyToDateRange(fromKey).startDate, endDate }
}

function sumValues(map) {
  return Object.values(map).reduce((sum, n) => sum + Number(n || 0), 0)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const monthKey = parseMonthKey(req.query.month)
  const fromMonth = parseMonthKey(req.query.fromMonth)
  const toMonth = parseMonthKey(req.query.toMonth)
  if (!monthKey && !(fromMonth && toMonth)) {
    return res
      .status(400)
      .json({ error: 'Chybí nebo neplatný parametr month (YYYY-MM), případně fromMonth + toMonth' })
  }

  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const organizationId = resolveOrganizationId({
    brandId,
    organizationId: req.query.organizationId
  })

  if (!getErpPool(brandId)) {
    return res.status(500).json({
      error:
        brandId === 'sk'
          ? 'SK ERP databáze není dostupná (chybí ERP_SK_DB_CONNECTION_STRING)'
          : 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)'
    })
  }

  const regionCatalog = resolveRegionCatalogForBrand(brandId)

  try {
    if (!monthKey) {
      const monthKeys = listMonthKeysInRange(fromMonth, toMonth)
      const range = toDateRange(monthKeys[0], monthKeys[monthKeys.length - 1])
      const result = await cached(`range|${brandId}|${organizationId}|${range.startDate}|${range.endDate}`, () =>
        fetchTargetsCompletedByMonthFromErp({
          start: range.start,
          end: range.end,
          regionCatalog,
          organizationId,
          brandId
        })
      )
      const months = monthKeys.map((key) => {
        const month = result.months[key]
        return {
          month: key,
          total: month?.total || 0,
          technicians: month?.technicians || {},
          regions: month?.regions || {}
        }
      })
      return res.status(200).json({
        brand: brandId,
        organization_id: organizationId,
        start: range.startDate,
        end: range.endDate,
        source: result.source,
        months
      })
    }

    const range = toDateRange(monthKey, monthKey)
    const completed = await cached(`month|${brandId}|${organizationId}|${monthKey}`, () =>
      fetchTargetsCompletedFromErp({
        start: range.start,
        end: range.end,
        regionCatalog,
        organizationId,
        brandId
      })
    )

    return res.status(200).json({
      month: monthKey,
      brand: brandId,
      organization_id: organizationId,
      start: range.startDate,
      end: range.endDate,
      source: completed.source,
      completed: {
        total: completed.total,
        technicians: completed.technicians,
        regions: completed.regions
      },
      details: {
        technicians_by_name: completed.technicians_by_name,
        regions_by_name: completed.regions_by_name
      },
      totals: {
        all: completed.total,
        technicians: sumValues(completed.technicians),
        regions: sumValues(completed.regions)
      }
    })
  } catch (error) {
    console.error('targets-completed:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení splněno z ERP' })
  }
}
