import { buildDefaultRegionCatalog, resolveErpRegionId } from '@/lib/czech-regions'
import { normalizeOperatorKey } from '@/lib/normalize-operator'

function mapTechniciansFromErp(data, catalog) {
  const technicians = {}
  const techByKey = new Map(catalog.map((item) => [normalizeOperatorKey(item.name), item.id]))

  for (const row of data.details?.technicians_by_name || []) {
    const id = techByKey.get(normalizeOperatorKey(row.name)) || row.technician_id
    if (!id) continue
    technicians[id] = (technicians[id] || 0) + (Number(row.count) || 0)
  }

  if (!Object.keys(technicians).length) {
    for (const [id, count] of Object.entries(data.completed?.technicians || {})) {
      technicians[id] = Number(count) || 0
    }
  }

  return technicians
}

function mapRegionsFromErp(data, catalog) {
  const canonicalCatalog = buildDefaultRegionCatalog()
  const regions = {}

  for (const row of data.details?.regions_by_name || []) {
    if (!row.region || row.region === 'N/A') continue
    const id = resolveErpRegionId(row.region, canonicalCatalog)
    if (!id) continue
    regions[id] = (regions[id] || 0) + (Number(row.count) || 0)
  }

  for (const [serverId, count] of Object.entries(data.completed?.regions || {})) {
    const fromServer = resolveErpRegionId(serverId, canonicalCatalog)
    const def = canonicalCatalog.find((item) => item.id === serverId)
    const id =
      fromServer ||
      (def ? resolveErpRegionId(def.name, canonicalCatalog) : null) ||
      (catalog.some((item) => item.id === serverId) ? serverId : null)
    if (!id) continue
    if (regions[id] == null) {
      regions[id] = Number(count) || 0
    }
  }

  return regions
}

export function mergeErpCompletedIntoBucket(bucket, erpCompleted) {
  if (!bucket || !erpCompleted) return bucket

  const techCompleted = { ...(bucket.technicians?.completed || {}) }
  const regionCompleted = { ...(bucket.regions?.completed || {}) }

  for (const [id, count] of Object.entries(erpCompleted.technicians || {})) {
    techCompleted[id] = String(count)
  }
  for (const [id, count] of Object.entries(erpCompleted.regions || {})) {
    regionCompleted[id] = String(count)
  }

  return {
    ...bucket,
    technicians: {
      ...bucket.technicians,
      completed: techCompleted
    },
    regions: {
      ...bucket.regions,
      completed: regionCompleted
    }
  }
}

export function mapErpCompletedToBucket(data, bucket) {
  const catalog = bucket?.regions?.catalog || []
  const techCatalog = bucket?.technicians?.catalog || []

  return {
    technicians: mapTechniciansFromErp(data, techCatalog),
    regions: mapRegionsFromErp(data, catalog)
  }
}
