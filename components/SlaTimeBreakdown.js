import { useEffect, useState } from 'react'

const GROUPS = [
  { key: 'hour', label: 'Hodiny dne' },
  { key: 'day', label: 'Dny' },
  { key: 'month', label: 'Měsíce' }
]

const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

/** Pod tímto počtem je procento nespolehlivé → sloupec se ztlumí. */
const LOW_VOLUME = 5

function bucketLabel(groupBy, bucket) {
  if (groupBy === 'hour') return `${bucket}`
  if (groupBy === 'month') return MONTHS[Number(bucket.slice(5, 7)) - 1] || bucket
  return `${Number(bucket.slice(8, 10))}.`
}

function bucketTitle(groupBy, bucket) {
  if (groupBy === 'hour') return `${bucket}:00–${bucket}:59`
  if (groupBy === 'month') return `${MONTHS[Number(bucket.slice(5, 7)) - 1]} ${bucket.slice(0, 4)}`
  const [y, m, d] = bucket.split('-')
  return `${Number(d)}. ${Number(m)}. ${y}`
}

function pctText(value) {
  if (value == null) return '—'
  return `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

/**
 * Časový rozpad SLA % — hodiny dne / dny / měsíce letošního roku.
 * kind: 'incoming' (SLA příchozí linky) | 'vycet' (Výčet SLA 24)
 */
export default function SlaTimeBreakdown({ kind, brandId, period, startDate = '', endDate = '', baseLabel }) {
  const [groupBy, setGroupBy] = useState('hour')
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hover, setHover] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          kind,
          groupBy,
          brand: brandId,
          period,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {})
        })
        const response = await fetch(`/api/sla-time-breakdown?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst rozpad')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [kind, groupBy, brandId, period, startDate, endDate])

  const buckets = data?.buckets || []
  const width = 960
  const height = 220
  const pad = { top: 12, right: 8, bottom: 28, left: 40 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const slot = buckets.length ? plotW / buckets.length : plotW
  const barW = Math.max(Math.min(slot - 2, 36), 2)
  const y = (pct) => pad.top + plotH - (plotH * pct) / 100
  const labelEvery = buckets.length > 16 ? Math.ceil(buckets.length / 16) : 1
  const hovered = hover != null ? buckets[hover] : null

  return (
    <div className="sla-time">
      <div className="sla-time-head">
        <p className="sla-time-title">Časový rozpad SLA %</p>
        <div className="sla-time-tabs" role="tablist" aria-label="Rozpad podle">
          {GROUPS.map((group) => (
            <button
              key={group.key}
              type="button"
              role="tab"
              aria-selected={groupBy === group.key}
              className={`sla-time-tab${groupBy === group.key ? ' is-active' : ''}`}
              onClick={() => setGroupBy(group.key)}
            >
              {group.label}
            </button>
          ))}
        </div>
      </div>
      <p className="sla-time-sub">
        {groupBy === 'hour'
          ? 'Průměr za zvolené období podle hodiny, kdy hovor / poptávka přišla.'
          : groupBy === 'day'
            ? 'Každý den zvoleného období.'
            : 'Měsíce letošního roku (filtr období se tady nepoužije).'}{' '}
        Světlé sloupce = méně než {LOW_VOLUME} {baseLabel} (procento je nespolehlivé).
      </p>

      {loading && !data ? <p className="sla-time-sub">Načítám…</p> : null}
      {error ? <p className="danger">{error}</p> : null}

      {data ? (
        <div className="sla-time-chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="SLA % v čase">
            {[0, 50, 100].map((tick) => (
              <g key={tick}>
                <line
                  x1={pad.left}
                  x2={width - pad.right}
                  y1={y(tick)}
                  y2={y(tick)}
                  className="sla-time-grid"
                />
                <text x={pad.left - 6} y={y(tick) + 4} className="sla-time-axis" textAnchor="end">
                  {tick} %
                </text>
              </g>
            ))}
            {buckets.map((b, index) => {
              const x = pad.left + index * slot + (slot - barW) / 2
              const h = b.pct == null ? 0 : (plotH * b.pct) / 100
              const r = Math.min(4, barW / 2, h)
              const top = pad.top + plotH - h
              const low = b.base < LOW_VOLUME
              return (
                <g key={b.bucket}>
                  {h > 0 ? (
                    <path
                      className={`sla-time-bar${low ? ' is-low' : ''}${hover === index ? ' is-hover' : ''}`}
                      d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    />
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text
                      x={x + barW / 2}
                      y={height - 10}
                      className="sla-time-axis"
                      textAnchor="middle"
                    >
                      {bucketLabel(groupBy, b.bucket)}
                    </text>
                  ) : null}
                  {/* širší neviditelná plocha pro hover */}
                  <rect
                    x={pad.left + index * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(index)}
                  />
                </g>
              )
            })}
          </svg>
          {hovered ? (
            <div
              className="sla-time-tip"
              style={{ left: `${((pad.left + (hover + 0.5) * slot) / width) * 100}%` }}
            >
              <strong>{bucketTitle(groupBy, hovered.bucket)}</strong>
              <span>SLA {pctText(hovered.pct)}</span>
              <span>
                {hovered.met.toLocaleString('cs-CZ')} / {hovered.base.toLocaleString('cs-CZ')} {baseLabel}
              </span>
            </div>
          ) : null}
        </div>
      ) : null}

      {data && buckets.length ? (
        <details className="sla-cmp-details">
          <summary>Zobrazit jako tabulku</summary>
          <div className="fronty-table-wrap">
            <table className="sla-cmp-table">
              <thead>
                <tr>
                  <th>{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                  <th>SLA %</th>
                  <th>Splněno</th>
                  <th>{baseLabel}</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td>{bucketTitle(groupBy, b.bucket)}</td>
                    <td>{pctText(b.pct)}</td>
                    <td>{b.met}</td>
                    <td>{b.base}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  )
}
