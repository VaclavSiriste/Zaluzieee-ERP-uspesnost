import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import DrilldownCount from '@/components/DrilldownCount'
import PauseDrilldown from '@/components/PauseDrilldown'
import OperatorErrorsDrilldown from '@/components/OperatorErrorsDrilldown'
import OperatorDirectory from '@/components/OperatorDirectory'
import OperatorsAccessPanel from '@/components/OperatorsAccessPanel'
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
import {
  computeCleanDays,
  computeRequestsPerDay,
  computeTotalRequests,
  formatRequestsFormulaHint
} from '@/lib/operator-requests-metrics'

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

/** Barevné pozadí vytíženosti: &lt;60 % červená, 60–75 % oranžová, &gt;75 % zelená. */
function utilizationToneClass(value) {
  if (value == null || Number.isNaN(Number(value))) return ''
  const pct = Number(value)
  if (pct < 60) return 'pauses-util-low'
  if (pct <= 75) return 'pauses-util-mid'
  return 'pauses-util-high'
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
  return `${formatNumber(hours, 1)} h`
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
  const [missedCallbackSummary, setMissedCallbackSummary] = useState(null)
  const [missedCallbackLoading, setMissedCallbackLoading] = useState(false)
  const [rejectedExpandedIds, setRejectedExpandedIds] = useState(() => new Set())

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

  async function loadMissedCallbackSummary(params) {
    setMissedCallbackLoading(true)
    setMissedCallbackSummary(null)
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 90000)
      const summaryParams = new URLSearchParams({
        ...Object.fromEntries(params.entries()),
        summary: '1'
      })
      const response = await fetch(`/api/missed-call-callbacks?${summaryParams}`, {
        signal: controller.signal
      })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (response.ok && data?.summary) {
        setMissedCallbackSummary(data.summary)
      }
    } catch {
      setMissedCallbackSummary(null)
    } finally {
      setMissedCallbackLoading(false)
    }
  }

  async function fetchData() {
    setLoading(true)
    setError('')
    const params = new URLSearchParams({
      period,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })
    let failed = false
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 20000)
      const response = await fetch(`/api/operator-pauses?${params}`, { signal: controller.signal })
      clearTimeout(timeoutId)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setBubbles(data.bubbles || [])
      setSummaryRows(data.summary || [])
    } catch (err) {
      failed = true
      if (err.name === 'AbortError') {
        setError('Načítání trvalo příliš dlouho. Zkuste obnovit stránku.')
      } else {
        setError(err.message || 'Nepodařilo se načíst činnosti operátorů')
      }
      setBubbles([])
      setSummaryRows([])
      setMissedCallbackSummary(null)
    } finally {
      setLoading(false)
    }
    if (!failed) {
      loadMissedCallbackSummary(params)
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
    let natrasovaniAno = 0
    let natrasovaniPocet = 0
    let zamereniAno = 0
    let zamereniPocet = 0

    for (const row of visibleSummaryRows) {
      natrasovaniAno += Number(row.domluveno_zamereni_ano) || 0
      natrasovaniPocet += Number(row.domluveno_zamereni_pocet) || 0
      zamereniAno += Number(row.erp_hovory_ano) || 0
      zamereniPocet += Number(row.erp_hovory_pocet) || 0
    }

    return {
      operators: visibleBubbles.length,
      sessions: visibleBubbles.reduce((sum, bubble) => sum + (Number(bubble.sessions) || 0), 0),
      duration_seconds: visibleBubbles.reduce(
        (sum, bubble) => sum + (Number(bubble.duration_seconds) || 0),
        0
      ),
      // Vážený souhrn přes viditelné operátory (číselník + tým), ne průměr %
      success_natrasovani_pct:
        natrasovaniPocet > 0 ? (natrasovaniAno / natrasovaniPocet) * 100 : null,
      natrasovani_ano: natrasovaniAno,
      natrasovani_pocet: natrasovaniPocet,
      success_zamereni_z_erp_pct: zamereniPocet > 0 ? (zamereniAno / zamereniPocet) * 100 : null,
      zamereni_ano: zamereniAno,
      zamereni_pocet: zamereniPocet
    }
  }, [visibleBubbles, visibleSummaryRows])

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
      subtitle,
      ...options
    })
  }

  function toggleRejectedBreakdown(operatorId) {
    const id = String(operatorId)
    setRejectedExpandedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function openUtilizationDrilldown(bubble, summary) {
    openDrilldown({
      operator: bubble.operator_id,
      operatorName: bubble.operator_name,
      metric: 'utilization',
      title: `${bubble.operator_name} — Vytíženost`,
      subtitle: 'Vzorec: (K + O×P + Q×R + T×U) / M × 100 · průměr včetně 0',
      utilizationInputs: {
        login_seconds: summary.login_seconds,
        idle_seconds: summary.idle_seconds,
        admin_seconds: summary.admin_seconds,
        clean_seconds: summary.clean_seconds,
        outgoing_calls: summary.outgoing_calls,
        outgoing_avg_seconds: summary.outgoing_avg_seconds,
        incoming_calls: summary.incoming_calls,
        incoming_avg_seconds: summary.incoming_avg_seconds,
        email_count: summary.email_count,
        email_avg_seconds: summary.email_avg_seconds,
        utilization_pct: summary.utilization_pct
      }
    })
  }

  function openMissedCallbackDrilldown(variant, title, subtitle, hoursAxis = 'all') {
    openDrilldown({
      metric: 'missed_callbacks',
      missedVariant: variant,
      hoursAxis,
      title,
      subtitle
    })
  }

  function enrichSummary(row) {
    if (!row) return row
    const totalRequests =
      Number(row.total_requests) ||
      computeTotalRequests({
        outgoing_calls: row.outgoing_calls,
        incoming_calls: row.incoming_calls,
        email_count: row.email_count
      })
    const cleanDays = computeCleanDays(row.clean_hours)
    const requestsPerDay = computeRequestsPerDay({
      total_requests: totalRequests,
      clean_hours: row.clean_hours,
      clean_days: cleanDays
    })
    return {
      ...row,
      total_requests: totalRequests,
      clean_days: cleanDays,
      requests_per_day: requestsPerDay
    }
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
                  className="pauses-directory-btn"
                  onClick={() => setDirectoryOpen(true)}
                >
                  Číselník operátorů
                  {hiddenIds.length > 0 ? (
                    <span className="pauses-directory-badge">{hiddenIds.length} skrytých</span>
                  ) : null}
                </button>
              </div>

              <OperatorsAccessPanel />

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
              <article
                className="pauses-kpi"
                title="ERP · Naplánován termín zaměření ANO / (ANO + NE) · součet přes viditelné operátory"
              >
                <span className="pauses-kpi-label">Úspěšnost natrasování</span>
                <strong className="pauses-kpi-value">
                  {formatPercent(visibleTotals.success_natrasovani_pct)}
                </strong>
                <span className="pauses-kpi-hint">
                  {visibleTotals.natrasovani_pocet > 0
                    ? `${formatNumber(visibleTotals.natrasovani_ano, 0)} ANO / ${formatNumber(visibleTotals.natrasovani_pocet, 0)}`
                    : 'bez ERP dat'}
                </span>
              </article>
              <article
                className="pauses-kpi"
                title="ANO / ERP hovory · součet přes viditelné operátory"
              >
                <span className="pauses-kpi-label">Úspěšnost zaměření</span>
                <strong className="pauses-kpi-value">
                  {formatPercent(visibleTotals.success_zamereni_z_erp_pct)}
                </strong>
                <span className="pauses-kpi-hint">
                  {visibleTotals.zamereni_pocet > 0
                    ? `${formatNumber(visibleTotals.zamereni_ano, 0)} ANO / ${formatNumber(visibleTotals.zamereni_pocet, 0)}`
                    : 'bez ERP dat'}
                </span>
              </article>
              {(missedCallbackLoading || missedCallbackSummary) ? (
                <>
                  <article className="pauses-kpi pauses-kpi-clickable">
                    <span className="pauses-kpi-label">Zmeškané příchozí</span>
                    {missedCallbackLoading ? (
                      <strong className="pauses-kpi-value">…</strong>
                    ) : (
                      <DrilldownCount
                        count={missedCallbackSummary.total_missed}
                        className="pauses-kpi-value"
                        title="Kliknutím zobrazíte výčet zmeškaných hovorů"
                        onOpen={() =>
                          openMissedCallbackDrilldown(
                            'all',
                            'Zmeškané příchozí hovory',
                            'Příchozí hovory (answered = Ne) · shoda s navoláním přes posledních 9 číslic'
                          )
                        }
                      />
                    )}
                    <span className="pauses-kpi-hint">
                      {missedCallbackLoading ? 'počítám…' : 'rozkliknout výčet'}
                    </span>
                  </article>
                  <article className="pauses-kpi pauses-kpi-clickable">
                    <span className="pauses-kpi-label">Navolání · pracovní doba</span>
                    {missedCallbackLoading ? (
                      <strong className="pauses-kpi-value">…</strong>
                    ) : (
                      <DrilldownCount
                        count={missedCallbackSummary.working?.called_back || 0}
                        text={formatHours(missedCallbackSummary.working?.avg_hours_to_callback)}
                        className="pauses-kpi-value"
                        title="Průměr do navolání v pracovní době (Po–Pá 8–20, So–Ne 10–18)"
                        onOpen={() =>
                          openMissedCallbackDrilldown(
                            'called_back',
                            'Navolání v pracovní době',
                            'Po–Pá 8–20 · So–Ne 10–18 · dle času zmeškaného hovoru',
                            'working'
                          )
                        }
                      />
                    )}
                    <span className="pauses-kpi-hint">
                      {missedCallbackLoading
                        ? 'počítám…'
                        : `${formatNumber(missedCallbackSummary.working?.called_back || 0, 0)} navoláno`}
                    </span>
                  </article>
                  <article className="pauses-kpi pauses-kpi-clickable">
                    <span className="pauses-kpi-label">Navolání · mimo prac. dobu</span>
                    {missedCallbackLoading ? (
                      <strong className="pauses-kpi-value">…</strong>
                    ) : (
                      <DrilldownCount
                        count={missedCallbackSummary.outside?.called_back || 0}
                        text={formatHours(missedCallbackSummary.outside?.avg_hours_to_callback)}
                        className="pauses-kpi-value"
                        title="Průměr do navolání mimo pracovní dobu"
                        onOpen={() =>
                          openMissedCallbackDrilldown(
                            'called_back',
                            'Navolání mimo pracovní dobu',
                            'Mimo Po–Pá 8–20 a So–Ne 10–18 · dle času zmeškaného hovoru',
                            'outside'
                          )
                        }
                      />
                    )}
                    <span className="pauses-kpi-hint">
                      {missedCallbackLoading
                        ? 'počítám…'
                        : `${formatNumber(missedCallbackSummary.outside?.called_back || 0, 0)} navoláno`}
                    </span>
                  </article>
                  <article className="pauses-kpi pauses-kpi-clickable pauses-kpi-warn">
                    <span className="pauses-kpi-label">Ještě nenavolané</span>
                    {missedCallbackLoading ? (
                      <strong className="pauses-kpi-value">…</strong>
                    ) : (
                      <DrilldownCount
                        count={missedCallbackSummary.not_called_back}
                        className="pauses-kpi-value"
                        title="Kliknutím zobrazíte nenavolané zmeškané hovory"
                        onOpen={() =>
                          openMissedCallbackDrilldown(
                            'open',
                            'Nenavolané zmeškané hovory',
                            'Zmeškané bez pozdějšího OUT ani zvednutého IN od stejného čísla'
                          )
                        }
                      />
                    )}
                    <span className="pauses-kpi-hint">
                      {missedCallbackLoading ? 'počítám…' : 'rozkliknout výčet'}
                    </span>
                  </article>
                </>
              ) : null}
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
              const summary = enrichSummary(summaryByOperator.get(String(bubble.operator_id)))
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
                          ? `${formatNumber(summary.requests_per_day, 2)} pož./den · ${formatNumber(summary.total_requests, 0)} celkem · vytíženost ${formatPercent(summary.utilization_pct)}`
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
                        Doba přihlášení, Čistý čas,
                        Odchozí/Příchozí/Hovory celkem, Maily,
                        Dopadl hovor ANO, Domluveno zaměření ANO, ERP hovory, ANO
                      */}
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
                        onClick={() =>
                          openMetricDrilldown(bubble, 'idle', 'Nečinnost')
                        }
                      >
                        <span>Nečinnost</span>
                        <strong>{formatDuration(summary.idle_seconds)}</strong>
                        <small>rozkliknout pauzy</small>
                      </button>
                      <div className="pauses-rejected-block">
                        <button
                          type="button"
                          className={`pauses-summary-item pauses-summary-clickable${
                            rejectedExpandedIds.has(String(bubble.operator_id)) ? ' is-open' : ''
                          }`}
                          disabled={!summary.rejected_calls}
                          onClick={() => toggleRejectedBreakdown(bubble.operator_id)}
                          aria-expanded={rejectedExpandedIds.has(String(bubble.operator_id))}
                          title="Rozklikněte rozpad: operátor vs zákazník"
                        >
                          <span>Odmítnuté hovory</span>
                          <strong>{formatNumber(summary.rejected_calls, 0)}</strong>
                          <small>
                            {rejectedExpandedIds.has(String(bubble.operator_id))
                              ? 'skrýt rozpad ▴'
                              : 'rozkliknout rozpad ▾'}
                          </small>
                        </button>
                        {rejectedExpandedIds.has(String(bubble.operator_id)) ? (
                          <div className="pauses-rejected-breakdown" aria-label="Rozpad odmítnutých hovorů">
                            <button
                              type="button"
                              className="pauses-summary-item pauses-summary-clickable pauses-rejected-child"
                              disabled={!summary.rejected_by_operator}
                              onClick={() =>
                                openMetricDrilldown(
                                  bubble,
                                  'rejected_operator',
                                  'Odmítnuté operátorem',
                                  'Daktela · answered = Ne · disposition_cause = agent · cancel/abandon'
                                )
                              }
                            >
                              <span>Odmítnuté operátorem</span>
                              <strong>{formatNumber(summary.rejected_by_operator, 0)}</strong>
                              <small>rozkliknout seznam</small>
                            </button>
                            <button
                              type="button"
                              className="pauses-summary-item pauses-summary-clickable pauses-rejected-child"
                              disabled={!summary.rejected_by_customer}
                              onClick={() =>
                                openMetricDrilldown(
                                  bubble,
                                  'rejected_customer',
                                  'Odmítnuté zákazníkem',
                                  'Daktela · answered = Ne · caller / busy / noanswer / failed'
                                )
                              }
                            >
                              <span>Odmítnuté zákazníkem</span>
                              <strong>{formatNumber(summary.rejected_by_customer, 0)}</strong>
                              <small>rozkliknout seznam</small>
                            </button>
                          </div>
                        ) : null}
                      </div>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.total_requests && !summary.clean_hours}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'activity',
                            'Požadavky / den',
                            `Vzorec: celkem požadavků ÷ čistý čas ve dnech · dny = (h × 3) ÷ 24 · h = přihlášení − nečinnost · období ${startDate} – ${endDate}`
                          )
                        }
                      >
                        <span>Požadavky / den</span>
                        <strong>{formatNumber(summary.requests_per_day, 2)}</strong>
                        <small title="Požadavky/den = celkem ÷ čistý čas ve dnech, kde dny = (h × 3) ÷ 24">
                          {formatRequestsFormulaHint(summary)}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.total_requests}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'activity',
                            'Požadavky celkem',
                            `Hovory + maily ve zvoleném období (${startDate} – ${endDate})`
                          )
                        }
                      >
                        <span>Požadavky celkem</span>
                        <strong>{formatNumber(summary.total_requests, 0)}</strong>
                        <small>rozkliknout požadavky</small>
                      </button>
                      <button
                        type="button"
                        className={[
                          'pauses-summary-item',
                          'pauses-summary-clickable',
                          utilizationToneClass(summary.utilization_pct)
                        ]
                          .filter(Boolean)
                          .join(' ')}
                        disabled={!summary.admin_seconds && !summary.total_calls && !summary.email_count}
                        onClick={() => openUtilizationDrilldown(bubble, summary)}
                      >
                        <span>Vytíženost</span>
                        <strong>{formatPercent(summary.utilization_pct)}</strong>
                        <small>rozkliknout podklady</small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.dopadl_hovor_pocet}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'dopadl_hovor_pocet',
                            'Úspěšnost navolání',
                            'ERP · Dopadl hovor ANO / (ANO + NE) · stejný časový filtr jako ostatní metriky',
                            {
                              operatorName:
                                summary.erp_operator_name || bubble.operator_name
                            }
                          )
                        }
                      >
                        <span>Úspěšnost navolání</span>
                        <strong>{formatPercent(summary.success_navolani_pct)}</strong>
                        <small>
                          {formatNumber(summary.dopadl_hovor_ano, 0)} ANO /{' '}
                          {formatNumber(summary.dopadl_hovor_pocet, 0)}
                        </small>
                      </button>
                      <button
                        type="button"
                        className="pauses-summary-item pauses-summary-clickable"
                        disabled={!summary.domluveno_zamereni_pocet}
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'domluveno_zamereni_pocet',
                            'Úspěšnost natrasování',
                            'ERP · Naplánován termín zaměření ANO / (ANO + NE) · stejný časový filtr',
                            {
                              operatorName:
                                summary.domluveno_operator_name ||
                                summary.erp_operator_name ||
                                bubble.operator_name
                            }
                          )
                        }
                      >
                        <span>Úspěšnost natrasování</span>
                        <strong>{formatPercent(summary.success_natrasovani_pct)}</strong>
                        <small>
                          {formatNumber(summary.domluveno_zamereni_ano, 0)} ANO /{' '}
                          {formatNumber(summary.domluveno_zamereni_pocet, 0)}
                        </small>
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
                        onClick={() =>
                          openMetricDrilldown(
                            bubble,
                            'pocet_chyb',
                            'Počet chyb',
                            'ERP chyby + ruční úpravy · průměr na den · ukládá se do databáze',
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
                        <small>
                          průměr {formatNumber(summary.pocet_chyb_avg_per_day, 2)} / den · rozkliknout
                        </small>
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
        open={Boolean(drilldown && drilldown.metric !== 'pocet_chyb')}
        drilldown={drilldown?.metric === 'pocet_chyb' ? null : drilldown}
        filters={filters}
        onClose={() => setDrilldown(null)}
      />

      <OperatorErrorsDrilldown
        open={Boolean(drilldown && drilldown.metric === 'pocet_chyb')}
        drilldown={drilldown?.metric === 'pocet_chyb' ? drilldown : null}
        filters={filters}
        onClose={() => setDrilldown(null)}
        onChanged={() => fetchData()}
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
