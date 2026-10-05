import { useEffect, useState } from 'react'

function pct(value) {
  if (value == null) return '—'
  return `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

/** Úspěšnost navolání podle krajů (SK provoz) — vodorovné sloupce 0–100 %. */
export default function RegionSuccessPanel({ period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const params = new URLSearchParams({
          period,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {})
        })
        const response = await fetch(`/api/navolani-regions?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Nepodařilo se načíst kraje')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [period, startDate, endDate])

  return (
    <section className="sla-block sla-block-nested">
      <h2 className="sla-block-title">Úspěšnost navolání podle krajů</h2>
      <p className="sla-block-desc">
        Dopadl hovor ANO / (ANO + NE), stejná data jako Úspěšnost navolání výše, rozdělená podle
        kraje zákazníka. Zvýrazněné jsou kraje, kam jezdíme.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {data ? (
        <div className="rs-list">
          {data.regions.map((region) => (
            <div key={region.key} className={`rs-row${region.service ? ' is-service' : ''}`}>
              <span className="rs-label">{region.label}</span>
              <div className="rs-track" title={`${region.ano} ANO z ${region.decided}`}>
                {region.success_pct != null ? (
                  <div className="rs-bar" style={{ width: `${Math.max(region.success_pct, 1)}%` }} />
                ) : null}
              </div>
              <span className="rs-value">{pct(region.success_pct)}</span>
              <span className="rs-count">
                {region.ano} / {region.decided}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  )
}
