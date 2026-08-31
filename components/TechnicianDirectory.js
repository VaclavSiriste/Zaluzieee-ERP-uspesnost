import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  normalizeTechnicianName,
  sortTechnicians
} from '@/lib/technician-targets'

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

export default function TechnicianDirectory({
  open,
  onClose,
  monthLabel = '',
  catalog,
  activeIds,
  onToggleActive,
  onAddName,
  onRename,
  onRemove,
  onShowAll,
  onHideAll
}) {
  const [mounted, setMounted] = useState(false)
  const [query, setQuery] = useState('')
  const [newName, setNewName] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editName, setEditName] = useState('')

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

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = sortTechnicians(catalog)
    if (!q) return list
    return list.filter((item) => item.name.toLowerCase().includes(q))
  }, [catalog, query])

  const activeCount = activeIds.length
  const hiddenCount = Math.max(catalog.length - activeCount, 0)

  function handleAdd(event) {
    event.preventDefault()
    const name = normalizeTechnicianName(newName)
    if (!name) return
    onAddName?.(name)
    setNewName('')
  }

  function startEdit(item) {
    setEditingId(item.id)
    setEditName(item.name)
  }

  function saveEdit(event) {
    event.preventDefault()
    const name = normalizeTechnicianName(editName)
    if (!name || !editingId) return
    onRename?.(editingId, name)
    setEditingId('')
    setEditName('')
  }

  if (!mounted || !open) return null

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel operator-directory-panel technician-directory-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="technician-directory-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="technician-directory-title">Číselník techniků</h2>
            <p className="drilldown-subtitle">
              Vyberte, kteří technici se zobrazí v tabulce targetů. Seznam jmen lze upravit nebo doplnit.
              {monthLabel ? (
                <>
                  {' '}
                  Platí pro měsíc <strong>{monthLabel}</strong>.
                </>
              ) : null}
            </p>
            <p className="drilldown-meta">
              V tabulce: <strong>{activeCount}</strong> · Skrytí: <strong>{hiddenCount}</strong> · Celkem v
              číselníku: <strong>{catalog.length}</strong>
            </p>
          </div>
          <button type="button" className="drilldown-close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </header>

        <form className="technician-directory-add" onSubmit={handleAdd}>
          <input
            type="text"
            className="operator-directory-search"
            placeholder="Přidat jméno technika…"
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
          />
          <button type="submit" className="technician-directory-add-btn">
            Přidat do číselníku
          </button>
        </form>

        <div className="operator-directory-toolbar">
          <input
            type="search"
            className="operator-directory-search"
            placeholder="Hledat technika…"
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
            <div className="drilldown-status">Žádný technik neodpovídá hledání.</div>
          ) : (
            filtered.map((item) => {
              const active = activeSet.has(item.id)
              const editing = editingId === item.id
              return (
                <div
                  key={item.id}
                  className={`operator-directory-row${active ? '' : ' is-hidden'}`}
                >
                  <div className="operator-directory-identity">
                    <span className="operator-directory-avatar" aria-hidden="true">
                      {initials(item.name)}
                    </span>
                    <div>
                      {editing ? (
                        <form className="technician-directory-edit-form" onSubmit={saveEdit}>
                          <input
                            type="text"
                            className="technician-directory-edit-input"
                            value={editName}
                            onChange={(event) => setEditName(event.target.value)}
                            autoFocus
                          />
                          <button type="submit" className="operator-directory-action">
                            Uložit
                          </button>
                          <button
                            type="button"
                            className="operator-directory-action"
                            onClick={() => {
                              setEditingId('')
                              setEditName('')
                            }}
                          >
                            Zrušit
                          </button>
                        </form>
                      ) : (
                        <>
                          <strong>{item.name}</strong>
                          <p>{active ? 'Zobrazen v tabulce targetů' : 'Skrytý v tabulce targetů'}</p>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="operator-directory-controls">
                    {!editing ? (
                      <>
                        <button
                          type="button"
                          className="operator-directory-action"
                          onClick={() => startEdit(item)}
                        >
                          Upravit
                        </button>
                        <button
                          type="button"
                          className="operator-directory-action"
                          onClick={() => onRemove?.(item.id)}
                        >
                          Odebrat
                        </button>
                        <button
                          type="button"
                          className={`operator-directory-toggle${active ? '' : ' is-hidden'}`}
                          onClick={() => onToggleActive?.(item.id)}
                        >
                          {active ? 'Skrýt' : 'Zobrazit'}
                        </button>
                      </>
                    ) : null}
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
