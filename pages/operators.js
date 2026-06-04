import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/router'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import MetricDrilldown from '@/components/MetricDrilldown'
import DrilldownCount from '@/components/DrilldownCount'
import DrilldownMoney from '@/components/DrilldownMoney'
import DrilldownDays from '@/components/DrilldownDays'
import { useMetricDrilldown, DRILL } from '@/hooks/useMetricDrilldown'

export default function OperatorsPage() {
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

  function openForOperator(metric, operatorName, title, zamerovac) {
    openDrilldown({
      metric,
      domluvil: operatorName,
      zamerovac,
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
            <p>Přehled podle {getDateBasisLabel(dateBasis)}. Kliknutím na číslo zobrazíte seznam zakázek.</p>
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
                    Všechny stavy:{' '}
                    <DrilldownCount
                      count={bubble.total_all}
                      onOpen={() => openForOperator(DRILL.scheduled, bubble.operator_name, `${bubble.operator_name} — všechny stavy`)}
                    />
                    {' '}| Celkem (Ano+Ne):{' '}
                    <DrilldownCount
                      count={bubble.total_decided}
                      onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} — Ano+Ne`)}
                    />
                    {' '}| Ano:{' '}
                    <DrilldownCount
                      count={bubble.ano}
                      className="success"
                      onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} — Ano`)}
                    />
                    {' '}| Ne:{' '}
                    <DrilldownCount
                      count={bubble.ne}
                      className="danger"
                      onOpen={() => openForOperator(DRILL.cancelled, bubble.operator_name, `${bubble.operator_name} — Ne`)}
                    />
                    {' '}| Čekáme:{' '}
                    <DrilldownCount
                      count={bubble.cekame}
                      onOpen={() => openForOperator(DRILL.waiting, bubble.operator_name, `${bubble.operator_name} — Čekáme`)}
                    />
                    {' '}| Bez výsledku:{' '}
                    <DrilldownCount
                      count={bubble.bez_hodnoty}
                      onOpen={() => openForOperator(DRILL.missing, bubble.operator_name, `${bubble.operator_name} — Bez výsledku`)}
                    />
                  </p>
                  <p>
                    Průměr celkové ceny s DPH:{' '}
                    <strong>
                      <DrilldownMoney
                        count={bubble.sale_count_with_vat || bubble.ano}
                        amount={`${formatMoney(bubble.avg_sale_with_vat)} Kč`}
                        onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} — zakázky tvořící průměr s DPH`)}
                      />
                    </strong>
                    {' '}| Průměr celkové ceny bez DPH:{' '}
                    <strong>
                      <DrilldownMoney
                        count={bubble.sale_count_without_vat || bubble.ano}
                        amount={`${formatMoney(bubble.avg_sale_without_vat)} Kč`}
                        onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} — zakázky tvořící průměr bez DPH`)}
                      />
                    </strong>
                  </p>
                  <p className="duration-metrics-line">
                    Průměr přijetí → navolání:{' '}
                    <DrilldownDays
                      count={bubble.count_lead_navolani}
                      days={bubble.avg_days_lead_navolani}
                      onOpen={() => openForOperator(DRILL.durationLeadNavolani, bubble.operator_name, `${bubble.operator_name} — přijetí → navolání`)}
                    />
                    {' '}| Navolání → zaměření:{' '}
                    <DrilldownDays
                      count={bubble.count_navolani_zamereni}
                      days={bubble.avg_days_navolani_zamereni}
                      onOpen={() => openForOperator(DRILL.durationNavolaniZamereni, bubble.operator_name, `${bubble.operator_name} — navolání → zaměření`)}
                    />
                    {' '}| Příjem → zaměření:{' '}
                    <DrilldownDays
                      count={bubble.count_lead_zamereni}
                      days={bubble.avg_days_lead_zamereni}
                      onOpen={() => openForOperator(DRILL.durationLeadZamereni, bubble.operator_name, `${bubble.operator_name} — přijetí → zaměření`)}
                    />
                  </p>
                  <p className="highlight">
                    Úspěšnost (Ano/(Ano+Ne)):{' '}
                    <DrilldownCount
                      count={bubble.total_decided}
                      onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} — úspěšnost`)}
                    />
                    {' '}
                    (
                    <DrilldownCount
                      count={bubble.total_decided}
                      text={`${bubble.success_rate}%`}
                      onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} — úspěšnost`)}
                    />
                    )
                  </p>

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
                        <col className="col-duration" />
                        <col className="col-duration" />
                        <col className="col-duration" />
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
                          <th title="Průměrný počet dní od přijetí leadu do navolání">Příjem→Navolání</th>
                          <th title="Průměrný počet dní od navolání do zaměření">Navolání→Zaměření</th>
                          <th title="Průměrný počet dní od přijetí leadu do zaměření">Příjem→Zaměření</th>
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
                            <td>
                              <DrilldownCount
                                count={z.total_decided}
                                onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — Celkem`, z.zamerovac_name)}
                              />
                            </td>
                            <td className="success">
                              <DrilldownCount
                                count={z.ano}
                                className="success"
                                onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — Ano`, z.zamerovac_name)}
                              />
                            </td>
                            <td className="danger">
                              <DrilldownCount
                                count={z.ne}
                                className="danger"
                                onOpen={() => openForOperator(DRILL.cancelled, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — Ne`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownCount
                                count={z.cekame}
                                onOpen={() => openForOperator(DRILL.waiting, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — Čekáme`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownCount
                                count={z.bez_hodnoty}
                                onOpen={() => openForOperator(DRILL.missing, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — Bez výsledku`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownMoney
                                count={z.sale_count_with_vat || z.ano}
                                amount={`${formatMoney(z.avg_sale_with_vat)} Kč`}
                                onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — průměr s DPH`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownMoney
                                count={z.sale_count_without_vat || z.ano}
                                amount={`${formatMoney(z.avg_sale_without_vat)} Kč`}
                                onOpen={() => openForOperator(DRILL.completed, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — průměr bez DPH`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={z.count_lead_navolani}
                                days={z.avg_days_lead_navolani}
                                onOpen={() => openForOperator(DRILL.durationLeadNavolani, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — přijetí → navolání`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={z.count_navolani_zamereni}
                                days={z.avg_days_navolani_zamereni}
                                onOpen={() => openForOperator(DRILL.durationNavolaniZamereni, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — navolání → zaměření`, z.zamerovac_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={z.count_lead_zamereni}
                                days={z.avg_days_lead_zamereni}
                                onOpen={() => openForOperator(DRILL.durationLeadZamereni, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — přijetí → zaměření`, z.zamerovac_name)}
                              />
                            </td>
                            <td className="highlight">
                              <DrilldownCount
                                count={z.total_decided}
                                onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — úspěšnost`, z.zamerovac_name)}
                              />
                              {' '}
                              (
                              <DrilldownCount
                                count={z.total_decided}
                                text={`${z.success_rate}%`}
                                onOpen={() => openForOperator(DRILL.decided, bubble.operator_name, `${bubble.operator_name} / ${z.zamerovac_name} — úspěšnost`, z.zamerovac_name)}
                              />
                              )
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
