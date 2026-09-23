import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import { createPortal } from 'react-dom'

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
 * Plovoucí tlačítko „Stáhnout“ vpravo nahoře — jen pro oprávněné e-maily.
 */
export default function GlobalDaktelaSyncButton() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)
  const [allowed, setAllowed] = useState(false)
  const [syncState, setSyncState] = useState('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncFreshness, setSyncFreshness] = useState(null)
  const [syncProgress, setSyncProgress] = useState(null)
  const [syncBusy, setSyncBusy] = useState(false)
  const [panelOpen, setPanelOpen] = useState(false)

  const isLogin = router.pathname === '/login'

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (isLogin) {
      setAllowed(false)
      return undefined
    }
    let cancelled = false
    async function loadMe() {
      try {
        const response = await fetch('/api/auth/me')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled) setAllowed(data.canTriggerDaktelaSync === true)
      } catch {
        if (!cancelled) setAllowed(false)
      }
    }
    loadMe()
    return () => {
      cancelled = true
    }
  }, [isLogin, router.pathname])

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
    if (!allowed) return undefined
    loadSyncStatus()
  }, [allowed])

  useEffect(() => {
    if (!allowed || syncState !== 'running') return undefined
    const intervalId = setInterval(() => {
      loadSyncStatus()
    }, 2000)
    return () => clearInterval(intervalId)
  }, [allowed, syncState])

  async function handleSyncData() {
    if (syncBusy) return
    if (syncState === 'running') {
      setPanelOpen(true)
      setSyncMessage('Synchronizace už běží — sledujte průběh.')
      return
    }
    setSyncBusy(true)
    setPanelOpen(true)
    setSyncMessage('Spouštím stahování…')
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
      setSyncMessage(data.message || data.status?.message || 'Stahování spuštěno.')
      setSyncProgress(data.status?.progress || data.progress || null)
      setTimeout(() => loadSyncStatus(), 800)
    } catch (err) {
      setSyncState('error')
      setSyncMessage(err.message || 'Nepodařilo se spustit stahování')
      setSyncProgress(null)
    } finally {
      setSyncBusy(false)
    }
  }

  if (!mounted || isLogin || !allowed) return null

  const running = syncState === 'running'
  const label = running
    ? `Stahuji… ${syncProgress?.percent ?? 0} %`
    : 'Stáhnout'

  const ui = (
    <div className="global-daktela-sync" aria-live="polite">
      <button
        type="button"
        className={`global-daktela-sync-btn${running ? ' is-running' : ''}`}
        onClick={handleSyncData}
        disabled={syncBusy}
        aria-busy={syncBusy || running}
        title="Stáhnout data z Daktely do DB"
      >
        {label}
      </button>

      {(panelOpen || running || syncState === 'error') && (
        <div
          className={`global-daktela-sync-panel${running ? ' is-running' : ''}${
            syncState === 'error' ? ' is-error' : ''
          }`}
        >
          <div className="global-daktela-sync-panel-top">
            <strong>
              {running
                ? syncProgress?.currentLabel
                  ? `Stahuji: ${syncProgress.currentLabel}`
                  : 'Synchronizace běží…'
                : syncState === 'error'
                  ? 'Sync se nepodařil'
                  : syncMessage || 'Stav syncu'}
            </strong>
            <button
              type="button"
              className="global-daktela-sync-close"
              onClick={() => setPanelOpen(false)}
              aria-label="Zavřít"
            >
              ×
            </button>
          </div>
          {running ? (
            <div className="pauses-sync-bar" aria-hidden="true">
              <div
                className="pauses-sync-bar-fill"
                style={{
                  width: `${Math.max(0, Math.min(100, syncProgress?.percent || 0))}%`
                }}
              />
            </div>
          ) : null}
          <p className="global-daktela-sync-meta">
            Poslední hovor v DB: {formatSyncTimestamp(syncFreshness?.call)}
          </p>
          {syncMessage ? <p className="pauses-sync-detail">{syncMessage}</p> : null}
        </div>
      )}
    </div>
  )

  return createPortal(ui, document.body)
}
