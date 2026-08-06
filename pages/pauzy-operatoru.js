import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import DrilldownCount from '@/components/DrilldownCount'
import PauseDrilldown from '@/components/PauseDrilldown'
import OperatorDirectory from '@/components/OperatorDirectory'

const HIDDEN_OPERATORS_KEY = 'prvni.pauses.hiddenOperators'

function formatDuration(totalSeconds) {
  const sec = Math.max(0, Math.floor(Number(totalSeconds) || 0))
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  if (h > 0) return `${h} h ${m} min`
  if (m > 0) return `${m} min`
  return `${sec} s`
}

function formatNumber(value, digits = 2) {
  const n = Number(value) || 0
  return n.toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
}

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${formatNumber(value, 2)} %`
}

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function toneForName(name) {
  const tones = ['a', 'b', 'c', 'd', 'e']
  const raw = String(name || '')
  let hash = 0
  for (let i = 0; i < raw.length; i += 1) hash = (hash + raw.charCodeAt(i) * (i + 1)) % tones.length
  return tones[hash]
}

function readHiddenOperators() {
  if (typeof window === 'undefined') return []
  try {
    const raw = localStorage.getItem(HIDDEN_OPERATORS_KEY)
    const parsed = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : []
  } catch {
    return []
  }
}

function writeHiddenOperators(ids) {
  if (typeof window === 'undefined') return
  localStorage.setItem(HIDDEN_OPERATORS_KEY, JSON.stringify(ids))
}

export default function OperatorPausesPage() {
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [bubbles, setBubbles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drilldown, setDrilldown] = useState(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [directoryOperators, setDirectoryOperators] = useState([])
  const [hiddenIds, setHiddenIds] = useState([])
  const [summaryRows, setSummaryRows] = useState([])

  const filters = useMemo(
    () => ({
      period,
      startDate,
      endDate
    }),
    [period, startDate, endDate]
  )

  useEffect(() => {
    setHiddenIds(readHiddenOperators())
  }, [])

  useEffect(() => {
    fetchData()
  }, [period, startDate, endDate])

  useEffect(() => {
    let cancelled = false
    async function loadOperators() {
      try {
        const response = await fetch('/api/daktela-operators')
        const data = await response.json()
        if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
        if (!cancelled) setDirectoryOperators(data.operators || [])
      } catch {
        if (!cancelled) {
          // fallback: jména z aktuálních statistik
          setDirectoryOperators(
            bubbles.map((bubble) => ({
              operator_id: bubble.operator_id,
              operator_name: bubble.operator_name,
              email: null
            }))
          )
        }
      }
    }
    loadOperators()
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!directoryOperators.length && bubbles.length) {
      setDirectoryOperators((current) => {
        if (current.length) return current
        return bubbles.map((bubble) => ({
          operator_id: bubble.operator_id,
          operator_name: bubble.operator_name,
          email: null
        }))
      })
    }
  }, [bubbles, directoryOperators.length])

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
      const response = await fetch(`/api/operator-pauses?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setBubbles(data.bubbles || [])
      setSummaryRows(data.summary || [])
    } catch (err) {
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst pauzy')
      }
      setBubbles([])
      setSummaryRows([])
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

  function handleStartDateChange(value) {
    setStartDate(value)
    setPeriod('custom')
  }

  function handleEndDateChange(value) {
    setEndDate(value)
    setPeriod('custom')
  }

  function persistHidden(nextIds) {
    setHiddenIds(nextIds)
    writeHiddenOperators(nextIds)
  }

  function toggleHidden(operatorId) {
    const id = String(operatorId)
    if (hiddenIds.includes(id)) {
      persistHidden(hiddenIds.filter((item) => item !== id))
    } else {
      persistHidden([...hiddenIds, id])
    }
  }

  function showAllOperators() {
    persistHidden([])
  }

  function hideAllOperators() {
    const ids = directoryOperators.map((op) => String(op.operator_id)).filter(Boolean)
    persistHidden(ids)
  }

  const hiddenSet = useMemo(() => new Set(hiddenIds.map(String)), [hiddenIds])

  const visibleBubbles = useMemo(
    () => bubbles.filter((bubble) => !hiddenSet.has(String(bubble.operator_id))),
    [bubbles, hiddenSet]
  )

  const visibleSummaryRows = useMemo(
    () => summaryRows.filter((row) => !hiddenSet.has(String(row.operator_id))),
    [summaryRows, hiddenSet]
  )

  const summaryByOperator = useMemo(() => {
    const map = new Map()
    for (const row of visibleSummaryRows) {
      map.set(String(row.operator_id), row)
    }
    return map
  }, [visibleSummaryRows])

  const visibleTotals = useMemo(() => {
    return {
      operators: visibleBubbles.length,
      sessions: visibleBubbles.reduce((sum, bubble) => sum + (Number(bubble.sessions) || 0), 0),
      duration_seconds: visibleBubbles.reduce(
        (sum, bubble) => sum + (Number(bubble.duration_seconds) || 0),
        0
      )
    }
  }, [visibleBubbles])

  const activeIds = useMemo(
    () => bubbles.map((bubble) => String(bubble.operator_id)),
    [bubbles]
  )

  const directoryList = useMemo(() => {
    const byId = new Map()
    for (const op of directoryOperators) {
      byId.set(String(op.operator_id), op)
    }
    for (const bubble of bubbles) {
      const id = String(bubble.operator_id)
      if (!byId.has(id)) {
        byId.set(id, {
          operator_id: bubble.operator_id,
          operator_name: bubble.operator_name,
          email: null
        })
      }
    }
    return Array.from(byId.values())
  }, [directoryOperators, bubbles])

  function openDrilldown({
    operator,
    operatorName,
    pause,
    pauseName,
    metric = 'pauses',
    title,
    subtitle,
    excludeHidden = false
  }) {
    setDrilldown({
      operator,
      operatorName,
      pause,
      pauseName,
      metric,
      title,
      subtitle,
      excludeOperators: excludeHidden ? hiddenIds : []
    })
  }

  function openMetricDrilldown(bubble, metric, title, subtitle, options = {}) {
    openDrilldown({
      operator: bubble.operator_id,
      operatorName: options.operatorName || bubble.operator_name,
      metric,
      title: `${bubble.operator_name} — ${title}`,
      subtitle
    })
  }

  return (
    <main className="dashboard-container pauses-page">
      <div className="dashboard-layout">
        <AppMenu active="operatorPauses" />
        <div className="dashboard-main">
          <header className="pauses-hero">
            <div className="pauses-hero-copy">
              <p className="pauses-kicker">Daktela · pouze pause_sessions</p>
              <h1>Pauzy operátorů</h1>
              <p>
                Přehled pauz a metrik z call centra. Časové filtry mění data stejně jako jinde —
                kliknutím na metriku otevřete její rozpad.
              </p>
              <button
                type="button"
                className="pauses-directory-btn"
                onClick={() => setDirectoryOpen(true)}
              >
                Číselník operátorů
                {hiddenIds.length > 0 ? (
                  <span className="pauses-directory-badge">{hiddenIds.length} skrytých</span>
                ) : null}
              </button>
            </div>
            <div className="pauses-hero-glow" aria-hidden="true" />
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={handlePeriodChange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={handleStartDateChange}
            onEndDateChange={handleEndDateChange}
            hideDateBasis
          />

          {loading ? (
            <div className="pauses-loading">
              <span className="pauses-spinner" />
              Načítám pauzy…
            </div>
          ) : null}

          {error ? (
            <section className="pauses-error">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {!loading && !error ? (
            <section className="pauses-kpis" aria-label="Souhrn pauz">
              <article className="pauses-kpi pauses-kpi-clickable">
                <span className="pauses-kpi-label">Operátoři</span>
                <button
                  type="button"
                  className="pauses-kpi-button"
                  onClick={() => setDirectoryOpen(true)}
                  title="Otevřít číselník operátorů"
                >
                  <strong className="pauses-kpi-value">
                    {visibleTotals.operators.toLocaleString('cs-CZ')}
                  </strong>
                  {hiddenIds.length > 0 ? (
                    <span className="pauses-kpi-hint">{hiddenIds.length} skrytých</span>
                  ) : (
                    <span className="pauses-kpi-hint">upravit seznam</span>
                  )}
                </button>
              </article>
              <article className="pauses-kpi pauses-kpi-clickable">
                <span className="pauses-kpi-label">Počet pauz</span>
                <DrilldownCount
                  count={visibleTotals.sessions}
                  className="pauses-kpi-value"
                  onOpen={() =>
                    openDrilldown({
                      title: 'Všechny pauzy v období',
                      excludeHidden: true
                    })
                  }
                />
              </article>
              <article className="pauses-kpi pauses-kpi-clickable pauses-kpi-accent">
                <span className="pauses-kpi-label">Celkový čas</span>
                <DrilldownCount
                  count={visibleTotals.duration_seconds}
                  text={formatDuration(visibleTotals.duration_seconds)}
                  className="pauses-kpi-value"
                  title="Kliknutím zobrazíte seznam pauz"
                  onOpen={() =>
                    openDrilldown({
                      title: 'Všechny pauzy v období',
                      excludeHidden: true
                    })
                  }
                />
              </article>
            </section>
          ) : null}

          {!loading && !error && visibleBubbles.length === 0 ? (
            <div className="pauses-empty">
              {bubbles.length > 0
                ? 'Všichni operátoři s pauzami jsou skrytí. Otevřete číselník a některé zobrazte.'
                : 'Pro zvolené období nejsou žádné pauzy.'}
            </div>
          ) : null}

          <div className="pauses-grid">
            {visibleBubbles.map((bubble, index) => {
              const tone = toneForName(bubble.operator_name)
              const summary = summaryByOperator.get(String(bubble.operator_id))
              return (
                <article
                  className={`pauses-card pauses-card-tone-${tone}`}
                  key={bubble.operator_id || bubble.operator_name}
                  style={{ '--pauses-delay': `${Math.min(index, 12) * 40}ms` }}
                >
                  <header className="pauses-card-head">
                    <div className="pauses-avatar" aria-hidden="true">
                      {initials(bubble.operator_name)}
                    </div>
                    <div className="pauses-card-title">
                      <h3>{bubble.operator_name}</h3>
                      <p>
                        {summary
                          ? `${formatDuration(summary.clean_seconds)} čistého času`
                          : `${bubble.pauses.length} typů pauz`}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="pauses-card-hide"
                      title="Skrýt operátora ze statistik"
                      onClick={() => toggleHidden(bubble.operator_id)}
                    >
                      Skrýt
                    </button>
                  </header>

                  <div className="pauses-card-stats">
                    <button
                      type="button"
                      className="pauses-stat"
                      onClick={() =>
                        openDrilldown({
                          operator: bubble.operator_id,
                          operatorName: bubble.operator_name,
                          title: `${bubble.operator_name} — všechny pauzy`
                        })
                      }
                      disabled={!bubble.sessions}
                    >
                      <span>Čas pauz</span>
                      <strong>{formatDuration(bubble.duration_seconds)}</strong>
                    </button>
                    <button
                      type="button"
                      className="pauses-stat"
                      onClick={() =>
                        openDrilldown({
                          operator: bubble.operator_id,
                          operatorName: bubble.operator_name,
                          title: `${bubble.operator_name} — všechny pauzy`
                        })
                      }
                      disabled={!bubble.sessions}
                    >
                      <span>Počet</span>
                      <strong>{bubble.sessions.toLocaleString('cs-CZ')}</strong>
                    </button>
                  </div>

                  {summary ? (
                    <div className="pauses-summary-grid">
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.login_seconds}
                        onClick={() =>
                          openMetricDrilldown(bubble, 'login', 'Doba přihlášení')
                        }
                      >
                        <span>Doba přihlášení</span>
                        <strong>{formatDuration(summary.login_seconds)}</strong>
                        <small>rozkliknout sessions</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.admin_seconds}
                        onClick={() =>
                          openMetricDrilldown(bubble, 'admin', 'Administrativa')
                        }
                      >
                        <span>Administrativa</span>
                        <strong>{formatDuration(summary.admin_seconds)}</strong>
                        <small>rozkliknout pauzy</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.idle_seconds}
                        onClick={() => openMetricDrilldown(bubble, 'idle', 'Nečinnost')}
                      >
                        <span>Nečinnost</span>
                        <strong>{formatDuration(summary.idle_seconds)}</strong>
                        <small>rozkliknout pauzy</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.login_seconds && !summary.idle_seconds}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'login',
                            'Čistý čas',
                            'Čistý čas = přihlášení − nečinnost (rozpad sessions přihlášení)'
                          )
                        }
                      >
                        <span>Čistý čas</span>
                        <strong>{formatDuration(summary.clean_seconds)}</strong>
                        <small>{formatNumber(summary.clean_days, 2)} dne</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.outgoing_calls}
                        onClick={() =>
                          openMetricDrilldown(bubble, 'outgoing', 'Odchozí hovory')
                        }
                      >
                        <span>Odchozí hovory</span>
                        <strong>{formatNumber(summary.outgoing_calls, 0)}</strong>
                        <small>průměr {formatDuration(summary.outgoing_avg_seconds)}</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.incoming_calls}
                        onClick={() =>
                          openMetricDrilldown(bubble, 'incoming', 'Příchozí hovory')
                        }
                      >
                        <span>Příchozí hovory</span>
                        <strong>{formatNumber(summary.incoming_calls, 0)}</strong>
                        <small>průměr {formatDuration(summary.incoming_avg_seconds)}</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.total_calls}
                        onClick={() =>
                          openMetricDrilldown(bubble, 'calls', 'Hovory celkem')
                        }
                      >
                        <span>Hovory celkem</span>
                        <strong>{formatNumber(summary.total_calls, 0)}</strong>
                        <small>rozkliknout hovory</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.email_count}
                        onClick={() => openMetricDrilldown(bubble, 'emails', 'Maily')}
                      >
                        <span>Maily</span>
                        <strong>{formatNumber(summary.email_count, 0)}</strong>
                        <small>průměr {formatDuration(summary.email_avg_seconds)}</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.total_calls && !summary.email_count}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'activity',
                            'Požadavky / den',
                            'Rozpad hovorů a mailů, ze kterých se počítá metrika'
                          )
                        }
                      >
                        <span>Požadavky / den</span>
                        <strong>{formatNumber(summary.requests_per_day, 2)}</strong>
                        <small>rozkliknout požadavky</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.admin_seconds && !summary.total_calls && !summary.email_count}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'activity',
                            'Vytíženost',
                            'Vytíženost = (administrativa + čas hovorů + maily) / čistý čas'
                          )
                        }
                      >
                        <span>Vytíženost</span>
                        <strong>{formatPercent(summary.utilization_pct)}</strong>
                        <small>rozkliknout podklady</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.dopadl_hovor_ano && !summary.dopadl_hovor_pocet}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'dopadl_hovor_ano',
                            'Dopadl hovor ANO',
                            'Looker: dopadl_hovor = Ano · filtry status ≠ duplikace, kdo domluvil ≠ null',
                            { operatorName: summary.erp_operator_name || bubble.operator_name }
                          )
                        }
                      >
                        <span>Dopadl hovor ANO</span>
                        <strong>{formatNumber(summary.dopadl_hovor_ano, 0)}</strong>
                        <small>
                          {formatPercent(summary.success_dopadl_hovor_pct)}
                          {summary.dopadl_hovor_pocet
                            ? ` · z ${formatNumber(summary.dopadl_hovor_pocet, 0)}`
                            : ''}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.erp_hovory_ano && !summary.erp_hovory_pocet}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'erp_hovory_ano',
                            'ERP hovory ANO',
                            'Looker: dopadl_hovor = Ano + filtry Důvod ne · vyloučeni Matěj Kalkus, Natálie Sawczuková',
                            { operatorName: summary.erp_operator_name || bubble.operator_name }
                          )
                        }
                      >
                        <span>ERP hovory ANO</span>
                        <strong>{formatNumber(summary.erp_hovory_ano, 0)}</strong>
                        <small>
                          {formatPercent(summary.success_erp_hovory_pct)}
                          {summary.erp_hovory_pocet
                            ? ` · z ${formatNumber(summary.erp_hovory_pocet, 0)}`
                            : ''}
                          {summary.erp_vs_daktela_pct != null
                            ? ` · vs Daktela ${formatPercent(summary.erp_vs_daktela_pct)}`
                            : ''}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.domluveno_zamereni_ano && !summary.domluveno_zamereni_pocet}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'domluveno_zamereni_ano',
                            'Domluveno zaměření ANO',
                            'Looker: naplanovan_termin_zamereni = Ano · filtry status ≠ duplikace, kdo naplánoval ≠ null',
                            {
                              operatorName:
                                summary.domluveno_operator_name ||
                                summary.erp_operator_name ||
                                bubble.operator_name
                            }
                          )
                        }
                      >
                        <span>Domluveno zaměření ANO</span>
                        <strong>{formatNumber(summary.domluveno_zamereni_ano, 0)}</strong>
                        <small>
                          {formatPercent(summary.success_domluveni_zamereni_pct)}
                          {summary.domluveno_zamereni_pocet
                            ? ` · z ${formatNumber(summary.domluveno_zamereni_pocet, 0)}`
                            : ''}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item"
                        disabled={summary.success_zamereni_z_erp_pct == null}
                        title="Domluveno zaměření ANO / ERP hovory ANO"
                      >
                        <span>Úspěšnost zaměření z ERP</span>
                        <strong>{formatPercent(summary.success_zamereni_z_erp_pct)}</strong>
                        <small>domluveno / ERP hovory</small>
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })}
          </div>
        </div>
      </div>

      <PauseDrilldown
        open={Boolean(drilldown)}
        drilldown={drilldown}
        filters={filters}
        onClose={() => setDrilldown(null)}
      />

      <OperatorDirectory
        open={directoryOpen}
        onClose={() => setDirectoryOpen(false)}
        operators={directoryList}
        hiddenIds={hiddenIds}
        activeIds={activeIds}
        onToggleHidden={toggleHidden}
        onShowAll={showAllOperators}
        onHideAll={hideAllOperators}
      />
    </main>
  )
}
