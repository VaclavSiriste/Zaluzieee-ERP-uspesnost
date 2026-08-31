import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

export default function ErpNavolaniDrilldown({ open, onClose, drilldown, filters }) {
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
          ...(filters.startDate ? { startDate: filters.startDate } : {}),
          ...(filters.endDate ? { endDate: filters.endDate } : {}),
          ...(drilldown.operatorName ? { operatorName: drilldown.operatorName } : {})
        })
        const response = await fetch(`/api/call-success-navolani-orders?${params}`)
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

  const title = drilldown.title || data?.label || 'Detail navolání'
  const hasMore = data ? data.orders.length < data.total : false

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="erp-navolani-drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="erp-navolani-drilldown-title">{title}</h2>
            <p className="drilldown-subtitle">
              ERP · Naplánován termín zaměření / Dopadl hovor · filtr podle data navolání
            </p>
            {data ? (
              <p className="drilldown-meta">
                Nalezeno <strong>{data.total.toLocaleString('cs-CZ')}</strong> zakázek
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
                <div className="drilldown-status">Žádné záznamy v zvoleném období.</div>
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>Datum navolání</th>
                        <th>Zákazník</th>
                        <th>Kraj</th>
                        <th>Operátor</th>
                        <th>Hodnota</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.orders.map((order) => (
                        <tr key={order.order_id}>
                          <td>{order.filter_date || '—'}</td>
                          <td>{order.customer_name || '—'}</td>
                          <td>{order.region || '—'}</td>
                          <td>{order.operator_name || '—'}</td>
                          <td>
                            <strong>
                              {order.metric_value ||
                                order.dopadl_hovor ||
                                order.naplanovan_termin_zamereni ||
                                '—'}
                            </strong>
                          </td>
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
