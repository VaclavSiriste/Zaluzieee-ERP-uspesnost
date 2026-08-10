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

function isPauseMetric(metric) {
  return !metric || metric === 'pauses' || metric === 'admin' || metric === 'idle'
}

function isErpMetric(metric) {
  return (
    metric === 'dopadl_hovor_ano' ||
    metric === 'dopadl_hovor_pocet' ||
    metric === 'domluveno_zamereni_ano' ||
    metric === 'domluveno_zamereni_pocet' ||
    metric === 'erp_hovory_ano' ||
    metric === 'erp_hovory_pocet'
  )
}

function buildQueryParams(drilldown, filters, offset, typeFilter = null) {
  const metric = drilldown.metric || 'pauses'
  const base = {
    period: filters.period,
    offset: String(offset),
    limit: '50',
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {})
  }

  if (isPauseMetric(metric)) {
    const pauseId = typeFilter?.pause || drilldown.pause || ''
    const pauseNameRaw = typeFilter?.pauseName || drilldown.pauseName || ''
    const pauseName = pauseId ? '' : pauseNameRaw
    return new URLSearchParams({
      ...base,
      ...(drilldown.operator ? { operator: drilldown.operator } : {}),
      ...(pauseId ? { pause: pauseId } : {}),
      ...(pauseName ? { pauseName } : {}),
      ...(metric === 'admin' || metric === 'idle' ? { pauseGroup: metric } : {}),
      ...(!drilldown.operator && Array.isArray(drilldown.excludeOperators) && drilldown.excludeOperators.length
        ? { excludeOperators: drilldown.excludeOperators.join(',') }
        : {})
    })
  }

  if (isErpMetric(metric)) {
    return new URLSearchParams({
      ...base,
      metric,
      operatorName: drilldown.operatorName || ''
    })
  }

  return new URLSearchParams({
    ...base,
    metric,
    ...(drilldown.operator ? { operator: drilldown.operator } : {})
  })
}

function emptyLabel(metric) {
  if (isPauseMetric(metric)) return 'Žádné pauzy v zvoleném období.'
  if (isErpMetric(metric)) return 'Žádné leady v zvoleném období.'
  if (metric === 'login') return 'Žádná přihlášení v zvoleném období.'
  if (metric === 'emails') return 'Žádné maily v zvoleném období.'
  if (metric === 'activity') return 'Žádné hovory ani maily v zvoleném období.'
  return 'Žádné hovory v zvoleném období.'
}

function resolveEndpoint(metric, params) {
  if (isPauseMetric(metric)) return `/api/operator-pause-sessions?${params}`
  if (isErpMetric(metric)) return `/api/operator-erp-orders?${params}`
  return `/api/operator-metric-sessions?${params}`
}

