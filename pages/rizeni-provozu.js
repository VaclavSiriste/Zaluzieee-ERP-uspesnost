import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import CallSuccessNavolaniPanel from '@/components/CallSuccessNavolaniPanel'
import DrilldownCount from '@/components/DrilldownCount'
import ErpNavolaniDrilldown from '@/components/ErpNavolaniDrilldown'
import FilterAssistant from '@/components/FilterAssistant'
import IncomingLineSlaDrilldown from '@/components/IncomingLineSlaDrilldown'
import OperationsTargetsPanel from '@/components/OperationsTargetsPanel'

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} %`
}

function formatSeconds(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} s`
}

function buildBreakdownItems(metrics) {
  return [
    {
      metric: 'all',
      title: 'Všechny příchozí linky',
      label: 'Příchozích linek',
      count: metrics.total_incoming
    },
    {
      metric: 'answered',
      title: 'Zvednuté hovory',
      label: 'Zvednuto',
      count: metrics.answered,
      hint: formatPercent(metrics.answered_pct)
    },
    {
      metric: 'sla_20s',
      title: 'Hovory do 20 s',
      label: 'Do 20 s (SLA)',
      count: metrics.sla_20s
    },
    {
      metric: 'interval_0_20',
      title: 'Interval 0–20 s',
      label: '0–20 s',
      count: metrics.intervals.interval_0_20
    },
    {
      metric: 'interval_21_40',
      title: 'Interval 21–40 s',
      label: '21–40 s',
      count: metrics.intervals.interval_21_40
    },
    {
      metric: 'interval_41_60',
      title: 'Interval 41–60 s',
      label: '41–60 s',
      count: metrics.intervals.interval_41_60
    },
    {
      metric: 'interval_60_plus',
      title: 'Interval nad 60 s',
      label: 'Nad 60 s',
      count: metrics.intervals.interval_60_plus
    },
    {
      metric: 'missed',
      title: 'Nezvednuté / zmeškané',
      label: 'Nezvednuté',
      count: metrics.missed
    }
  ]
}

