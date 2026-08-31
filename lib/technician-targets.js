export const DEFAULT_TECHNICIAN_NAMES = [
  'Tomáš Korner',
  'Denis David',
  'Roman Marejka',
  'Radek Smoček',
  'Lubomír Micov',
  'Jiří Staněk',
  'Roman Zwolski',
  'Dalimil Novotný',
  'Michal Macháček',
  'Zbyněk Jergl',
  'Vojtěch Slavinský',
  'Antonín Trenkner',
  'David Galle',
  'Zdeněk Pokorný',
  'Zdeněk Pejša',
  'Vít Fišara',
  'Dominik Šípek',
  'Dávid Duch',
  'Jindřich Baštař',
  'Adam Hurban',
  'Václav Paletář',
  'Jan Veverka',
  'Martin Onderka',
  'David Chládek',
  'Hynek Verner',
  'Radek Ritter',
  'Jan Vaško',
  'Jakub Kořínek',
  'Daniel Král',
  'Jan Krejza',
  'Tomáš Štuk',
  'Luboš Gráf',
  'Lukáš Chytil',
  'Karel Vávra',
  'Petr Kasík'
]

const CATALOG_KEY = 'prvni.targets.catalog'
const ACTIVE_KEY = 'prvni.targets.active'
const VALUES_KEY = 'prvni.targets.values'

export function technicianId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeTechnicianName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ')
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

export function buildDefaultCatalog() {
  return DEFAULT_TECHNICIAN_NAMES.map((name) => ({
    id: technicianId(name),
    name
  }))
}

export function readTechnicianCatalog() {
  const stored = readJson(CATALOG_KEY, null)
  if (!Array.isArray(stored) || !stored.length) return buildDefaultCatalog()
  const seen = new Set()
  const catalog = []
  for (const item of stored) {
    const name = normalizeTechnicianName(item?.name)
    if (!name) continue
    const id = technicianId(name)
    if (seen.has(id)) continue
    seen.add(id)
    catalog.push({ id, name })
  }
  return catalog.length ? catalog : buildDefaultCatalog()
}

export function writeTechnicianCatalog(catalog) {
  writeJson(CATALOG_KEY, catalog)
}

export function readActiveTechnicianIds() {
  const stored = readJson(ACTIVE_KEY, null)
  if (Array.isArray(stored)) return stored.map(String).filter(Boolean)
  return buildDefaultCatalog().map((item) => item.id)
}

export function writeActiveTechnicianIds(ids) {
  writeJson(ACTIVE_KEY, ids.map(String).filter(Boolean))
}

export function readTargetValues() {
  const stored = readJson(VALUES_KEY, {})
  return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}
}

export function writeTargetValues(values) {
  writeJson(VALUES_KEY, values)
}

export function sortTechnicians(list) {
  return [...list].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'cs', { sensitivity: 'base' })
  )
}
