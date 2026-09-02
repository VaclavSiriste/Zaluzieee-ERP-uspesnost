import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import CallSuccessNavolaniPanel from '@/components/CallSuccessNavolaniPanel'
import DrilldownCount from '@/components/DrilldownCount'
import ErpNavolaniDrilldown from '@/components/ErpNavolaniDrilldown'
import FilterAssistant from '@/components/FilterAssistant'
import IncomingLineSlaDrilldown from '@/components/IncomingLineSlaDrilldown'
import OperationsTargetsPanel from '@/components/OperationsTargetsPanel'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'

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

function formatFilterRange(startDate, endDate) {
  if (!startDate || !endDate) return ''
  const formatDay = (value) => {
    const [year, month, day] = String(value).split('-').map(Number)
    if (!year || !month || !day) return value
    return new Date(year, month - 1, day).toLocaleDateString('cs-CZ')
  }
  return `${formatDay(startDate)} – ${formatDay(endDate)}`
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
      count: metrics.answered
    },
    {
      metric: 'sla_20s',
      title: 'Hovory do 20 s',
      label: 'Do 20 s (SLA)',
      count: metrics.sla_20s,
      hint: formatPercent(metrics.sla_20s_pct)
    },
    {
      metric: 'interval_0_20',
      title: 'Interval 0–20 s',
      label: '0–20 s',
      count: metrics.intervals.interval_0_20,
      hint: formatPercent(metrics.sla_20s_pct)
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

export default function OperationsBrandPage({ brandId = 'cz' }) {
  const brand = OPERATIONS_BRANDS[brandId] || OPERATIONS_BRANDS.cz
  const showTargets = brand.showTargets === true
  const navolaniConfigured = brand.organizationId != null

  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [slaFilterRange, setSlaFilterRange] = useState(null)
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
      endDate,
      brand: brand.id
    }),
    [period, startDate, endDate, brand.id]
  )

  const breakdownItems = useMemo(
    () => (metrics ? buildBreakdownItems(metrics) : []),
    [metrics]
  )

  const slaIncomingQueueLabel = useMemo(() => {
    const segment = brand.slaQueueBreakdown?.find((item) => item.countsForSla)
    return segment?.label || null
  }, [brand.slaQueueBreakdown])

  useEffect(() => {
    fetchData()
    fetchNavolaniData()
  }, [period, startDate, endDate, brand.id])

  useEffect(() => {
    setBreakdownOpen(false)
    setNavolaniOpen(false)
  }, [period, startDate, endDate, brand.id])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const params = new URLSearchParams({
        period,
        brand: brand.id,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/incoming-line-sla?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setMetrics(data.metrics || null)
      setSlaFilterRange(
        data.startDate && data.endDate
          ? { startDate: data.startDate, endDate: data.endDate }
          : null
      )
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst SLA příchozích linek')
      }
      setMetrics(null)
      setSlaFilterRange(null)
    } finally {
      setLoading(false)
    }
  }

  async function fetchNavolaniData() {
    if (!navolaniConfigured) {
      setNavolaniMetrics(null)
      setNavolaniError('')
      setNavolaniLoading(false)
      return
    }

    setNavolaniLoading(true)
    setNavolaniError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const params = new URLSearchParams({
        period,
        brand: brand.id,
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
    setNavolaniDrilldown({ metric, title, operatorName, brand: brand.id })
  }

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active={brand.activeMenuKey} />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Provoz · Daktela + ERP reporting</p>
              <h1>{brand.pageTitle}</h1>
              <p className="sla-hero-lead">
                SLA příchozích linek ({brand.slaLineHint}), úspěšnost navolání z ERP
                {navolaniConfigured ? ` (organizace č. ${brand.organizationId})` : ''}
                {showTargets ? ' a targety provozu' : ''}. Rozbalte blok pro rozpad.
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

          {navolaniConfigured && navolaniError ? (
            <section className="sla-error">
              <p className="danger">Úspěšnost navolání: {navolaniError}</p>
            </section>
          ) : null}

          {!navolaniConfigured ? (
            <section className="sla-error">
              <p className="danger">
                Úspěšnost navolání: chybí <code>organization_id</code> pro {brand.pageTitle}. Doplňte ho v{' '}
                <code>lib/operations-brands.js</code>.
              </p>
            </section>
          ) : null}

          {!loading && !error && metrics ? (
            <section className={`sla-block sla-block-nested${breakdownOpen ? ' is-expanded' : ''}`}>
              <h2 className="sla-block-title">SLA příchozí linky — do 20 s</h2>
              <p className="sla-block-desc">
                {slaFilterRange
                  ? `Období filtru: ${formatFilterRange(slaFilterRange.startDate, slaFilterRange.endDate)}. `
                  : ''}
                {breakdownOpen
                  ? `${brand.slaLineHint}. Vyberte položku pro seznam hovorů.`
                  : `${brand.slaLineHint}. SLA % = do 20 s / zvednuté hovory.`}
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
                  {(metrics.sla_20s_denominator ?? metrics.answered).toLocaleString('cs-CZ')} zvednutých
                  {slaIncomingQueueLabel ? ` (${slaIncomingQueueLabel})` : ''}
                  {' · '}
                  průměr {formatSeconds(metrics.avg_response_seconds)}
                </span>
                <span className="sla-kpi-root-toggle">{breakdownOpen ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
              </button>

              {breakdownOpen ? (
                <div className="sla-breakdown-stack" aria-label="Rozpad SLA">
                  {metrics.queue_breakdown?.items?.length ? (
                    <div className="sla-queue-breakdown" aria-label="Rozpad podle front Daktela">
                      <p className="sla-queue-breakdown-title">
                        Fronty Daktela
                        {slaFilterRange
                          ? ` · ${formatFilterRange(slaFilterRange.startDate, slaFilterRange.endDate)}`
                          : ''}
                      </p>
                      <div
                        className={`sla-queue-breakdown-grid${
                          metrics.queue_breakdown.items.length > 6 ? ' sla-queue-breakdown-grid--wide' : ''
                        }`}
                      >
                        {metrics.queue_breakdown.items.map((item) => (
                          <article key={item.queue_id} className="sla-queue-breakdown-card">
                            <span className="sla-queue-breakdown-label">
                              {item.label}
                              {item.counts_for_sla ? (
                                <span className="sla-queue-breakdown-badge">SLA</span>
                              ) : null}
                            </span>
                            <strong className="sla-queue-breakdown-value">
                              {item.total_calls.toLocaleString('cs-CZ')}
                            </strong>
                            <span className="sla-queue-breakdown-hint">
                              {item.answered.toLocaleString('cs-CZ')} zvednutých ({formatPercent(item.answered_pct)})
                              {' · '}
                              {item.unanswered.toLocaleString('cs-CZ')} nezvednutých
                            </span>
                          </article>
                        ))}
                      </div>
                      {metrics.queue_breakdown.totals ? (
                        <p className="sla-queue-breakdown-total">
                          Celkem hovorů ve frontách:{' '}
                          <strong>{metrics.queue_breakdown.totals.total_calls.toLocaleString('cs-CZ')}</strong>
                          {' · '}
                          {metrics.queue_breakdown.totals.answered.toLocaleString('cs-CZ')} zvednutých
                          {' · '}
                          {metrics.queue_breakdown.totals.unanswered.toLocaleString('cs-CZ')} nezvednutých
                        </p>
                      ) : null}
                    </div>
                  ) : metrics.queue_breakdown ? (
                    <div className="sla-queue-breakdown" aria-label="Rozpad podle front Daktela">
                      <p className="sla-queue-breakdown-title">
                        Fronty Daktela
                        {slaFilterRange
                          ? ` · ${formatFilterRange(slaFilterRange.startDate, slaFilterRange.endDate)}`
                          : ''}
                      </p>
                      <p className="sla-queue-breakdown-empty">Ve zvoleném období nejsou žádné hovory ve frontách.</p>
                    </div>
                  ) : null}

                  <div className="sla-kpi-breakdown" aria-label="Rozpad SLA příchozích linek">
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
                </div>
              ) : null}
            </section>
          ) : null}

          {navolaniConfigured && !navolaniLoading && !navolaniError && navolaniMetrics ? (
            <CallSuccessNavolaniPanel
              metrics={navolaniMetrics}
              expanded={navolaniOpen}
              onToggle={() => setNavolaniOpen((open) => !open)}
              onOpenMetric={openNavolaniMetric}
              navolaniHint={brand.navolaniHint}
              organizationId={brand.organizationId}
            />
          ) : null}

          {!loading && !navolaniLoading && showTargets ? (
            <OperationsTargetsPanel
              brandId={brand.targetsBrandId || brand.id}
              organizationId={brand.organizationId}
              brandLabel={brand.pageTitle}
            />
          ) : null}
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
