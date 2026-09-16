import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import CallSuccessNavolaniPanel from '@/components/CallSuccessNavolaniPanel'
import DrilldownCount from '@/components/DrilldownCount'
import ErpNavolaniDrilldown from '@/components/ErpNavolaniDrilldown'
import FilterAssistant from '@/components/FilterAssistant'
import IncomingLineSlaDrilldown from '@/components/IncomingLineSlaDrilldown'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'
import OperationsTargetsPanel from '@/components/OperationsTargetsPanel'
import PauseDrilldown from '@/components/PauseDrilldown'
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

function formatHours(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const hours = Number(value)
  if (hours < 1) {
    const minutes = Math.round(hours * 60)
    return minutes > 0 ? `${minutes} min` : '< 1 min'
  }
  if (hours >= 48) {
    const days = Math.floor(hours / 24)
    const rest = Math.round(hours % 24)
    return rest > 0 ? `${days} d ${rest} h` : `${days} d`
  }
  return `${hours.toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} h`
}

function formatNumber(value, digits = 0) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
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
      helpId: 'sla_total_incoming',
      count: metrics.total_incoming
    },
    {
      metric: 'answered',
      title: 'Zvednuté hovory',
      label: 'Zvednuto',
      helpId: 'sla_answered',
      count: metrics.answered
    },
    {
      metric: 'sla_20s',
      title: 'Hovory do 20 s',
      label: 'Do 20 s (SLA)',
      helpId: 'sla_20s',
      count: metrics.sla_20s,
      hint: formatPercent(metrics.sla_20s_pct)
    },
    {
      metric: 'interval_0_20',
      title: 'Interval 0–20 s',
      label: '0–20 s',
      helpId: 'sla_interval_0_20',
      count: metrics.intervals.interval_0_20,
      hint: formatPercent(metrics.sla_20s_pct)
    },
    {
      metric: 'interval_21_40',
      title: 'Interval 21–40 s',
      label: '21–40 s',
      helpId: 'sla_interval_21_40',
      count: metrics.intervals.interval_21_40
    },
    {
      metric: 'interval_41_60',
      title: 'Interval 41–60 s',
      label: '41–60 s',
      helpId: 'sla_interval_41_60',
      count: metrics.intervals.interval_41_60
    },
    {
      metric: 'interval_60_plus',
      title: 'Interval nad 60 s',
      label: 'Nad 60 s',
      helpId: 'sla_interval_60_plus',
      count: metrics.intervals.interval_60_plus
    },
    {
      metric: 'missed',
      title: 'Nezvednuté / zmeškané',
      label: 'Nezvednuté',
      helpId: 'sla_missed',
      count: metrics.missed
    }
  ]
}

