import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'

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
  activeIds = []
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
    const list = [...operators].sort((a, b) => {
      const aHidden = hiddenSet.has(a.operator_id) ? 1 : 0
      const bHidden = hiddenSet.has(b.operator_id) ? 1 : 0
      if (aHidden !== bHidden) return aHidden - bHidden
      return String(a.operator_name).localeCompare(String(b.operator_name), 'cs')
    })
    if (!q) return list
    return list.filter((op) => {
      const hay = `${op.operator_name} ${op.operator_id} ${op.email || ''}`.toLowerCase()
      return hay.includes(q)
    })
  }, [operators, query, hiddenSet])

  const hiddenCount = hiddenIds.length
  const visibleCount = Math.max(operators.length - hiddenCount, 0)

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
              Skryté operátory se nepočítají do statistik ani se nezobrazí v kartách.
            </p>
            <p className="drilldown-meta">
              Viditelní: <strong>{visibleCount}</strong> · Skrytí: <strong>{hiddenCount}</strong>
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
            placeholder="Hledat jméno…"
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
                        {active ? ' · v období má pauzy' : ''}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    className={`operator-directory-toggle${hidden ? ' is-hidden' : ''}`}
                    onClick={() => onToggleHidden(op.operator_id)}
                  >
                    {hidden ? 'Zobrazit' : 'Skrýt'}
                  </button>
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
