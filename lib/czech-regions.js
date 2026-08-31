import mapData from './czech-regions.generated.json'

/** 14 krajů ČR — SVG obrysy z GeoJSON (siwekm/czech-geojson). */
export const MAP_VIEWBOX = mapData.viewBox

export const DEFAULT_CZECH_REGIONS = mapData.regions

export function regionId(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function normalizeRegionName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ')
}

export function buildDefaultRegionCatalog() {
  return DEFAULT_CZECH_REGIONS.map((region) => ({
    id: region.id,
    name: region.name,
    shortName: region.shortName
  }))
}

export function sortRegions(list) {
  return [...list].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'cs', { sensitivity: 'base' })
  )
}

export function getRegionPath(regionIdValue, catalog = buildDefaultRegionCatalog()) {
  const fromDefault = DEFAULT_CZECH_REGIONS.find((item) => item.id === regionIdValue)
  if (fromDefault) return fromDefault.path
  const item = catalog.find((entry) => entry.id === regionIdValue)
  if (!item) return null
  const generated = regionId(item.name)
  return DEFAULT_CZECH_REGIONS.find((entry) => entry.id === generated)?.path || null
}
