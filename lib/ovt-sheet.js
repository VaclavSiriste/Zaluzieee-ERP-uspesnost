/**
 * OVT Google Sheet — pokladamee + malujemeee
 *
 * Společná logika sloupců:
 * Q (řádek 2 nadpis, od 3 jména) → technici
 * P → datum zaměření → Splněno targetů
 * U → kraj
 * K → datum navolání (filtr úspěšnosti)
 * L → dopadl hovor ANO
 * N (pokladamee) → důvod — vybrané hodnoty se vyřazují z úspěšnosti navolání
 */

import { formatDateOnly } from '@/lib/metrics-query'
import { isPokladameeNavolaniExcludedReason } from '@/lib/pokladamee-navolani-exclude'
import { normalizeTechnicianName, technicianId } from '@/lib/technician-targets'
import { resolveErpRegionId } from '@/lib/czech-regions'

const SHARED_COLS = {
  colDatumNavolani: 10, // K
  colDopadlHovor: 11, // L
  colDuvod: 13, // N
  colDatumZamereni: 15, // P
  colTechnik: 16, // Q
  colKraj: 20, // U
  dataStartRow: 3
}

export const OVT_SHEET_BRANDS = {
  pokladamee: {
    brandId: 'pokladamee',
    spreadsheetId: '18PGajHulyJm8wC1QdxRISFYVwVrKbriFMfdY-UYfOyA',
    gid: 1262379590,
    sheetNameFallback: 'Databáze_2026',
    source: 'pokladamee-ovt-sheet',
    envWebappUrl: 'POKLADAMEE_OVT_SHEET_WEBAPP_URL',
    envToken: 'POKLADAMEE_OVT_SHEET_TOKEN',
    envSheetId: 'POKLADAMEE_OVT_SHEET_ID',
    envGid: 'POKLADAMEE_OVT_SHEET_GID',
    envTab: 'POKLADAMEE_OVT_SHEET_TAB',
    ...SHARED_COLS
  },
  malujemeee: {
    brandId: 'malujemeee',
    spreadsheetId: '1_VBk_iUklmFN7JtK7PPpBp0vtd3K1Lor4oowMurTXvM',
    gid: 0,
    sheetNameFallback: 'List1',
    source: 'malujemeee-ovt-sheet',
    envWebappUrl: 'MALUJEMEEE_OVT_SHEET_WEBAPP_URL',
    envToken: 'MALUJEMEEE_OVT_SHEET_TOKEN',
    envSheetId: 'MALUJEMEEE_OVT_SHEET_ID',
    envGid: 'MALUJEMEEE_OVT_SHEET_GID',
    envTab: 'MALUJEMEEE_OVT_SHEET_TAB',
    ...SHARED_COLS
  }
}

/** @deprecated alias — zpětná kompatibilita */
export const POKLADAMEE_OVT_SHEET = OVT_SHEET_BRANDS.pokladamee

export function resolveOvtSheetBrand(brandId) {
  const id = String(brandId || '').trim().toLowerCase()
  return OVT_SHEET_BRANDS[id] || null
}

function isAno(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return raw === 'ano' || raw === 'yes' || raw === 'true' || raw === '1'
}

function isNe(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return raw === 'ne' || raw === 'no' || raw === 'false' || raw === '0'
}

export function parseSheetDate(value) {
  if (value == null || value === '') return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return formatDateOnly(value)
  }
  const raw = String(value).trim()
  if (!raw) return null

  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) {
    return raw.slice(0, 10)
  }

  const cz = raw.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})/)
  if (cz) {
    const day = Number(cz[1])
    const month = Number(cz[2])
    const year = Number(cz[3])
    if (day >= 1 && day <= 31 && month >= 1 && month <= 12) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
    }
  }

  const asNum = Number(raw)
  if (Number.isFinite(asNum) && asNum > 20000 && asNum < 80000) {
    const utc = new Date(Date.UTC(1899, 11, 30) + asNum * 86400000)
    return formatDateOnly(utc)
  }

  const parsed = new Date(raw)
  if (!Number.isNaN(parsed.getTime())) return formatDateOnly(parsed)
  return null
}

function inRange(dateStr, startDate, endDate) {
  if (!dateStr) return false
  if (startDate && dateStr < startDate) return false
  if (endDate && dateStr > endDate) return false
  return true
}

/**
 * @param {object} cfg - brand sheet config
 * @param {string[][]} rows
 * @param {{ startDate?: string, endDate?: string }} range
 */
