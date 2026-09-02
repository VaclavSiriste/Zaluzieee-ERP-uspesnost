import {
  DEFAULT_TECHNICIAN_NAMES,
  buildDefaultCatalog,
  normalizeTechnicianName,
  sortTechnicians,
  technicianId
} from '@/lib/technician-targets'
import {
  buildDefaultRegionCatalog,
  EXTRA_REGIONS,
  normalizeRegionName,
  resolveErpRegionId,
  sortRegions
} from '@/lib/czech-regions'

const EXTRA_REGION_IDS = new Set(EXTRA_REGIONS.map((item) => item.id))

const MONTHLY_KEY_PREFIX = 'prvni.targets.monthly.v1'
const VIEW_KEY = 'prvni.targets.view'
const MONTH_KEY = 'prvni.targets.selectedMonth'

const LEGACY_CATALOG_KEY = 'prvni.targets.catalog'
const LEGACY_ACTIVE_KEY = 'prvni.targets.active'
const LEGACY_VALUES_KEY = 'prvni.targets.values'

export function resolveTargetsBrandId(brandId) {
  const id = String(brandId || 'cz').trim()
  return id || 'cz'
}

function monthlyStorageKey(brandId = 'cz') {
  return `${MONTHLY_KEY_PREFIX}.${resolveTargetsBrandId(brandId)}`
}

function readJson(key, fallback) {
  if (typeof window === 'undefined') return fallback
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : fallback
  } catch {
    return fallback
  }
}

function writeJson(key, value) {
  if (typeof window === 'undefined') return
  localStorage.setItem(key, JSON.stringify(value))
}

export function getCurrentMonthKey(date = new Date()) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

export function formatMonthLabel(monthKey) {
  const [year, month] = String(monthKey || '').split('-')
  if (!year || !month) return monthKey
  const date = new Date(Number(year), Number(month) - 1, 1)
  if (Number.isNaN(date.getTime())) return monthKey
  return date.toLocaleDateString('cs-CZ', { month: 'long', year: 'numeric' })
}

export const TARGET_MONTH_MIN = '2026-01'
export const TARGET_MONTH_MAX = '2027-12'
export const TARGET_YEARS = [2026, 2027]

export function clampMonthKey(monthKey) {
  const key = String(monthKey || getCurrentMonthKey())
  if (key < TARGET_MONTH_MIN) return TARGET_MONTH_MIN
  if (key > TARGET_MONTH_MAX) return TARGET_MONTH_MAX
  return key
}

export function shiftMonthKey(monthKey, delta) {
  const [year, month] = String(monthKey || getCurrentMonthKey()).split('-').map(Number)
  const date = new Date(year, month - 1 + delta, 1)
  return clampMonthKey(getCurrentMonthKey(date))
}

export function listMonthOptions(years = TARGET_YEARS) {
  const options = []
  for (const year of years) {
    for (let month = 1; month <= 12; month += 1) {
      const key = `${year}-${String(month).padStart(2, '0')}`
      options.push({ key, label: formatMonthLabel(key) })
    }
  }
  return options
}

/** Kalendářní rozsah měsíce YYYY-MM (lokální čas). */
export function monthKeyToDateRange(monthKey) {
  const key = clampMonthKey(monthKey)
  const [year, month] = key.split('-').map(Number)
  const start = new Date(year, month - 1, 1)
  const end = new Date(year, month, 0)
  return {
    startDate: formatDateInput(start),
    endDate: formatDateInput(end)
  }
}

