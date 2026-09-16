/**
 * Alias — preferuj /api/ovt-sheet?brand=pokladamee
 */
import ovtHandler from './ovt-sheet'

export default function pokladameeHandler(req, res) {
  if (!req.query || typeof req.query !== 'object') {
    req.query = {}
  }
  req.query.brand = 'pokladamee'
  return ovtHandler(req, res)
}
