import { useEffect, useState } from 'react'

/** Kategorická paleta (pevné pořadí, nikdy necyklit) + šedá pro „Ostatní“. */
const SERIES = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7']
const OTHER = '#b8bcc6'
/** Barvy tří kategorií v souhrnném koláči. */
const CATEGORY_COLORS = { blocked: '#4a3aa7', lost: '#eb6834', pending: '#2a78d6' }
const MAX_SLICES = SERIES.length

function pct(part, total) {
  if (!total) return '—'
  return `${((part / total) * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

/** Nejvýš 7 výsečí + „Ostatní“ — víc barev už oko nerozliší. */
function toSlices(reasons) {
  const top = reasons.slice(0, MAX_SLICES)
  const rest = reasons.slice(MAX_SLICES)
  const slices = top.map((reason, index) => ({ ...reason, color: SERIES[index] }))
  const restCount = rest.reduce((sum, reason) => sum + reason.count, 0)
  if (restCount) slices.push({ key: 'ostatni', label: `Ostatní (${rest.length})`, count: restCount, color: OTHER, folded: rest })
  return slices
}

function arcPath(cx, cy, rOuter, rInner, a0, a1) {
  // celý kruh → dvě poloviny (SVG arc neumí 360°)
  if (a1 - a0 >= Math.PI * 2 - 1e-6) {
    const mid = a0 + Math.PI
    return `${arcPath(cx, cy, rOuter, rInner, a0, mid)} ${arcPath(cx, cy, rOuter, rInner, mid, a1)}`
  }
  const p = (r, a) => `${cx + r * Math.sin(a)},${cy - r * Math.cos(a)}`
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M${p(rOuter, a0)} A${rOuter},${rOuter} 0 ${large} 1 ${p(rOuter, a1)} L${p(rInner, a1)} A${rInner},${rInner} 0 ${large} 0 ${p(rInner, a0)} Z`
}

function Ring({ items, total, rOuter, rInner, gap = 0.012 }) {
  let angle = 0
  return items.map((item) => {
    const sweep = total ? (item.count / total) * Math.PI * 2 : 0
    const a0 = angle + (items.length > 1 ? gap / 2 : 0)
    const a1 = angle + sweep - (items.length > 1 ? gap / 2 : 0)
    angle += sweep
    if (a1 <= a0) return null
    return (
      <path key={item.key + item.label} d={arcPath(100, 100, rOuter, rInner, a0, a1)} fill={item.color} opacity={item.opacity ?? 1}>
        <title>{`${item.label}: ${item.count} (${pct(item.count, total)})`}</title>
      </path>
    )
  })
}

function Donut({ children, total, caption }) {
  return (
    <svg viewBox="0 0 200 200" className="lr-donut" role="img" aria-label={caption}>
      {children}
      <text x="100" y="96" textAnchor="middle" className="lr-donut-total">
        {total.toLocaleString('cs-CZ')}
      </text>
      <text x="100" y="116" textAnchor="middle" className="lr-donut-caption">
        leadů
      </text>
    </svg>
  )
}

function Legend({ slices, total }) {
  return (
    <ul className="lr-legend">
      {slices.map((slice) => (
        <li key={slice.key + slice.label} title={slice.folded ? slice.folded.map((r) => `${r.label}: ${r.count}`).join('\n') : undefined}>
          <span className="lr-dot" style={{ background: slice.color }} aria-hidden="true" />
          <span className="lr-legend-label">{slice.label}</span>
          <span className="lr-legend-count">{slice.count}</span>
          <span className="lr-legend-pct">{pct(slice.count, total)}</span>
        </li>
      ))}
    </ul>
  )
}

function CategoryPie({ index, category }) {
  const slices = toSlices(category.reasons)
  return (
    <article className="lr-card">
      <header className="lr-card-head">
        <span className="lr-card-num">{index}</span>
        <div>
          <h3 className="lr-card-title">{category.label}</h3>
          <p className="lr-card-hint">{category.hint}</p>
        </div>
      </header>
      {category.total ? (
        <div className="lr-card-body">
          <Donut total={category.total} caption={category.label}>
            <Ring items={slices} total={category.total} rOuter={92} rInner={58} />
          </Donut>
          <Legend slices={slices} total={category.total} />
        </div>
      ) : (
        <p className="lr-empty">V období žádné leady v této kategorii.</p>
      )}
    </article>
  )
}