export default function PauseDrilldown({ open, onClose, drilldown, filters }) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [offset, setOffset] = useState(0)
  const [typeFilter, setTypeFilter] = useState(null)
  const [typeSummary, setTypeSummary] = useState([])

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open || !drilldown) return
    setOffset(0)
    setData(null)
    setError('')
    setLoading(true)
    setTypeFilter(null)
    setTypeSummary([])
  }, [open, drilldown])

  useEffect(() => {
    if (!open || !drilldown) return

    async function fetchSessions() {
      setLoading(true)
      setError('')
      try {
        const metric = drilldown.metric || 'pauses'
        const params = buildQueryParams(drilldown, filters, offset, typeFilter)
        const response = await fetch(resolveEndpoint(metric, params))
        const payload = await response.json()
        if (!response.ok || payload.error) {
          throw new Error(payload.error || `HTTP ${response.status}`)
        }

        let normalized
        if (isPauseMetric(metric)) {
          normalized = {
            ...payload,
            kind: 'sessions',
            by_type: payload.by_type || [],
            items: (payload.sessions || []).map((session) => ({
              id: session.session,
              kind: 'pause',
              operator_name: session.operator_name,
              label: session.pause_name,
              detail: null,
              start_time: session.start_time,
              end_time: session.end_time,
              duration_seconds: session.duration_seconds
            }))
          }
        } else if (isErpMetric(metric)) {
          normalized = {
            ...payload,
            kind: 'orders',
            items: payload.orders || [],
            duration_seconds: 0
          }
        } else {
          normalized = {
            ...payload,
            kind: 'sessions',
            items: payload.items || []
          }
        }

        setData((current) => {
          if (offset === 0) return normalized
          return {
            ...normalized,
            items: [...(current?.items || []), ...(normalized.items || [])]
          }
        })

        if (isPauseMetric(metric) && offset === 0 && !typeFilter) {
          setTypeSummary(normalized.by_type || [])
        }
      } catch (err) {
        setError(err.message || 'Nepodařilo se načíst rozpad')
        if (offset === 0) setData(null)
      } finally {
        setLoading(false)
      }
    }

    fetchSessions()
  }, [open, drilldown, filters, offset, typeFilter])

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

  const metric = drilldown.metric || 'pauses'
  const title = drilldown.title || 'Rozpad metriky'
  const hasMore = data ? data.items.length < data.total : false
  const showEnd = isPauseMetric(metric) || metric === 'login'
  const isOrders = data?.kind === 'orders' || isErpMetric(metric)
  const showTypeSummary = isPauseMetric(metric) && typeSummary.length > 0
  const activePauseId = typeFilter?.pause || drilldown.pause || ''
  const activePauseName = typeFilter?.pauseName || drilldown.pauseName || ''
  const erpValueHeader =
    metric === 'domluveno_zamereni_ano' || metric === 'domluveno_zamereni_pocet'
      ? 'Naplánován termín'
      : 'Dopadl hovor'

  function selectPauseType(type) {
    const next = {
      pause: type.pause_id || '',
      pauseName: type.pause_name || ''
    }
    const isSame =
      (activePauseId && next.pause && activePauseId === next.pause) ||
      (!activePauseId && !next.pause && activePauseName === next.pauseName)
    setOffset(0)
    setData(null)
    setTypeFilter(isSame ? null : next)
  }

  function clearPauseTypeFilter() {
    if (!typeFilter) return
    setOffset(0)
    setData(null)
    setTypeFilter(null)
  }

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
            {drilldown.subtitle ? <p className="drilldown-subtitle">{drilldown.subtitle}</p> : null}
            {data ? (
              <p className="drilldown-meta">
                Nalezeno <strong>{data.total.toLocaleString('cs-CZ')}</strong>
                {isOrders ? ' leadů' : isPauseMetric(metric) ? ' pauz' : ' záznamů'}
                {!isOrders ? ` · ${formatDuration(data.duration_seconds || 0)}` : null}
                {typeFilter?.pauseName ? ` · filtr: ${typeFilter.pauseName}` : null}
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
            Načítání rozpadu...
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data || showTypeSummary ? (
          <div className="drilldown-body">
            {showTypeSummary ? (
              <aside className="drilldown-summary">
                <section className="drilldown-summary-block">
                  <h3>Součty podle typu pauzy</h3>
                  {typeFilter ? (
                    <button
                      type="button"
                      className="drilldown-chip drilldown-chip-neutral"
                      onClick={clearPauseTypeFilter}
                      style={{ marginBottom: 12, width: '100%' }}
                    >
                      <span className="drilldown-chip-label">Zrušit filtr typu</span>
                      <span className="drilldown-chip-value" style={{ fontSize: 16 }}>
                        Zobrazit všechny typy
                      </span>
                    </button>
                  ) : null}
                  <div className="drilldown-chip-grid">
                    {typeSummary.map((type) => {
                      const selected =
                        (activePauseId && type.pause_id && activePauseId === type.pause_id) ||
                        (!activePauseId &&
                          activePauseName &&
                          activePauseName === type.pause_name)
                      return (
                        <button
                          key={`${type.pause_id || 'x'}-${type.pause_name}`}
                          type="button"
                          className={`drilldown-chip ${selected ? 'drilldown-chip-success' : 'drilldown-chip-neutral'}`}
                          onClick={() => selectPauseType(type)}
                          title="Kliknutím filtrujte sessions podle typu"
                        >
                          <span className="drilldown-chip-value">
                            {formatDuration(type.duration_seconds)}
                          </span>
                          <span className="drilldown-chip-label">
                            <strong>{type.pause_name}</strong>
                            <br />
                            {type.sessions.toLocaleString('cs-CZ')}×
                          </span>
                        </button>
                      )
                    })}
                  </div>
                </section>
              </aside>
            ) : null}

            <div className="drilldown-orders-pane">
              {!data ? (
                <div className="drilldown-status drilldown-loading">
                  <div className="drilldown-spinner" />
                  Načítání sessions...
                </div>
              ) : data.items.length === 0 ? (
                <div className="drilldown-status">{emptyLabel(metric)}</div>
              ) : isOrders ? (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Zákazník</th>
                        <th>Kraj</th>
                        <th>Operátor</th>
                        <th>{erpValueHeader}</th>
                        {metric === 'erp_hovory_ano' || metric === 'erp_hovory_pocet' ? (
                          <th>Důvod ne</th>
                        ) : null}
                        <th>Datum navolání</th>
                        <th>Detail</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((order) => (
                        <tr key={`order-${order.order_id}`}>
                          <td>{order.order_id}</td>
                          <td>
                            <strong>{order.customer_name}</strong>
                          </td>
                          <td>{order.region}</td>
                          <td>{order.operator_name}</td>
                          <td>
                            {order.metric_value ||
                              order.naplanovan_termin_zamereni ||
                              order.dopadl_hovor ||
                              '—'}
                          </td>
                          {metric === 'erp_hovory_ano' || metric === 'erp_hovory_pocet' ? (
                            <td>{order.proc_nedopadl_hovor || '—'}</td>
                          ) : null}
                          <td>{order.filter_date || '—'}</td>
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
              ) : (
                <div className="drilldown-table-wrap table-scroll">
                  <table className="leaderboard-table drilldown-table">
                    <thead>
                      <tr>
                        <th>Operátor</th>
                        <th>Typ</th>
                        <th>Detail</th>
                        <th>Začátek</th>
                        {showEnd ? <th>Konec</th> : null}
                        <th>Délka</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map((item) => (
                        <tr key={`${item.kind}-${item.id}`}>
                          <td>{item.operator_name}</td>
                          <td>
                            <strong>{item.label}</strong>
                          </td>
                          <td>{item.detail || '—'}</td>
                          <td>{formatDateTime(item.start_time)}</td>
                          {showEnd ? <td>{formatDateTime(item.end_time)}</td> : null}
                          <td>{formatDuration(item.duration_seconds)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {data && hasMore ? (
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
