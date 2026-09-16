import mapData from './slovak-regions.generated.json'

/** Slovensko jako jeden celek — SVG obrys pro targety SK. */
export const MAP_VIEWBOX = mapData.viewBox

export const DEFAULT_SLOVAK_REGIONS = mapData.regions

export const EXTRA_SLOVAK_REGIONS = []

export const ALL_SLOVAK_REGIONS = [...DEFAULT_SLOVAK_REGIONS, ...EXTRA_SLOVAK_REGIONS]

const ERP_REGION_ALIASES = {
  sk: 'sk',
  slovakia: 'sk',
  slovensko: 'sk',
  'slovak republic': 'sk',
  'slovenska republika': 'sk'
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

export function buildDefaultSlovakRegionCatalog() {
  return ALL_SLOVAK_REGIONS.map((region) => ({
    id: region.id,
    name: region.name,
    shortName: region.shortName
  }))
}

export function sortSlovakRegions(list) {
  return [...list].sort((a, b) =>
    String(a.name).localeCompare(String(b.name), 'sk', { sensitivity: 'base' })
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

/** Mapuje ERP region / ruční popisek na id `sk`. */
export function resolveSlovakErpRegionId(erpRegion, catalog = buildDefaultSlovakRegionCatalog()) {
  const raw = normalizeRegionName(erpRegion)
  if (!raw || raw === 'N/A') return null

  const aliasId = ERP_REGION_ALIASES[regionMatchKey(raw)]
  if (aliasId && catalog.some((item) => item.id === aliasId)) {
    return aliasId
  }

  const lookup = new Map()
  for (const item of catalog) {
    lookup.set(regionMatchKey(item.name), item.id)
    if (item.shortName) lookup.set(regionMatchKey(item.shortName), item.id)
    lookup.set(regionMatchKey(item.id), item.id)
  }

  const direct = lookup.get(regionMatchKey(raw))
  if (direct) return direct

  // Jakýkoli slovenský kraj / obec padá do celostátního targetu SK
  if (/slovak|slovensk/.test(regionMatchKey(raw))) return 'sk'

  return null
}
