/**
 * Persistovaný seznam e-mailů s přístupem jen k sekci Operátoři.
 * Soubor: .runtime-cache/operators-only-emails.json
 */

import fs from 'fs/promises'
import path from 'path'
import { isAllowedEmail } from '@/lib/auth'

const CACHE_DIR = path.join(process.cwd(), '.runtime-cache')
const CACHE_FILE = path.join(CACHE_DIR, 'operators-only-emails.json')

/** Výchozí seznam (seed při prvním spuštění). */
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
  'bara.tkacova@zaluzieee.cz',
  'daniel.krajca@zaluzieee.cz',
  'barbora.kempna@zaluzieee.cz',
  'stepan.nedoma@zaluzieee.cz',
  'matej.kalkus@zaluzieee.cz',
  'vlasta.filipova@zaluzieee.cz',
  'filip.vymyslicky@zaluzieee.cz',
  'bruno.lehocky@zaluzieee.cz',
  'lucie.francisci@zaluzieee.cz',
  'barbora.raska@zaluzieee.cz',
  'jan.paracka@zaluzieee.cz'
]

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

async function readFile() {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf8')
    const data = JSON.parse(raw)
    if (Array.isArray(data?.emails)) {
      return uniqueSorted(data.emails)
    }
  } catch {
    // missing or invalid
  }
  return null
}

async function writeFile(emails) {
  await fs.mkdir(CACHE_DIR, { recursive: true })
  const list = uniqueSorted(emails)
  await fs.writeFile(
    CACHE_FILE,
    JSON.stringify({ updatedAt: new Date().toISOString(), emails: list }, null, 2),
    'utf8'
  )
  return list
}

export async function listOperatorsOnlyEmails() {
  const existing = await readFile()
  if (existing) return existing
  return writeFile(DEFAULT_OPERATORS_ONLY_EMAILS)
}

export async function isOperatorsOnlyEmail(email) {
  const list = await listOperatorsOnlyEmails()
  return list.includes(normalizeEmail(email))
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
