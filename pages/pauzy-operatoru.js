import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import DrilldownCount from '@/components/DrilldownCount'
import PauseDrilldown from '@/components/PauseDrilldown'
import OperatorDirectory from '@/components/OperatorDirectory'
import { getMonthToDateRange } from '@/lib/metrics-query'
import {
  TEAM_IDS,
  TEAM_OPTIONS,
  operatorMatchesTeamFilter,
  readActiveTeamFilter,
  readTeamAssignments,
  writeActiveTeamFilter,
  writeTeamAssignments
} from '@/lib/operator-teams'

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

function formatSyncTimestamp(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function OperatorPausesPage() {
  const initialMonthRange = getMonthToDateRange()
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState(initialMonthRange.startDate)
  const [endDate, setEndDate] = useState(initialMonthRange.endDate)
  const [bubbles, setBubbles] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [drilldown, setDrilldown] = useState(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [directoryOperators, setDirectoryOperators] = useState([])
  const [hiddenIds, setHiddenIds] = useState([])
  const [summaryRows, setSummaryRows] = useState([])
  const [teamAssignments, setTeamAssignments] = useState({})
  const [activeTeam, setActiveTeam] = useState(TEAM_IDS.ALL)
  const [syncState, setSyncState] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncFreshness, setSyncFreshness] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)

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
    setTeamAssignments(readTeamAssignments())
    setActiveTeam(readActiveTeamFilter())
  }, [])

  useEffect(() => {
    fetchData()
  }, [period, startDate, endDate])

  async function loadSyncStatus() {
    try {
      const response = await fetch('/api/daktela-sync')
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        throw new Error(
          response.redirected || response.status === 307 || response.status === 302
            ? 'Nejste přihlášeni — obnovte stránku a přihlaste se.'
            : `Neplatná odpověď API (${response.status})`
        )
      }
      if (!response.ok || data?.error) {
        throw new Error(data?.error || `HTTP ${response.status}`)
      }
      setSyncState(data.state || 'idle')
      if (data.message) setSyncMessage(data.message)
      setSyncFreshness(data.dataFreshness || null)
      setSyncProgress(data.progress || null)
      return data
    } catch (err) {
      setSyncMessage(err.message || 'Nepodařilo se načíst stav syncu')
      return null
    }
  }

  useEffect(() => {
    loadSyncStatus()
  }, [])

  useEffect(() => {
    if (syncState !== 'running') return undefined
    const intervalId = setInterval(async () => {
      const data = await loadSyncStatus()
      if (data?.state === 'success') {
        fetchData()
      }
    }, 2000)
    return () => clearInterval(intervalId)
  }, [syncState, period, startDate, endDate])

  async function handleSyncData() {
    if (syncBusy) return
    if (syncState === 'running') {
      setSyncMessage('Synchronizace už běží — sledujte průběh níže.')
      return
    }
    setSyncBusy(true)
    setSyncMessage('Spouštím synchronizaci…')
    setSyncState('running')
    try {
      const response = await fetch('/api/daktela-sync', { method: 'POST' })
      const text = await response.text()
      let data = null
      try {
        data = text ? JSON.parse(text) : null
      } catch {
        throw new Error(
          response.status === 401 || response.status === 302 || response.status === 307
            ? 'Nejste přihlášeni — obnovte stránku a přihlaste se.'
            : `Server nevrátil JSON (${response.status}). ${text.slice(0, 120)}`
        )
      }
      if (!response.ok || data?.error) {
        throw new Error(data?.error || data?.message || `HTTP ${response.status}`)
      }
      setSyncState(data.status?.state || 'running')
      setSyncMessage(data.message || data.status?.message || 'Synchronizace spuštěna.')
      setSyncProgress(data.status?.progress || data.progress || null)
      // znovu načti progress (lokální běh)
      setTimeout(() => loadSyncStatus(), 800)
    } catch (err) {
      setSyncState('error')
      setSyncMessage(err.message || 'Nepodařilo se spustit synchronizaci')
      setSyncProgress(null)
    } finally {
      setSyncBusy(false)
    }
  }

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
        setError(err.message || 'Nepodařilo se načíst činnosti operátorů')
      }
      setBubbles([])
      setSummaryRows([])
    } finally {
      setLoading(false)
    }
  }

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod === 'month') {
      const range = getMonthToDateRange()
      setStartDate(range.startDate)
      setEndDate(range.endDate)
    } else if (nextPeriod !== 'custom') {
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

  function persistTeamAssignments(nextAssignments) {
    setTeamAssignments(nextAssignments)
    writeTeamAssignments(nextAssignments)
  }

  function handleTeamFilterChange(teamId) {
    setActiveTeam(teamId)
    writeActiveTeamFilter(teamId)
  }

  function assignOperatorTeam(operatorId, teamId) {
    const id = String(operatorId)
    if (!id) return
    const next = { ...teamAssignments, [id]: teamId }
    persistTeamAssignments(next)
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
    () =>
      bubbles.filter((bubble) => {
        if (hiddenSet.has(String(bubble.operator_id))) return false
        return operatorMatchesTeamFilter(bubble, activeTeam, teamAssignments)
      }),
    [bubbles, hiddenSet, activeTeam, teamAssignments]
  )

  const visibleSummaryRows = useMemo(
    () =>
      summaryRows.filter((row) => {
        if (hiddenSet.has(String(row.operator_id))) return false
        return operatorMatchesTeamFilter(row, activeTeam, teamAssignments)
      }),
    [summaryRows, hiddenSet, activeTeam, teamAssignments]
  )

  const teamExcludedIds = useMemo(() => {
    if (activeTeam === TEAM_IDS.ALL) return []
    return bubbles
      .filter((bubble) => !operatorMatchesTeamFilter(bubble, activeTeam, teamAssignments))
      .map((bubble) => String(bubble.operator_id))
  }, [bubbles, activeTeam, teamAssignments])

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
    const excluded = new Set()
    if (excludeHidden) {
      for (const id of hiddenIds) excluded.add(String(id))
      for (const id of teamExcludedIds) excluded.add(String(id))
    }
    setDrilldown({
      operator,
      operatorName,
      pause,
      pauseName,
      metric,
      title,
      subtitle,
      excludeOperators: Array.from(excluded)
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
              <p className="pauses-kicker">Daktela + ERP · časový filtr</p>
              <h1>Činnosti operátorů</h1>
              <p>
                Všechny metriky na kartách (Daktela i ERP) se řídí jen časovým filtrem —
                výchozí rozsah je od 1. dne měsíce do dnes; lze změnit na týden, rok nebo vlastní datum.
                Kliknutím otevřete rozpad.
              </p>
              <div className="pauses-hero-actions">
                <button
                  type="button"
                  className="pauses-sync-btn"
                  onClick={handleSyncData}
                  disabled={syncBusy || syncState === 'running'}
                  aria-busy={syncBusy || syncState === 'running'}
                >
                  {syncState === 'running'
                    ? `Aktualizuji… ${syncProgress?.percent ?? 0} %`
                    : 'Aktualizovat data'}
                </button>
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

              {(syncState === 'running' ||
                syncState === 'error' ||
                (syncState === 'success' && syncProgress)) && (
                <div
                  className={`pauses-sync-panel${syncState === 'running' ? ' is-running' : ''}${
                    syncState === 'error' ? ' is-error' : ''
                  }`}
                  aria-live="polite"
                >
                  <div className="pauses-sync-panel-top">
                    <strong>
                      {syncState === 'running'
                        ? syncProgress?.currentLabel
                          ? `Stahuji: ${syncProgress.currentLabel}`
                          : 'Synchronizace běží…'
                        : syncState === 'error'
                          ? 'Sync se nepodařil'
                          : syncMessage || 'Poslední sync'}
                    </strong>
                    <span>
                      {syncProgress
                        ? `${syncProgress.doneSteps || 0} / ${syncProgress.totalSteps || 0} tabulek`
                        : ''}
                      {syncProgress?.remainingSteps > 0 && syncState === 'running'
                        ? ` · zbývá ${syncProgress.remainingSteps}`
                        : ''}
                    </span>
                  </div>
                  {syncState === 'running' ? (
                    <div className="pauses-sync-bar" aria-hidden="true">
                      <div
                        className="pauses-sync-bar-fill"
                        style={{
                          width: `${Math.max(0, Math.min(100, syncProgress?.percent || 0))}%`
                        }}
                      />
                    </div>
                  ) : null}
                  {syncState === 'running' && syncProgress?.page?.total != null ? (
                    <p className="pauses-sync-detail">
                      Stránka {syncProgress.page.page} ·{' '}
                      {Number(syncProgress.page.offset || 0).toLocaleString('cs-CZ')} /{' '}
                      {Number(syncProgress.page.total || 0).toLocaleString('cs-CZ')}
                      {syncProgress.page.remaining != null
                        ? ` · zbývá ${Number(syncProgress.page.remaining).toLocaleString('cs-CZ')} záznamů`
                        : ''}
                    </p>
                  ) : syncMessage ? (
                    <p className="pauses-sync-detail">{syncMessage}</p>
                  ) : null}
                  {Array.isArray(syncProgress?.steps) && syncProgress.steps.length > 0 ? (
                    <ul className="pauses-sync-steps">
                      {syncProgress.steps.map((step) => (
                        <li
                          key={step.id}
                          className={`pauses-sync-step is-${step.state || 'pending'}`}
                        >
                          <span className="pauses-sync-step-mark" aria-hidden="true">
                            {step.state === 'done'
                              ? '✓'
                              : step.state === 'error'
                                ? '!'
                                : step.state === 'running'
                                  ? '…'
                                  : '·'}
                          </span>
                          {step.label}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )}

              <p className="pauses-sync-meta">
                Poslední hovor v DB: {formatSyncTimestamp(syncFreshness?.call)}
                {syncFreshness?.ready_sessions
                  ? ` · ready: ${formatSyncTimestamp(syncFreshness.ready_sessions)}`
                  : ''}
              </p>
            </div>
            <div className="pauses-hero-glow" aria-hidden="true" />
          </header>

          <div className="pauses-team-switch" role="group" aria-label="Přepínání týmů">
            {TEAM_OPTIONS.map((team) => (
              <button
                key={team.id}
                type="button"
                className={`pauses-team-btn${activeTeam === team.id ? ' is-active' : ''}`}
                onClick={() => handleTeamFilterChange(team.id)}
              >
                {team.label}
              </button>
            ))}
          </div>

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
              Načítám činnosti operátorů…
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
                ? activeTeam !== TEAM_IDS.ALL
                  ? 'V tomto týmu nejsou v období žádní viditelní operátoři. Změňte tým nebo upravte číselník.'
                  : 'Všichni operátoři s daty jsou skrytí. Otevřete číselník a některé zobrazte.'
                : 'Pro zvolené období nejsou žádná data.'}
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
                          ? `${formatNumber(summary.requests_per_day, 2)} pož./den · vytíženost ${formatPercent(summary.utilization_pct)}`
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
                          title: `${bubble.operator_name} — čas pauz`,
                          subtitle: 'Součty podle typu pauzy + jednotlivé sessions'
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
                          title: `${bubble.operator_name} — počet pauz`,
                          subtitle: 'Součty podle typu pauzy + jednotlivé sessions'
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
                      {/*
                        Skryté v UI (počíta se dál v API):
                        Doba přihlášení, Administrativa, Nečinnost, Čistý čas,
                        Odchozí/Příchozí/Hovory celkem, Maily,
                        Dopadl hovor ANO, Domluveno zaměření ANO, ERP hovory, ANO
                      */}
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.rejected_calls}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'rejected',
                            'Odmítnuté hovory',
                            'Nezvednuté / zmeškané hovory (answered = Ne) v Daktela'
                          )
                        }
                      >
                        <span>Odmítnuté hovory</span>
                        <strong>{formatNumber(summary.rejected_calls, 0)}</strong>
                        <small>rozkliknout seznam</small>
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
                        className="pauses-summary-item"
                        disabled={summary.success_zamereni_z_erp_pct == null}
                        title="ANO / ERP hovory"
                      >
                        <span>Úspěšnost zaměření</span>
                        <strong>{formatPercent(summary.success_zamereni_z_erp_pct)}</strong>
                        <small>ANO / ERP hovory</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.pocet_chyb}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'pocet_chyb',
                            'Počet chyb',
                            'Looker: 5 typů chyb · období podle data vytvoření zakázky',
                            {
                              operatorName:
                                summary.chyby_operator_name ||
                                summary.erp_operator_name ||
                                bubble.operator_name
                            }
                          )
                        }
                      >
                        <span>Počet chyb</span>
                        <strong>{formatNumber(summary.pocet_chyb, 0)}</strong>
                        <small>rozkliknout chyby</small>
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
        teamAssignments={teamAssignments}
        onAssignTeam={assignOperatorTeam}
      />
    </main>
  )
}
