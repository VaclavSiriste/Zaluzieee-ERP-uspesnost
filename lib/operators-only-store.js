/**
 * Persistovaný seznam e-mailů s přístupem jen k sekci Operátoři.
 *
 * Lokálně: .runtime-cache/operators-only-emails.json
 * Vercel (read-only FS): /tmp + fallback na výchozí seznam (bez pádu).
 */

import fs from 'fs/promises'
import path from 'path'
import { isAllowedEmail } from '@/lib/auth'

/** Výchozí seznam (seed). */
export const DEFAULT_OPERATORS_ONLY_EMAILS = [
  'martina.plutova@zaluzieee.cz',
  'nikolas.agel@zaluzieee.cz',
  'aneta.hradilova@zaluzieee.cz',
  'katerina.malikova@zaluzieee.cz',
  'eliska.sandany@zaluzieee.cz',
  'kristyna.poranska@zaluzieee.cz',
  'veronika.ondrusova@zaluzieee.cz',
  'radka.hrncirova@zaluzieee.cz',
  'barbora.kalocova@zaluzieee.cz',
  'kristyna.kluzova@zaluzieee.cz',
  'lukas.ham@zaluzieee.cz',
  'david.michalcik@zaluzieee.cz',
  'lucie.burdova@zaluzieee.cz',
  'veronika.prchlikova@zaluzieee.cz',
  'martina.stendova@zaluzieee.cz',
  'elisabeth.watson@zaluzieee.cz',
  'katrin.slivonova@zaluzieee.cz',
  'karolina.sachmerdova@zaluzieee.cz',
  'eva.kureckova@zaluzieee.cz',
  'klara.nekoranikova@zaluzieee.cz',
  'veronika.kubinova@zaluzieee.cz',
  'sandra.poslusna@zaluzieee.cz',
  'natalie.sawczukova@zaluzieee.cz',
  'matej.minarik@zaluzieee.cz',
  'lenka.herrmannova@zaluzieee.cz',
  'ludek.kutac@zaluzieee.cz',
  'denis.hosala@zaluzieee.cz',
  'nikola.chwistkova@zaluzieee.cz',
  'adela.fridrichova@zaluzieee.cz',
  'michal.srba@zaluzieee.cz',
  'natalie.pavlikova@zaluzieee.cz',
  'daniel.krajca@zaluzieee.cz',
  'barbora.kempna@zaluzieee.cz',
  'matej.kalkus@zaluzieee.cz',
  'vlasta.filipova@zaluzieee.cz',
  'bruno.lehocky@zaluzieee.cz',
  'barbora.raska@zaluzieee.cz',
  'jan.paracka@zaluzieee.cz'
]

/** In-memory fallback (Vercel instance), když nejde zapsat na disk. */
let memoryEmails = null

function normalizeEmail(email) {
  return String(email || '')
    .trim()
    .toLowerCase()
}

function uniqueSorted(emails) {
  return [...new Set(emails.map(normalizeEmail).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'cs')
  )
}

function candidatePaths() {
  const paths = []
  // Vercel / serverless — zapisovatelné
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    paths.push(path.join('/tmp', 'prvni-operators-only-emails.json'))
  }
  paths.push(path.join(process.cwd(), '.runtime-cache', 'operators-only-emails.json'))
  return paths
}

async function readFromPath(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    const data = JSON.parse(raw)
    if (Array.isArray(data?.emails)) {
      return uniqueSorted(data.emails)
    }
  } catch {
    // missing / invalid
  }
  return null
}

async function readFile() {
  if (memoryEmails) return memoryEmails
  for (const filePath of candidatePaths()) {
    const emails = await readFromPath(filePath)
    if (emails) {
      memoryEmails = emails
      return emails
    }
  }
  return null
}

async function writeFile(emails) {
  const list = uniqueSorted(emails)
  memoryEmails = list
  const payload = JSON.stringify({ updatedAt: new Date().toISOString(), emails: list }, null, 2)

  let lastError = null
  for (const filePath of candidatePaths()) {
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, payload, 'utf8')
      return list
    } catch (error) {
      lastError = error
    }
  }

  // Disk nejde (read-only) — držíme aspoň v paměti instance
  if (lastError) {
    console.warn('operators-only-store write failed, using memory:', lastError.message)
  }
  return list
}

/** E-maily, které už nemají být v operators-only (plný přístup), i kdyby byly ve starém cache. */
const REVOKED_OPERATORS_ONLY = new Set([
  'filip.vymyslicky@zaluzieee.cz',
  'lucie.francisci@zaluzieee.cz',
  'stepan.nedoma@zaluzieee.cz',
  'bara.tkacova@zaluzieee.cz'
])

function withoutRevoked(emails) {
  return emails.filter((email) => !REVOKED_OPERATORS_ONLY.has(normalizeEmail(email)))
}

export async function listOperatorsOnlyEmails() {
  try {
    const existing = await readFile()
    if (existing) {
      const cleaned = withoutRevoked(existing)
      if (cleaned.length !== existing.length) {
        return writeFile(cleaned)
      }
      return cleaned
    }
    return writeFile(DEFAULT_OPERATORS_ONLY_EMAILS)
  } catch (error) {
    console.warn('operators-only-store list failed:', error.message)
    memoryEmails = uniqueSorted(DEFAULT_OPERATORS_ONLY_EMAILS)
    return memoryEmails
  }
}

export async function isOperatorsOnlyEmail(email) {
  try {
    const list = await listOperatorsOnlyEmails()
    return list.includes(normalizeEmail(email))
  } catch {
    return DEFAULT_OPERATORS_ONLY_EMAILS.map(normalizeEmail).includes(normalizeEmail(email))
  }
}

export async function addOperatorsOnlyEmail(email) {
  const normalized = normalizeEmail(email)
  if (!isAllowedEmail(normalized)) {
    throw new Error('Povolené jsou jen e-maily @zaluzieee.cz nebo @demaxia.cz')
  }
  const list = await listOperatorsOnlyEmails()
  if (list.includes(normalized)) {
    return { emails: list, added: false, email: normalized }
  }
  const next = await writeFile([...list, normalized])
  return { emails: next, added: true, email: normalized }
}

export async function removeOperatorsOnlyEmail(email) {
  const normalized = normalizeEmail(email)
  const list = await listOperatorsOnlyEmails()
  if (!list.includes(normalized)) {
    return { emails: list, removed: false, email: normalized }
  }
  const next = await writeFile(list.filter((item) => item !== normalized))
  return { emails: next, removed: true, email: normalized }
}
