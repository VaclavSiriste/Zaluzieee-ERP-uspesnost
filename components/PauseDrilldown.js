import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min ${s} s`
  return `${s} s`
}

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
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

function buildQueryParams(drilldown, filters, offset) {
  return new URLSearchParams({
    period: filters.period,
    offset: String(offset),
    limit: '50',
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {}),
    ...(drilldown.operator ? { operator: drilldown.operator } : {}),
    ...(drilldown.pause ? { pause: drilldown.pause } : {}),
    ...(drilldown.pauseName && !drilldown.pause ? { pauseName: drilldown.pauseName } : {}),
    ...(!drilldown.operator && Array.isArray(drilldown.excludeOperators) && drilldown.excludeOperators.length
      ? { excludeOperators: drilldown.excludeOperators.join(',') }
      : {})
  })
}

export default function PauseDrilldown({ open, onClose, drilldown, filters }) {
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

    async function fetchSessions() {
      setLoading(true)
      setError('')
      try {
        const params = buildQueryParams(drilldown, filters, offset)
        const response = await fetch(`/api/operator-pause-sessions?${params}`)
        const payload = await response.json()
        if (!response.ok || payload.error) {
          throw new Error(payload.error || `HTTP ${response.status}`)
        }

        setData((current) => {
          if (offset === 0) return payload
          return {
            ...payload,
            sessions: [...(current?.sessions || []), ...payload.sessions]
          }
        })
      } catch (err) {
        setError(err.message || 'Nepodařilo se načíst pauzy')
        if (offset === 0) setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchSessions()
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

  const title = drilldown.title || 'Rozpad pauz'
  const hasMore = data ? data.sessions.length < data.total : false

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="pause-drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="pause-drilldown-title">{title}</h2>
            {drilldown.operatorName ? (
              <p className="drilldown-subtitle">{drilldown.operatorName}</p>
            ) : null}
            {data ? (
              <p className="drilldown-meta">
                Nalezeno <strong>{data.total.toLocaleString('cs-CZ')}</strong> pauz ·{' '}
                {formatDuration(data.duration_seconds)}
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
            Načítání pauz...
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data ? (
          <div className="drilldown-body">
            <div className="drilldown-orders-pane">
              {data.sessions.length === 0 ? (
                <div className="drilldown-status">Žádné pauzy v zvoleném období.</div>
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>Operátor</th>
                        <th>Typ pauzy</th>
                        <th>Začátek</th>
                        <th>Konec</th>
                        <th>Délka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.sessions.map((session) => (
                        <tr key={session.session}>
                          <td>{session.operator_name}</td>
                          <td>
                            <strong>{session.pause_name}</strong>
                          </td>
                          <td>{formatDateTime(session.start_time)}</td>
                          <td>{formatDateTime(session.end_time)}</td>
                          <td>{formatDuration(session.duration_seconds)}</td>
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