export function analyzeOvtSheet(cfg, rows, { startDate, endDate } = {}) {
  const startIdx = Math.max(0, cfg.dataStartRow - 1)
  const techNames = []
  const techSeen = new Set()
  let ano = 0
  let ne = 0
  let withoutDate = 0
  let excludedByReason = 0

  const completedByTech = {}
  const completedByRegion = {}
  let completedTotal = 0

  for (let i = startIdx; i < (rows?.length || 0); i += 1) {
    const row = rows[i] || []
    const techRaw = normalizeTechnicianName(row[cfg.colTechnik])
    if (techRaw) {
      const id = technicianId(techRaw)
      if (id && !techSeen.has(id)) {
        techSeen.add(id)
        techNames.push({ id, name: techRaw })
      }
    }

    const zamereniDate = parseSheetDate(row[cfg.colDatumZamereni])
    if (zamereniDate && inRange(zamereniDate, startDate, endDate)) {
      completedTotal += 1
      if (techRaw) {
        const id = technicianId(techRaw)
        if (id) completedByTech[id] = (completedByTech[id] || 0) + 1
      }
      const regionRaw = String(row[cfg.colKraj] ?? '').trim()
      if (regionRaw) {
        const regionId = resolveErpRegionId(regionRaw)
        if (regionId) {
          completedByRegion[regionId] = (completedByRegion[regionId] || 0) + 1
        }
      }
    }

    const dateStr = parseSheetDate(row[cfg.colDatumNavolani])
    if (!dateStr) {
      const hasAny =
        String(row[cfg.colDopadlHovor] ?? '').trim() ||
        String(row[cfg.colDatumNavolani] ?? '').trim()
      if (hasAny) withoutDate += 1
      continue
    }
    if (!inRange(dateStr, startDate, endDate)) continue

    // pokladamee: sloupec N — vybrané důvody úplně ven z úspěšnosti navolání
    if (cfg.brandId === 'pokladamee' && cfg.colDuvod != null) {
      const duvod = row[cfg.colDuvod]
      if (isPokladameeNavolaniExcludedReason(duvod)) {
        excludedByReason += 1
        continue
      }
    }

    const dopadl = row[cfg.colDopadlHovor]
    if (isAno(dopadl)) ano += 1
    else if (isNe(dopadl)) ne += 1
  }

  const decided = ano + ne
  techNames.sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  return {
    technicians: techNames,
    success: {
      dopadl_hovor_ano: ano,
      dopadl_hovor_ne: ne,
      dopadl_hovor_pocet: decided,
      // Úspěšnost navolání = Dopadl hovor ANO / (ANO + NE)
      success_navolani_pct: decided > 0 ? (ano / decided) * 100 : null,
      domluveno_zamereni_ano: 0,
      domluveno_zamereni_ne: 0,
      domluveno_zamereni_pocet: 0,
      by_operator: [],
      source: cfg.source,
      date_basis: 'datum_navolani',
      without_date_rows: withoutDate,
      excluded_by_reason: excludedByReason
    },
    targets: {
      source: cfg.source,
      date_basis: 'datum_zamereni',
      technicians: techNames,
      completed: {
        total: completedTotal,
        technicians: completedByTech,
        regions: completedByRegion
      }
    }
  }
}

/** @deprecated */
export function analyzePokladameeOvtSheet(rows, range) {
  return analyzeOvtSheet(OVT_SHEET_BRANDS.pokladamee, rows, range)
}

async function fetchViaWebApp(cfg, { startDate, endDate }) {
  const url = process.env[cfg.envWebappUrl]?.trim()
  if (!url) return null

  const token = process.env[cfg.envToken]?.trim() || ''
  const endpoint = new URL(url)
  if (token) endpoint.searchParams.set('token', token)
  if (startDate) endpoint.searchParams.set('startDate', startDate)
  if (endDate) endpoint.searchParams.set('endDate', endDate)
  endpoint.searchParams.set('mode', 'raw')

  const response = await fetch(endpoint.toString(), {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  })
  const data = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(data?.error || `Sheet webapp HTTP ${response.status}`)
  }

  if (Array.isArray(data?.rows)) {
    return analyzeOvtSheet(cfg, data.rows, { startDate, endDate })
  }
  if (data?.success && Array.isArray(data?.technicians)) {
    return {
      technicians: data.technicians,
      success: {
        ...data.success,
        by_operator: data.success.by_operator || [],
        source: cfg.source,
        date_basis: 'datum_navolani'
      },
      targets: data.targets || {
        source: cfg.source,
        date_basis: 'datum_zamereni',
        technicians: data.technicians,
        completed: { total: 0, technicians: {}, regions: {} }
      }
    }
  }
  throw new Error(`Neplatná odpověď z ${cfg.envWebappUrl}`)
}

