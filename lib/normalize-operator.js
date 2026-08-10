/**
 * Normalizace jména operátora pro párování ERP ↔ Daktela (bez diakritiky).
 * Bez server-only závislostí — bezpečné pro klientský import.
 */
export function normalizeOperatorKey(name) {
  return String(name || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}
