import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'

export default function ObchodniciPage() {
  const router = useRouter()
  const [period, setPeriod] = useState('month')
  const [dateBasis, setDateBasis] = useState('navolani')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [bubbles, setBubbles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!router.isReady) return

    const queryPeriod = typeof router.query.period === 'string' ? router.query.period : ''
    const queryDateBasis = typeof router.query.dateBasis === 'string' ? router.query.dateBasis : ''
    const queryStartDate = typeof router.query.startDate === 'string' ? router.query.startDate : ''
    const queryEndDate = typeof router.query.endDate === 'string' ? router.query.endDate : ''
    const hasCustomRange = Boolean(queryStartDate || queryEndDate)

    if (hasCustomRange) {
      if (period !== 'custom') setPeriod('custom')
    } else if (queryPeriod && queryPeriod !== period) {
      setPeriod(queryPeriod)
    }
    if (queryDateBasis && queryDateBasis !== dateBasis) setDateBasis(queryDateBasis)
    if (queryStartDate !== startDate) setStartDate(queryStartDate)
    if (queryEndDate !== endDate) setEndDate(queryEndDate)
  }, [router.isReady, router.query.period, router.query.dateBasis, router.query.startDate, router.query.endDate])

  useEffect(() => {
    fetchData()
  }, [period, dateBasis, startDate, endDate])

  useEffect(() => {
    if (!router.isReady || loading) return
    const focusName = typeof router.query.focus === 'string' ? router.query.focus : ''
    if (!focusName) return

    const targetId = `zamerovac-${toAnchorId(focusName)}`
    const element = document.getElementById(targetId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [router.isReady, router.query.focus, loading, bubbles])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        period,
        dateBasis,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/obchodnici?${params}`)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setBubbles(data.bubbles || [])
    } catch (err) {
      setError(err.message || 'Nepodařilo se načíst data.')
      setBubbles([])
    } finally {
      setLoading(false)
    }
  }

  function toAnchorId(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  function getOperatorsLink(targetName) {
    const params = new URLSearchParams({
      focus: targetName,
      period,
      dateBasis,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    return `/operators?${params.toString()}`
  }

  function getDateBasisLabel(value) {
    if (value === 'created') return 'data vytvoření'
    if (value === 'zamereni') return 'data zaměření'
    return 'data navolání'
  }

  function formatMoney(value) {
    return new Intl.NumberFormat('cs-CZ', {
      maximumFractionDigits: 0
    }).format(Number(value || 0))
  }

  return (
    <main className="dashboard-container">
      <div className="dashboard-layout">
        <AppMenu active="obchodnici" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Obchodníci</h1>
            <p>Časová osa podle {getDateBasisLabel(dateBasis)} a rozpad výsledků Ano / Ne / Čekáme.</p>
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={setPeriod}
            dateBasis={dateBasis}
            onDateBasisChange={setDateBasis}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={setStartDate}
            onEndDateChange={setEndDate}
          />

          {loading ? <div className="status-message">Načítání...</div> : null}
          {error ? <section className="section-card"><p className="danger">{error}</p></section> : null}

          {!loading && !error ? (
            <div className="bubble-grid">
              {bubbles.map((bubble) => (
                <section
                  key={bubble.zamerovac_name}
                  id={`zamerovac-${toAnchorId(bubble.zamerovac_name)}`}
                  className="bubble-card"
                >
                  <h3>
                    <Link className="operator-jump-link" href={getOperatorsLink(bubble.zamerovac_name)}>
                      {bubble.zamerovac_name}
                    </Link>
                  </h3>
                  <p>
                    Celkem: <strong>{bubble.total}</strong> | Ano: <strong>{bubble.ano}</strong> | Ne: <strong>{bubble.ne}</strong> | Čekáme: <strong>{bubble.cekame}</strong> | Bez výsledku: <strong>{bubble.bez_hodnoty}</strong>
                  </p>
                  <p>
                    Průměr celkové ceny s DPH: <strong>{formatMoney(bubble.avg_sale_with_vat)} Kč</strong> | Průměr celkové ceny bez DPH: <strong>{formatMoney(bubble.avg_sale_without_vat)} Kč</strong>
                  </p>
                  <p className="highlight">Úspěšnost (Ano/(Ano+Ne)): {bubble.success_rate}%</p>

                  <div className="table-scroll bubble-scroll">
                    <table className="leaderboard-table bubble-table">
                      <colgroup>
                        <col className="col-name" />
                        <col className="col-total" />
                        <col className="col-ano" />
                        <col className="col-ne" />
                        <col className="col-cekame" />
                        <col className="col-missing" />
                        <col className="col-avg" />
                        <col className="col-avg2" />
                        <col className="col-success" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Kdo domluvil</th>
                          <th>Celkem</th>
                          <th>Ano</th>
                          <th>Ne</th>
                          <th>Čekáme</th>
                          <th>Bez výsledku</th>
                          <th>Průměr s DPH</th>
                          <th>Průměr bez DPH</th>
                          <th>Úspěšnost</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bubble.obchodnici.map((s) => (
                          <tr key={`${bubble.zamerovac_name}-${s.obchodnik_name}`}>
                            <td>
                              <Link className="operator-jump-link" href={getOperatorsLink(s.obchodnik_name)}>
                                {s.obchodnik_name}
                              </Link>
                            </td>
                            <td>{s.total}</td>
                            <td className="success">{s.ano}</td>
                            <td className="danger">{s.ne}</td>
                            <td>{s.cekame}</td>
                            <td>{s.bez_hodnoty}</td>
                            <td>{formatMoney(s.avg_sale_with_vat)} Kč</td>
                            <td>{formatMoney(s.avg_sale_without_vat)} Kč</td>
                            <td className="highlight">{s.success_rate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              ))}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
