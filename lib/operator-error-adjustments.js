/**
 * Ruční úpravy počtu chyb operátorů (Daktela / Supabase Pohoda CC).
 * ERP chyby lze odebrat z počtu nebo doplnit poznámku; ruční chyby lze přidat/odebrat.
 */

import { getDaktelaPool, resetDaktelaPool } from '@/lib/db-esm'
import { fetchPocetChybOrders } from '@/lib/dopadl-hovor-metrics'
import { formatDateInput } from '@/lib/metrics-query'

const TRANSIENT_DB_ERRORS = [
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  'Connection terminated unexpectedly',
  'terminating connection due to administrator command'
]

function isTransientDbError(error) {
  const message = String(error?.message || '')
  return TRANSIENT_DB_ERRORS.some((needle) => message.includes(needle))
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function queryWithRetry(sql, params = [], attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i += 1) {
    try {
      const pool = getDaktelaPool()
      if (!pool) throw new Error('Chybí DAKTELA_DB_CONNECTION_STRING (Supabase Pohoda CC)')
      return await pool.query(sql, params)
    } catch (error) {
      lastError = error
      if (!isTransientDbError(error) || i === attempts - 1) throw error
      const shouldUseFallback = String(error?.message || '').includes('ENOTFOUND')
      await resetDaktelaPool({ useFallbackOnNext: shouldUseFallback })
      await sleep(250 * (i + 1))
    }
  }
  throw lastError
}

