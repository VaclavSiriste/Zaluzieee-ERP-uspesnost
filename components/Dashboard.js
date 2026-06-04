import { useState, useEffect } from 'react'
import MetricsCard from '@/components/MetricsCard'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import MetricDrilldown from '@/components/MetricDrilldown'
import DrilldownCount from '@/components/DrilldownCount'
import DrilldownMoney from '@/components/DrilldownMoney'
import { useMetricDrilldown, DRILL } from '@/hooks/useMetricDrilldown'

export default function Dashboard() {
  const [period, setPeriod] = useState('month')
  const [dateBasis, setDateBasis] = useState('navolani')
  const [filters, setFilters] = useState({
    region: '',
    startDate: '',
    endDate: ''
  })
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const drilldownFilters = {
    period,
    dateBasis,
    startDate: filters.startDate,
    endDate: filters.endDate,
    region: filters.region
  }
  const { openDrilldown, drilldownProps } = useMetricDrilldown(drilldownFilters)

  useEffect(() => {
    fetchMetrics()
  }, [period, dateBasis, filters])

  async function fetchMetrics() {
    setLoading(true)
    setError('')
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 12000)
      const params = new URLSearchParams({
        period,
        dateBasis,
        ...Object.fromEntries(
          Object.entries(filters).filter(([, v]) => v && v !== '')
        )
      })
      const response = await fetch(`/api/metrics?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`)
      }
      const metrics = await response.json()
      if (metrics.error) {
        throw new Error(metrics.error)
      }
      setData(metrics)
    } catch (error) {
      console.error('Chyba při načítání metrik:', error)
      setData(null)
      if (error.name === 'AbortError') {
        setError('Načítání metrik trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(error.message || 'Nepodařilo se načíst data z API.')
      }
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return <div className="status-message">Načítání dashboardu...</div>
  }

  if (error) {
    return (
      <main className="dashboard-container">
        <div className="dashboard-layout">
          <AppMenu active="dashboard" />
          <div className="dashboard-main">
            <header className="dashboard-header">
              <h1>Firemni Dashboard</h1>
              <p>Aktualni vykon obchodniho tymu a regionu</p>
            </header>
            <section className="section-card">
              <h2>Data nejsou dostupná</h2>
              <p className="danger">
                Nepodařilo se načíst reálná data: {error}
              </p>
            </section>
          </div>
        </div>
      </main>
    )
  }

  const scheduled = Number(data?.totals?.scheduled || 0)
  const leads = Number(data?.totals?.leads || 0)
  const completed = Number(data?.totals?.completed || 0)
  const cancelled = Number(data?.totals?.cancelled || 0)
  const inProgress = Math.max(scheduled - completed - cancelled, 0)
  const avgSaleWithVat = Number(data?.totals?.avg_sale_with_vat || 0)
  const avgSaleWithoutVat = Number(data?.totals?.avg_sale_without_vat || 0)

  function formatMoney(value) {
    return new Intl.NumberFormat('cs-CZ', {
      maximumFractionDigits: 0
    }).format(Number(value || 0))
  }

  return (
    <main className="dashboard-container">
      <div className="dashboard-layout">
        <AppMenu active="dashboard" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Firemni Dashboard</h1>
            <p>Aktualni vykon obchodniho tymu a regionu</p>
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={setPeriod}
            dateBasis={dateBasis}
            onDateBasisChange={setDateBasis}
            startDate={filters.startDate}
            endDate={filters.endDate}
            onStartDateChange={(value) => setFilters((current) => ({ ...current, startDate: value }))}
            onEndDateChange={(value) => setFilters((current) => ({ ...current, endDate: value }))}
            region={filters.region}
            onRegionChange={(value) => setFilters((current) => ({ ...current, region: value }))}
            regions={Object.keys(data.byRegion || {})}
          />

          <section className="section-card">
            <h2>Celkove metriky</h2>
            <p>
              Kliknutim na libovolne cislo zobrazite seznam zakazek a vizualni rozpad.
            </p>
            <div className="metrics-grid">
              <MetricsCard
                label="Prijate leady"
                value={leads}
                unit="leadů"
                onClick={() => openDrilldown({
                  metric: DRILL.leads,
                  title: 'Přijaté leady (datum vytvoření zakázky)'
                })}
              />
              <MetricsCard
                label="Celkem navolanych"
                value={scheduled}
                unit="zakazek"
                onClick={() => openDrilldown({ metric: DRILL.scheduled, title: 'Celkem navolaných' })}
              />
              <MetricsCard
                label="Dopadlo"
                value={completed}
                unit="zakazek"
                onClick={() => openDrilldown({ metric: DRILL.completed, title: 'Dopadlo' })}
              />
              <MetricsCard
                label="Nedopadlo"
                value={cancelled}
                unit="zakazek"
                onClick={() => openDrilldown({ metric: DRILL.cancelled, title: 'Nedopadlo' })}
              />
              <MetricsCard
                label="V reseni"
                value={inProgress}
                unit="zakazek"
                onClick={() => openDrilldown({ metric: DRILL.inProgress, title: 'V řešení' })}
              />
              <MetricsCard
                label="Uspesnost"
                value={data.totals?.success_rate || 0}
                unit="%"
                onClick={() => openDrilldown({
                  metric: DRILL.decided,
                  title: 'Komunikováno (Ano + Ne)'
                })}
              />
              <MetricsCard
                label="Prumer celkove ceny s DPH"
                value={formatMoney(avgSaleWithVat)}
                unit="Kc"
                onClick={() => openDrilldown({ metric: DRILL.completed, title: 'Zakázky tvořící průměr ceny s DPH' })}
              />
              <MetricsCard
                label="Prumer celkove ceny bez DPH"
                value={formatMoney(avgSaleWithoutVat)}
                unit="Kc"
                onClick={() => openDrilldown({ metric: DRILL.completed, title: 'Zakázky tvořící průměr ceny bez DPH' })}
              />
            </div>
            {Array.isArray(data.in_progress_breakdown) && data.in_progress_breakdown.length > 0 ? (
              <div style={{ marginTop: '14px' }}>
                <h3>Kategorie ve stavu "V řešení"</h3>
                <div className="region-stats">
                  {data.in_progress_breakdown.map((item) => (
                    <div key={item.category}>
                      <DrilldownCount
                        count={item.count}
                        text={item.category}
                        onOpen={() => openDrilldown({
                          metric: DRILL.category,
                          category: item.category,
                          title: `Kategorie: ${item.category}`
                        })}
                      />
                      :{' '}
                      <DrilldownCount
                        count={item.count}
                        onOpen={() => openDrilldown({
                          metric: DRILL.category,
                          category: item.category,
                          title: `Kategorie: ${item.category}`
                        })}
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {Object.keys(data.byRegion || {}).length > 0 && (
            <section className="section-card">
              <h2>Metriky po krajich</h2>
              <div className="regions-grid">
                {Object.entries(data.byRegion).map(([region, stats]) => (
                  <article key={region} className="region-card">
                    <h3>{region}</h3>
                    <div className="region-stats">
                      <div>
                        <DrilldownCount
                          count={stats.leads || 0}
                          onOpen={() => openDrilldown({
                            metric: DRILL.leads,
                            region,
                            title: `${region} — přijaté leady`
                          })}
                        />{' '}
                        prijate leady
                      </div>
                      <div>
                        <DrilldownCount
                          count={stats.scheduled}
                          onOpen={() => openDrilldown({
                            metric: DRILL.scheduled,
                            region,
                            title: `${region} — sjednáno`
                          })}
                        />{' '}
                        sjednano
                      </div>
                      <div>
                        <DrilldownCount
                          count={stats.completed}
                          className="success"
                          onOpen={() => openDrilldown({
                            metric: DRILL.completed,
                            region,
                            title: `${region} — dopadlo`
                          })}
                        />{' '}
                        dopadlo
                      </div>
                      <div>
                        <DrilldownCount
                          count={stats.cancelled}
                          className="danger"
                          onOpen={() => openDrilldown({
                            metric: DRILL.cancelled,
                            region,
                            title: `${region} — nedopadlo`
                          })}
                        />{' '}
                        nedopadlo
                      </div>
                      <div>
                        <DrilldownCount
                          count={stats.waiting || 0}
                          onOpen={() => openDrilldown({
                            metric: DRILL.waiting,
                            region,
                            title: `${region} — čekáme`
                          })}
                        />{' '}
                        cekame
                      </div>
                      <div>
                        <DrilldownCount
                          count={stats.missing || 0}
                          onOpen={() => openDrilldown({
                            metric: DRILL.missing,
                            region,
                            title: `${region} — bez výsledku`
                          })}
                        />{' '}
                        bez vysledku
                      </div>
                      <div>
                        <DrilldownCount
                          count={Number(stats.completed || 0) + Number(stats.cancelled || 0)}
                          onOpen={() => openDrilldown({
                            metric: DRILL.decided,
                            region,
                            title: `${region} — komunikováno`
                          })}
                        />
                        {' '}
                        (
                        <DrilldownCount
                          count={Number(stats.completed || 0) + Number(stats.cancelled || 0)}
                          text={`${stats.success_rate}%`}
                          onOpen={() => openDrilldown({
                            metric: DRILL.decided,
                            region,
                            title: `${region} — úspěšnost`
                          })}
                        />
                        {' '}
                        uspesnost)
                      </div>
                      <div>
                        <strong>
                          <DrilldownMoney
                            count={completed}
                            amount={formatMoney(stats.avg_sale_with_vat || 0)}
                            onOpen={() => openDrilldown({
                              metric: DRILL.completed,
                              region,
                              title: `${region} — zakázky tvořící průměr s DPH`
                            })}
                          />
                        </strong>{' '}
                        prumer celkem s DPH
                      </div>
                      <div>
                        <strong>
                          <DrilldownMoney
                            count={completed}
                            amount={formatMoney(stats.avg_sale_without_vat || 0)}
                            onOpen={() => openDrilldown({
                              metric: DRILL.completed,
                              region,
                              title: `${region} — zakázky tvořící průměr bez DPH`
                            })}
                          />
                        </strong>{' '}
                        prumer celkem bez DPH
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}

          {data.leaderboard && data.leaderboard.length > 0 && (
            <section className="section-card">
              <h2>Top operatori</h2>
              <div className="table-scroll">
                <table className="leaderboard-table top-operators-table">
                  <thead>
                    <tr>
                      <th>Poradi</th>
                      <th>Operator</th>
                      <th>Kraj</th>
                      <th>Komunikovano</th>
                      <th>Dopadlo</th>
                      <th>Nedopadlo</th>
                      <th>Nejcastejsi duvod NE</th>
                      <th>Pocet duvodu NE</th>
                      <th>Prumer s DPH</th>
                      <th>Prumer bez DPH</th>
                      <th>Uspesnost</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.leaderboard.map((op) => (
                      <tr key={`${op.operator_name}-${op.region}`}>
                        <td>{op.rank}</td>
                        <td><strong>{op.operator_name}</strong></td>
                        <td>{op.region}</td>
                        <td>
                          <DrilldownCount
                            count={Number(op.completed || 0) + Number(op.cancelled || 0)}
                            onOpen={() => openDrilldown({
                              metric: DRILL.decided,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — komunikováno`
                            })}
                          />
                        </td>
                        <td className="success">
                          <DrilldownCount
                            count={op.completed}
                            className="success"
                            onOpen={() => openDrilldown({
                              metric: DRILL.completed,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — dopadlo`
                            })}
                          />
                        </td>
                        <td className="danger">
                          <DrilldownCount
                            count={op.cancelled}
                            className="danger"
                            onOpen={() => openDrilldown({
                              metric: DRILL.cancelled,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — nedopadlo`
                            })}
                          />
                        </td>
                        <td>
                          {op.top_failed_reason !== '-' ? (
                            <DrilldownCount
                              count={op.top_failed_reason_count}
                              className="danger"
                              text={op.top_failed_reason}
                              onOpen={() => openDrilldown({
                                metric: DRILL.cancelled,
                                operator: op.operator_name,
                                region: op.region,
                                failedReason: op.top_failed_reason,
                                title: `${op.operator_name} — ${op.top_failed_reason}`
                              })}
                            />
                          ) : (
                            op.top_failed_reason
                          )}
                        </td>
                        <td>
                          <DrilldownCount
                            count={op.top_failed_reason_count}
                            className="danger"
                            onOpen={() => openDrilldown({
                              metric: DRILL.cancelled,
                              operator: op.operator_name,
                              region: op.region,
                              failedReason: op.top_failed_reason === '-' ? 'bez_duvodu' : op.top_failed_reason,
                              title: `${op.operator_name} — ${op.top_failed_reason}`
                            })}
                          />
                        </td>
                        <td>
                          <DrilldownMoney
                            count={op.completed}
                            amount={`${formatMoney(op.avg_sale_with_vat)} Kč`}
                            onOpen={() => openDrilldown({
                              metric: DRILL.completed,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — zakázky tvořící průměr s DPH`
                            })}
                          />
                        </td>
                        <td>
                          <DrilldownMoney
                            count={op.completed}
                            amount={`${formatMoney(op.avg_sale_without_vat)} Kč`}
                            onOpen={() => openDrilldown({
                              metric: DRILL.completed,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — zakázky tvořící průměr bez DPH`
                            })}
                          />
                        </td>
                        <td className="highlight">
                          <DrilldownCount
                            count={Number(op.completed || 0) + Number(op.cancelled || 0)}
                            onOpen={() => openDrilldown({
                              metric: DRILL.decided,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — úspěšnost`
                            })}
                          />
                          {' '}
                          (
                          <DrilldownCount
                            count={Number(op.completed || 0) + Number(op.cancelled || 0)}
                            text={`${op.success_rate}%`}
                            onOpen={() => openDrilldown({
                              metric: DRILL.decided,
                              operator: op.operator_name,
                              region: op.region,
                              title: `${op.operator_name} — úspěšnost`
                            })}
                          />
                          )
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>

      <MetricDrilldown {...drilldownProps} onRefine={openDrilldown} />
    </main>
  )
}
