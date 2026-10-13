import { useEffect, useState } from 'react'

/**
 * Den OVT z kalendáře (SK): zaměření a přejezdy na OVT a den směny, po krajích.
 */

function num(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

function dec(value, digits = 1) {
  if (value == null) return '—'
  return value.toLocaleString('cs-CZ', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function minutes(value) {
  if (value == null) return '—'
  const total = Math.round(value)
  if (total < 60) return `${total} min`
  return `${Math.floor(total / 60)} h ${String(total % 60).padStart(2, '0')} min`
}

function Row({ region, isTotal = false }) {
  return (
    <tr className={`${region.service ? 'is-service' : ''}${isTotal ? ' rf-total' : ''}`}>
      <td className="rf-name">{region.name}</td>
      <td className="rf-leads">{num(region.dni_ovt)}</td>
      <td className="rf-leads">{num(region.ovt_count)}</td>
      <td className="rf-rate">{dec(region.zamereni_na_den)}</td>
      <td className="rf-rate">{dec(region.prejezdu_na_den)}</td>
      <td className="rf-rate">
        <strong>{minutes(region.prejezd_min_na_den)}</strong>
      </td>
      <td className="rf-rate">{minutes(region.min_na_prejezd)}</td>
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
      <h2 className="sla-block-title">Den OVT – zaměření a přejezdy (kalendář)</h2>
      <p className="sla-block-desc">
        {brandLabel}. Průměr na OVT a den směny: za každý den, kdy má OVT v kalendáři nastavenou
        směnu, počet zaměření, počet přejezdů a čas přejezdů. Přejezd = aktivita v kalendáři
        s názvem přesně „Přejezd“ / „přejezd“ (jiné názvy jako „12,8“ nebo „Přejezd domů“ se
        nepočítají), délka = konec − začátek aktivity. Kraj dne = kraj, kde měl OVT ten den nejvíc
        zaměření. Jen proběhlé dny. Zvýrazněné jsou kraje, kam jezdíme.
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {loading ? (
        <div className="sla-loading">
          <span className="pauses-spinner" />
          Načítám přejezdy…
        </div>
      ) : null}
      {!loading && data ? (
        data.totals.dni_ovt ? (
          <div className="fronty-table-wrap">
            <table className="sla-cmp-table rf-table">
              <thead>
                <tr>
                  <th>Kraj</th>
                  <th>
                    Dní OVT
                    <span className="rf-th-sub">OVT × den se směnou</span>
                  </th>
                  <th>OVT</th>
                  <th>Zaměření / den</th>
                  <th>Přejezdů / den</th>
                  <th>
                    Přejezdy / den
                    <span className="rf-th-sub">čas za den</span>
                  </th>
                  <th>Průměrný přejezd</th>
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
          <p className="sla-cmp-note">V tomto období nemá žádný OVT v kalendáři směnu.</p>
        )
      ) : null}
    </section>
  )
}
