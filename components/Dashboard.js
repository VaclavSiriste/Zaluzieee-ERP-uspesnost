import { useState, useEffect } from 'react'
import MetricsCard from '@/components/MetricsCard'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'

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
              Celkem = vsechny navolane zakazky v obdobi. Dopadlo/Nedopadlo jsou finalni vysledky.
            </p>
            <div className="metrics-grid">
              <MetricsCard
                label="Celkem navolanych"
                value={scheduled}
                unit="zakazek"
              />
              <MetricsCard
                label="Dopadlo"
                value={completed}
                unit="zakazek"
              />
              <MetricsCard
                label="Nedopadlo"
                value={cancelled}
                unit="zakazek"
              />
              <MetricsCard
                label="V reseni"
                value={inProgress}
                unit="zakazek"
              />
              <MetricsCard
                label="Uspesnost"
                value={data.totals?.success_rate || 0}
                unit="%"
              />
              <MetricsCard
                label="Prumer celkove ceny s DPH"
                value={formatMoney(avgSaleWithVat)}
                unit="Kc"
              />
              <MetricsCard
                label="Prumer celkove ceny bez DPH"
                value={formatMoney(avgSaleWithoutVat)}
                unit="Kc"
              />
            </div>
            {Array.isArray(data.in_progress_breakdown) && data.in_progress_breakdown.length > 0 ? (
              <div style={{ marginTop: '14px' }}>
                <h3>Kategorie ve stavu "V řešení"</h3>
                <div className="region-stats">
                  {data.in_progress_breakdown.map((item) => (
                    <div key={item.category}>
                      <strong>{item.category}</strong>: {item.count}
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
                      <div><strong>{stats.scheduled}</strong> sjednano</div>
                      <div><strong>{stats.completed}</strong> dopadlo</div>
                      <div><strong>{stats.cancelled}</strong> nedopadlo</div>
                      <div><strong>{stats.waiting || 0}</strong> cekame</div>
                      <div><strong>{stats.missing || 0}</strong> bez vysledku</div>
                      <div><strong>{formatMoney(stats.avg_sale_with_vat || 0)}</strong> prumer celkem s DPH</div>
                      <div><strong>{formatMoney(stats.avg_sale_without_vat || 0)}</strong> prumer celkem bez DPH</div>
                      <div className="highlight">
                        {stats.success_rate}% uspesnost
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
                      <tr key={op.operator_name}>
                        <td>{op.rank}</td>
                        <td><strong>{op.operator_name}</strong></td>
                        <td>{op.region}</td>
                        <td>{Number(op.completed || 0) + Number(op.cancelled || 0)}</td>
                        <td className="success">
                          <strong>{op.completed}</strong>
                        </td>
                        <td className="danger">
                          <strong>{op.cancelled}</strong>
                        </td>
                        <td>{op.top_failed_reason}</td>
                        <td>{op.top_failed_reason_count}</td>
                        <td>{formatMoney(op.avg_sale_with_vat)} Kč</td>
                        <td>{formatMoney(op.avg_sale_without_vat)} Kč</td>
                        <td className="highlight">
                          {op.success_rate}%
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
    </main>
  )
}
