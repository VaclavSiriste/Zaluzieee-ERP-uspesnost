import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
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

const HIDDEN_OPERATORS_KEY = 'prvni.attendance.hiddenOperators'

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

function formatDateTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

export default function DochazkaPage() {
  const initial = getMonthToDateRange()
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState(initial.startDate)
  const [endDate, setEndDate] = useState(initial.endDate)
  const [items, setItems] = useState([])
  const [drafts, setDrafts] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [savingKey, setSavingKey] = useState('')
  const [message, setMessage] = useState('')
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [directoryOperators, setDirectoryOperators] = useState([])
  const [hiddenIds, setHiddenIds] = useState([])
  const [teamAssignments, setTeamAssignments] = useState({})
  const [activeTeam, setActiveTeam] = useState(TEAM_IDS.ALL)

  useEffect(() => {
    setHiddenIds(readHiddenOperators())
    setTeamAssignments(readTeamAssignments())
    setActiveTeam(readActiveTeamFilter())
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadOperators() {
      try {
        const response = await fetch('/api/daktela-operators')
        const data = await response.json()
        if (!response.ok || data.error) throw new Error(data.error)
        if (!cancelled) setDirectoryOperators(data.operators || [])
      } catch {
        /* fallback built from items below */
      }
    }
    loadOperators()
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!directoryOperators.length && items.length) {
      const seen = new Map()
      for (const item of items) {
        const id = String(item.operator_id)
        if (!seen.has(id)) {
          seen.set(id, { operator_id: item.operator_id, operator_name: item.operator_name, email: null })
        }
      }
      setDirectoryOperators(Array.from(seen.values()))
    }
  }, [items, directoryOperators.length])

  useEffect(() => {
    fetchData()
  }, [period, startDate, endDate])

  async function fetchData() {
    setLoading(true)
    setError('')
    setMessage('')
    try {
      const params = new URLSearchParams({
        period,
        ...(startDate ? { startDate } : {}),
        ...(endDate ? { endDate } : {})
      })
      const response = await fetch(`/api/employee-attendance?${params}`)
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      const list = data.items || []
      setItems(list)
      const nextDrafts = {}
      for (const item of list) {
        const key = `${item.operator_id}|${item.work_date}`
        nextDrafts[key] = {
          arrival_input: item.arrival_input || '',
          departure_input: item.departure_input || '',
          note: item.note || ''
        }
      }
      setDrafts(nextDrafts)
    } catch (err) {
      setError(err.message || 'Nepodařilo se načíst docházku')
      setItems([])
      setDrafts({})
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

  function updateDraft(key, field, value) {
    setDrafts((current) => ({
      ...current,
      [key]: {
        ...(current[key] || {}),
        [field]: value
      }
    }))
  }

  async function saveRow(item) {
    const key = `${item.operator_id}|${item.work_date}`
    const draft = drafts[key] || {}
    setSavingKey(key)
    setMessage('')
    setError('')
    try {
      const response = await fetch('/api/employee-attendance', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          operator_id: item.operator_id,
          work_date: item.work_date,
          arrival_at: draft.arrival_input || null,
          departure_at: draft.departure_input || null,
          note: draft.note || ''
        })
      })
      const data = await response.json()
      if (!response.ok || data.error) throw new Error(data.error || `HTTP ${response.status}`)
      setMessage(`Uloženo: ${item.operator_name} · ${item.work_date}`)
      await fetchData()
    } catch (err) {
      setError(err.message || 'Uložení selhalo')
    } finally {
      setSavingKey('')
    }
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
    persistTeamAssignments({ ...teamAssignments, [id]: teamId })
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

  const filteredItems = useMemo(
    () =>
      items.filter((item) => {
        if (hiddenSet.has(String(item.operator_id))) return false
        return operatorMatchesTeamFilter(item, activeTeam, teamAssignments)
      }),
    [items, hiddenSet, activeTeam, teamAssignments]
  )

  const activeIds = useMemo(
    () => [...new Set(items.map((item) => String(item.operator_id)))],
    [items]
  )

  const directoryList = useMemo(() => {
    const byId = new Map()
    for (const op of directoryOperators) {
      byId.set(String(op.operator_id), op)
    }
    for (const item of items) {
      const id = String(item.operator_id)
      if (!byId.has(id)) {
        byId.set(id, { operator_id: item.operator_id, operator_name: item.operator_name, email: null })
      }
    }
    return Array.from(byId.values())
  }, [directoryOperators, items])

  return (
    <main className="dashboard-container pauses-page">
      <div className="dashboard-layout">
        <AppMenu active="attendance" />
        <div className="dashboard-main">
          <header className="pauses-hero">
            <div className="pauses-hero-copy">
              <p className="pauses-kicker">Docházka · editace do DB</p>
              <h1>Příchody a odchody</h1>
              <p>
                Seznam příchodů a odchodů podle časového filtru. Výchozí návrh je z Daktela
                ready sessions; po uložení se hodnota zapíše do tabulky{' '}
                <code>employee_attendance</code> a přepíše návrh.
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
            <div className="pauses-loading">
              <span className="pauses-spinner" />
              Načítám docházku…
            </div>
          ) : null}

          {error ? (
            <section className="pauses-error">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {message ? (
            <section className="pauses-error" style={{ borderColor: '#86efac' }}>
              <p style={{ color: '#166534', margin: 0 }}>{message}</p>
            </section>
          ) : null}

          {!loading && !error && filteredItems.length === 0 ? (
            <div className="pauses-empty">
              {items.length > 0
                ? 'Všichni operátoři jsou skrytí nebo neodpovídají filtru týmu. Otevřete číselník.'
                : 'Pro zvolené období nejsou žádné záznamy.'}
            </div>
          ) : null}

          {!loading && filteredItems.length > 0 ? (
            <div className="drilldown-table-wrap table-scroll attendance-table-wrap">
              <table className="leaderboard-table drilldown-table attendance-table">
                <thead>
                  <tr>
                    <th>Zaměstnanec</th>
                    <th>Datum</th>
                    <th>Příchod</th>
                    <th>Odchod</th>
                    <th>Poznámka</th>
                    <th>Zdroj</th>
                    <th>Akce</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredItems.map((item) => {
                    const key = `${item.operator_id}|${item.work_date}`
                    const draft = drafts[key] || {}
                    const dirty =
                      draft.arrival_input !== (item.arrival_input || '') ||
                      draft.departure_input !== (item.departure_input || '') ||
                      draft.note !== (item.note || '')
                    return (
                      <tr key={key}>
                        <td>
                          <strong>{item.operator_name}</strong>
                        </td>
                        <td>{item.work_date}</td>
                        <td>
                          <input
                            type="datetime-local"
                            className="attendance-input"
                            value={draft.arrival_input || ''}
                            onChange={(event) =>
                              updateDraft(key, 'arrival_input', event.target.value)
                            }
                          />
                          {item.suggested_arrival && item.source === 'manual' ? (
                            <small className="attendance-hint">
                              Daktela: {formatDateTime(item.suggested_arrival)}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <input
                            type="datetime-local"
                            className="attendance-input"
                            value={draft.departure_input || ''}
                            onChange={(event) =>
                              updateDraft(key, 'departure_input', event.target.value)
                            }
                          />
                          {item.suggested_departure && item.source === 'manual' ? (
                            <small className="attendance-hint">
                              Daktela: {formatDateTime(item.suggested_departure)}
                            </small>
                          ) : null}
                        </td>
                        <td>
                          <input
                            type="text"
                            className="attendance-input attendance-note"
                            value={draft.note || ''}
                            placeholder="poznámka"
                            onChange={(event) => updateDraft(key, 'note', event.target.value)}
                          />
                        </td>
                        <td>{item.source === 'manual' ? 'Uloženo' : 'Návrh (Daktela)'}</td>
                        <td>
                          <button
                            type="button"
                            className="attendance-save-btn"
                            disabled={savingKey === key || !dirty}
                            onClick={() => saveRow(item)}
                          >
                            {savingKey === key ? 'Ukládám…' : 'Uložit'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>

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
