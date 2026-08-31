import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { normalizeRegionName, sortRegions } from '@/lib/czech-regions'

export default function RegionDirectory({
  open,
  onClose,
  monthLabel,
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
    const list = sortRegions(catalog)
    if (!q) return list
    return list.filter((item) => item.name.toLowerCase().includes(q))
  }, [catalog, query])

  function handleAdd(event) {
    event.preventDefault()
    const name = normalizeRegionName(newName)
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
    const name = normalizeRegionName(editName)
    if (!name || !editingId) return
    onRename?.(editingId, name)
    setEditingId('')
    setEditName('')
  }

  if (!mounted || !open) return null

  return createPortal(
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel operator-directory-panel technician-directory-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="region-directory-title"
      >
        <header className="drilldown-header">
          <div>
            <h2 id="region-directory-title">Číselník krajů</h2>
            <p className="drilldown-subtitle">
              Úpravy platí pro měsíc <strong>{monthLabel}</strong>. Každý měsíc může mít jiný seznam
              krajů.
            </p>
            <p className="drilldown-meta">
              V tabulce: <strong>{activeIds.length}</strong> · Celkem: <strong>{catalog.length}</strong>
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
            placeholder="Přidat kraj…"
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
            placeholder="Hledat kraj…"
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
            <div className="drilldown-status">Žádný kraj neodpovídá hledání.</div>
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
                          <p>{active ? 'Zobrazen v mapě a tabulce' : 'Skrytý'}</p>
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
    </div>,
    document.body
  )
}
