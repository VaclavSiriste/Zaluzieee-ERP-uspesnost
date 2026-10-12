/**
 * Fronty — Žaluzieee CZ/SK z ERP (stav objednávek), ostatní značky z Daktely (nenavolané leady)
 * GET /api/fronty?brand=cz|sk|malujemeee|pokladamee|venkovky&period=&startDate=&endDate=
 * Bez brand = všechny fronty Daktela (zpětná kompatibilita).
 */

import { getDaktelaPool, getErpPool } from '@/lib/db-esm'
import { fetchErpQueueBacklog } from '@/lib/erp-queue-backlog'
import { lookupOrdersByPhoneKeys } from '@/lib/erp-phone-orders'
import { resolveDateRange, formatDateOnly } from '@/lib/metrics-query'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'
import { fetchQueueBacklog } from '@/lib/queue-backlog'

async function handleErp(res, brand) {
  const pool = getErpPool(brand.id)
  if (!pool) {
    return res.status(500).json({
      error:
        brand.id === 'sk'
          ? 'SK ERP databáze není dostupná (chybí ERP_SK_DB_CONNECTION_STRING)'
          : 'ERP databáze není dostupná (chybí ERP_DB_CONNECTION_STRING)'
    })
  }
  const data = await fetchErpQueueBacklog(pool, {
    brandId: brand.id,
    organizationId: brand.organizationId
  })
  return res.status(200).json({ brand: brand.id, source: 'erp', ...data })
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const rawBrand = typeof req.query.brand === 'string' ? req.query.brand.trim() : ''
  const brandId = OPERATIONS_BRANDS[rawBrand] ? rawBrand : null

  try {
    if (brandId && OPERATIONS_BRANDS[brandId].frontySource === 'erp') {
      return await handleErp(res, OPERATIONS_BRANDS[brandId])
    }

    const pool = getDaktelaPool()
    if (!pool) {
      return res.status(500).json({ error: 'Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)' })
    }

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
      source: 'daktela',
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
