/**
 * Pokladamee · OVT list podle gid z URL (odolné vůči přejmenování)
 * https://docs.google.com/spreadsheets/d/18PGajHulyJm8wC1QdxRISFYVwVrKbriFMfdY-UYfOyA/edit?gid=1262379590
 *
 * Q (řádek 2 = nadpis, od 3 jména) → target technici
 * K (od řádku 3) → datum navolání (časový filtr)
 * L (od řádku 3) → dopadl hovor (ANO) → úspěšnost = ANO / počet řádků v období
 */

import { formatDateOnly } from '@/lib/metrics-query'
import { normalizeTechnicianName, technicianId } from '@/lib/technician-targets'

export const POKLADAMEE_OVT_SHEET = {
  spreadsheetId: '18PGajHulyJm8wC1QdxRISFYVwVrKbriFMfdY-UYfOyA',
  /** Stabilní ID listu z URL (?gid=...) — název listu je jen fallback / info */
  gid: 1262379590,
  sheetNameFallback: 'Databáze_2026',
  /** 0-based indexes */
  colDatumNavolani: 10, // K
  colDopadlHovor: 11, // L
  colTechnik: 16, // Q
  dataStartRow: 3 // 1-based; řádek 2 = nadpis
}

function isAno(value) {
  const raw = String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
  return raw === 'ano' || raw === 'yes' || raw === 'true' || raw === '1'
}

/** Parse datum z Sheetu (Date, ISO, DD.MM.YYYY, DD/MM/YYYY). */
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

  // Google Sheets serial date (days since 1899-12-30)
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
 * @param {string[][]} rows - včetně hlaviček; index 0 = řádek 1 sheetu
 * @param {{ startDate: string, endDate: string }} range
 */
export function analyzePokladameeOvtSheet(rows, { startDate, endDate } = {}) {
  const cfg = POKLADAMEE_OVT_SHEET
  const startIdx = Math.max(0, cfg.dataStartRow - 1)
  const techNames = []
  const techSeen = new Set()
  let total = 0
  let ano = 0
  let ne = 0
  let withoutDate = 0

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

    const dateStr = parseSheetDate(row[cfg.colDatumNavolani])
    if (!dateStr) {
      // řádek bez data navolání nepatří do časového filtru úspěšnosti
      const hasAny =
        String(row[cfg.colDopadlHovor] ?? '').trim() ||
        String(row[cfg.colDatumNavolani] ?? '').trim()
      if (hasAny) withoutDate += 1
      continue
    }
    if (!inRange(dateStr, startDate, endDate)) continue

    total += 1
    const dopadl = row[cfg.colDopadlHovor]
    if (isAno(dopadl)) ano += 1
    else if (String(dopadl ?? '').trim()) ne += 1
  }

  techNames.sort((a, b) => a.name.localeCompare(b.name, 'cs'))

  return {
    technicians: techNames,
    success: {
      dopadl_hovor_ano: ano,
      dopadl_hovor_ne: ne,
      dopadl_hovor_pocet: total,
      // Sheet: ANO / celkový počet řádků s datumem navolání v období
      success_navolani_pct: total > 0 ? (ano / total) * 100 : null,
      // ERP-kompatibilní pole (panel očekává i zaměření — u sheetu nepoužíváme)
      domluveno_zamereni_ano: 0,
      domluveno_zamereni_ne: 0,
      domluveno_zamereni_pocet: 0,
      by_operator: [],
      source: 'pokladamee-ovt-sheet',
      date_basis: 'datum_navolani',
      without_date_rows: withoutDate
    }
  }
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

async function fetchViaWebApp({ startDate, endDate }) {
  const url = process.env.POKLADAMEE_OVT_SHEET_WEBAPP_URL?.trim()
  if (!url) return null

  const token = process.env.POKLADAMEE_OVT_SHEET_TOKEN?.trim() || ''
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

  // Webapp může vrátit už spočítané metriky, nebo raw rows
  if (Array.isArray(data?.rows)) {
    return analyzePokladameeOvtSheet(data.rows, { startDate, endDate })
  }
  if (data?.success && Array.isArray(data?.technicians)) {
    return {
      technicians: data.technicians,
      success: {
        ...data.success,
        by_operator: data.success.by_operator || [],
        source: 'pokladamee-ovt-sheet',
        date_basis: 'datum_navolani'
      }
    }
  }
  throw new Error('Neplatná odpověď z POKLADAMEE_OVT_SHEET_WEBAPP_URL')
}

async function fetchViaServiceAccount() {
  const rawJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  const spreadsheetId =
    process.env.POKLADAMEE_OVT_SHEET_ID?.trim() || POKLADAMEE_OVT_SHEET.spreadsheetId
  const gid = Number(
    process.env.POKLADAMEE_OVT_SHEET_GID?.trim() || POKLADAMEE_OVT_SHEET.gid
  )
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

  // Název listu zjistíme podle gid (přejmenování listu nevadí)
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
    sheetProps?.title ||
    process.env.POKLADAMEE_OVT_SHEET_TAB?.trim() ||
    POKLADAMEE_OVT_SHEET.sheetNameFallback
  if (!sheetProps?.title) {
    throw new Error(`List s gid=${gid} nenalezen ve spreadsheetu ${spreadsheetId}`)
  }

  const range = encodeURIComponent(`${tab}!A1:Q`)
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

export function isPokladameeOvtSheetConfigured() {
  return Boolean(
    process.env.POKLADAMEE_OVT_SHEET_WEBAPP_URL?.trim() ||
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()
  )
}

export async function fetchPokladameeOvtMetrics({ startDate, endDate }) {
  const fromWebApp = await fetchViaWebApp({ startDate, endDate })
  if (fromWebApp) return { ...fromWebApp, fetch_source: 'webapp' }

  const rows = await fetchViaServiceAccount()
  if (!rows) {
    throw new Error(
      'Chybí napojení na sheet: nastavte POKLADAMEE_OVT_SHEET_WEBAPP_URL (Apps Script) nebo GOOGLE_SERVICE_ACCOUNT_JSON.'
    )
  }
  return {
    ...analyzePokladameeOvtSheet(rows, { startDate, endDate }),
    fetch_source: 'service_account'
  }
}

export { parseCsv }
