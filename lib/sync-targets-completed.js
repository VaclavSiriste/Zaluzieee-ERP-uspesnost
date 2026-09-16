import { mapErpCompletedToBucket, mergeErpCompletedIntoBucket } from '@/lib/targets-completed-merge'
import { monthKeyToDateRange, writeMonthBucket } from '@/lib/targets-storage'
import { sortTechnicians, technicianId } from '@/lib/technician-targets'

export async function syncTargetsCompletedFromErp(monthKey, bucket, { organizationId = null, brandId = 'cz' } = {}) {
  const params = new URLSearchParams({ month: monthKey })
  if (organizationId != null) {
    params.set('organizationId', String(organizationId))
  }
  if (brandId) {
    params.set('brand', String(brandId))
  }

  const response = await fetch(`/api/targets-completed?${params}`)
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }

  const mapped = mapErpCompletedToBucket(data, bucket)
  const merged = mergeErpCompletedIntoBucket(bucket, mapped)
  writeMonthBucket(monthKey, merged, brandId)
  return { bucket: merged, meta: data }
}

/**
 * pokladamee: technici ze sloupce Q, Splněno = počet řádků s Datum zaměření (P) v měsíci.
 */
export async function syncTargetsCompletedFromOvtSheet(monthKey, bucket, { brandId = 'pokladamee' } = {}) {
  const { startDate, endDate } = monthKeyToDateRange(monthKey)
  const params = new URLSearchParams({
    period: 'custom',
    startDate,
    endDate
  })
  const response = await fetch(`/api/pokladamee-ovt-sheet?${params}`)
  const data = await response.json()
  if (!response.ok || data.error) {
    throw new Error(data.error || `HTTP ${response.status}`)
  }

  const sheetTechs = (Array.isArray(data.technicians) ? data.technicians : [])
    .map((item) => ({
      id: item.id || technicianId(item.name),
      name: String(item.name || '').trim()
    }))
    .filter((item) => item.id && item.name)

  const catalog = sortTechnicians(sheetTechs)
  const activeIds = catalog.map((item) => item.id)
  const prevValues = bucket?.technicians?.values || {}
  const values = {}
  for (const tech of catalog) {
    if (prevValues[tech.id] != null) values[tech.id] = prevValues[tech.id]
  }

  const targets = data.targets || {}
  const completed = targets.completed || {}
  const withCatalog = {
    ...bucket,
    technicians: {
      ...(bucket?.technicians || {}),
      catalog,
      activeIds,
      values,
      completed: bucket?.technicians?.completed || {}
    }
  }

  const mapped = {
    total: Number(completed.total) || 0,
    technicians: completed.technicians || {},
    regions: completed.regions || {}
  }
  const merged = mergeErpCompletedIntoBucket(withCatalog, mapped)
  writeMonthBucket(monthKey, merged, brandId)
  return { bucket: merged, meta: data }
}