export async function ensureOperatorErrorAdjustmentsTable() {
  await queryWithRetry(`
    CREATE TABLE IF NOT EXISTS operator_error_adjustments (
      id              BIGSERIAL PRIMARY KEY,
      operator_id     TEXT NOT NULL,
      operator_name   TEXT,
      entry_kind      TEXT NOT NULL CHECK (entry_kind IN ('erp', 'manual')),
      erp_order_id    BIGINT,
      erp_error_type  TEXT,
      error_date      DATE,
      auto_reason     TEXT,
      note            TEXT,
      excluded        BOOLEAN NOT NULL DEFAULT FALSE,
      created_at      TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `)
  await queryWithRetry(`
    CREATE INDEX IF NOT EXISTS idx_operator_error_adjustments_operator
      ON operator_error_adjustments (operator_id)
  `)
  await queryWithRetry(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_operator_error_adjustments_erp_key
      ON operator_error_adjustments (operator_id, erp_order_id, erp_error_type)
      WHERE entry_kind = 'erp' AND erp_order_id IS NOT NULL AND erp_error_type IS NOT NULL
  `)
}

export function inclusiveCalendarDays(start, end) {
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate())
  const endDay = new Date(end.getFullYear(), end.getMonth(), end.getDate())
  const msPerDay = 86400000
  return Math.max(1, Math.round((endDay - startDay) / msPerDay) + 1)
}

function erpEntryKey(operatorId, orderId, errorType) {
  return `${operatorId}::${orderId}::${errorType}`
}

function mapAdjustmentRow(row) {
  return {
    id: row.id,
    operator_id: row.operator_id,
    operator_name: row.operator_name || '',
    entry_kind: row.entry_kind,
    erp_order_id: row.erp_order_id != null ? Number(row.erp_order_id) : null,
    erp_error_type: row.erp_error_type || '',
    error_date: row.error_date ? formatDateInput(row.error_date) : null,
    auto_reason: row.auto_reason || '',
    note: row.note || '',
    excluded: Boolean(row.excluded),
    updated_at: row.updated_at
  }
}

export async function fetchAdjustmentsForOperators(operatorIds = []) {
  if (!operatorIds.length) return []
  await ensureOperatorErrorAdjustmentsTable()
  const { rows } = await queryWithRetry(
    `
    SELECT *
    FROM operator_error_adjustments
    WHERE operator_id = ANY($1::text[])
    ORDER BY updated_at DESC, id DESC
    `,
    [operatorIds.map(String)]
  )
  return rows.map(mapAdjustmentRow)
}

function buildAdjustmentMaps(adjustments) {
  const erpByKey = new Map()
  const manual = []
  for (const item of adjustments) {
    if (item.entry_kind === 'manual' && !item.excluded) {
      manual.push(item)
      continue
    }
    if (item.entry_kind === 'erp' && item.erp_order_id != null && item.erp_error_type) {
      erpByKey.set(erpEntryKey(item.operator_id, item.erp_order_id, item.erp_error_type), item)
    }
  }
  return { erpByKey, manual }
}

export function mergeOperatorErrors({ erpOrders, adjustments, operatorId, start, end }) {
  const { erpByKey, manual } = buildAdjustmentMaps(adjustments)
  const startDay = formatDateInput(start)
  const endDay = formatDateInput(end)
  const items = []

  for (const order of erpOrders) {
    const orderId = Number(order.order_id)
    const errorType = order.error_type || order.metric_value || ''
    const key = erpEntryKey(operatorId, orderId, errorType)
    const adj = erpByKey.get(key)
    const excluded = Boolean(adj?.excluded)
    items.push({
      entry_id: adj?.id || null,
      entry_kind: 'erp',
      operator_id: operatorId,
      operator_name: order.operator_name || '',
      erp_order_id: orderId,
      error_type: errorType,
      auto_reason: errorType,
      note: adj?.note || '',
      excluded,
      active: !excluded,
      error_date: order.filter_date || null,
      customer_name: order.customer_name || '—',
      region: order.region || '—',
      status: order.status || '—',
      detail_url: order.detail_url || null
    })
  }

  for (const entry of manual) {
    if (entry.operator_id !== operatorId) continue
    if (!entry.error_date) continue
    if (entry.error_date < startDay || entry.error_date > endDay) continue
    items.push({
      entry_id: entry.id,
      entry_kind: 'manual',
      operator_id: operatorId,
      operator_name: entry.operator_name || '',
      erp_order_id: null,
      error_type: entry.auto_reason || entry.note || 'Ruční záznam',
      auto_reason: entry.auto_reason || '',
      note: entry.note || entry.auto_reason || '',
      excluded: false,
      active: true,
      error_date: entry.error_date,
      customer_name: '—',
      region: '—',
      status: 'Ruční',
      detail_url: null
    })
  }

  items.sort((a, b) => String(b.error_date || '').localeCompare(String(a.error_date || '')))

  const activeItems = items.filter((item) => item.active)
  const periodDays = inclusiveCalendarDays(start, end)
  const count = activeItems.length
  const avgPerDay = count > 0 ? count / periodDays : 0

  return {
    items,
    count,
    erp_total: erpOrders.length,
    excluded_count: items.filter((item) => item.entry_kind === 'erp' && item.excluded).length,
    manual_count: activeItems.filter((item) => item.entry_kind === 'manual').length,
    period_days: periodDays,
    avg_per_day: avgPerDay
  }
}

export async function fetchMergedOperatorErrors({
  start,
  end,
  operatorId,
  operatorName,
  limit = 500,
  offset = 0
}) {
  const erp = await fetchPocetChybOrders({
    start,
    end,
    operatorName,
    limit,
    offset: 0
  })
  const adjustments = await fetchAdjustmentsForOperators([operatorId])
  const merged = mergeOperatorErrors({
    erpOrders: erp.orders || [],
    adjustments,
    operatorId,
    start,
    end
  })
  return {
    ...merged,
    total: merged.count,
    limit,
    offset
  }
}

export async function fetchAdjustedPocetChybByOperator({ start, end, operatorNamesByKey = new Map() }) {
  const erp = await fetchPocetChybOrders({ start, end, operatorName: '', limit: 5000, offset: 0 })
  const operatorIds = [...new Set((erp.orders || []).map((row) => {
    const name = row.operator_name
    return operatorNamesByKey.get(name) || name
  }).filter(Boolean))]

  const adjustments = await fetchAdjustmentsForOperators(operatorIds)
  const byOperator = new Map()

  for (const order of erp.orders || []) {
    const opName = order.operator_name
    const opId = operatorNamesByKey.get(opName) || opName
    if (!byOperator.has(opId)) {
      byOperator.set(opId, { operator_name: opName, erpOrders: [] })
    }
    byOperator.get(opId).erpOrders.push(order)
  }

  for (const adj of adjustments) {
    if (adj.entry_kind === 'manual' && !byOperator.has(adj.operator_id)) {
      byOperator.set(adj.operator_id, { operator_name: adj.operator_name || adj.operator_id, erpOrders: [] })
    }
  }

  const periodDays = inclusiveCalendarDays(start, end)
  const result = new Map()
  for (const [operatorId, bucket] of byOperator.entries()) {
    const merged = mergeOperatorErrors({
      erpOrders: bucket.erpOrders,
      adjustments,
      operatorId,
      start,
      end
    })
    result.set(operatorId, {
      operator_name: bucket.operator_name,
      pocet_chyb: merged.count,
      pocet_chyb_avg_per_day: merged.avg_per_day,
      pocet_chyb_erp_raw: merged.erp_total,
      pocet_chyb_manual: merged.manual_count,
      pocet_chyb_excluded: merged.excluded_count
    })
  }
  return { byOperator: result, periodDays }
}

export async function upsertErpErrorAdjustment({
  operatorId,
  operatorName,
  erpOrderId,
  erpErrorType,
  errorDate,
  autoReason,
  note,
  excluded
}) {
  await ensureOperatorErrorAdjustmentsTable()
  const params = [
    String(operatorId),
    operatorName || null,
    Number(erpOrderId),
    String(erpErrorType),
    errorDate || null,
    autoReason || erpErrorType,
    note || '',
    Boolean(excluded)
  ]
  const existing = await queryWithRetry(
    `
    SELECT id
    FROM operator_error_adjustments
    WHERE operator_id = $1
      AND entry_kind = 'erp'
      AND erp_order_id = $3
      AND erp_error_type = $4
    LIMIT 1
    `,
    params.slice(0, 4)
  )
  if (existing.rows.length) {
    const { rows } = await queryWithRetry(
      `
      UPDATE operator_error_adjustments
      SET
        operator_name = $2,
        error_date = $5::date,
        auto_reason = $6,
        note = NULLIF($7, ''),
        excluded = $8,
        updated_at = NOW()
      WHERE id = $9
      RETURNING *
      `,
      [...params, existing.rows[0].id]
    )
    return mapAdjustmentRow(rows[0])
  }
  const { rows } = await queryWithRetry(
    `
    INSERT INTO operator_error_adjustments (
      operator_id, operator_name, entry_kind, erp_order_id, erp_error_type,
      error_date, auto_reason, note, excluded, updated_at
    )
    VALUES ($1, $2, 'erp', $3, $4, $5::date, $6, NULLIF($7, ''), $8, NOW())
    RETURNING *
    `,
    params
  )
  return mapAdjustmentRow(rows[0])
}

export async function insertManualErrorAdjustment({
  operatorId,
  operatorName,
  errorDate,
  reason,
  note
}) {
  await ensureOperatorErrorAdjustmentsTable()
  const text = String(reason || note || '').trim()
  if (!text) throw new Error('Chybí popis chyby')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(errorDate || ''))) {
    throw new Error('Chybí error_date (YYYY-MM-DD)')
  }
  const { rows } = await queryWithRetry(
    `
    INSERT INTO operator_error_adjustments (
      operator_id, operator_name, entry_kind, error_date, auto_reason, note, excluded, updated_at
    )
    VALUES ($1, $2, 'manual', $3::date, $4, NULLIF($5, ''), FALSE, NOW())
    RETURNING *
    `,
    [String(operatorId), operatorName || null, errorDate, text, note || text]
  )
  return mapAdjustmentRow(rows[0])
}

export async function updateManualErrorAdjustment({ id, note, reason, errorDate }) {
  await ensureOperatorErrorAdjustmentsTable()
  const { rows } = await queryWithRetry(
    `
    UPDATE operator_error_adjustments
    SET
      auto_reason = COALESCE(NULLIF($2, ''), auto_reason),
      note = COALESCE(NULLIF($3, ''), note),
      error_date = COALESCE($4::date, error_date),
      updated_at = NOW()
    WHERE id = $1 AND entry_kind = 'manual'
    RETURNING *
    `,
    [Number(id), reason || '', note || '', errorDate || null]
  )
  if (!rows.length) throw new Error('Ruční záznam nenalezen')
  return mapAdjustmentRow(rows[0])
}

export async function deleteManualErrorAdjustment(id) {
  await ensureOperatorErrorAdjustmentsTable()
  const { rowCount } = await queryWithRetry(
    `DELETE FROM operator_error_adjustments WHERE id = $1 AND entry_kind = 'manual'`,
    [Number(id)]
  )
  if (!rowCount) throw new Error('Ruční záznam nenalezen')
  return { ok: true }
}
