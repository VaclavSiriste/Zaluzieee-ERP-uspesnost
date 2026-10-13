import { useEffect, useState } from 'react'

/**
 * Přejezdy OVT z kalendáře (plánovaný čas) po krajích cílové schůzky.
 */

function num(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

function minutes(value) {
  if (value == null) return '—'
  return `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} min`
}

function Row({ region, isTotal = false }) {
  return (
    <tr className={`${region.service ? 'is-service' : ''}${isTotal ? ' rf-total' : ''}`}>
      <td className="rf-name">{region.name}</td>
      <td className="rf-leads">{num(region.prejezdu)}</td>
      <td className="rf-leads">{num(region.ovt_count)}</td>
      <td className="rf-rate">
        <strong>{minutes(region.avg_min)}</strong>
      </td>
      <td className="rf-rate">{minutes(region.median_min)}</td>
    </tr>
  )
}

export default function OvtTravelPanel({ brandId, brandLabel, period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

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
        const response = await fetch(`/api/ovt-travel?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst přejezdy OVT')
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
      <h2 className="sla-block-title">Přejezdy OVT (kalendář)</h2>
      <p className="sla-block-desc">
        {brandLabel}. Plánovaný čas přejezdu z kalendáře ERP — bloky „Přejezd“, které operátoři
        zapisují při plánování (ne skutečná jízda). Jen OVT, kteří mají ten den v kalendáři
        nastavenou směnu. Kraj = kraj zákazníka zaměření, na které OVT
        po přejezdu jede (stejný den). Přejezdy bez navazujícího zaměření (montáž, cesta domů…)
        zvlášť. Bloky se plánují po 30 min, proto medián často vychází 30 min. Zvýrazněné jsou kraje,
        kam jezdíme.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {loading ? (
        <div className="sla-loading">
          <span className="pauses-spinner" />
          Načítám přejezdy…
        </div>
      ) : null}
      {!loading && data ? (
        data.totals.prejezdu ? (
          <div className="fronty-table-wrap">
            <table className="sla-cmp-table rf-table">
              <thead>
                <tr>
                  <th>Kraj</th>
                  <th>Přejezdů</th>
                  <th>OVT</th>
                  <th>Průměr přejezdu</th>
                  <th>Medián</th>
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
          <p className="sla-cmp-note">V tomto období nejsou v kalendáři žádné přejezdy.</p>
        )
      ) : null}
    </section>
  )
}
