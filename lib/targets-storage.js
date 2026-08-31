import {
  DEFAULT_TECHNICIAN_NAMES,
  buildDefaultCatalog,
  normalizeTechnicianName,
  sortTechnicians,
  technicianId
} from '@/lib/technician-targets'
import {
  DEFAULT_CZECH_REGIONS,
  buildDefaultRegionCatalog,
  normalizeRegionName,
  regionId,
  sortRegions
} from '@/lib/czech-regions'

const MONTHLY_KEY = 'prvni.targets.monthly.v1'
const VIEW_KEY = 'prvni.targets.view'
const MONTH_KEY = 'prvni.targets.selectedMonth'

const LEGACY_CATALOG_KEY = 'prvni.targets.catalog'
const LEGACY_ACTIVE_KEY = 'prvni.targets.active'
const LEGACY_VALUES_KEY = 'prvni.targets.values'

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

  const regionCatalog = sanitizeCatalog(raw.regions?.catalog, normalizeRegionName, regionId)
  bucket.regions.catalog = regionCatalog.length ? sortRegions(regionCatalog) : bucket.regions.catalog
  bucket.regions.activeIds = Array.isArray(raw.regions?.activeIds)
    ? raw.regions.activeIds.map(String).filter(Boolean)
    : bucket.regions.catalog.map((item) => item.id)
  bucket.regions.values =
    raw.regions?.values && typeof raw.regions.values === 'object' ? raw.regions.values : {}
  bucket.regions.completed =
    raw.regions?.completed && typeof raw.regions.completed === 'object' ? raw.regions.completed : {}
  bucket.regions.labels =
    raw.regions?.labels && typeof raw.regions.labels === 'object' ? raw.regions.labels : {}

  bucket.operations = {
    target: typeof raw.operations?.target === 'string' ? raw.operations.target : '',
    completed: typeof raw.operations?.completed === 'string' ? raw.operations.completed : ''
  }

  return bucket
}

function migrateLegacyTechnicians(monthKey, store) {
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
  writeJson(MONTHLY_KEY, store)
  return store
}

function readMonthlyStore() {
  let store = readJson(MONTHLY_KEY, {})
  if (!store || typeof store !== 'object') store = {}
  store = migrateLegacyTechnicians(getCurrentMonthKey(), store)
  return store
}

function writeMonthlyStore(store) {
  writeJson(MONTHLY_KEY, store)
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

export function readMonthBucket(monthKey) {
  const store = readMonthlyStore()
  const key = monthKey || readSelectedMonthKey()
  if (!store[key]) {
    store[key] = emptyMonthBucket()
    writeMonthlyStore(store)
  }
  return normalizeMonthBucket(store[key])
}

export function writeMonthBucket(monthKey, bucket) {
  const store = readMonthlyStore()
  store[monthKey] = normalizeMonthBucket(bucket)
  writeMonthlyStore(store)
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

export { DEFAULT_TECHNICIAN_NAMES, DEFAULT_CZECH_REGIONS }
