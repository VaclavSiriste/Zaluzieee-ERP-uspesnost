/**
 * Počet chyb — seznam s ručními úpravami (Daktela DB)
 * GET    /api/operator-errors?operatorId=&operatorName=&period=&startDate=&endDate=
 * POST   { action: 'manual'|'erp', ... }
 * PUT    { id?, action: 'manual'|'erp', ... }
 * DELETE ?id= (manual) | erp params
 */

import {
  deleteManualErrorAdjustment,
  fetchMergedOperatorErrors,
  insertManualErrorAdjustment,
  updateManualErrorAdjustment,
  upsertErpErrorAdjustment
} from '@/lib/operator-error-adjustments'
import { resolveDateRange } from '@/lib/metrics-query'

function json(res, status, body) {
  res.status(status).json(body)
}

export default async function handler(req, res) {
  try {
    const { start, end } = resolveDateRange({
      startDate: req.query.startDate || req.body?.startDate,
      endDate: req.query.endDate || req.body?.endDate,
      period: req.query.period || req.body?.period || 'month'
    })

    if (req.method === 'GET') {
      const operatorId = String(req.query.operatorId || '').trim()
      const operatorName = String(req.query.operatorName || '').trim()
      if (!operatorId) return json(res, 400, { error: 'Chybí operatorId' })

      const data = await fetchMergedOperatorErrors({
        start,
        end,
        operatorId,
        operatorName
      })
      return json(res, 200, {
        period: req.query.period || 'month',
        start: start.toISOString(),
        end: end.toISOString(),
        operator_id: operatorId,
        operator_name: operatorName,
        ...data
      })
    }

    if (req.method === 'POST') {
      const body = req.body || {}
      if (body.action === 'manual') {
        const row = await insertManualErrorAdjustment({
          operatorId: body.operatorId,
          operatorName: body.operatorName,
          errorDate: body.errorDate,
          reason: body.reason,
          note: body.note
        })
        return json(res, 201, { ok: true, adjustment: row })
      }
      if (body.action === 'erp') {
        const row = await upsertErpErrorAdjustment({
          operatorId: body.operatorId,
          operatorName: body.operatorName,
          erpOrderId: body.erpOrderId,
          erpErrorType: body.erpErrorType,
          errorDate: body.errorDate,
          autoReason: body.autoReason,
          note: body.note,
          excluded: body.excluded
        })
        return json(res, 200, { ok: true, adjustment: row })
      }
      return json(res, 400, { error: 'Neznámá action' })
    }

    if (req.method === 'PUT') {
      const body = req.body || {}
      if (body.action === 'manual') {
        const row = await updateManualErrorAdjustment({
          id: body.id,
          note: body.note,
          reason: body.reason,
          errorDate: body.errorDate
        })
        return json(res, 200, { ok: true, adjustment: row })
      }
      if (body.action === 'erp') {
        const row = await upsertErpErrorAdjustment({
          operatorId: body.operatorId,
          operatorName: body.operatorName,
          erpOrderId: body.erpOrderId,
          erpErrorType: body.erpErrorType,
          errorDate: body.errorDate,
          autoReason: body.autoReason,
          note: body.note,
          excluded: body.excluded
        })
        return json(res, 200, { ok: true, adjustment: row })
      }
      return json(res, 400, { error: 'Neznámá action' })
    }

    if (req.method === 'DELETE') {
      const id = req.query.id || req.body?.id
      if (id) {
        await deleteManualErrorAdjustment(id)
        return json(res, 200, { ok: true })
      }
      const body = req.body || {}
      if (body.action === 'erp' && body.operatorId && body.erpOrderId && body.erpErrorType) {
        await upsertErpErrorAdjustment({
          operatorId: body.operatorId,
          operatorName: body.operatorName,
          erpOrderId: body.erpOrderId,
          erpErrorType: body.erpErrorType,
          errorDate: body.errorDate,
          autoReason: body.autoReason,
          note: body.note || '',
          excluded: false
        })
        return json(res, 200, { ok: true })
      }
      return json(res, 400, { error: 'Chybí id nebo ERP parametry' })
    }

    res.setHeader('Allow', 'GET, POST, PUT, DELETE')
    return json(res, 405, { error: 'Method not allowed' })
  } catch (error) {
    console.error('operator-errors:', error)
    return json(res, 500, { error: error.message || 'Chyba serveru' })
  }
}
