import { useEffect, useState } from 'react'

const GROUPS = [
  { key: 'hour', label: 'Hodiny dne' },
  { key: 'day', label: 'Dny' },
  { key: 'month', label: 'Měsíce' }
]

const MONTHS = ['led', 'úno', 'bře', 'dub', 'kvě', 'čvn', 'čvc', 'srp', 'zář', 'říj', 'lis', 'pro']

/** Pod tímto jmenovatelem je SLA % nespolehlivé → číslo nad sloupcem šedě. */
const LOW_VOLUME = 5

/**
 * Segmenty sloupce podle druhu SLA (zdola nahoru): splněno → zvednuto pozdě → nezvednuto.
 * `pctNote` = jak se počítá SLA % (stejně jako hlavní číslo nad grafem).
 */
const KIND_CONFIG = {
  incoming: {
    unit: 'hovorů',
    segments: [
      { key: 'met', label: 'Zvednuto do 20 s', color: '#2a78d6' },
      { key: 'late', label: 'Zvednuto po 20 s', color: '#9ec5f4' },
      { key: 'missed', label: 'Nezvednuto', color: '#eb6834' }
    ],
    pctNote: 'SLA % = do 20 s / zvednuté'
  },
  incoming30: {
    unit: 'hovorů',
    segments: [
      { key: 'met', label: 'Zvednuto do 30 s', color: '#2a78d6' },
      { key: 'late', label: 'Zvednuto po 30 s', color: '#9ec5f4' },
      { key: 'missed', label: 'Nezvednuto', color: '#eb6834' }
    ],
    pctNote: 'SLA % = do 30 s / všechny příchozí v pracovní době'
  },
  vycet: {
    unit: 'poptávek',
    segments: [
      { key: 'met', label: 'Kontakt do 24 h', color: '#2a78d6' },
      { key: 'missed', label: 'Bez kontaktu do 24 h', color: '#eb6834' }
    ],
    pctNote: 'SLA % = kontakt do 24 h / poptávky'
  },
  trasovac: {
    unit: 'odbavených',
    segments: [
      { key: 'met', label: 'Odbaveno do 12 h', color: '#2a78d6' },
      { key: 'missed', label: 'Odbaveno po 12 h', color: '#eb6834' }
    ],
    pctNote: 'SLA % = do 12 h / odbavené'
  }
}

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

