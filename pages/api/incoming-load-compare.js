/**
 * Nápor + odmítnuté — MTD vs minulý měsíc (stejný kalendářní den)
 * GET /api/incoming-load-compare?brand=cz
 */

import { resolveOperationsBrand } from '@/lib/operations-brands'
import { fetchIncomingLoadCompare } from '@/lib/incoming-load-compare'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const brandId = typeof req.query.brand === 'string' ? req.query.brand : 'cz'
  const brand = resolveOperationsBrand(brandId)
  if (!brand) {
    return res.status(400).json({ error: `Neznámá značka: ${brandId}` })
  }

  try {
    const data = await fetchIncomingLoadCompare({ brandId: brand.id })
    return res.status(200).json({
      brand: brand.id,
      brandLabel: brand.pageTitle,
      source: 'daktela',
      ...data
    })
  } catch (error) {
    console.error('incoming-load-compare:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení náporu / odmítnutých' })
  }
}
