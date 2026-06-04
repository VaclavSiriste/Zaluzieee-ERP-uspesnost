import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import MetricDrilldown from '@/components/MetricDrilldown'
import DrilldownCount from '@/components/DrilldownCount'
import { useMetricDrilldown, DRILL } from '@/hooks/useMetricDrilldown'

export default function NeprobehleZakazkyPage() {
  const router = useRouter()
  const [period, setPeriod] = useState('month')
  const [dateBasis, setDateBasis] = useState('navolani')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [bubbles, setBubbles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const drilldownFilters = { period, dateBasis, startDate, endDate }
  const { openDrilldown, drilldownProps } = useMetricDrilldown(drilldownFilters)

  function openFailed({ zamerovac, domluvil, failedReason, title }) {
    openDrilldown({
      metric: DRILL.cancelled,
      zamerovac,
      domluvil,
      failedReason,
      title
    })
  }

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
      const response = await fetch(`/api/neprobehle-zakazky?${params}`, { signal: controller.signal })
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

  function getPzLink(targetName) {
    const params = new URLSearchParams({
      focus: targetName,
      period,
      dateBasis,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    return `/neprobehle-zakazky-pz?${params.toString()}`
  }

  return (
    <main className="dashboard-container">
      <div className="dashboard-layout">
        <AppMenu active="failedOrdersOvt" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Neproběhlé zakázky OVT</h1>
            <p>
              Přehled podle {getDateBasisLabel(dateBasis)}. Zobrazuje jen zakázky, kde
              {' '}
              <strong>Dopadlo to? = ne</strong>
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
                  key={bubble.technician_name}
                  className="bubble-card"
                  data-focus-id={toAnchorId(bubble.technician_name)}
                >
                  <h3>{bubble.technician_name}</h3>
                  <p>
                    Neproběhlé zakázky celkem:
                    {' '}
                    <strong>
                      <DrilldownCount
                        count={bubble.total_failed}
                        className="danger"
                        onOpen={() => openFailed({
                          zamerovac: bubble.technician_name,
                          title: `${bubble.technician_name} — neproběhlé celkem`
                        })}
                      />
                    </strong>
                  </p>

                  <div className="table-scroll">
                    <table className="leaderboard-table failed-reasons-table">
                      <colgroup>
                        <col className="col-failed-label" />
                        <col className="col-failed-count" />
                        <col className="col-failed-share" />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Důvod</th>
                          <th>Počet</th>
                          <th>Podíl</th>
                        </tr>
                      </thead>
                      <tbody>
                        {bubble.reasons.map((reason) => (
                          <tr key={`${bubble.technician_name}-${reason.reason_slug}`}>
                            <td>
                              <div className="failed-reason-label">{reason.reason_label}</div>
                              {reason.schedulers.length > 0 ? (
                                <div className="failed-reason-schedulers">
                                  {reason.schedulers.map((scheduler) => (
                                    <div
                                      key={`${bubble.technician_name}-${reason.reason_slug}-${scheduler.scheduler_name}`}
                                      className="failed-reason-scheduler-item"
                                    >
                                      <Link className="operator-jump-link" href={getPzLink(scheduler.scheduler_name)}>
                                        {scheduler.scheduler_name}
                                      </Link>
                                      <strong>
                                        <DrilldownCount
                                          count={scheduler.count}
                                          className="danger"
                                          onOpen={() => openFailed({
                                            zamerovac: bubble.technician_name,
                                            domluvil: scheduler.scheduler_name,
                                            failedReason: reason.reason_slug,
                                            title: `${bubble.technician_name} — ${reason.reason_label} — ${scheduler.scheduler_name}`
                                          })}
                                        />
                                        {' '}
                                        <span className="failed-inline-share">
                                          (
                                          <DrilldownCount
                                            count={scheduler.count}
                                            className="danger"
                                            text={`${scheduler.share_pct_reason}%`}
                                            onOpen={() => openFailed({
                                              zamerovac: bubble.technician_name,
                                              domluvil: scheduler.scheduler_name,
                                              failedReason: reason.reason_slug,
                                            title: `${bubble.technician_name} — ${reason.reason_label} — ${scheduler.scheduler_name}`
                                          })}
                                          />
                                          )
                                        </span>
                                      </strong>
                                    </div>
                                  ))}
                                </div>
                              ) : null}
                            </td>
                            <td>
                              <DrilldownCount
                                count={reason.count}
                                className="danger"
                                onOpen={() => openFailed({
                                  zamerovac: bubble.technician_name,
                                  failedReason: reason.reason_slug,
                                  title: `${bubble.technician_name} — ${reason.reason_label}`
                                })}
                              />
                            </td>
                            <td className="highlight">
                              <DrilldownCount
                                count={reason.count}
                                className="danger"
                                text={`${reason.share_pct}%`}
                                onOpen={() => openFailed({
                                  zamerovac: bubble.technician_name,
                                  failedReason: reason.reason_slug,
                                  title: `${bubble.technician_name} — ${reason.reason_label}`
                                })}
                              />
                            </td>
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

      <MetricDrilldown {...drilldownProps} onRefine={openDrilldown} />
    </main>
  )
}
