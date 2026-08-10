import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  TEAM_ASSIGN_OPTIONS,
  TEAM_IDS,
  resolveOperatorTeam,
  teamLabel
} from '@/lib/operator-teams'

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

export default function OperatorDirectory({
  open,
  onClose,
  operators,
  hiddenIds,
  onToggleHidden,
  onShowAll,
  onHideAll,
  activeIds = [],
  teamAssignments = {},
  onAssignTeam
}) {
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (!open) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKeyDown)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = ''
    }
  }, [open, onClose])

  const activeSet = useMemo(() => new Set(activeIds), [activeIds])
  const hiddenSet = useMemo(() => new Set(hiddenIds), [hiddenIds])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const teamOrder = {
      [TEAM_IDS.LUCIE]: 0,
      [TEAM_IDS.STEPAN]: 1,
      [TEAM_IDS.NONE]: 2
    }
    const list = [...operators].sort((a, b) => {
      const aTeam = resolveOperatorTeam(a, teamAssignments)
      const bTeam = resolveOperatorTeam(b, teamAssignments)
      if (teamOrder[aTeam] !== teamOrder[bTeam]) {
        return (teamOrder[aTeam] ?? 9) - (teamOrder[bTeam] ?? 9)
      }
      const aHidden = hiddenSet.has(a.operator_id) ? 1 : 0
      const bHidden = hiddenSet.has(b.operator_id) ? 1 : 0
      if (aHidden !== bHidden) return aHidden - bHidden
      return String(a.operator_name).localeCompare(String(b.operator_name), 'cs')
    })
    if (!q) return list
    return list.filter((op) => {
      const team = teamLabel(resolveOperatorTeam(op, teamAssignments))
      const hay = `${op.operator_name} ${op.operator_id} ${op.email || ''} ${team}`.toLowerCase()
      return hay.includes(q)
    })
  }, [operators, query, hiddenSet, teamAssignments])

  const hiddenCount = hiddenIds.length
  const visibleCount = Math.max(operators.length - hiddenCount, 0)
  const teamCounts = useMemo(() => {
    const counts = {
      [TEAM_IDS.LUCIE]: 0,
      [TEAM_IDS.STEPAN]: 0,
      [TEAM_IDS.NONE]: 0
    }
    for (const op of operators) {
      const team = resolveOperatorTeam(op, teamAssignments)
      counts[team] = (counts[team] || 0) + 1
    }
    return counts
  }, [operators, teamAssignments])

  if (!mounted || !open) return null

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel operator-directory-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-directory-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="operator-directory-title">Číselník operátorů</h2>
            <p className="drilldown-subtitle">
              Skryté operátory se nepočítají do statistik. Tým lze přehazovat mezi Lucií a Štěpánem.
            </p>
            <p className="drilldown-meta">
              Viditelní: <strong>{visibleCount}</strong> · Skrytí: <strong>{hiddenCount}</strong>
              {' · '}
              Lucie: <strong>{teamCounts[TEAM_IDS.LUCIE]}</strong>
              {' · '}
              Štěpán: <strong>{teamCounts[TEAM_IDS.STEPAN]}</strong>
              {' · '}
              Bez týmu: <strong>{teamCounts[TEAM_IDS.NONE]}</strong>
            </p>
          </div>
          <button type="button" className="drilldown-close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </header>

        <div className="operator-directory-toolbar">
          <input
            type="search"
            className="operator-directory-search"
            placeholder="Hledat jméno nebo tým…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <div className="operator-directory-actions">
            <button type="button" className="operator-directory-action" onClick={onShowAll}>
              Zobrazit všechny
            </button>
            <button type="button" className="operator-directory-action" onClick={onHideAll}>
              Skrýt všechny
            </button>
          </div>
        </div>

        <div className="operator-directory-list">
          {filtered.length === 0 ? (
            <div className="drilldown-status">Žádný operátor neodpovídá hledání.</div>
          ) : (
            filtered.map((op) => {
              const hidden = hiddenSet.has(op.operator_id)
              const active = activeSet.has(op.operator_id)
              const team = resolveOperatorTeam(op, teamAssignments)
              return (
                <div
                  key={op.operator_id}
                  className={`operator-directory-row${hidden ? ' is-hidden' : ''}`}
                >
                  <div className="operator-directory-identity">
                    <span className="operator-directory-avatar" aria-hidden="true">
                      {initials(op.operator_name)}
                    </span>
                    <div>
                      <strong>{op.operator_name}</strong>
                      <p>
                        {op.operator_id}
                        {active ? ' · v období má data' : ''}
                        {' · '}
                        {teamLabel(team)}
                      </p>
                    </div>
                  </div>
                  <div className="operator-directory-controls">
                    <select
                      className="operator-directory-team-select"
                      value={team}
                      aria-label={`Tým pro ${op.operator_name}`}
                      onChange={(event) => onAssignTeam?.(op.operator_id, event.target.value)}
                    >
                      {TEAM_ASSIGN_OPTIONS.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className={`operator-directory-toggle${hidden ? ' is-hidden' : ''}`}
                      onClick={() => onToggleHidden(op.operator_id)}
                    >
                      {hidden ? 'Zobrazit' : 'Skrýt'}
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
