import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'

export default function NeprobehleZakazkyPzPage() {
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

    const target = document.querySelector(`[data-focus-id="${toAnchorId(focusName)}"]`)
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
      const response = await fetch(`/api/neprobehle-zakazky-pz?${params}`, { signal: controller.signal })
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

  function getDateBasisLabel(value) {
    if (value === 'created') return 'data vytvoření'
    if (value === 'zamereni') return 'data zaměření'
    return 'data navolání'
  }

  function toAnchorId(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  function getOvtLink(targetName) {
    const params = new URLSearchParams({
      focus: targetName,
      period,
      dateBasis,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    return `/neprobehle-zakazky?${params.toString()}`
  }

  return (
    <main className="dashboard-container">
      <div className="dashboard-layout">
        <AppMenu active="failedOrdersPz" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Neproběhlé zakázky PZ</h1>
            <p>
              Přehled podle {getDateBasisLabel(dateBasis)}. Hlavní karta je podle toho,
              kdo domluvil, a uvnitř jsou technici s podílem důvodů
              {' '}
              <strong>ne</strong>
              .
            </p>
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
                  key={bubble.scheduler_name}
                  className="bubble-card"
                  data-focus-id={toAnchorId(bubble.scheduler_name)}
                >
                  <h3>{bubble.scheduler_name}</h3>
                  <p>
                    Neproběhlé zakázky celkem:
                    {' '}
                    <strong>{bubble.total_failed}</strong>
                  </p>

                  <div className="table-scroll">
                    <table className="leaderboard-table failed-reasons-table">
                      <thead>
                        <tr>
                          <th>Technik</th>
                          <th>Počet</th>
                          <th>Podíl</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bubble.technicians.map((technician) => (
                          <tr key={`${bubble.scheduler_name}-${technician.technician_name}`}>
                            <td>
                              <div className="failed-reason-label">
                                <Link className="operator-jump-link" href={getOvtLink(technician.technician_name)}>
                                  {technician.technician_name}
                                </Link>
                              </div>
                              {technician.reasons.length > 0 ? (
                                <div className="failed-reason-schedulers">
                                  {technician.reasons.map((reason) => (
                                    <div
                                      key={`${bubble.scheduler_name}-${technician.technician_name}-${reason.reason_slug}`}
                                      className="failed-reason-scheduler-item"
                                    >
                                      <span>{reason.reason_label}</span>
                                      <strong>
                                        {reason.count}
                                        {' '}
                                        <span className="failed-inline-share">({reason.share_pct_technician}%)</span>
                                      </strong>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                            <td>{technician.count}</td>
                            <td className="highlight">{technician.share_pct}%</td>
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
