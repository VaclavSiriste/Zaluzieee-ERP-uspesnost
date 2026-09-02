import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'

function formatNumber(value, digits = 2) {
  const n = Number(value) || 0
  return n.toLocaleString('cs-CZ', {
    minimumFractionDigits: 0,
    maximumFractionDigits: digits
  })
}

function formatDate(value) {
  if (!value) return '—'
  let date = value instanceof Date ? value : null
  if (!date) {
    const text = String(value).slice(0, 10)
    if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      const [year, month, day] = text.split('-').map(Number)
      date = new Date(year, month - 1, day)
    } else {
      const parsed = new Date(value)
      if (!Number.isNaN(parsed.getTime())) date = parsed
    }
  }
  if (!date || Number.isNaN(date.getTime())) return String(value)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const year = date.getFullYear()
  return `${day}.${month}.${year}`
}

function buildQueryParams(drilldown, filters) {
  return new URLSearchParams({
    operatorId: drilldown.operator || '',
    operatorName: drilldown.operatorName || '',
    period: filters.period,
    ...(filters.startDate ? { startDate: filters.startDate } : {}),
    ...(filters.endDate ? { endDate: filters.endDate } : {})
  })
}

function rowKeyForItem(item) {
  return item.entry_kind === 'manual'
    ? `manual-${item.entry_id}`
    : `erp-${item.erp_order_id}-${item.error_type}`
}