function SummaryPie({ data }) {
  const inner = data.categories.map((category) => ({
    key: category.key,
    label: category.label,
    count: category.total,
    color: CATEGORY_COLORS[category.key]
  }))
  // vnější prstenec: důvody ve barvě své kategorie, střídavě sytě/světleji
  const outer = data.categories.flatMap((category) =>
    category.reasons.map((reason, i) => ({
      ...reason,
      key: `${category.key}-${reason.key}`,
      color: CATEGORY_COLORS[category.key],
      opacity: i % 2 === 0 ? 0.85 : 0.5
    }))
  )
  return (
    <article className="lr-card lr-card-summary">
      <header className="lr-card-head">
        <span className="lr-card-num">4</span>
        <div>
          <h3 className="lr-card-title">Souhrn všech tří</h3>
          <p className="lr-card-hint">
            Vnitřní kruh = poměr kategorií, vnější = jednotlivé důvody v barvě své kategorie
            (najeďte myší pro název).
          </p>
        </div>
      </header>
      <div className="lr-card-body">
        <Donut total={data.total} caption="Souhrn kategorií">
          <Ring items={outer} total={data.total} rOuter={96} rInner={74} gap={0.006} />
          <Ring items={inner} total={data.total} rOuter={70} rInner={46} />
        </Donut>
        <ul className="lr-legend">
          {data.categories.map((category) => (
            <li key={category.key} className="lr-legend-group">
              <span className="lr-dot" style={{ background: CATEGORY_COLORS[category.key] }} aria-hidden="true" />
              <span className="lr-legend-label">
                <strong>{category.label}</strong>
                <span className="lr-legend-sub">
                  {category.reasons
                    .slice(0, 3)
                    .map((r) => `${r.label} ${pct(r.count, category.total)}`)
                    .join(' · ') || '—'}
                </span>
              </span>
              <span className="lr-legend-count">{category.total}</span>
              <span className="lr-legend-pct">{pct(category.total, data.total)}</span>
            </li>
          ))}
        </ul>
      </div>
    </article>
  )
}

/** Koláče leadů podle důvodu ne hovoru — 3 kategorie + souhrn. Data si načítá sám. */
export default function LeadReasonPies({ brandId, brandLabel, period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          brand: brandId,
          period,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {})
        })
        const response = await fetch(`/api/lead-reasons?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst důvody leadů')
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
  }, [brandId, period, startDate, endDate])

  return (
    <section className="sla-block sla-block-nested">
      <h2 className="sla-block-title">Leady podle důvodu – co nedopadlo a proč</h2>
      <p className="sla-block-desc">
        {brandLabel}. Leady dle data vzniku v období, rozdělené podle „Důvodu ne hovoru“. U každého
        koláče je vidět poměr jednotlivých problémů, čtvrtý ukazuje poměr mezi kategoriemi.
        {data && data.source !== 'erp-db' ? ' Zdroj: OVT sheet (sloupec M), „v řešení“ ze sheetu nepoznáme.' : ''}
      </p>

      {loading && !data ? <div className="sla-loading">Načítám důvody leadů…</div> : null}
      {error ? <p className="danger">Důvody leadů: {error}</p> : null}

      {data && data.total === 0 ? (
        <p className="lr-empty">V období nemá žádný lead vyplněný důvod ne hovoru.</p>
      ) : null}

      {data && data.total > 0 ? (
        <div className="lr-grid">
          {data.categories.map((category, i) => (
            <CategoryPie key={category.key} index={i + 1} category={category} />
          ))}
          <SummaryPie data={data} />
        </div>
      ) : null}

      {data && data.unassigned.length ? (
        <p className="drilldown-muted">
          Nezařazené důvody (nepočítají se):{' '}
          {data.unassigned.map((u) => `${u.key} ${u.count}`).join(', ')}
        </p>
      ) : null}
    </section>
  )
}
