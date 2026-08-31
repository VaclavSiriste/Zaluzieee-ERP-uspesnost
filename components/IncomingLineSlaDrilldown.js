import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ')
}

function formatSeconds(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ')} s`
}

export default function IncomingLineSlaDrilldown({ open, onClose, drilldown, filters }) {
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
          ...(filters.endDate ? { endDate: filters.endDate } : {})
        })
        const response = await fetch(`/api/incoming-line-sla-items?${params}`)
        const payload = await response.json()
        if (!response.ok || payload.error) {
          throw new Error(payload.error || `HTTP ${response.status}`)
        }
        setData((current) => {
          if (offset === 0) return payload
          return {
            ...payload,
            items: [...(current?.items || []), ...payload.items]
          }
        })
      } catch (err) {
        setError(err.message || 'Nepodařilo se načíst detail hovorů')
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

  const title = drilldown.title || data?.label || 'Detail příchozích linek'
  const hasMore = data ? data.items.length < data.total : false

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="incoming-line-sla-drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="incoming-line-sla-drilldown-title">{title}</h2>
            <p className="drilldown-subtitle">
              Daktela · příchozí linky · SLA do 20 s · propojení na zakázku podle telefonu
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
            Načítání hovorů…
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data ? (
          <div className="drilldown-body">
            <div className="drilldown-orders-pane">
              {data.items.length === 0 ? (
                <div className="drilldown-status">Žádné záznamy v zvoleném období.</div>
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>Čas hovoru</th>
                        <th>Telefon</th>
                        <th>Čekání</th>
                        <th>SLA 20 s</th>
                        <th>Operátor</th>
                        <th>Linka / fronta</th>
                        <th>Zakázka</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item) => (
                        <tr key={item.call_id}>
                          <td>{formatDateTime(item.call_time)}</td>
                          <td>{item.clid || '—'}</td>
                          <td>{formatSeconds(item.response_seconds)}</td>
                          <td>
                            <strong className={item.within_sla_20s ? 'success' : ''}>
                              {item.answered ? (item.within_sla_20s ? 'ANO' : 'NE') : '—'}
                            </strong>
                          </td>
                          <td>{item.operator_name}</td>
                          <td>{item.queue_name}</td>
                          <td>{item.order_id || '—'}</td>
                          <td>
                            {item.detail_url ? (
                              <a
                                href={item.detail_url}
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