async function fetchViaServiceAccount(cfg) {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  const spreadsheetId = process.env[cfg.envSheetId]?.trim() || cfg.spreadsheetId
  const gid = Number(process.env[cfg.envGid]?.trim() || cfg.gid)
  if (!rawJson) return null

  const serviceAccount = JSON.parse(rawJson)
  const now = Math.floor(Date.now() / 1000)
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/spreadsheets.readonly',
      aud: 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now
    })
  ).toString('base64url')
  const crypto = await import('crypto')
  const sign = crypto.createSign('RSA-SHA256')
  sign.update(`${header}.${payload}`)
  sign.end()
  const jwt = `${header}.${payload}.${sign.sign(serviceAccount.private_key, 'base64url')}`

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt
    })
  })
  const tokenData = await tokenRes.json()
  if (!tokenData.access_token) {
    throw new Error(tokenData.error_description || tokenData.error || 'Google OAuth selhalo')
  }

  const authHeaders = { Authorization: `Bearer ${tokenData.access_token}` }

  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    { headers: authHeaders }
  )
  const meta = await metaRes.json()
  if (!metaRes.ok) {
    throw new Error(meta.error?.message || `Sheets meta HTTP ${metaRes.status}`)
  }
  const sheetProps = (meta.sheets || [])
    .map((item) => item.properties)
    .find((props) => Number(props?.sheetId) === gid)
  const tab =
    sheetProps?.title || process.env[cfg.envTab]?.trim() || cfg.sheetNameFallback
  if (!sheetProps?.title) {
    throw new Error(`List s gid=${gid} nenalezen ve spreadsheetu ${spreadsheetId}`)
  }

  const range = encodeURIComponent(`${tab}!A1:U`)
  const sheetRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${range}`,
    { headers: authHeaders }
  )
  const sheetData = await sheetRes.json()
  if (!sheetRes.ok) {
    throw new Error(sheetData.error?.message || `Sheets API HTTP ${sheetRes.status}`)
  }
  return sheetData.values || []
}

export function isOvtSheetConfigured(brandId) {
  const cfg = resolveOvtSheetBrand(brandId)
  if (!cfg) return false
  return Boolean(
    process.env[cfg.envWebappUrl]?.trim() || process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  )
}

export function isPokladameeOvtSheetConfigured() {
  return isOvtSheetConfigured('pokladamee')
}

export async function fetchOvtSheetMetrics(brandId, { startDate, endDate } = {}) {
  const cfg = resolveOvtSheetBrand(brandId)
  if (!cfg) {
    throw new Error(`Neznámá OVT značka: ${brandId}`)
  }

  const fromWebApp = await fetchViaWebApp(cfg, { startDate, endDate })
  if (fromWebApp) return { ...fromWebApp, fetch_source: 'webapp', brand: cfg.brandId }

  const rows = await fetchViaServiceAccount(cfg)
  if (!rows) {
    throw new Error(
      `Chybí napojení na sheet: nastavte ${cfg.envWebappUrl} (Apps Script) nebo GOOGLE_SERVICE_ACCOUNT_JSON.`
    )
  }
  return {
    ...analyzeOvtSheet(cfg, rows, { startDate, endDate }),
    fetch_source: 'service_account',
    brand: cfg.brandId
  }
}

export async function fetchPokladameeOvtMetrics(range) {
  return fetchOvtSheetMetrics('pokladamee', range)
}

function parseCsv(text) {
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  const input = String(text || '').replace(/^\uFEFF/, '')

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i]
    const next = input[i + 1]
    if (inQuotes) {
      if (ch === '"' && next === '"') {
        cell += '"'
        i += 1
      } else if (ch === '"') {
        inQuotes = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"') {
      inQuotes = true
      continue
    }
    if (ch === ',') {
      row.push(cell)
      cell = ''
      continue
    }
    if (ch === '\n') {
      row.push(cell)
      rows.push(row)
      row = []
      cell = ''
      continue
    }
    if (ch === '\r') continue
    cell += ch
  }
  if (cell.length || row.length) {
    row.push(cell)
    rows.push(row)
  }
  return rows
}

export { parseCsv }
