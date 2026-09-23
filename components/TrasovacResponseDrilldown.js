import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function formatDateTime(value) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  })
}

function formatHours(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const hours = Number(value)
  if (hours < 1) {
    const minutes = Math.round(hours * 60)
    return minutes > 0 ? `${minutes} min` : '< 1 min'
  }
  if (hours >= 48) {
    const days = Math.floor(hours / 24)
    const rest = Math.round(hours % 24)
    return rest > 0 ? `${days} d ${rest} h` : `${days} d`
  }
  return `${hours.toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} h`
}

function formatFirstChange(order) {
  if (!order.first_change_at) return '—'
  const field = order.first_change_field || order.first_change_action || 'změna'
  let value = order.first_change_new
  if (!value) return field
  if (typeof value === 'string' && value.length > 80) {
    try {
      const parsed = JSON.parse(value)
      if (parsed?.user?.name) value = parsed.user.name
      else if (parsed?.assignment_type) value = parsed.assignment_type
      else value = `${value.slice(0, 60)}…`
    } catch {
      value = `${value.slice(0, 60)}…`
    }
  }
  return `${field}: ${value}`
}

export default function TrasovacResponseDrilldown({ open, onClose, drilldown, filters }) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open || !drilldown) return
    setOffset(0)
    setData(null)
    setError('')
    setLoading(true)
  }, [open, drilldown])

  useEffect(() => {
    if (!open || !drilldown) return undefined

    async function fetchItems() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          metric: drilldown.metric,
          period: filters.period,
          offset: String(offset),
          limit: '50',
          ...(filters.brand ? { brand: filters.brand } : {}),
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {}),
          ...(drilldown.brand ? { brand: drilldown.brand } : {}),
          ...(drilldown.duvodReason ? { duvodReason: drilldown.duvodReason } : {})
        })
        const response = await fetch(`/api/trasovac-response-orders?${params}`)
        const payload = await response.json()
        if (!response.ok || payload.error) {
          throw new Error(payload.error || `HTTP ${response.status}`)
        }
        setData((current) => {
          if (offset === 0) return payload
          return {
            ...payload,
            orders: [...(current?.orders || []), ...payload.orders]
          }
        })
      } catch (err) {
        setError(err.message || 'Nepodařilo se načíst detail leadů')
        if (offset === 0) setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchItems()
  }, [open, drilldown, filters, offset])

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  if (!mounted || !open || !drilldown) return null

  const title = drilldown.title || data?.label || 'Fronta trasovačů'
  const hasMore = data ? data.orders.length < data.total : false
  const isWaiting = drilldown.metric === 'waiting'

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="trasovac-drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="trasovac-drilldown-title">{title}</h2>
            <p className="drilldown-subtitle">
              u každého leadu: <strong>datum a čas nastavení stavu</strong> „Čeká na trasovače“ a{' '}
              <strong>datum a čas první změny</strong> (≥ 15 min). Doba = rozdíl těchto časů (z toho
              průměr / medián)
              {isWaiting ? ' · aktuální fronta (snapshot)' : ' · filtr podle data nastavení stavu'}
            </p>
            {data ? (
              <p className="drilldown-meta">
                Nalezeno <strong>{data.total.toLocaleString('cs-CZ')}</strong> záznamů
              </p>
            ) : null}
          </div>
          <button type="button" className="drilldown-close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </header>

        {loading && !data ? (
          <div className="drilldown-status drilldown-loading">
            <div className="drilldown-spinner" />
            Načítání leadů…
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data ? (
          <div className="drilldown-body">
            <div className="drilldown-orders-pane">
              {data.orders.length === 0 ? (
                <div className="drilldown-status">Žádné záznamy.</div>
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Nastavení stavu (datum + čas)</th>
                        <th>První změna (datum + čas)</th>
                        <th>Doba (rozdíl)</th>
                        <th>Důvod ne</th>
                        <th>Co se změnilo</th>
                        <th>Zákazník</th>
                        <th>Kraj</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((order) => (
                        <tr key={`${order.order_id}-${order.entered_at || ''}`}>
                          <td>{order.order_id}</td>
                          <td>{formatDateTime(order.entered_at)}</td>
                          <td>{formatDateTime(order.first_change_at)}</td>
                          <td>
                            <strong>{formatHours(order.hours_to_response)}</strong>
                          </td>
                          <td>{order.duvod_ne_label || 'Bez důvodu ne'}</td>
                          <td>{formatFirstChange(order)}</td>
                          <td>{order.customer_name || '—'}</td>
                          <td>{order.region || '—'}</td>
                          <td>
                            {order.detail_url ? (
                              <a
                                href={order.detail_url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="drilldown-detail-link"
                              >
                                Systeeem →
                              </a>
                            ) : (
                              '—'
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {hasMore ? (
                <div className="drilldown-footer">
                  <button
                    type="button"
                    className="drilldown-load-more"
                    disabled={loading}
                    onClick={() => setOffset((current) => current + 50)}
                  >
                    {loading ? 'Načítám…' : 'Načíst další'}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
