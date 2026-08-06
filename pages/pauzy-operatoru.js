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

  function openDrilldown({ operator, operatorName, pause, pauseName, title, excludeHidden = false }) {
    setDrilldown({
      operator,
      operatorName,
      pause,
      pauseName,
      title,
      excludeOperators: excludeHidden ? hiddenIds : []
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
                Přehled pauz z call centra. Časové filtry mění data stejně jako jinde —
                kliknutím na číslo otevřete jednotlivé pauzy.
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
              const maxPause = Math.max(...bubble.pauses.map((p) => p.duration_seconds), 1)
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
                      <p>{bubble.pauses.length} typů pauz</p>
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

                  <ul className="pauses-type-list">
                    {bubble.pauses.map((pause) => {
                      const width = Math.max(8, Math.round((pause.duration_seconds / maxPause) * 100))
                      return (
                        <li key={`${bubble.operator_id}-${pause.pause_id || pause.pause_name}`}>
                          <div className="pauses-type-row">
                            <div className="pauses-type-meta">
                              <span className="pauses-type-name">{pause.pause_name}</span>
                              <div className="pauses-type-values">
                                <DrilldownCount
                                  count={pause.sessions}
                                  onOpen={() =>
                                    openDrilldown({
                                      operator: bubble.operator_id,
                                      operatorName: bubble.operator_name,
                                      pause: pause.pause_id,
                                      pauseName: pause.pause_name,
                                      title: `${bubble.operator_name} — ${pause.pause_name}`
                                    })
                                  }
                                />
                                <span className="pauses-type-sep">·</span>
                                <DrilldownCount
                                  count={pause.duration_seconds}
                                  text={formatDuration(pause.duration_seconds)}
                                  title="Kliknutím zobrazíte seznam pauz"
                                  onOpen={() =>
                                    openDrilldown({
                                      operator: bubble.operator_id,
                                      operatorName: bubble.operator_name,
                                      pause: pause.pause_id,
                                      pauseName: pause.pause_name,
                                      title: `${bubble.operator_name} — ${pause.pause_name}`
                                    })
                                  }
                                />
                              </div>
                            </div>
                            <button
                              type="button"
                              className="pauses-bar-track"
                              title="Zobrazit rozpad pauz"
                              disabled={!pause.sessions}
                              onClick={() =>
                                openDrilldown({
                                  operator: bubble.operator_id,
                                  operatorName: bubble.operator_name,
                                  pause: pause.pause_id,
                                  pauseName: pause.pause_name,
                                  title: `${bubble.operator_name} — ${pause.pause_name}`
                                })
                              }
                            >
                              <span className="pauses-bar-fill" style={{ width: `${width}%` }} />
                            </button>
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </article>
              )
            })}
          </div>

          {!loading && !error && visibleSummaryRows.length > 0 ? (
            <section className="sla-block">
              <h2 className="sla-block-title">Sumarizace operátorů</h2>
              <div className="table-scroll">
                <table className="leaderboard-table">
                  <thead>
                    <tr>
                      <th>Operátor</th>
                      <th>Doba přihlášení</th>
                      <th>Administrativa</th>
                      <th>Nečinnost</th>
                      <th>Čistý čas</th>
                      <th>Čistý čas ve dnech</th>
                      <th>Odchozí hovory</th>
                      <th>Průměr odchozí</th>
                      <th>Příchozí hovory</th>
                      <th>Průměr příchozí</th>
                      <th>Hovory celkem</th>
                      <th>Maily</th>
                      <th>Průměr mail</th>
                      <th>Požadavky / den</th>
                      <th>Vytíženost</th>
                      <th>Dopadl hovor ANO</th>
                      <th>ERP hovory ANO</th>
                      <th>Domluveno zaměření ANO</th>
                      <th>Úspěšnost / dopadl hovor</th>
                      <th>Úspěšnost / domluvení zaměření</th>
                      <th>ERP / Daktela</th>
                      <th>Úspěšnost zaměření z ERP</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleSummaryRows.map((row) => (
                      <tr key={`summary-${row.operator_id || row.operator_name}`}>
                        <td>{row.operator_name}</td>
                        <td>{formatDuration(row.login_seconds)}</td>
                        <td>{formatDuration(row.admin_seconds)}</td>
                        <td>{formatDuration(row.idle_seconds)}</td>
                        <td>{formatDuration(row.clean_seconds)}</td>
                        <td>{formatNumber(row.clean_days, 2)}</td>
                        <td>{formatNumber(row.outgoing_calls, 0)}</td>
                        <td>{formatDuration(row.outgoing_avg_seconds)}</td>
                        <td>{formatNumber(row.incoming_calls, 0)}</td>
                        <td>{formatDuration(row.incoming_avg_seconds)}</td>
                        <td>{formatNumber(row.total_calls, 0)}</td>
                        <td>{formatNumber(row.email_count, 0)}</td>
                        <td>{formatDuration(row.email_avg_seconds)}</td>
                        <td>{formatNumber(row.requests_per_day, 2)}</td>
                        <td>{formatPercent(row.utilization_pct)}</td>
                        <td>{row.dopadl_hovor_ano == null ? '—' : formatNumber(row.dopadl_hovor_ano, 0)}</td>
                        <td>{row.erp_hovory_ano == null ? '—' : formatNumber(row.erp_hovory_ano, 0)}</td>
                        <td>
                          {row.domluveno_zamereni_ano == null
                            ? '—'
                            : formatNumber(row.domluveno_zamereni_ano, 0)}
                        </td>
                        <td>{formatPercent(row.success_dopadl_hovor_pct)}</td>
                        <td>{formatPercent(row.success_domluveni_zamereni_pct)}</td>
                        <td>{formatPercent(row.erp_vs_daktela_pct)}</td>
                        <td>{formatPercent(row.success_zamereni_z_erp_pct)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ) : null}
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