function ErrorCard({
  item,
  noteDraft,
  onNoteChange,
  isSaving,
  onToggleExclude,
  onSaveNote,
  onSaveManual,
  onDeleteManual
}) {
  const reason = item.auto_reason || item.error_type
  const isManual = item.entry_kind === 'manual'
  const isExcluded = !item.active

  return (
    <article
      className={[
        'operator-error-card',
        isManual ? 'is-manual' : 'is-erp',
        isExcluded ? 'is-excluded' : ''
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="operator-error-card-top">
        <time className="operator-error-date">{formatDate(item.error_date)}</time>
        <div className="operator-error-badges">
          {isManual ? <span className="operator-error-pill operator-error-pill-manual">Ruční</span> : null}
          {isExcluded ? (
            <span className="operator-error-pill operator-error-pill-muted">Mimo počet</span>
          ) : (
            <span className="operator-error-pill operator-error-pill-active">Započteno</span>
          )}
        </div>
      </div>

      <h4 className="operator-error-reason">{reason}</h4>

      <div className="operator-error-meta">
        <div>
          <span className="operator-error-meta-label">Zákazník</span>
          {item.detail_url ? (
            <a
              className="drilldown-detail-link"
              href={item.detail_url}
              target="_blank"
              rel="noreferrer"
            >
              {item.customer_name}
            </a>
          ) : (
            <strong>{item.customer_name}</strong>
          )}
        </div>
        {item.region && item.region !== '—' ? (
          <div>
            <span className="operator-error-meta-label">Region</span>
            <span>{item.region}</span>
          </div>
        ) : null}
        {item.erp_order_id ? (
          <div>
            <span className="operator-error-meta-label">Zakázka</span>
            <span>#{item.erp_order_id}</span>
          </div>
        ) : null}
      </div>

      <label className="operator-error-note-field">
        <span>Poznámka z naší strany</span>
        <textarea
          rows={2}
          value={noteDraft}
          placeholder="Doplňte důvod nebo kontext chyby…"
          onChange={(event) => onNoteChange(event.target.value)}
        />
      </label>

      <div className="operator-error-card-actions">
        {!isManual ? (
          <>
            <button
              type="button"
              className={`operator-error-action ${isExcluded ? 'is-primary' : 'is-outline'}`}
              disabled={isSaving}
              onClick={onToggleExclude}
            >
              {isExcluded ? 'Vrátit do počtu' : 'Odebrat z počtu'}
            </button>
            <button
              type="button"
              className="operator-error-action is-primary"
              disabled={isSaving}
              onClick={onSaveNote}
            >
              {isSaving ? 'Ukládám…' : 'Uložit poznámku'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="operator-error-action is-primary"
              disabled={isSaving}
              onClick={onSaveManual}
            >
              {isSaving ? 'Ukládám…' : 'Uložit'}
            </button>
            <button
              type="button"
              className="operator-error-action is-danger"
              disabled={isSaving}
              onClick={onDeleteManual}
            >
              Smazat
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export default function OperatorErrorsDrilldown({ open, onClose, drilldown, filters, onChanged }) {
  const [mounted, setMounted] = useState(false)
  const [loading, setLoading] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [error, setError] = useState('')
  const [data, setData] = useState(null)
  const [noteDrafts, setNoteDrafts] = useState({})
  const [manualForm, setManualForm] = useState({ errorDate: '', reason: '', note: '' })
  const [addingManual, setAddingManual] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  async function loadData() {
    if (!drilldown?.operator) return
    setLoading(true)
    setError('')
    try {
      const params = buildQueryParams(drilldown, filters)
      const response = await fetch(`/api/operator-errors?${params}`)
      const payload = await response.json()
      if (!response.ok || payload.error) {
        throw new Error(payload.error || `HTTP ${response.status}`)
      }
      setData(payload)
      const drafts = {}
      for (const item of payload.items || []) {
        drafts[rowKeyForItem(item)] = item.note || ''
      }
      setNoteDrafts(drafts)
    } catch (err) {
      setError(err.message || 'Nepodařilo se načíst chyby')
      setData(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!open || !drilldown) return
    setData(null)
    setError('')
    setManualForm({ errorDate: filters.endDate || '', reason: '', note: '' })
    loadData()
  }, [open, drilldown, filters])

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

  async function refreshAfterChange() {
    await loadData()
    onChanged?.()
  }

  async function saveErpItem(item, patch = {}) {
    const key = rowKeyForItem(item)
    setSavingId(key)
    setError('')
    try {
      const response = await fetch('/api/operator-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'erp',
          operatorId: drilldown.operator,
          operatorName: drilldown.operatorName,
          erpOrderId: item.erp_order_id,
          erpErrorType: item.error_type,
          errorDate: item.error_date,
          autoReason: item.auto_reason,
          note: patch.note ?? noteDrafts[key] ?? item.note,
          excluded: patch.excluded ?? item.excluded
        })
      })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
      await refreshAfterChange()
    } catch (err) {
      setError(err.message || 'Uložení selhalo')
    } finally {
      setSavingId(null)
    }
  }

  async function saveManualItem(item) {
    const key = rowKeyForItem(item)
    setSavingId(key)
    setError('')
    try {
      const response = await fetch('/api/operator-errors', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual',
          id: item.entry_id,
          note: noteDrafts[key] ?? item.note,
          reason: item.auto_reason || item.error_type
        })
      })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
      await refreshAfterChange()
    } catch (err) {
      setError(err.message || 'Uložení selhalo')
    } finally {
      setSavingId(null)
    }
  }

  async function deleteManualItem(item) {
    if (!window.confirm('Odebrat ruční záznam z počtu chyb?')) return
    const key = rowKeyForItem(item)
    setSavingId(key)
    setError('')
    try {
      const response = await fetch(`/api/operator-errors?id=${item.entry_id}`, { method: 'DELETE' })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
      await refreshAfterChange()
    } catch (err) {
      setError(err.message || 'Smazání selhalo')
    } finally {
      setSavingId(null)
    }
  }

  async function addManualEntry(event) {
    event.preventDefault()
    setAddingManual(true)
    setError('')
    try {
      const response = await fetch('/api/operator-errors', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'manual',
          operatorId: drilldown.operator,
          operatorName: drilldown.operatorName,
          errorDate: manualForm.errorDate,
          reason: manualForm.reason,
          note: manualForm.note || manualForm.reason
        })
      })
      const payload = await response.json()
      if (!response.ok || payload.error) throw new Error(payload.error || `HTTP ${response.status}`)
      setManualForm({ errorDate: filters.endDate || '', reason: '', note: '' })
      await refreshAfterChange()
    } catch (err) {
      setError(err.message || 'Přidání selhalo')
    } finally {
      setAddingManual(false)
    }
  }

  if (!mounted || !open || !drilldown) return null

  const title = drilldown.title || 'Počet chyb'
  const activeCount = data?.count ?? 0
  const avgPerDay = data?.avg_per_day ?? 0
  const items = data?.items || []

  const panel = (
    <div className="drilldown-overlay" onClick={onClose} role="presentation">
      <div
        className="drilldown-panel operator-errors-panel"
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="operator-errors-title"
      >
        <header className="drilldown-header operator-errors-header">
          <div>
            <p className="operator-errors-kicker">Počet chyb · ERP + ruční úpravy</p>
            <h2 id="operator-errors-title">{title}</h2>
            {drilldown.subtitle ? <p className="drilldown-subtitle">{drilldown.subtitle}</p> : null}
          </div>
          <button type="button" className="drilldown-close" onClick={onClose} aria-label="Zavřít">
            ×
          </button>
        </header>

        {data ? (
          <div className="operator-errors-stats">
            <div className="operator-errors-stat drilldown-chip-danger">
              <span className="operator-errors-stat-value">{formatNumber(activeCount, 0)}</span>
              <span className="operator-errors-stat-label">Počet chyb</span>
            </div>
            <div className="operator-errors-stat drilldown-chip-neutral">
              <span className="operator-errors-stat-value">{formatNumber(avgPerDay, 2)}</span>
              <span className="operator-errors-stat-label">Průměr / den</span>
            </div>
            <div className="operator-errors-stat drilldown-chip-neutral">
              <span className="operator-errors-stat-value">{formatNumber(data.period_days, 0)}</span>
              <span className="operator-errors-stat-label">Dní v období</span>
            </div>
            {data.manual_count ? (
              <div className="operator-errors-stat drilldown-chip-waiting">
                <span className="operator-errors-stat-value">{formatNumber(data.manual_count, 0)}</span>
                <span className="operator-errors-stat-label">Ruční záznamy</span>
              </div>
            ) : null}
            {data.excluded_count ? (
              <div className="operator-errors-stat drilldown-chip-neutral">
                <span className="operator-errors-stat-value">{formatNumber(data.excluded_count, 0)}</span>
                <span className="operator-errors-stat-label">Odebráno</span>
              </div>
            ) : null}
          </div>
        ) : null}

        {loading && !data ? (
          <div className="drilldown-status drilldown-loading">
            <div className="drilldown-spinner" />
            Načítání chyb...
          </div>
        ) : null}
        {error ? <div className="drilldown-status danger">{error}</div> : null}

        <div className="operator-errors-scroll">
          {items.length ? (
            <div className="operator-errors-list">
              {items.map((item) => {
                const rowKey = rowKeyForItem(item)
                return (
                  <ErrorCard
                    key={rowKey}
                    item={item}
                    noteDraft={noteDrafts[rowKey] ?? item.note ?? ''}
                    isSaving={savingId === rowKey}
                    onNoteChange={(value) =>
                      setNoteDrafts((current) => ({ ...current, [rowKey]: value }))
                    }
                    onToggleExclude={() =>
                      saveErpItem(item, {
                        excluded: !item.excluded,
                        note: noteDrafts[rowKey] ?? item.note
                      })
                    }
                    onSaveNote={() => saveErpItem(item, { note: noteDrafts[rowKey] ?? item.note })}
                    onSaveManual={() => saveManualItem(item)}
                    onDeleteManual={() => deleteManualItem(item)}
                  />
                )
              })}
            </div>
          ) : (
            !loading && (
              <div className="operator-errors-empty">
                <strong>Žádné chyby v zvoleném období</strong>
                <p>Můžete přidat ruční záznam dole ve formuláři.</p>
              </div>
            )
          )}
        </div>

        <footer className="operator-errors-footer">
          <form className="operator-errors-add-form" onSubmit={addManualEntry}>
            <div className="operator-errors-add-head">
              <div>
                <h3>Přidat ruční chybu</h3>
                <p>Uloží se do databáze a započte se do počtu i průměru.</p>
              </div>
              <button type="submit" className="operator-error-action is-primary" disabled={addingManual}>
                {addingManual ? 'Ukládám…' : '+ Přidat do počtu'}
              </button>
            </div>
            <div className="operator-errors-add-grid">
              <label>
                <span>Datum</span>
                <input
                  type="date"
                  required
                  value={manualForm.errorDate}
                  onChange={(event) =>
                    setManualForm((current) => ({ ...current, errorDate: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Popis chyby</span>
                <input
                  type="text"
                  required
                  placeholder="Proč je chyba v počtu"
                  value={manualForm.reason}
                  onChange={(event) =>
                    setManualForm((current) => ({ ...current, reason: event.target.value }))
                  }
                />
              </label>
              <label>
                <span>Poznámka (volitelně)</span>
                <input
                  type="text"
                  placeholder="Doplňující text"
                  value={manualForm.note}
                  onChange={(event) =>
                    setManualForm((current) => ({ ...current, note: event.target.value }))
                  }
                />
              </label>
            </div>
          </form>
        </footer>
      </div>
    </div>
  )

  return createPortal(panel, document.body)
}
