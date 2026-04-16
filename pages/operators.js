import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'

export default function OperatorsPage() {
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

    const focusId = toAnchorId(focusName)
    const target = document.querySelector(`[data-focus-id="${focusId}"]`)
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [router.isReady, router.query.focus, loading, bubbles])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12000)
      const params = new URLSearchParams({
        period,
        dateBasis,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/operators?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setBubbles(data.bubbles || [])
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst data')
      }
      setBubbles([])
    } finally {
      setLoading(false)
    }
  }

  function getObchodniciLink(targetName) {
    const params = new URLSearchParams({
      focus: targetName,
      period,
      dateBasis,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    return `/obchodnici?${params.toString()}`
  }

  function toAnchorId(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
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
        <AppMenu active="operators" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Příjem zakázek</h1>
            <p>Přehled podle {getDateBasisLabel(dateBasis)}. Úspěšnost se počítá z Ano/(Ano+Ne).</p>
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
          {error ? (
            <section className="section-card">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {!loading && !error ? (
            <div className="bubble-grid">
              {bubbles.map((bubble) => (
                <section
                  key={bubble.operator_name}
                  className="bubble-card"
                  data-focus-id={toAnchorId(bubble.operator_name)}
                >
                  <h3>{bubble.operator_name}</h3>
                  <p>
                    Celkem (Ano+Ne): <strong>{bubble.total_decided}</strong> | Ano: <strong>{bubble.ano}</strong> | Ne: <strong>{bubble.ne}</strong> | Čekáme: <strong>{bubble.cekame}</strong> | Bez výsledku: <strong>{bubble.bez_hodnoty}</strong>
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
                          <th>Zaměřovač (OVT)</th>
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
                        {bubble.zamerovaci.map((z) => (
                          <tr key={`${bubble.operator_name}-${z.zamerovac_name}`}>
                            <td>
                              <Link
                                className="operator-jump-link"
                                href={getObchodniciLink(z.zamerovac_name)}
                              >
                                {z.zamerovac_name}
                              </Link>
                            </td>
                            <td>{z.total_decided}</td>
                            <td className="success">{z.ano}</td>
                            <td className="danger">{z.ne}</td>
                            <td>{z.cekame}</td>
                            <td>{z.bez_hodnoty}</td>
                            <td>{formatMoney(z.avg_sale_with_vat)} Kč</td>
                            <td>{formatMoney(z.avg_sale_without_vat)} Kč</td>
                            <td className="highlight">{z.success_rate}%</td>
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