function num(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

/** Rozdělí sloupec na segmenty: splněno / zvednuto pozdě / nezvednuto. */
function splitBucket(kind, b) {
  if (kind === 'incoming' || kind === 'incoming30') {
    return {
      met: b.met,
      late: Math.max(b.answered - b.met, 0),
      missed: Math.max(b.total - b.answered, 0),
      height: b.total
    }
  }
  return { met: b.met, missed: Math.max(b.base - b.met, 0), height: b.base }
}

/** „Hezká“ horní mez osy (1, 2, 2.5, 5 × 10^n). */
function niceMax(value) {
  if (value <= 0) return 1
  const pow = 10 ** Math.floor(Math.log10(value))
  return [1, 2, 2.5, 5, 10].map((s) => s * pow).find((v) => v >= value) || value
}

/**
 * Časový rozpad SLA — počty (barevně splněno / pozdě / nezvednuto) + SLA % nad sloupcem.
 * kind: 'incoming' | 'incoming30' | 'vycet' | 'trasovac'
 */
export default function SlaTimeBreakdown({
  kind,
  brandId,
  period,
  startDate = '',
  endDate = '',
  defaultGroupBy = 'hour'
}) {
  const config = KIND_CONFIG[kind] || KIND_CONFIG.incoming
  const [groupBy, setGroupBy] = useState(defaultGroupBy)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [hover, setHover] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      setHover(null)
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

  const buckets = (data?.buckets || []).map((b) => ({ ...b, parts: splitBucket(kind, b) }))
  const yMax = niceMax(Math.max(0, ...buckets.map((b) => b.parts.height)))
  const width = 960
  const height = 250
  const pad = { top: 24, right: 8, bottom: 28, left: 44 }
  const plotW = width - pad.left - pad.right
  const plotH = height - pad.top - pad.bottom
  const slot = buckets.length ? plotW / buckets.length : plotW
  const barW = Math.max(Math.min(slot - 2, 36), 2)
  const yOf = (value) => pad.top + plotH - (plotH * value) / yMax
  const labelEvery = buckets.length > 16 ? Math.ceil(buckets.length / 16) : 1
  const showPct = barW >= 18
  const hovered = hover != null ? buckets[hover] : null
  const ticks = [0, yMax / 2, yMax]

  return (
    <div className="sla-time">
      <div className="sla-time-head">
        <p className="sla-time-title">Časový rozpad</p>
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
          ? 'Součet za zvolené období podle hodiny, kdy hovor / poptávka přišla.'
          : groupBy === 'day'
            ? 'Každý den zvoleného období.'
            : 'Měsíce letošního roku (filtr období se tady nepoužije).'}{' '}
        Výška sloupce = počet {config.unit}, číslo nad sloupcem = {config.pctNote}.
      </p>

      <ul className="sla-time-legend">
        {config.segments.map((segment) => (
          <li key={segment.key}>
            <span className="sla-time-swatch" style={{ background: segment.color }} aria-hidden="true" />
            {segment.label}
          </li>
        ))}
      </ul>

      {error ? <p className="danger">{error}</p> : null}

      <div
        className={`sla-time-chart${loading ? ' is-loading' : ''}`}
        onMouseLeave={() => setHover(null)}
        aria-busy={loading}
      >
        {loading ? (
          <div className="sla-time-loading">
            <span className="pauses-spinner" /> Načítám…
          </div>
        ) : null}
        {data ? (
          <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="SLA v čase">
            {ticks.map((tick) => (
              <g key={tick}>
                <line x1={pad.left} x2={width - pad.right} y1={yOf(tick)} y2={yOf(tick)} className="sla-time-grid" />
                <text x={pad.left - 6} y={yOf(tick) + 4} className="sla-time-axis" textAnchor="end">
                  {num(Math.round(tick))}
                </text>
              </g>
            ))}
            {buckets.map((b, index) => {
              const x = pad.left + index * slot + (slot - barW) / 2
              let acc = 0
              const stacks = config.segments.map((segment) => {
                const value = b.parts[segment.key] || 0
                const y0 = acc
                acc += value
                return { ...segment, value, y0, y1: acc }
              })
              const lastIndex = stacks.map((stack) => stack.value > 0).lastIndexOf(true)
              const topY = yOf(b.parts.height)
              return (
                <g key={b.bucket} className={hover === index ? 'is-hover' : ''}>
                  {stacks.map((stack, i) =>
                    stack.value > 0 ? (
                      <rect
                        key={stack.key}
                        x={x}
                        y={yOf(stack.y1)}
                        width={barW}
                        // 1 px mezera mezi segmenty
                        height={Math.max(yOf(stack.y0) - yOf(stack.y1) - (i < lastIndex ? 1 : 0), 0.5)}
                        fill={stack.color}
                        rx={i === lastIndex ? 2 : 0}
                      />
                    ) : null
                  )}
                  {showPct && b.pct != null && b.parts.height > 0 ? (
                    <text
                      x={x + barW / 2}
                      y={topY - 5}
                      textAnchor="middle"
                      className={`sla-time-pct${b.base < LOW_VOLUME ? ' is-low' : ''}`}
                    >
                      {Math.round(b.pct)} %
                    </text>
                  ) : null}
                  {index % labelEvery === 0 ? (
                    <text x={x + barW / 2} y={height - 10} className="sla-time-axis" textAnchor="middle">
                      {bucketLabel(groupBy, b.bucket)}
                    </text>
                  ) : null}
                  <rect
                    x={pad.left + index * slot}
                    y={pad.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(index)}
                    onClick={() => setHover(index)}
                  />
                </g>
              )
            })}
          </svg>
        ) : null}
        {hovered ? (
          <div
            className="sla-time-tip"
            style={{ left: `${Math.min(Math.max(((pad.left + (hover + 0.5) * slot) / width) * 100, 12), 88)}%` }}
          >
            <strong>{bucketTitle(groupBy, hovered.bucket)}</strong>
            <span>SLA {pctText(hovered.pct)}</span>
            {config.segments.map((segment) => (
              <span key={segment.key}>
                <span className="sla-time-swatch" style={{ background: segment.color }} aria-hidden="true" />
                {segment.label}: {num(hovered.parts[segment.key])}
              </span>
            ))}
            <span>
              Celkem: {num(hovered.parts.height)} {config.unit}
            </span>
          </div>
        ) : null}
      </div>

      {data && buckets.length ? (
        <details className="sla-cmp-details">
          <summary>Zobrazit jako tabulku</summary>
          <div className="fronty-table-wrap">
            <table className="sla-cmp-table">
              <thead>
                <tr>
                  <th>{GROUPS.find((g) => g.key === groupBy)?.label}</th>
                  <th>Celkem</th>
                  {config.segments.map((segment) => (
                    <th key={segment.key}>{segment.label}</th>
                  ))}
                  <th>SLA %</th>
                </tr>
              </thead>
              <tbody>
                {buckets.map((b) => (
                  <tr key={b.bucket}>
                    <td>{bucketTitle(groupBy, b.bucket)}</td>
                    <td>{num(b.parts.height)}</td>
                    {config.segments.map((segment) => (
                      <td key={segment.key}>{num(b.parts[segment.key])}</td>
                    ))}
                    <td>{pctText(b.pct)}</td>
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
