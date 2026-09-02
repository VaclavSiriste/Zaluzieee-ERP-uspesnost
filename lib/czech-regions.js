import mapData from './czech-regions.generated.json'

/** 14 krajů ČR — SVG obrysy z GeoJSON (siwekm/czech-geojson). */
export const MAP_VIEWBOX = mapData.viewBox

export const DEFAULT_CZECH_REGIONS = mapData.regions

/** Doplňkové oblasti mimo 14 krajů (ERP hodnoty, zobrazení na mapě). */
export const EXTRA_REGIONS = [
  {
    id: 'benesov',
    name: 'Okres Benešov',
    shortName: 'Benešov',
    /** Souřadnice Benešova (49.78°N, 14.69°E) v projekci mapy krajů */
    mapX: 319,
    mapY: 264
  }
]

export const ALL_CZECH_REGIONS = [...DEFAULT_CZECH_REGIONS, ...EXTRA_REGIONS]

/** ERP customers.region → id v číselníku */
const ERP_REGION_ALIASES = {
  'okres benesov': 'benesov',
  benesov: 'benesov',
  'moravskosleszky': 'moravskoslezsky',
  'kralovehradecky kraj': 'kralovehradecky',
  olomouc: 'olomoucky',
  olomoucky: 'olomoucky'
}

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
  return ALL_CZECH_REGIONS.map((region) => ({
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

function regionMatchKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

/** Mapuje hodnotu customers.region z ERP na id kraje v číselníku. */
export function resolveErpRegionId(erpRegion, catalog = buildDefaultRegionCatalog()) {
  const raw = normalizeRegionName(erpRegion)
  if (!raw || raw === 'N/A') return null

  const aliasId = ERP_REGION_ALIASES[regionMatchKey(raw)]
  if (aliasId && catalog.some((item) => item.id === aliasId)) {
    return aliasId
  }

  const lookup = new Map()
  for (const item of catalog) {
    const variants = [
      item.name,
      item.shortName,
      item.id,
      String(item.name).replace(/\s+kraj$/i, ''),
      String(item.shortName || '').replace(/\s+kraj$/i, ''),
      String(item.name).replace(/^kraj\s+/i, ''),
      String(item.shortName || '').replace(/^kraj\s+/i, '')
    ]
    for (const variant of variants) {
      const key = regionMatchKey(variant)
      if (key) lookup.set(key, item.id)
    }
  }

  const direct = lookup.get(regionMatchKey(raw))
  if (direct) return direct

  const withoutKraj = regionMatchKey(raw.replace(/\s+kraj$/i, ''))
  if (lookup.has(withoutKraj)) return lookup.get(withoutKraj)

  for (const [key, id] of lookup.entries()) {
    if (key && (key.includes(withoutKraj) || withoutKraj.includes(key))) {
      return id
    }
  }

  return null
}

export function getRegionPath(regionIdValue, catalog = buildDefaultRegionCatalog()) {
  const fromDefault = ALL_CZECH_REGIONS.find((item) => item.id === regionIdValue)
  if (fromDefault) return fromDefault.path
  const item = catalog.find((entry) => entry.id === regionIdValue)
  if (!item) return null
  const generated = regionId(item.name)
  return DEFAULT_CZECH_REGIONS.find((entry) => entry.id === generated)?.path || null
}
