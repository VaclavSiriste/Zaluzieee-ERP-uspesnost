/**
 * Sloupce „Kdo zadal“ a „Volat na“ pro drilldowny se seznamem objednávek.
 * Data doplňuje lib/callback-info (withCallbackInfo) — jen u callbacků / Volat později.
 * Callbacky se řadí vzestupně podle preferovaného data a času, po termínu = červený řádek.
 */

import { compareCallbackDue } from '@/lib/callback-due'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function formatCallbackDay(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})-(\d{2})/)
  if (!match) return value || ''
  return `${Number(match[3])}. ${Number(match[2])}. ${match[1]}`
}

export function formatCallbackWhen(order) {
  return [formatCallbackDay(order.callback_date), order.callback_time].filter(Boolean).join(' ')
}

export function hasCallbacks(orders) {
  return Array.isArray(orders) && orders.some((order) => order.is_callback)
}

/** Callbacky nahoru vzestupně podle termínu (bez termínu na konec callbacků), ostatní v původním pořadí. */
export function sortByCallbackDue(orders) {
  if (!Array.isArray(orders)) return orders
  const callbacks = orders.filter((order) => order.is_callback).sort(compareCallbackDue)
  const rest = orders.filter((order) => !order.is_callback)
  return [...callbacks, ...rest]
}

export function callbackRowClass(order) {
  return order?.is_callback && order.callback_due === 'overdue' ? 'callback-overdue' : ''
}

export function CallbackHeaders() {
  return (
    <>
      <th>Kdo zadal callback</th>
      <th>Volat na ▲</th>
    </>
  )
}

const DUE_LABEL = { overdue: 'po termínu', today: 'dnes', planned: '', missing: '' }

export function CallbackCells({ order }) {
  if (!order.is_callback) {
    return (
      <>
        <td>—</td>
        <td>—</td>
      </>
    )
  }
  const when = formatCallbackWhen(order)
  const dueLabel = DUE_LABEL[order.callback_due] || ''
  return (
    <>
      <td>
        {order.callback_set_by || '—'}
        {order.callback_set_at ? (
          <div className="drilldown-muted">{formatDateTime(order.callback_set_at)}</div>
        ) : null}
      </td>
      <td>
        {when ? <strong>{when}</strong> : <span className="drilldown-muted">bez termínu</span>}
        {dueLabel ? <div className="callback-due-label">{dueLabel}</div> : null}
      </td>
    </>
  )
}