export default function OperationsBrandPage({ brandId = 'cz' }) {
  const brand = OPERATIONS_BRANDS[brandId] || OPERATIONS_BRANDS.cz
  const showTargets = brand.showTargets === true
  const navolaniConfigured = brand.organizationId != null || brand.navolaniSource === 'ovt-sheet'

  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [slaFilterRange, setSlaFilterRange] = useState(null)
  const [navolaniMetrics, setNavolaniMetrics] = useState(null)
  const [navolaniSource, setNavolaniSource] = useState('erp-db')
  const [sheetTechnicians, setSheetTechnicians] = useState([])
  const [loading, setLoading] = useState(true)
  const [navolaniLoading, setNavolaniLoading] = useState(true)
  const [error, setError] = useState('')
  const [navolaniError, setNavolaniError] = useState('')
  const [breakdownOpen, setBreakdownOpen] = useState(false)
  const [navolaniOpen, setNavolaniOpen] = useState(false)
  const [callbackOpen, setCallbackOpen] = useState(false)
  const [drilldown, setDrilldown] = useState(null)
  const [navolaniDrilldown, setNavolaniDrilldown] = useState(null)
  const [callbackDrilldown, setCallbackDrilldown] = useState(null)
  const [callbackSummary, setCallbackSummary] = useState(null)
  const [callbackLoading, setCallbackLoading] = useState(true)
  const [callbackError, setCallbackError] = useState('')

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
    fetchCallbackData()
  }, [period, startDate, endDate, brand.id])

  useEffect(() => {
    setBreakdownOpen(false)
    setNavolaniOpen(false)
    setCallbackOpen(false)
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
    if (!navolaniConfigured && brand.navolaniSource !== 'ovt-sheet') {
      setNavolaniMetrics(null)
      setNavolaniError('')
      setNavolaniLoading(false)
      setNavolaniSource('erp-db')
      setSheetTechnicians([])
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
      setNavolaniSource(data.source || 'erp-db')
      setSheetTechnicians(Array.isArray(data.technicians) ? data.technicians : [])
    } catch (err) {
      if (err.name === 'AbortError') {
        setNavolaniError('Načítání úspěšnosti navolání trvalo příliš dlouho.')
      } else {
        setNavolaniError(err.message || 'Nepodařilo se načíst úspěšnost navolání')
      }
      setNavolaniMetrics(null)
      setNavolaniSource('erp-db')
      setSheetTechnicians([])
    } finally {
      setNavolaniLoading(false)
    }
  }

  async function fetchCallbackData() {
    setCallbackLoading(true)
    setCallbackError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 90000)
      const params = new URLSearchParams({
        period,
        brand: brand.id,
        summary: '1',
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/missed-call-callbacks?${params}`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setCallbackSummary(data.summary || null)
    } catch (err) {
      if (err.name === 'AbortError') {
        setCallbackError('Načítání doby do navolání trvalo příliš dlouho.')
      } else {
        setCallbackError(err.message || 'Nepodařilo se načíst dobu do navolání zmeškaných')
      }
      setCallbackSummary(null)
    } finally {
      setCallbackLoading(false)
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

  function openCallbackDrilldown(variant, title, subtitle, hoursAxis = 'all') {
    setCallbackDrilldown({
      metric: 'missed_callbacks',
      missedVariant: variant,
      hoursAxis,
      brand: brand.id,
      title,
      subtitle
    })
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
                SLA příchozích linek ({brand.slaLineHint}), průměrná doba do navolání zmeškaných,
                {brand.navolaniSource === 'ovt-sheet'
                  ? ' úspěšnost navolání z OVT sheetu (gid 1262379590)'
                  : ` úspěšnost navolání z ERP${
                      navolaniConfigured && brand.organizationId != null
                        ? ` (organizace č. ${brand.organizationId})`
                        : ''
                    }`}
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
            metricHelpId="filter_obdobi"
          />

          {loading && navolaniLoading && callbackLoading ? (
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

          {callbackError ? (
            <section className="sla-error">
              <p className="danger">Doba do navolání: {callbackError}</p>
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
              <h2 className="sla-block-title">
                SLA příchozí linky — do 20 s
                <MetricInfoTip helpId="sla_celkem" />
              </h2>
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
                <MetricLabel helpId="sla_celkem" className="sla-kpi-label">
                  SLA celkem
                </MetricLabel>
                <strong className="sla-kpi-value">{formatPercent(metrics.sla_20s_pct)}</strong>
                <span className="sla-kpi-hint">
                  {metrics.sla_20s.toLocaleString('cs-CZ')} /{' '}
                  {(metrics.sla_20s_denominator ?? metrics.answered).toLocaleString('cs-CZ')} zvednutých
                  {slaIncomingQueueLabel ? ` (${slaIncomingQueueLabel})` : ''}
                  {' · '}
                  průměr {formatSeconds(metrics.avg_response_seconds)}
                  <MetricInfoTip helpId="sla_avg_response" />
                </span>
                <span className="sla-kpi-root-toggle">{breakdownOpen ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
              </button>

              {breakdownOpen ? (
                <div className="sla-breakdown-stack" aria-label="Rozpad SLA">
                  {metrics.queue_breakdown?.items?.length ? (
                    <div className="sla-queue-breakdown" aria-label="Rozpad podle front Daktela">
                      <p className="sla-queue-breakdown-title">
                        Fronty Daktela
                        <MetricInfoTip helpId="sla_queue_fronty" />
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
                                <span className="sla-queue-breakdown-badge">
                                  SLA
                                  <MetricInfoTip helpId="sla_queue_sla_badge" />
                                </span>
                              ) : null}
                              <MetricInfoTip helpId="sla_queue_calls" label="Popis fronty Daktela" />
                            </span>
                            <strong className="sla-queue-breakdown-value">
                              {item.total_calls.toLocaleString('cs-CZ')}
                            </strong>
                            <span className="sla-queue-breakdown-hint">
                              <span className="sla-queue-breakdown-hint-part">
                                {item.answered.toLocaleString('cs-CZ')} zvednutých ({formatPercent(item.answered_pct)})
                                <MetricInfoTip helpId="sla_queue_answered" />
                              </span>
                              {' · '}
                              <span className="sla-queue-breakdown-hint-part">
                                {item.unanswered.toLocaleString('cs-CZ')} nezvednutých
                                <MetricInfoTip helpId="sla_queue_unanswered" />
                              </span>
                              {' · '}
                              <span className="sla-queue-breakdown-hint-part">
                                {(item.working_hours_calls || 0).toLocaleString('cs-CZ')} pracovní
                                <MetricInfoTip helpId="sla_working_hours" />
                              </span>
                              {' · '}
                              <span className="sla-queue-breakdown-hint-part">
                                {(item.outside_hours_calls || 0).toLocaleString('cs-CZ')} mimo
                                <MetricInfoTip helpId="sla_outside_hours" />
                              </span>
                            </span>
                          </article>
                        ))}
                      </div>
                      {metrics.queue_breakdown.totals ? (
                        <p className="sla-queue-breakdown-total">
                          Celkem hovorů ve frontách:
                          <MetricInfoTip helpId="sla_queue_totals" />
                          {' '}
                          <strong>{metrics.queue_breakdown.totals.total_calls.toLocaleString('cs-CZ')}</strong>
                          {' · '}
                          {metrics.queue_breakdown.totals.answered.toLocaleString('cs-CZ')} zvednutých
                          {' · '}
                          {metrics.queue_breakdown.totals.unanswered.toLocaleString('cs-CZ')} nezvednutých
                          {' · '}
                          {(metrics.queue_breakdown.totals.working_hours_calls || 0).toLocaleString('cs-CZ')} pracovní
                          {' · '}
                          {(metrics.queue_breakdown.totals.outside_hours_calls || 0).toLocaleString('cs-CZ')} mimo
                        </p>
                      ) : null}
                    </div>
                  ) : metrics.queue_breakdown ? (
                    <div className="sla-queue-breakdown" aria-label="Rozpad podle front Daktela">
                      <p className="sla-queue-breakdown-title">
                        Fronty Daktela
                        <MetricInfoTip helpId="sla_queue_fronty" />
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
                        <MetricLabel helpId={item.helpId}>{item.label}</MetricLabel>
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

          {!loading && !error && metrics ? (
            <section className="sla-block sla-block-nested sla-block-hours">
              <h2 className="sla-block-title">
                Hovory · pracovní / mimo pracovní dobu
                <MetricInfoTip helpId="sla_working_hours" />
              </h2>
              <p className="sla-block-desc">
                Příchozí hovory na linkách {brand.pageTitle}. Pracovní doba: Po–Pá 8–20 · So–Ne 10–18
                (Europe/Prague). Mimo = ostatní časy.
              </p>
              <div className="sla-kpi-breakdown" aria-label="Hovory podle pracovní doby">
                <article className="sla-kpi sla-kpi-child">
                  <MetricLabel helpId="sla_working_hours">V pracovní době</MetricLabel>
                  <strong className="sla-kpi-value">
                    {(metrics.working_hours_calls || 0).toLocaleString('cs-CZ')}
                  </strong>
                  <span className="sla-kpi-hint">Po–Pá 8–20 · So–Ne 10–18</span>
                </article>
                <article className="sla-kpi sla-kpi-child">
                  <MetricLabel helpId="sla_outside_hours">Mimo pracovní dobu</MetricLabel>
                  <strong className="sla-kpi-value">
                    {(metrics.outside_hours_calls || 0).toLocaleString('cs-CZ')}
                  </strong>
                  <span className="sla-kpi-hint">
                    {(
                      (metrics.working_hours_calls || 0) + (metrics.outside_hours_calls || 0)
                    ).toLocaleString('cs-CZ')}{' '}
                    příchozích celkem na linkách značky
                  </span>
                </article>
              </div>
            </section>
          ) : null}

          {!callbackLoading && !callbackError && callbackSummary ? (
            <section className={`sla-block sla-block-nested sla-block-callback${callbackOpen ? ' is-expanded' : ''}`}>
              <h2 className="sla-block-title">
                Průměrná doba do navolání zmeškaných
                <MetricInfoTip helpId="missed_callback_avg" />
              </h2>
              <p className="sla-block-desc">
                Zmeškaný příchozí → první odchozí zpět. Dvě osy dle času zmeškání (Europe/Prague):
                pracovní doba Po–Pá 8–20 / So–Ne 10–18 · mimo = ostatní časy. Fronty {brand.pageTitle}.
              </p>

              <button
                type="button"
                className={`sla-kpi-root sla-kpi-root-callback${callbackOpen ? ' is-open' : ''}`}
                onClick={() => setCallbackOpen((open) => !open)}
                aria-expanded={callbackOpen}
              >
                <MetricLabel helpId="missed_callback_avg" className="sla-kpi-label">
                  Průměrná doba do navolání · celkem
                </MetricLabel>
                <strong className="sla-kpi-value">
                  {formatHours(callbackSummary.avg_hours_to_callback)}
                </strong>
                <span className="sla-kpi-hint">
                  {formatNumber(callbackSummary.called_back)} navoláno z{' '}
                  {formatNumber(callbackSummary.total_missed)} zmeškaných
                  {' · '}
                  pracovní {formatHours(callbackSummary.working?.avg_hours_to_callback)}
                  {' / '}
                  mimo {formatHours(callbackSummary.outside?.avg_hours_to_callback)}
                </span>
                <span className="sla-kpi-root-toggle">
                  {callbackOpen ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}
                </span>
              </button>

              {callbackOpen ? (
                <div className="sla-kpi-breakdown" aria-label="Rozpad zmeškaných hovorů">
                  <article className="sla-kpi sla-kpi-child">
                    <MetricLabel helpId="missed_callback_working">V pracovní době</MetricLabel>
                    <DrilldownCount
                      count={callbackSummary.working?.called_back || 0}
                      text={formatHours(callbackSummary.working?.avg_hours_to_callback)}
                      className="sla-kpi-value"
                      title="Navolané zmeškané v pracovní době"
                      onOpen={() =>
                        openCallbackDrilldown(
                          'called_back',
                          `${brand.pageTitle} — Navolání v pracovní době`,
                          'Po–Pá 8–20 · So–Ne 10–18 · dle času zmeškaného hovoru',
                          'working'
                        )
                      }
                    />
                    <span className="sla-kpi-hint">
                      {formatNumber(callbackSummary.working?.called_back)} navoláno ·{' '}
                      {formatNumber(callbackSummary.working?.total_missed)} zmeškaných
                    </span>
                  </article>
                  <article className="sla-kpi sla-kpi-child">
                    <MetricLabel helpId="missed_callback_outside">Mimo pracovní dobu</MetricLabel>
                    <DrilldownCount
                      count={callbackSummary.outside?.called_back || 0}
                      text={formatHours(callbackSummary.outside?.avg_hours_to_callback)}
                      className="sla-kpi-value"
                      title="Navolané zmeškané mimo pracovní dobu"
                      onOpen={() =>
                        openCallbackDrilldown(
                          'called_back',
                          `${brand.pageTitle} — Navolání mimo pracovní dobu`,
                          'Mimo Po–Pá 8–20 a So–Ne 10–18 · dle času zmeškaného hovoru',
                          'outside'
                        )
                      }
                    />
                    <span className="sla-kpi-hint">
                      {formatNumber(callbackSummary.outside?.called_back)} navoláno ·{' '}
                      {formatNumber(callbackSummary.outside?.total_missed)} zmeškaných
                    </span>
                  </article>
                  <article className="sla-kpi sla-kpi-child">
                    <span className="sla-kpi-label">Zmeškané příchozí</span>
                    <DrilldownCount
                      count={callbackSummary.total_missed}
                      className="sla-kpi-value"
                      title="Kliknutím zobrazíte výčet zmeškaných hovorů"
                      onOpen={() =>
                        openCallbackDrilldown(
                          'all',
                          `${brand.pageTitle} — Zmeškané příchozí`,
                          'Příchozí hovory (answered = Ne) · shoda s navoláním přes posledních 9 číslic'
                        )
                      }
                    />
                  </article>
                  <article className="sla-kpi sla-kpi-child">
                    <span className="sla-kpi-label">Ještě nenavolané</span>
                    <DrilldownCount
                      count={callbackSummary.not_called_back}
                      className="sla-kpi-value"
                      title="Kliknutím zobrazíte nenavolané zmeškané hovory"
                      onOpen={() =>
                        openCallbackDrilldown(
                          'open',
                          `${brand.pageTitle} — Nenavolané zmeškané`,
                          'Zmeškané příchozí bez následného odchozího hovoru na stejné číslo'
                        )
                      }
                    />
                  </article>
                </div>
              ) : null}
            </section>
          ) : null}

          {navolaniConfigured && !navolaniLoading && !navolaniError && navolaniMetrics ? (
            <CallSuccessNavolaniPanel
              metrics={navolaniMetrics}
              expanded={navolaniOpen}
              onToggle={() => setNavolaniOpen((open) => !open)}
              onOpenMetric={
                navolaniSource === 'pokladamee-ovt-sheet' ||
                navolaniSource === 'malujemeee-ovt-sheet'
                  ? null
                  : openNavolaniMetric
              }
              navolaniHint={brand.navolaniHint}
              organizationId={brand.organizationId}
              source={navolaniSource}
            />
          ) : null}

          {!loading && !navolaniLoading && showTargets ? (
            <OperationsTargetsPanel
              brandId={brand.targetsBrandId || brand.id}
              organizationId={brand.organizationId}
              brandLabel={brand.pageTitle}
              sheetTechnicians={brand.navolaniSource === 'ovt-sheet' ? sheetTechnicians : null}
              completedSource={brand.navolaniSource === 'ovt-sheet' ? 'ovt-sheet' : 'erp'}
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

      <PauseDrilldown
        open={Boolean(callbackDrilldown)}
        onClose={() => setCallbackDrilldown(null)}
        drilldown={callbackDrilldown}
        filters={filters}
      />
    </main>
  )
}
