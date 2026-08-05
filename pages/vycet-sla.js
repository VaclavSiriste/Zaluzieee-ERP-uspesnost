import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import DrilldownCount from '@/components/DrilldownCount'
import SlaDrilldown from '@/components/SlaDrilldown'

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })} %`
}

export default function VycetSlaPage() {
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drilldown, setDrilldown] = useState(null)

  const filters = useMemo(
    () => ({
      period,
      startDate,
      endDate
    }),
    [period, startDate, endDate]
  )

  useEffect(() => {
    fetchData()
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
      const response = await fetch(`/api/vycet-sla?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setMetrics(data.metrics || null)
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst SLA')
      }
      setMetrics(null)
    } finally {
      setLoading(false)
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

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="sla" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Operátoři · přehled navolání</p>
              <h1>Výčet SLA</h1>
              <p className="sla-hero-lead">
                Tady vidíte, kolik leadů během zvoleného období přišlo, kolik z nich už bylo
                navoláno a jak rychle se daří kontaktovat zákazníky do 24, 48 a 72 hodin.
                Stačí vybrat období nahoře — čísla i rozkliknutí se přepočítají.
              </p>
              <div className="sla-hero-points">
                <div className="sla-hero-point">
                  <strong>Pracovní den</strong>
                  <span>Den běží od 20:00 do 19:59 následujícího dne — stejně jako na call centru.</span>
                </div>
                <div className="sla-hero-point">
                  <strong>Kalendářní den</strong>
                  <span>Klasický den od půlnoci. Sem patří poptávky a splnění SLA 24 / 48 / 72.</span>
                </div>
                <div className="sla-hero-point">
                  <strong>Klikněte na číslo</strong>
                  <span>Otevře se seznam konkrétních leadů. Duplikace a leady bez formuláře nepočítáme.</span>
                </div>
              </div>
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

          {loading ? (
            <div className="sla-loading">
              <span className="pauses-spinner" />
              Načítám SLA…
            </div>
          ) : null}

          {error ? (
            <section className="sla-error">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {!loading && !error && metrics ? (
            <>
              <section className="sla-block">
                <h2 className="sla-block-title">Pracovní den — přišlo a navoláno</h2>
                <p className="sla-block-desc">Kolik leadů připadá na pracovní den a kolik z nich už má první kontakt.</p>
                <div className="sla-kpis" aria-label="Business SLA metriky">
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Přišlo leadů</span>
                    <DrilldownCount
                      count={metrics.leads}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('leads', 'Přišlo leadů')}
                    />
                    <span className="sla-kpi-hint">count(ID)</span>
                  </article>

                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Dnes navoláno</span>
                    <DrilldownCount
                      count={metrics.navolano}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('navolano', 'Dnes navoláno')}
                    />
                    <span className="sla-kpi-hint">stejný business den</span>
                  </article>

                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Dnes chybí</span>
                    <DrilldownCount
                      count={metrics.missing}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('missing', 'Dnes chybí')}
                    />
                    <span className="sla-kpi-hint">přišlo − navoláno</span>
                  </article>

                  <article className="sla-kpi sla-kpi-accent">
                    <span className="sla-kpi-label">Splněno</span>
                    <DrilldownCount
                      count={metrics.navolano}
                      text={formatPercent(metrics.fulfilled_pct)}
                      className="sla-kpi-value"
                      title="Kliknutím zobrazíte navolané leady"
                      onOpen={() => openMetric('navolano', 'Splněno — navolané leady')}
                    />
                    <span className="sla-kpi-hint">
                      {metrics.navolano.toLocaleString('cs-CZ')} / {metrics.leads.toLocaleString('cs-CZ')}
                    </span>
                  </article>
                </div>
              </section>

              <section className="sla-block">
                <h2 className="sla-block-title">Kalendářní den — poptávky a rychlost kontaktu</h2>
                <p className="sla-block-desc">
                  Filtry: bez duplikací/reklamací, s ID formuláře, mimo Karlovarský kraj, Důvod ne ≠ Venkovky (null OK).
                </p>
                <div className="sla-kpis sla-kpis-wide" aria-label="Poptávky a SLA">
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Poptávky</span>
                    <DrilldownCount
                      count={metrics.poptavky}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('poptavky', 'Poptávky')}
                    />
                    <span className="sla-kpi-hint">count(ID)</span>
                  </article>

                  <article className="sla-kpi">
                    <span className="sla-kpi-label">SLA 24</span>
                    <DrilldownCount
                      count={metrics.sla24}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('sla24', 'SLA 24')}
                    />
                    <DrilldownCount
                      count={metrics.sla24}
                      text={formatPercent(metrics.sla24_pct)}
                      className="sla-kpi-sub"
                      title="Procento SLA 24"
                      onOpen={() => openMetric('sla24', 'SLA 24 %')}
                    />
                  </article>

                  <article className="sla-kpi">
                    <span className="sla-kpi-label">SLA 48</span>
                    <DrilldownCount
                      count={metrics.sla48}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('sla48', 'SLA 48')}
                    />
                    <DrilldownCount
                      count={metrics.sla48}
                      text={formatPercent(metrics.sla48_pct)}
                      className="sla-kpi-sub"
                      title="Procento SLA 48"
                      onOpen={() => openMetric('sla48', 'SLA 48 %')}
                    />
                  </article>

                  <article className="sla-kpi">
                    <span className="sla-kpi-label">SLA 72</span>
                    <DrilldownCount
                      count={metrics.sla72}
                      className="sla-kpi-value"
                      onOpen={() => openMetric('sla72', 'SLA 72')}
                    />
                    <DrilldownCount
                      count={metrics.sla72}
                      text={formatPercent(metrics.sla72_pct)}
                      className="sla-kpi-sub"
                      title="Procento SLA 72"
                      onOpen={() => openMetric('sla72', 'SLA 72 %')}
                    />
                  </article>
                </div>
              </section>
            </>
          ) : null}
        </div>
      </div>

      <SlaDrilldown
        open={Boolean(drilldown)}
        drilldown={drilldown}
        filters={filters}
        onClose={() => setDrilldown(null)}
      />
    </main>
  )
}
