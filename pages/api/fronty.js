/**
 * Fronty Daktela — nenavolané leady a jejich stáří
 * GET /api/fronty?brand=cz|sk|malujemeee|pokladamee|venkovky|(prázdné = všechny)&period=&startDate=&endDate=
 */

import { getDaktelaPool } from '@/lib/db-esm'
import { lookupOrdersByPhoneKeys } from '@/lib/erp-phone-orders'
import { resolveDateRange, formatDateOnly } from '@/lib/metrics-query'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'
import { fetchQueueBacklog } from '@/lib/queue-backlog'

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const pool = getDaktelaPool()
  if (!pool) {
    return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
  }

  const rawBrand = typeof req.query.brand === 'string' ? req.query.brand.trim() : ''
  const brandId = OPERATIONS_BRANDS[rawBrand] ? rawBrand : null

  try {
    const { start, end } = resolveDateRange({
      period: typeof req.query.period === 'string' ? req.query.period : 'week',
      startDate: typeof req.query.startDate === 'string' ? req.query.startDate : '',
      endDate: typeof req.query.endDate === 'string' ? req.query.endDate : ''
    })
    const data = await fetchQueueBacklog(pool, { start, end, brandId })

    // Napárovat nejstarší leady na objednávky v ERP (CZ DWH)
    const orderByPhone = await lookupOrdersByPhoneKeys(data.oldest.map((row) => row.phone_key))
    const oldest = data.oldest.map((row) => {
      const order = orderByPhone.get(row.phone_key) || null
      return {
        ...row,
        order_id: order?.order_id || null,
        customer_name: order?.customer_name || null,
        detail_url: order?.detail_url || null
      }
    })

    return res.status(200).json({
      brand: brandId,
      startDate: formatDateOnly(start),
      endDate: formatDateOnly(end),
      ...data,
      oldest
    })
  } catch (error) {
    console.error('fronty:', error.message)
    return res.status(500).json({ error: error.message || 'Chyba načtení front' })
  }
}
