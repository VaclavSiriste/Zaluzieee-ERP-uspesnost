import { useEffect, useState } from 'react'

/**
 * Průměrný počet zaměření na OVT za pracovní den v období filtru.
 * Průměr = zaměření / (OVT × pracovní dny). SK po krajích, ostatní značky jen celkem.
 */

function formatDay(day) {
  const [y, m, d] = String(day).split('-').map(Number)
  if (!y || !m || !d) return day
  return new Date(y, m - 1, d).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' })
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

function Row({ region, isTotal = false, showNames = false }) {
  return (
    <tr className={`${region.service ? 'is-service' : ''}${isTotal ? ' rf-total' : ''}`}>
      <td className="rf-name">
        {region.name}
        {showNames ? <OvtNames list={region.ovt} /> : null}
      </td>
      <td className="rf-leads">{num(region.zamereni)}</td>
      <td className="rf-leads">{num(region.ovt_count)}</td>
      <td className="rf-rate">
        <strong>{avg(region.avg_per_ovt_day)}</strong>
      </td>
      <td className="rf-leads">{region.bez_ovt ? num(region.bez_ovt) : '—'}</td>
    </tr>
  )
}

export default function OvtDailyLoadPanel({ brandId, brandLabel, period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const byRegion = brandId === 'sk'

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
  }, [brandId, period, startDate, endDate])

  return (
    <section className="sla-block sla-block-nested">
      <h2 className="sla-block-title">Zaměření na OVT za pracovní den</h2>
      <p className="sla-block-desc">
        {brandLabel}
        {data ? ` · ${formatDay(data.startDate)} – ${formatDay(data.endDate)} · ${data.working_days} pracovních dní` : ''}.
        {' '}Průměr = zaměření / (počet OVT × počet pracovních dní). Zaměření = datum zaměření v období,
        bez duplikací a reklamací. Počet OVT = kdo v období aspoň jednou zaměřoval. Pracovní dny Po–Pá
        (svátky se neodečítají), období končí nejpozději včerejškem — dnešek ještě není uzavřený.
        {byRegion
          ? ' OVT jezdící do více krajů se počítá v každém z nich, v řádku Celkem jen jednou. Zvýrazněné jsou kraje, kam jezdíme.'
          : ''}
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
                  <th>{byRegion ? 'Kraj' : ''}</th>
                  <th>Zaměření</th>
                  <th>OVT</th>
                  <th>
                    Průměr na OVT a den
                    <span className="rf-th-sub">zaměření / (OVT × {data.working_days} dní)</span>
                  </th>
                  <th>
                    Bez OVT
                    <span className="rf-th-sub">nepřiřazený zaměřovač</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.regions.map((region) => (
                  <Row key={region.id} region={region} showNames />
                ))}
                <Row region={data.totals} isTotal showNames={!byRegion} />
              </tbody>
            </table>
          </div>
        ) : (
          <p className="sla-cmp-note">
            {data.working_days ? 'V tomto období nejsou žádná zaměření.' : 'Období ještě nemá žádný uzavřený pracovní den.'}
          </p>
        )
      ) : null}
    </section>
  )
}
