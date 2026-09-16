/**
 * Pokladamee OVT — důvody ve sloupci M (Důvod ne Hovoru), které se úplně
 * vyřazují z úspěšnosti navolání (ANO / ANO+NE).
 *
 * Reálné hodnoty ze sheetu: „Mimo dosah“, „Duplikace“, „nemožná realizace“,
 * „zájem o spolupráci“, „žádost o práci“ (+ varianty diakritiky / mezer).
 *
 * Match je bez diakritiky, case-insensitive, toleruje pomlčky/mezery.
 */

/** Canonical keys (bez diakritiky) → lidský popis */
export const POKLADAMEE_NAVOLANI_EXCLUDE_REASONS = [
  {
    id: 'mimodosah',
    label: 'Mimodosah',
    /** celý normalizovaný text nebo podřetězec */
    equals: ['mimodosah', 'mimo dosah', 'mimo-dosah'],
    includes: ['mimodosah', 'mimo dosah', 'projekt mimodosah', 'projekt-mimodosah']
  },
  {
    id: 'duplikace',
    label: 'Duplikace',
    equals: ['duplikace', 'duplicita', 'duplicitni', 'duplicitni zakazka'],
    includes: ['duplikac', 'duplicit']
  },
  {
    id: 'nemozna_realizace',
    label: 'Nemožná realizace',
    equals: ['nemozna realizace', 'nemoyna realizace'],
    includes: ['nemozna realiz', 'nemoyna realiz']
  },
  {
    id: 'zajem_o_spolupraci',
    label: 'Zájem o spolupráci',
    equals: ['zajem o spolupraci', 'zajem o spoluprace'],
    includes: ['zajem o spolupr']
  },
  {
    id: 'zadost_o_praci',
    label: 'Žádost o práci',
    equals: ['zadost o praci', 'zadost o prace'],
    includes: ['zadost o prac']
  }
]

export function normalizeReasonText(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[–—−]/g, '-')
    .replace(/[_/.,;:]+/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @returns {{ excluded: boolean, reasonId: string|null, reasonLabel: string|null }}
 */
export function matchPokladameeNavolaniExcludeReason(value) {
  const norm = normalizeReasonText(value)
  if (!norm) {
    return { excluded: false, reasonId: null, reasonLabel: null }
  }

  for (const rule of POKLADAMEE_NAVOLANI_EXCLUDE_REASONS) {
    if (rule.equals.some((item) => norm === normalizeReasonText(item))) {
      return { excluded: true, reasonId: rule.id, reasonLabel: rule.label }
    }
  }

  for (const rule of POKLADAMEE_NAVOLANI_EXCLUDE_REASONS) {
    if (
      rule.includes.some((item) => {
        const needle = normalizeReasonText(item)
        return needle && norm.includes(needle)
      })
    ) {
      return { excluded: true, reasonId: rule.id, reasonLabel: rule.label }
    }
  }

  return { excluded: false, reasonId: null, reasonLabel: null }
}

export function isPokladameeNavolaniExcludedReason(value) {
  return matchPokladameeNavolaniExcludeReason(value).excluded
}
