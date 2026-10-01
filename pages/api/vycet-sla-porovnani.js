/**
 * Porovnání SLA: stará metoda (first_iframe_change_at) vs. nová pole
 * (first_contact_at / first_response_minutes). Jen CZ ERP — SK nová pole nemá.
 */

import { getErpPool } from '@/lib/db-esm'
import { formatDateOnly } from '@/lib/metrics-query'
import { fetchSlaComparison } from '@/lib/sla-compare'
import { resolveSlaRange } from '@/lib/sla-metrics'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getErpPool('')
  if (!pool) {
    return res.status(500).json({ error: 'ERP databáze není dostupná' })
  }

  try {
    const { start, end } = resolveSlaRange(req.query)
    const data = await fetchSlaComparison(pool, {
      start,
      end,
      organizationId: req.query.organizationId,
      onlyCovered: req.query.onlyCovered !== '0'
    })
    return res.status(200).json({
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      source: 'erp-db',
      ...data
    })
  } catch (error) {
    console.error('vycet-sla-porovnani:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba porovnání SLA' })
  }
}
