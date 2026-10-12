import { useEffect, useState } from 'react'

/**
 * Průměrný počet zaměření na OVT za den, po krajích.
 * Výchozí den = včera (dnešek ještě není uzavřený); šipkami jde den posunout.
 */

function pragueDay(offsetDays = 0) {
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Europe/Prague' })
  const [y, m, d] = today.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + offsetDays)).toISOString().slice(0, 10)
}

function shiftDay(day, delta) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + delta)).toISOString().slice(0, 10)
}

function formatDay(day) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('cs-CZ', {
    weekday: 'long',
    day: 'numeric',
    month: 'numeric',
    year: 'numeric'
  })
}

function num(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

function avg(value) {
  if (value == null) return '—'
  return value.toLocaleString('cs-CZ', { minimumFractionDigits: 1, maximumFractionDigits: 2 })
}

function OvtNames({ list }) {
  if (!list?.length) return null
  return (
    <div className="ovt-load-names">
      {list.map((item) => `${item.name} ${item.count}`).join(' · ')}
    </div>
  )
}

function Row({ region, isTotal = false }) {
  return (
    <tr className={`${region.service ? 'is-service' : ''}${isTotal ? ' rf-total' : ''}`}>
      <td className="rf-name">
        {region.name}
        {isTotal ? null : <OvtNames list={region.ovt} />}
      </td>
      <td className="rf-leads">{num(region.zamereni)}</td>
      <td className="rf-leads">{num(region.ovt_count)}</td>
      <td className="rf-rate">
        <strong>{avg(region.avg_per_ovt)}</strong>
      </td>
      <td className="rf-leads">{region.bez_ovt ? num(region.bez_ovt) : '—'}</td>
    </tr>
  )
}

export default function OvtDailyLoadPanel({ brandId, brandLabel }) {
  const yesterday = pragueDay(-1)
  const [day, setDay] = useState(yesterday)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({ brand: brandId, date: day })
        const response = await fetch(`/api/ovt-daily-load?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst zaměření na OVT')
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
  }, [brandId, day])

  return (
    <section className="sla-block sla-block-nested">
      <div className="rf-head">
        <h2 className="sla-block-title">Zaměření na OVT za den</h2>
        <div className="sla-time-tabs" aria-label="Den">
          <button type="button" className="sla-time-tab" onClick={() => setDay((d) => shiftDay(d, -1))} aria-label="Předchozí den">
            ‹
          </button>
          <input
            type="date"
            className="ovt-load-date"
            value={day}
            max={yesterday}
            onChange={(event) => event.target.value && setDay(event.target.value)}
          />
          <button
            type="button"
            className="sla-time-tab"
            onClick={() => setDay((d) => shiftDay(d, 1))}
            disabled={day >= yesterday}
            aria-label="Další den"
          >
            ›
          </button>
        </div>
      </div>
      <p className="sla-block-desc">
        {brandLabel} · {formatDay(day)}. Počet zaměření (datum zaměření v daný den, bez duplikací
        a reklamací) / počet OVT, kteří ten den v kraji zaměřovali. Výchozí je včerejšek — dnešní den
        ještě není uzavřený. Jeden OVT může zaměřovat ve více krajích, celkový průměr ho počítá jednou.
        {brandId === 'sk' ? ' Zvýrazněné jsou kraje, kam jezdíme.' : ''}
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {loading ? (
        <div className="sla-loading">
          <span className="pauses-spinner" />
          Načítám zaměření…
        </div>
      ) : null}
      {!loading && data ? (
        data.totals.zamereni ? (
          <div className="fronty-table-wrap">
            <table className="sla-cmp-table rf-table">
              <thead>
                <tr>
                  <th>Kraj</th>
                  <th>Zaměření</th>
                  <th>OVT</th>
                  <th>Průměr na OVT</th>
                  <th>
                    Bez OVT
                    <span className="rf-th-sub">nepřiřazený zaměřovač</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.regions.map((region) => (
                  <Row key={region.id} region={region} />
                ))}
                <Row region={data.totals} isTotal />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sla-cmp-note">V tento den nejsou žádná zaměření.</p>
        )
      ) : null}
    </section>
  )
}