function formatDateInput(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function emptyMonthBucket() {
  return {
    technicians: {
      catalog: buildDefaultCatalog(),
      activeIds: buildDefaultCatalog().map((item) => item.id),
      values: {},
      completed: {}
    },
    regions: {
      catalog: buildDefaultRegionCatalog(),
      activeIds: buildDefaultRegionCatalog().map((item) => item.id),
      values: {},
      completed: {},
      labels: {}
    },
    operations: {
      target: '',
      completed: ''
    }
  }
}

function sanitizeCatalog(items, normalizeName, idFn) {
  if (!Array.isArray(items)) return []
  const seen = new Set()
  const catalog = []
  for (const item of items) {
    const name = normalizeName(item?.name)
    if (!name) continue
    const id = idFn(name)
    if (seen.has(id)) continue
    seen.add(id)
    catalog.push({ id, name })
  }
  return catalog
}

function remapRegionKeyedMaps(rawRegions, catalog) {
  function remap(map) {
    const next = {}
    if (!map || typeof map !== 'object') return next
    for (const [key, value] of Object.entries(map)) {
      const fromCatalog = Array.isArray(rawRegions?.catalog)
        ? rawRegions.catalog.find((item) => item.id === key)
        : null
      const label = fromCatalog?.name || key
      const canonicalId =
        resolveErpRegionId(label, catalog) ||
        resolveErpRegionId(key, catalog) ||
        catalog.find((item) => item.id === key)?.id
      if (canonicalId) next[canonicalId] = value
    }
    return next
  }

  return {
    values: remap(rawRegions?.values),
    completed: remap(rawRegions?.completed),
    labels: remap(rawRegions?.labels)
  }
}

function remapRegionActiveIds(rawActiveIds, rawRegions, catalog) {
  if (!Array.isArray(rawActiveIds)) {
    return catalog.map((item) => item.id)
  }
  const canonical = new Set()
  for (const key of rawActiveIds.map(String).filter(Boolean)) {
    const fromCatalog = rawRegions?.catalog?.find((item) => item.id === key)
    const label = fromCatalog?.name || key
    const id =
      resolveErpRegionId(label, catalog) ||
      resolveErpRegionId(key, catalog) ||
      catalog.find((item) => item.id === key)?.id
    if (id) canonical.add(id)
  }
  if (!canonical.size) return catalog.map((item) => item.id)
  for (const item of catalog) {
    if (EXTRA_REGION_IDS.has(item.id)) canonical.add(item.id)
  }
  return [...canonical]
}

function normalizeMonthBucket(raw) {
  const bucket = emptyMonthBucket()
  if (!raw || typeof raw !== 'object') return bucket

  const techCatalog = sanitizeCatalog(raw.technicians?.catalog, normalizeTechnicianName, technicianId)
  bucket.technicians.catalog = techCatalog.length ? sortTechnicians(techCatalog) : bucket.technicians.catalog
  bucket.technicians.activeIds = Array.isArray(raw.technicians?.activeIds)
    ? raw.technicians.activeIds.map(String).filter(Boolean)
    : bucket.technicians.catalog.map((item) => item.id)
  bucket.technicians.values =
    raw.technicians?.values && typeof raw.technicians.values === 'object' ? raw.technicians.values : {}
  bucket.technicians.completed =
    raw.technicians?.completed && typeof raw.technicians.completed === 'object'
      ? raw.technicians.completed
      : {}

  const regionCatalog = buildDefaultRegionCatalog()
  bucket.regions.catalog = regionCatalog
  const remappedRegions = remapRegionKeyedMaps(raw.regions, regionCatalog)
  bucket.regions.values = remappedRegions.values
  bucket.regions.completed = remappedRegions.completed
  bucket.regions.labels = remappedRegions.labels
  bucket.regions.activeIds = remapRegionActiveIds(raw.regions?.activeIds, raw.regions, regionCatalog)

  bucket.operations = {
    target: typeof raw.operations?.target === 'string' ? raw.operations.target : '',
    completed: typeof raw.operations?.completed === 'string' ? raw.operations.completed : ''
  }

  return bucket
}

function migrateLegacyTechnicians(monthKey, store, brandId = 'cz') {
  if (resolveTargetsBrandId(brandId) !== 'cz') return store
  const legacyCatalog = readJson(LEGACY_CATALOG_KEY, null)
  const legacyActive = readJson(LEGACY_ACTIVE_KEY, null)
  const legacyValues = readJson(LEGACY_VALUES_KEY, null)
  if (!legacyCatalog && !legacyActive && !legacyValues) return store

  if (!store[monthKey]) store[monthKey] = emptyMonthBucket()
  const bucket = store[monthKey]

  if (Array.isArray(legacyCatalog) && legacyCatalog.length) {
    bucket.technicians.catalog = sanitizeCatalog(legacyCatalog, normalizeTechnicianName, technicianId)
  }
  if (Array.isArray(legacyActive)) {
    bucket.technicians.activeIds = legacyActive.map(String).filter(Boolean)
  }
  if (legacyValues && typeof legacyValues === 'object') {
    bucket.technicians.values = legacyValues
  }

  localStorage.removeItem(LEGACY_CATALOG_KEY)
  localStorage.removeItem(LEGACY_ACTIVE_KEY)
  localStorage.removeItem(LEGACY_VALUES_KEY)
  writeJson(monthlyStorageKey(brandId), store)
  return store
}

function readMonthlyStore(brandId = 'cz') {
  let store = readJson(monthlyStorageKey(brandId), {})
  if (!store || typeof store !== 'object') store = {}
  store = migrateLegacyTechnicians(getCurrentMonthKey(), store, brandId)
  return store
}

function writeMonthlyStore(brandId, store) {
  writeJson(monthlyStorageKey(brandId), store)
}

export function readSelectedMonthKey() {
  const stored = readJson(MONTH_KEY, null)
  const key =
    typeof stored === 'string' && /^\d{4}-\d{2}$/.test(stored)
      ? stored
      : getCurrentMonthKey()
  return clampMonthKey(key)
}

export function writeSelectedMonthKey(monthKey) {
  writeJson(MONTH_KEY, monthKey)
}

export function readTargetsView() {
  const view = readJson(VIEW_KEY, 'technicians')
  return view === 'regions' ? 'regions' : 'technicians'
}

export function writeTargetsView(view) {
  writeJson(VIEW_KEY, view === 'regions' ? 'regions' : 'technicians')
}

export function readMonthBucket(monthKey, brandId = 'cz') {
  const store = readMonthlyStore(brandId)
  const key = monthKey || readSelectedMonthKey()
  if (!store[key]) {
    store[key] = emptyMonthBucket()
    writeMonthlyStore(brandId, store)
  }
  return normalizeMonthBucket(store[key])
}

export function writeMonthBucket(monthKey, bucket, brandId = 'cz') {
  const store = readMonthlyStore(brandId)
  store[monthKey] = normalizeMonthBucket(bucket)
  writeMonthlyStore(brandId, store)
}

export function parseTargetNumber(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\s/g, '')
    .replace(',', '.')
  if (!normalized) return null
  const num = Number(normalized)
  return Number.isFinite(num) ? num : null
}

export { DEFAULT_TECHNICIAN_NAMES } from '@/lib/technician-targets'
export { DEFAULT_CZECH_REGIONS } from '@/lib/czech-regions'
