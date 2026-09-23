import { useEffect, useState } from 'react'

function formatSyncTimestamp(value) {
  if (!value) return '—'
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('cs-CZ', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/**
 * Spustí stahování Daktela → Supabase a po dokončení zavolá onSynced (reload metrik).
 */
export default function DaktelaSyncControls({ onSynced, compact = false }) {
  const [syncState, setSyncState] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncFreshness, setSyncFreshness] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)

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
      if (data?.state === 'success' && typeof onSynced === 'function') {
        onSynced()
      }
    }, 2000)
    return () => clearInterval(intervalId)
  }, [syncState, onSynced])

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
      setTimeout(() => loadSyncStatus(), 800)
    } catch (err) {
      setSyncState('error')
      setSyncMessage(err.message || 'Nepodařilo se spustit synchronizaci')
      setSyncProgress(null)
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div className={`sla-daktela-sync${compact ? ' is-compact' : ''}`}>
      <div className="sla-daktela-sync-actions">
        <button
          type="button"
          className="pauses-sync-btn"
          onClick={handleSyncData}
          disabled={syncBusy || syncState === 'running'}
          aria-busy={syncBusy || syncState === 'running'}
          title="Stáhne hovory z Daktely do DB (SLA příchozích linek)"
        >
          {syncState === 'running'
            ? `Aktualizuji… ${syncProgress?.percent ?? 0} %`
            : 'Aktualizovat data z Daktely'}
        </button>
        <span className="pauses-sync-meta">
          Poslední hovor v DB: {formatSyncTimestamp(syncFreshness?.call)}
        </span>
      </div>

      {(syncState === 'running' || syncState === 'error' || (syncState === 'success' && syncProgress)) && (
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
          {syncMessage ? <p className="pauses-sync-detail">{syncMessage}</p> : null}
        </div>
      )}
    </div>
  )
}
