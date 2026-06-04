import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { formatStatusLabel } from '@/lib/metrics-query'
import { formatDurationDays, isDurationMetric } from '@/lib/duration-metrics'

function formatMoney(value) {
  return new Intl.NumberFormat('cs-CZ', {
    maximumFractionDigits: 0
  }).format(Number(value || 0))
}

function statusClass(status) {
  if (status === 'ano') return 'success'
  if (status === 'ne') return 'danger'
  if (status === 'cekame') return 'waiting'
  return 'neutral'
}

function buildQueryParams(drilldown, filters, offset) {
  return new URLSearchParams({
    metric: drilldown.metric,
    period: filters.period,
    dateBasis: filters.dateBasis,
    offset: String(offset),
    limit: '50',
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {}),
    ...(drilldown.region ? { region: drilldown.region } : {}),
    ...(filters.region && !drilldown.region ? { region: filters.region } : {}),
    ...(drilldown.operator ? { operator: drilldown.operator } : {}),
    ...(drilldown.zamerovac ? { zamerovac: drilldown.zamerovac } : {}),
    ...(drilldown.domluvil ? { domluvil: drilldown.domluvil } : {}),
    ...(drilldown.obchodnik ? { obchodnik: drilldown.obchodnik } : {}),
    ...(drilldown.category ? { category: drilldown.category } : {}),
    ...(drilldown.failedReason ? { failedReason: drilldown.failedReason } : {})
  })
}

