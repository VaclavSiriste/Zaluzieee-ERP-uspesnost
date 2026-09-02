import { mapErpCompletedToBucket, mergeErpCompletedIntoBucket } from '@/lib/targets-completed-merge'
import { writeMonthBucket } from '@/lib/targets-storage'

export async function syncTargetsCompletedFromErp(monthKey, bucket, { organizationId = null, brandId = 'cz' } = {}) {
  const params = new URLSearchParams({ month: monthKey })
  if (organizationId != null) {
    params.set('organizationId', String(organizationId))
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