export default function RizeniProvozuPage() {
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [navolaniMetrics, setNavolaniMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [navolaniLoading, setNavolaniLoading] = useState(true)
  const [error, setError] = useState('')
  const [navolaniError, setNavolaniError] = useState('')
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [navolaniOpen, setNavolaniOpen] = useState(false)
  const [drilldown, setDrilldown] = useState(null)
  const [navolaniDrilldown, setNavolaniDrilldown] = useState(null)

  const filters = useMemo(
    () => ({
      period,
      startDate,
      endDate
    }),
    [period, startDate, endDate]
  )

  const breakdownItems = useMemo(
    () => (metrics ? buildBreakdownItems(metrics) : []),
    [metrics]
  )

  useEffect(() => {
    fetchData()
    fetchNavolaniData()
  }, [period, startDate, endDate])

  useEffect(() => {
    setBreakdownOpen(false)
    setNavolaniOpen(false)
  }, [period, startDate, endDate])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const params = new URLSearchParams({
        period,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/incoming-line-sla?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setMetrics(data.metrics || null)
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst SLA příchozích linek')
      }
      setMetrics(null)
    } finally {
      setLoading(false)
    }
  }

  async function fetchNavolaniData() {
    setNavolaniLoading(true)
    setNavolaniError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const params = new URLSearchParams({
        period,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/call-success-navolani?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setNavolaniMetrics(data.metrics || null)
    } catch (err) {
      if (err.name === 'AbortError') {
        setNavolaniError('Načítání úspěšnosti navolání trvalo příliš dlouho.')
      } else {
        setNavolaniError(err.message || 'Nepodařilo se načíst úspěšnost navolání')
      }
      setNavolaniMetrics(null)
    } finally {
      setNavolaniLoading(false)
    }
  }

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod !== 'custom') {
      setStartDate('')
      setEndDate('')
    }
  }

  function openMetric(metric, title) {
    setDrilldown({ metric, title })
  }

  function openNavolaniMetric(metric, title, operatorName = '') {
    setNavolaniDrilldown({ metric, title, operatorName })
  }

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="operations" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Provoz · Daktela reporting</p>
              <h1>zaluzieee - CZ</h1>
              <p className="sla-hero-lead">
                SLA příchozích linek, úspěšnost navolání z ERP a targety provozu. Rozbalte blok pro
                rozpad — u SLA na hovory, u navolání na zakázky, u targetů na kraje a techniky.
              </p>
            </div>
            <div className="sla-hero-glow" aria-hidden="true" />
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={handlePeriodChange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(value) => {
              setStartDate(value)
              setPeriod('custom')
            }}
            onEndDateChange={(value) => {
              setEndDate(value)
              setPeriod('custom')
            }}
            hideDateBasis
          />

          {loading && navolaniLoading ? (
            <div className="sla-loading">
              <span className="pauses-spinner" />
              Načítám metriky provozu…
            </div>
          ) : null}

          {error ? (
            <section className="sla-error">
              <p className="danger">SLA: {error}</p>
            </section>
          ) : null}

          {navolaniError ? (
            <section className="sla-error">
              <p className="danger">Úspěšnost navolání: {navolaniError}</p>
            </section>
          ) : null}

          {!loading && !error && metrics ? (
            <section className={`sla-block sla-block-nested${breakdownOpen ? ' is-expanded' : ''}`}>
              <h2 className="sla-block-title">SLA příchozí linky — do 20 s</h2>
              <p className="sla-block-desc">
                {breakdownOpen
                  ? 'Vyberte položku pro seznam hovorů a zakázek.'
                  : 'Klikněte na SLA celkem pro zobrazení rozpadu.'}
              </p>

              <button
                type="button"
                className={`sla-kpi-root${breakdownOpen ? ' is-open' : ''}`}
                onClick={() => setBreakdownOpen((open) => !open)}
                aria-expanded={breakdownOpen}
              >
                <span className="sla-kpi-label">SLA celkem</span>
                <strong className="sla-kpi-value">{formatPercent(metrics.sla_20s_pct)}</strong>
                <span className="sla-kpi-hint">
                  {metrics.sla_20s.toLocaleString('cs-CZ')} /{' '}
                  {metrics.total_incoming.toLocaleString('cs-CZ')} linek · průměr{' '}
                  {formatSeconds(metrics.avg_response_seconds)}
                </span>
                <span className="sla-kpi-root-toggle">{breakdownOpen ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
              </button>

              {breakdownOpen ? (
                <div className="sla-kpi-breakdown" aria-label="Rozpad SLA">
                  {breakdownItems.map((item) => (
                    <article key={item.metric} className="sla-kpi sla-kpi-child">
                      <span className="sla-kpi-label">{item.label}</span>
                      <DrilldownCount
                        count={item.count}
                        className="sla-kpi-value"
                        title={`Kliknutím zobrazíte záznamy: ${item.title}`}
                        onOpen={() => openMetric(item.metric, item.title)}
                      />
                      {item.hint ? <span className="sla-kpi-hint">{item.hint}</span> : null}
                    </article>
                  ))}
                </div>
              ) : null}
            </section>
          ) : null}

          {!navolaniLoading && !navolaniError && navolaniMetrics ? (
            <CallSuccessNavolaniPanel
              metrics={navolaniMetrics}
              expanded={navolaniOpen}
              onToggle={() => setNavolaniOpen((open) => !open)}
              onOpenMetric={openNavolaniMetric}
            />
          ) : null}

          {!loading && !navolaniLoading ? <OperationsTargetsPanel /> : null}
        </div>
      </div>

      <IncomingLineSlaDrilldown
        open={Boolean(drilldown)}
        onClose={() => setDrilldown(null)}
        drilldown={drilldown}
        filters={filters}
      />

      <ErpNavolaniDrilldown
        open={Boolean(navolaniDrilldown)}
        onClose={() => setNavolaniDrilldown(null)}
        drilldown={navolaniDrilldown}
        filters={filters}
      />
    </main>
  )
}