export default function MetricDrilldown({ open, onClose, drilldown, filters, onRefine }) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [offset, setOffset] = useState(0)
  const [view, setView] = useState('cards')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open || !drilldown) return
    setOffset(0)
    setView('cards')
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
        const params = buildQueryParams(drilldown, filters, offset)
        const response = await fetch(`/api/metrics-orders?${params}`)
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
        setError(err.message || 'Nepodařilo se načíst zakázky')
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

  const title = drilldown.title || data?.label || 'Seznam zakázek'
  const subtitleParts = []
  if (drilldown.region) subtitleParts.push(drilldown.region)
  if (drilldown.operator) subtitleParts.push(drilldown.operator)
  if (drilldown.zamerovac) subtitleParts.push(`Zaměřovač: ${drilldown.zamerovac}`)
  if (drilldown.domluvil) subtitleParts.push(`Domluvil: ${drilldown.domluvil}`)
  if (drilldown.obchodnik) subtitleParts.push(`Obchodník: ${drilldown.obchodnik}`)
  if (filters.region && !drilldown.region) subtitleParts.push(`Filtr kraje: ${filters.region}`)

  function refine(next) {
    if (onRefine) {
      onRefine({ ...drilldown, ...next })
    }
  }

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drilldown-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="drilldown-title">{title}</h2>
            {subtitleParts.length > 0 ? (
              <p className="drilldown-subtitle">{subtitleParts.join(' · ')}</p>
            ) : null}
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
            Načítání zakázek...
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        {data ? (
          <div className="drilldown-body">
            {data.summary ? (
              <div className="drilldown-summary">
                {data.summary.by_status.length > 0 ? (
                  <section className="drilldown-summary-block">
                    <h3>Rozpad podle stavu</h3>
                    <div className="drilldown-chip-grid">
                      {data.summary.by_status.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className={`drilldown-chip drilldown-chip-${statusClass(item.key)}`}
                          onClick={() => refine({
                            metric: item.key === 'ano' ? 'completed'
                              : item.key === 'ne' ? 'cancelled'
                                : item.key === 'cekame' ? 'waiting'
                                  : item.key === 'bez_hodnoty' ? 'missing' : 'category',
                            category: ['ano', 'ne', 'cekame', 'bez_hodnoty'].includes(item.key) ? undefined : item.key,
                            title: `${title} — ${item.label}`
                          })}
                        >
                          <span className="drilldown-chip-value">{item.count.toLocaleString('cs-CZ')}</span>
                          <span className="drilldown-chip-label">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {data.summary.by_region.length > 0 ? (
                  <section className="drilldown-summary-block">
                    <h3>Rozpad podle krajů</h3>
                    <div className="drilldown-region-grid">
                      {data.summary.by_region.map((item) => (
                        <button
                          key={item.region}
                          type="button"
                          className="drilldown-region-card"
                          onClick={() => refine({
                            region: item.region,
                            title: `${title} — ${item.region}`
                          })}
                        >
                          <strong>{item.count.toLocaleString('cs-CZ')}</strong>
                          <span>{item.region}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}

                {data.summary.by_reason.length > 0 ? (
                  <section className="drilldown-summary-block">
                    <h3>Důvody NE</h3>
                    <div className="drilldown-chip-grid">
                      {data.summary.by_reason.map((item) => (
                        <button
                          key={item.key}
                          type="button"
                          className="drilldown-chip drilldown-chip-danger"
                          onClick={() => refine({
                            metric: 'cancelled',
                            failedReason: item.key,
                            title: `${title} — ${item.label}`
                          })}
                        >
                          <span className="drilldown-chip-value">{item.count.toLocaleString('cs-CZ')}</span>
                          <span className="drilldown-chip-label">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                ) : null}
              </div>
            ) : null}

            {data.orders?.length > 0 ? (
              <div className="drilldown-orders-pane">
                <div className="drilldown-toolbar">
                  <div className="drilldown-view-toggle">
                    <button
                      type="button"
                      className={view === 'cards' ? 'active' : ''}
                      onClick={() => setView('cards')}
                    >
                      Karty
                    </button>
                    <button
                      type="button"
                      className={view === 'table' ? 'active' : ''}
                      onClick={() => setView('table')}
                    >
                      Tabulka
                    </button>
                  </div>
                </div>

                {view === 'cards' ? (
                  <div className="drilldown-orders-grid">
                    {data.orders.map((order) => (
                      <article key={order.order_id} className="drilldown-order-card">
                        <div className="drilldown-order-card-top">
                          <span className={`drilldown-status-pill drilldown-status-pill-${statusClass(order.dopadlo_status)}`}>
                            {formatStatusLabel(order.dopadlo_status)}
                          </span>
                          <span className="drilldown-order-id">#{order.order_id}</span>
                        </div>
                        <h4>{order.customer_name}</h4>
                        {order.customer_phone ? (
                          <p className="drilldown-muted">{order.customer_phone}</p>
                        ) : null}
                        <div className="drilldown-order-meta">
                          <span>{order.region}</span>
                          {order.filter_date ? <span>{order.filter_date}</span> : null}
                          {order.duration_days != null ? (
                            <span>{formatDurationDays(order.duration_days)}</span>
                          ) : null}
                          <span>{formatMoney(order.total_with_vat)} Kč</span>
                        </div>
                        {order.failed_reason ? (
                          <p className="drilldown-order-reason">Důvod: {order.failed_reason}</p>
                        ) : null}
                        <div className="drilldown-order-people">
                          {order.zamerovac_name ? <span>OVT: {order.zamerovac_name}</span> : null}
                          {order.domluvil_name ? <span>Domluvil: {order.domluvil_name}</span> : null}
                        </div>
                        <a
                          href={order.detail_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="drilldown-detail-link"
                        >
                          Otevřít v Systeeem →
                        </a>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className="drilldown-table-wrap table-scroll">
                    <table className="leaderboard-table drilldown-table">
                      <thead>
                        <tr>
                          <th>ID</th>
                          <th>Zákazník</th>
                          <th>Kraj</th>
                          <th>Stav</th>
                          <th>Důvod NE</th>
                          <th>Zaměřovač</th>
                          <th>Datum</th>
                          {data?.metric && isDurationMetric(data.metric) ? <th>Délka</th> : null}
                          <th>Cena s DPH</th>
                          <th>Detail</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.orders.map((order) => (
                          <tr key={order.order_id}>
                            <td>{order.order_id}</td>
                            <td>
                              <strong>{order.customer_name}</strong>
                              {order.customer_phone ? (
                                <div className="drilldown-muted">{order.customer_phone}</div>
                              ) : null}
                            </td>
                            <td>{order.region}</td>
                            <td>{formatStatusLabel(order.dopadlo_status)}</td>
                            <td>{order.failed_reason || '—'}</td>
                            <td>{order.zamerovac_name}</td>
                            <td>{order.filter_date || '—'}</td>
                            {data?.metric && isDurationMetric(data.metric) ? (
                              <td>{order.duration_days != null ? formatDurationDays(order.duration_days) : '—'}</td>
                            ) : null}
                            <td>{formatMoney(order.total_with_vat)} Kč</td>
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
              </div>
            ) : null}
          </div>
        ) : null}

        {!loading && data && data.orders.length === 0 ? (
          <div className="drilldown-status">Žádné zakázky pro tuto metriku.</div>
        ) : null}

        {data?.hasMore ? (
          <footer className="drilldown-footer">
            <button
              type="button"
              className="drilldown-load-more"
              onClick={() => setOffset((current) => current + 50)}
              disabled={loading}
            >
              {loading ? 'Načítání...' : 'Načíst další'}
            </button>
          </footer>
        ) : null}
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
