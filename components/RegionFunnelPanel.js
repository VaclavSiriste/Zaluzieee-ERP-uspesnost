import { useEffect, useState } from 'react'

function pct(value) {
  if (value == null) return '—'
  return `${value.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

function num(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

/** Buňka s počtem a podílem z leadů + tenký pruh (0–100 %). */
function StageCell({ count, rate, tone }) {
  return (
    <td className="rf-stage">
      <div className="rf-stage-top">
        <span className="rf-stage-count">{num(count)}</span>
        <span className="rf-stage-rate">{pct(rate)}</span>
      </div>
      <div className="rf-track">
        {rate != null ? (
          <div className={`rf-bar rf-bar-${tone}`} style={{ width: `${Math.min(Math.max(rate, 0), 100)}%` }} />
        ) : null}
      </div>
    </td>
  )
}

function Row({ region, isTotal = false, venkovky }) {
  return (
    <tr className={`${region.service ? 'is-service' : ''}${isTotal ? ' rf-total' : ''}`}>
      <td className="rf-name">{region.name}</td>
      <td className="rf-leads">{num(region.leads)}</td>
      {venkovky ? null : (
        <>
          <StageCell
            count={region.dopadl_ano}
            rate={region.leads ? (region.dopadl_ano / region.leads) * 100 : null}
            tone="call"
          />
          <td className="rf-rate">{pct(region.navolani_pct)}</td>
        </>
      )}
      <StageCell count={region.zamereni_ano} rate={region.lead_to_zamereni_pct} tone="meet" />
      <StageCell count={region.zakazka} rate={region.lead_to_zakazka_pct} tone="win" />
      <td className="rf-rate">{pct(region.zamereni_to_zakazka_pct)}</td>
      {venkovky ? null : <td className="rf-rate">{num(region.ceka_vysledek)}</td>}
    </tr>
  )
}

/**
 * Konverze po krajích (ERP značky): leady → dopadl hovor → zaměření → zakázka.
 * Kohorta = leady vzniklé ve zvoleném období.
 */
export default function RegionFunnelPanel({ brandId, brandLabel, period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const venkovky = brandId === 'venkovky'

  useEffect(() => {
    let cancelled = false
    async function load() {
      setError('')
      try {
        const params = new URLSearchParams({
          brand: brandId,
          period,
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {})
        })
        const response = await fetch(`/api/region-funnel?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) setError(err.message || 'Nepodařilo se načíst konverzi po krajích')
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [brandId, period, startDate, endDate])

  return (
    <section className="sla-block sla-block-nested">
      <h2 className="sla-block-title">Konverze po krajích</h2>
      <p className="sla-block-desc">
        {brandLabel}. Leady vzniklé v období a kam se dostaly: dopadl hovor → zaměření → zakázka
        (dopadlo zaměření ANO). Procenta jsou z leadů daného kraje. Čerstvé leady ještě nestihly
        projít celým trychtýřem, proto je u krátkého období konverze nižší — pro srovnání krajů
        volte delší období.
        {venkovky ? null : (
          <>
            {' '}
            <strong>Dvě procenta u navolání:</strong> „Dopadl hovor ANO“ = podíl ze všech leadů kraje
            (i těch, kde ANO/NE ještě není vyplněno); „Úspěšnost navolání“ = ANO / (ANO + NE), jen leady
            s vyplněným výsledkem. Souhrnná Úspěšnost navolání nahoře je ANO / (ANO + NE) podle data
            navolání, tady podle data vzniku leadu — proto se může mírně lišit.
          </>
        )}
        {venkovky ? ' Venkovky nevyplňují ANO/NE sloupce — zaměření a zakázka jsou odvozené z jejich stavů.' : ''}
        {brandId === 'sk' ? ' Zvýrazněné jsou kraje, kam jezdíme.' : ''}
      </p>
      {error ? <p className="danger">{error}</p> : null}
      {data ? (
        <div className="fronty-table-wrap">
          <table className="sla-cmp-table rf-table">
            <thead>
              <tr>
                <th>Kraj</th>
                <th>Leady</th>
                {venkovky ? null : (
                  <>
                    <th title="Kolik leadů z kraje má Dopadl hovor = ANO, % ze všech leadů kraje">
                      Dopadl hovor ANO
                      <span className="rf-th-sub">% ze všech leadů</span>
                    </th>
                    <th title="Dopadl hovor ANO / (ANO + NE) — leady bez vyplněného ANO/NE se nepočítají">
                      Úspěšnost navolání
                      <span className="rf-th-sub">ANO / (ANO + NE)</span>
                    </th>
                  </>
                )}
                <th>
                  Zaměření
                  <span className="rf-th-sub">% ze všech leadů</span>
                </th>
                <th>
                  Zakázka
                  <span className="rf-th-sub">% ze všech leadů</span>
                </th>
                <th title="Zakázka / zaměření">Zaměření → zakázka</th>
                {venkovky ? null : <th title="Dopadlo zaměření = čekáme">Čeká na výsledek</th>}
              </tr>
            </thead>
            <tbody>
              {data.regions.map((region) => (
                <Row key={region.id} region={region} venkovky={venkovky} />
              ))}
              <Row region={data.totals} isTotal venkovky={venkovky} />
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  )
}
