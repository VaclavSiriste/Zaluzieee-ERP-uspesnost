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

export default function ObchodniciPage() {
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

  function openForZamerovac(metric, zamerovacName, title, obchodnik) {
    openDrilldown({ metric, zamerovac: zamerovacName, obchodnik, title })
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

    const targetId = `zamerovac-${toAnchorId(focusName)}`
    const element = document.getElementById(targetId)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [router.isReady, router.query.focus, loading, bubbles])

  async function fetchData() {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({
        period,
        dateBasis,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/obchodnici?${params}`)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setBubbles(data.bubbles || [])
    } catch (err) {
      setError(err.message || 'Nepodařilo se načíst data.')
      setBubbles([])
    } finally {
      setLoading(false)
    }
  }

  function toAnchorId(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
  }

  function getOperatorsLink(targetName) {
    const params = new URLSearchParams({
      focus: targetName,
      period,
      dateBasis,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    return `/operators?${params.toString()}`
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
        <AppMenu active="obchodnici" />
        <div className="dashboard-main">
          <header className="dashboard-header">
            <h1>Obchodníci</h1>
            <p>Časová osa podle {getDateBasisLabel(dateBasis)}. Kliknutím na číslo zobrazíte seznam zakázek.</p>
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
          {error ? <section className="section-card"><p className="danger">{error}</p></section> : null}

          {!loading && !error ? (
            <div className="bubble-grid">
              {bubbles.map((bubble) => (
                <section
                  key={bubble.zamerovac_name}
                  id={`zamerovac-${toAnchorId(bubble.zamerovac_name)}`}
                  className="bubble-card"
                >
                  <h3>
                    <Link className="operator-jump-link" href={getOperatorsLink(bubble.zamerovac_name)}>
                      {bubble.zamerovac_name}
                    </Link>
                  </h3>
                  <p>
                    Celkem:{' '}
                    <DrilldownCount
                      count={bubble.total}
                      onOpen={() => openForZamerovac(DRILL.scheduled, bubble.zamerovac_name, `${bubble.zamerovac_name} — Celkem`)}
                    />
                    {' '}| Ano:{' '}
                    <DrilldownCount
                      count={bubble.ano}
                      className="success"
                      onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} — Ano`)}
                    />
                    {' '}| Ne:{' '}
                    <DrilldownCount
                      count={bubble.ne}
                      className="danger"
                      onOpen={() => openForZamerovac(DRILL.cancelled, bubble.zamerovac_name, `${bubble.zamerovac_name} — Ne`)}
                    />
                    {' '}| Čekáme:{' '}
                    <DrilldownCount
                      count={bubble.cekame}
                      onOpen={() => openForZamerovac(DRILL.waiting, bubble.zamerovac_name, `${bubble.zamerovac_name} — Čekáme`)}
                    />
                    {' '}| Bez výsledku:{' '}
                    <DrilldownCount
                      count={bubble.bez_hodnoty}
                      onOpen={() => openForZamerovac(DRILL.missing, bubble.zamerovac_name, `${bubble.zamerovac_name} — Bez výsledku`)}
                    />
                  </p>
                  <p>
                    Průměr celkové ceny s DPH:{' '}
                    <strong>
                      <DrilldownMoney
                        count={bubble.sale_count_with_vat || bubble.ano}
                        amount={`${formatMoney(bubble.avg_sale_with_vat)} Kč`}
                        onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} — zakázky tvořící průměr s DPH`)}
                      />
                    </strong>
                    {' '}| Průměr celkové ceny bez DPH:{' '}
                    <strong>
                      <DrilldownMoney
                        count={bubble.sale_count_without_vat || bubble.ano}
                        amount={`${formatMoney(bubble.avg_sale_without_vat)} Kč`}
                        onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} — zakázky tvořící průměr bez DPH`)}
                      />
                    </strong>
                  </p>
                  <p className="duration-metrics-line">
                    Průměr přijetí → navolání:{' '}
                    <DrilldownDays
                      count={bubble.count_lead_navolani}
                      days={bubble.avg_days_lead_navolani}
                      onOpen={() => openForZamerovac(DRILL.durationLeadNavolani, bubble.zamerovac_name, `${bubble.zamerovac_name} — přijetí → navolání`)}
                    />
                    {' '}| Navolání → zaměření:{' '}
                    <DrilldownDays
                      count={bubble.count_navolani_zamereni}
                      days={bubble.avg_days_navolani_zamereni}
                      onOpen={() => openForZamerovac(DRILL.durationNavolaniZamereni, bubble.zamerovac_name, `${bubble.zamerovac_name} — navolání → zaměření`)}
                    />
                    {' '}| Příjem → zaměření:{' '}
                    <DrilldownDays
                      count={bubble.count_lead_zamereni}
                      days={bubble.avg_days_lead_zamereni}
                      onOpen={() => openForZamerovac(DRILL.durationLeadZamereni, bubble.zamerovac_name, `${bubble.zamerovac_name} — přijetí → zaměření`)}
                    />
                  </p>
                  <p className="highlight">
                    Úspěšnost (Ano/(Ano+Ne)):{' '}
                    <DrilldownCount
                      count={bubble.ano + bubble.ne}
                      onOpen={() => openForZamerovac(DRILL.decided, bubble.zamerovac_name, `${bubble.zamerovac_name} — úspěšnost`)}
                    />
                    {' '}
                    (
                    <DrilldownCount
                      count={bubble.ano + bubble.ne}
                      text={`${bubble.success_rate}%`}
                      onOpen={() => openForZamerovac(DRILL.decided, bubble.zamerovac_name, `${bubble.zamerovac_name} — úspěšnost`)}
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
                          <th>Kdo domluvil</th>
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
                        {bubble.obchodnici.map((s) => (
                          <tr key={`${bubble.zamerovac_name}-${s.obchodnik_name}`}>
                            <td>
                              <Link className="operator-jump-link" href={getOperatorsLink(s.obchodnik_name)}>
                                {s.obchodnik_name}
                              </Link>
                            </td>
                            <td>
                              <DrilldownCount
                                count={s.total}
                                onOpen={() => openForZamerovac(DRILL.scheduled, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — Celkem`, s.obchodnik_name)}
                              />
                            </td>
                            <td className="success">
                              <DrilldownCount
                                count={s.ano}
                                className="success"
                                onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — Ano`, s.obchodnik_name)}
                              />
                            </td>
                            <td className="danger">
                              <DrilldownCount
                                count={s.ne}
                                className="danger"
                                onOpen={() => openForZamerovac(DRILL.cancelled, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — Ne`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownCount
                                count={s.cekame}
                                onOpen={() => openForZamerovac(DRILL.waiting, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — Čekáme`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownCount
                                count={s.bez_hodnoty}
                                onOpen={() => openForZamerovac(DRILL.missing, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — Bez výsledku`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownMoney
                                count={s.sale_count_with_vat || s.ano}
                                amount={`${formatMoney(s.avg_sale_with_vat)} Kč`}
                                onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — průměr s DPH`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownMoney
                                count={s.sale_count_without_vat || s.ano}
                                amount={`${formatMoney(s.avg_sale_without_vat)} Kč`}
                                onOpen={() => openForZamerovac(DRILL.completed, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — průměr bez DPH`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={s.count_lead_navolani}
                                days={s.avg_days_lead_navolani}
                                onOpen={() => openForZamerovac(DRILL.durationLeadNavolani, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — přijetí → navolání`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={s.count_navolani_zamereni}
                                days={s.avg_days_navolani_zamereni}
                                onOpen={() => openForZamerovac(DRILL.durationNavolaniZamereni, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — navolání → zaměření`, s.obchodnik_name)}
                              />
                            </td>
                            <td>
                              <DrilldownDays
                                count={s.count_lead_zamereni}
                                days={s.avg_days_lead_zamereni}
                                onOpen={() => openForZamerovac(DRILL.durationLeadZamereni, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — přijetí → zaměření`, s.obchodnik_name)}
                              />
                            </td>
                            <td className="highlight">
                              <DrilldownCount
                                count={s.ano + s.ne}
                                onOpen={() => openForZamerovac(DRILL.decided, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — úspěšnost`, s.obchodnik_name)}
                              />
                              {' '}
                              (
                              <DrilldownCount
                                count={s.ano + s.ne}
                                text={`${s.success_rate}%`}
                                onOpen={() => openForZamerovac(DRILL.decided, bubble.zamerovac_name, `${bubble.zamerovac_name} / ${s.obchodnik_name} — úspěšnost`, s.obchodnik_name)}
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
