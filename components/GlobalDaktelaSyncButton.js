import { useEffect, useRef, useState } from 'react'
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

function formatProgressLabel(progress) {
  if (!progress) return null
  const pct = Math.max(0, Math.min(100, Number(progress.percent) || 0))
  if (progress.approximate) return `≈ ${pct} %`
  return `${pct} %`
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
  const wasRunningRef = useRef(false)

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

      const nextState = data.state || 'idle'
      if (wasRunningRef.current && nextState === 'success') {
        setPanelOpen(true)
        setSyncMessage(data.message || 'Stahování dokončeno.')
      } else if (wasRunningRef.current && nextState === 'error') {
        setPanelOpen(true)
        setSyncMessage(data.message || 'Sync se nepodařil.')
      } else if (data.message) {
        setSyncMessage(data.message)
      }

      wasRunningRef.current = nextState === 'running'
      setSyncState(nextState)
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

  // Po úspěchu nechat „Hotovo“ vidět ~12 s, pak klidový stav
  useEffect(() => {
    if (syncState !== 'success') return undefined
    const timeoutId = setTimeout(() => {
      setSyncState('idle')
    }, 12000)
    return () => clearTimeout(timeoutId)
  }, [syncState])

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
    wasRunningRef.current = true
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
      wasRunningRef.current = false
      setSyncState('error')
      setSyncMessage(err.message || 'Nepodařilo se spustit stahování')
      setSyncProgress(null)
    } finally {
      setSyncBusy(false)
    }
  }

  if (!mounted || isLogin || !allowed) return null

  const running = syncState === 'running'
  const success = syncState === 'success'
  const errored = syncState === 'error'

  let label = 'Stáhnout'
  if (running) {
    const pctLabel = formatProgressLabel(syncProgress)
    label = pctLabel ? `Stahuji… ${pctLabel}` : 'Stahuji…'
  } else if (success) label = 'Hotovo ✓'
  else if (errored) label = 'Chyba'

  const showPanel = panelOpen || running || success || errored
  const progressPct = Math.max(0, Math.min(100, Number(syncProgress?.percent) || 0))

  const ui = (
    <div className="global-daktela-sync" aria-live="polite">
      <button
        type="button"
        className={`global-daktela-sync-btn${running ? ' is-running' : ''}${
          success ? ' is-success' : ''
        }${errored ? ' is-error' : ''}`}
        onClick={handleSyncData}
        disabled={syncBusy || running}
        aria-busy={syncBusy || running}
        title="Stáhnout data z Daktely do DB"
      >
        {label}
      </button>

      {showPanel ? (
        <div
          className={`global-daktela-sync-panel${running ? ' is-running' : ''}${
            success ? ' is-success' : ''
          }${errored ? ' is-error' : ''}`}
        >
          <div className="global-daktela-sync-panel-top">
            <strong>
              {running
                ? syncProgress?.currentLabel
                  ? `Stahuji: ${syncProgress.currentLabel}`
                  : 'Synchronizace běží…'
                : success
                  ? 'Stahování dokončeno'
                  : errored
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
                style={{ width: `${progressPct}%` }}
              />
            </div>
          ) : null}
          {running && syncProgress ? (
            <div className="global-daktela-sync-stats">
              <span>
                {syncProgress.approximate ? 'Odhad ' : ''}
                {formatProgressLabel(syncProgress) || `${progressPct} %`}
              </span>
              {syncProgress.elapsedLabel ? (
                <span>Uplynulo {syncProgress.elapsedLabel}</span>
              ) : null}
              {syncProgress.remainingLabel ? (
                <span>Zbývá {syncProgress.remainingLabel}</span>
              ) : syncProgress.page?.remaining != null ? (
                <span>
                  Zbývá ~{Number(syncProgress.page.remaining).toLocaleString('cs-CZ')}{' '}
                  záznamů
                </span>
              ) : null}
              {syncProgress.doneSteps != null && syncProgress.totalSteps ? (
                <span>
                  Kroky {syncProgress.doneSteps}/{syncProgress.totalSteps}
                </span>
              ) : null}
            </div>
          ) : null}
          {running && syncProgress?.approximate ? (
            <p className="global-daktela-sync-hint">
              GitHub Actions neposílá přesné % stažených stránek — ukazatel je odhad
              podle času (typicky ~{syncProgress.estimateMinutes || 12} min).
            </p>
          ) : null}
          {running &&
          syncProgress?.page &&
          !syncProgress.approximate &&
          syncProgress.page.total != null ? (
            <p className="global-daktela-sync-hint">
              {syncProgress.currentLabel || 'Tabulka'}:{' '}
              {Number(syncProgress.page.offset || 0).toLocaleString('cs-CZ')} /{' '}
              {Number(syncProgress.page.total).toLocaleString('cs-CZ')}
              {syncProgress.page.percentEntity != null
                ? ` (${syncProgress.page.percentEntity} % této tabulky)`
                : ''}
            </p>
          ) : null}
          {success ? (
            <p className="global-daktela-sync-success-text">
              Data z Daktely jsou v DB. Obnov stránku / filtr, ať se přepočítá SLA.
            </p>
          ) : null}
          <p className="global-daktela-sync-meta">
            Poslední hovor v DB: {formatSyncTimestamp(syncFreshness?.call)}
          </p>
          {syncMessage && !success ? (
            <p className="pauses-sync-detail">{syncMessage}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  )

  return createPortal(ui, document.body)
}
