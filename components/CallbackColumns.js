/**
 * Sloupce „Callback nastavil“ a „Volat na“ pro drilldowny se seznamem objednávek.
 * Data doplňuje lib/callback-info (withCallbackInfo) — jen u callbacků / Volat později.
 */

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

export function hasCallbacks(orders) {
  return Array.isArray(orders) && orders.some((order) => order.is_callback)
}

export function CallbackHeaders() {
  return (
    <>
      <th>Callback nastavil</th>
      <th>Volat na</th>
    </>
  )
}

export function CallbackCells({ order }) {
  if (!order.is_callback) {
    return (
      <>
        <td>—</td>
        <td>—</td>
      </>
    )
  }
  const when = [formatCallbackDay(order.callback_date), order.callback_time].filter(Boolean).join(' ')
  return (
    <>
      <td>
        {order.callback_set_by || '—'}
        {order.callback_set_at ? (
          <div className="drilldown-muted">{formatDateTime(order.callback_set_at)}</div>
        ) : null}
      </td>
      <td>{when || <span className="drilldown-muted">bez termínu</span>}</td>
    </>
  )
}
