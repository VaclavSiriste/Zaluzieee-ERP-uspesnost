/**
 * Zpětná kompatibilita — kanonická logika je v lib/ovt-sheet.js
 */
export {
  POKLADAMEE_OVT_SHEET,
  analyzePokladameeOvtSheet,
  parseSheetDate,
  isPokladameeOvtSheetConfigured,
  fetchPokladameeOvtMetrics,
  parseCsv
} from '@/lib/ovt-sheet'
