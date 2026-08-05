import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('cs-CZ')
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ')
}

function formatHours(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 4
  })} h`
}

export default function SlaDrilldown({ open, onClose, drilldown, filters }) {
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
    if (!open || !drilldown) return

    async function fetchOrders() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          metric: drilldown.metric,
          period: filters.period,
          offset: String(offset),
          limit: '50',
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {})
        })
        const response = await fetch(`/api/vycet-sla-orders?${params}`)
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
        setError(err.message || 'Nepodařilo se načíst leady')
        if (offset === 0) setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchOrders()
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

  const title = drilldown.title || data?.label || 'Seznam leadů'
  const hasMore = data ? data.orders.length < data.total : false
  const isCalendar = data?.mode === 'calendar' || ['poptavky', 'sla24', 'sla48', 'sla72'].includes(drilldown.metric)

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="sla-drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="sla-drilldown-title">{title}</h2>
            <p className="drilldown-subtitle">
              {isCalendar
                ? 'Kalendářní datum 00:00–23:59 · +2 h posun'
                : 'Business datum 20:00–19:59 · +2 h posun'}
            </p>
            {data ? (
              <p className="drilldown-meta">
                Nalezeno <strong>{data.total.toLocaleString('cs-CZ')}</strong> leadů
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
            Načítání leadů...
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data ? (
          <div className="drilldown-body">
            <div className="drilldown-orders-pane">
              {data.orders.length === 0 ? (
                <div className="drilldown-status">Žádné leady v zvoleném období.</div>
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        {isCalendar ? <th>Kalendářní datum</th> : <th>Business datum</th>}
                        <th>Vznik leadu</th>
                        <th>První kontakt</th>
                        {isCalendar ? (
                          <>
                            <th>Hodiny</th>
                            <th>SLA 24</th>
                            <th>SLA 48</th>
                            <th>SLA 72</th>
                          </>
                        ) : (
                          <th>Voláno</th>
                        )}
                        <th>Stav</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((order) => (
                        <tr key={order.order_id}>
                          <td>{order.order_id}</td>
                          <td>
                            {formatDate(isCalendar ? order.calendar_date : order.business_date)}
                          </td>
                          <td>{formatDateTime(order.created_at)}</td>
                          <td>{formatDateTime(order.first_iframe_change_at)}</td>
                          {isCalendar ? (
                            <>
                              <td>{formatHours(order.hours_to_contact)}</td>
                              <td>
                                <strong className={order.sla24 ? 'success' : ''}>{order.sla24}</strong>
                              </td>
                              <td>
                                <strong className={order.sla48 ? 'success' : ''}>{order.sla48}</strong>
                              </td>
                              <td>
                                <strong className={order.sla72 ? 'success' : ''}>{order.sla72}</strong>
                              </td>
                            </>
                          ) : (
                            <td>
                              <strong className={order.called_flag ? 'success' : ''}>
                                {order.called_flag}
                              </strong>
                            </td>
                          )}
                          <td>{order.status || '—'}</td>
                          <td>
                            <a
                              href={order.detail_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="drilldown-detail-link"
                            >
                              Systeeem →
                            </a>
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
