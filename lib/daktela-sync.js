import fs from 'fs'
import os from 'os'
import path from 'path'
import { spawn } from 'child_process'
import { getDaktelaPool } from '@/lib/db-esm'

function resolveCacheDir() {
  // Vercel / serverless: /var/task je read-only → použij /tmp
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return path.join(os.tmpdir(), 'prvni-daktela-sync')
  }
  return path.join(process.cwd(), '.cache')
}

const CACHE_DIR = resolveCacheDir()
const STATUS_FILE = path.join(CACHE_DIR, 'daktela-sync-status.json')
const LOG_FILE = path.join(CACHE_DIR, 'daktela-sync.log')
const LIVE_FILE = path.join(CACHE_DIR, 'daktela-sync-live.json')
const RUNNER_SCRIPT = path.join(process.cwd(), 'scripts', 'run-daktela-sync.mjs')

const SCRIPT_LABELS = {
  user: 'Uživatelé',
  pause: 'Typy pauz',
  'pause-sessions': 'Pauzy',
  'login-sessions': 'Přihlášení (login)',
  'ready-sessions': 'Doba přihlášení (ready)',
  call: 'Hovory',
  email: 'Maily'
}

const DASHBOARD_SCRIPTS =
  process.env.SYNC_GHA_SCRIPTS ||
  'user,pause,pause-sessions,login-sessions,ready-sessions,call,email'

function ensureCacheDir() {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true })
  } catch (err) {
    // na serverless nesmí spadnout celý sync kvůli cache
    console.warn('daktela-sync cache mkdir:', err.message)
  }
}

function readStatusFile() {
  try {
    const raw = fs.readFileSync(STATUS_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : { state: 'idle' }
  } catch {
    return { state: 'idle' }
  }
}

function writeStatusFile(patch) {
  ensureCacheDir()
  const next = {
    ...readStatusFile(),
    ...patch,
    updatedAt: new Date().toISOString()
  }
  try {
    fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2))
  } catch (err) {
    console.warn('daktela-sync status write:', err.message)
  }
  return next
}

function readLiveFile() {
  try {
    const raw = fs.readFileSync(LIVE_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function buildProgress(status, live) {
  const scripts = String(DASHBOARD_SCRIPTS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  const steps =
    Array.isArray(status.steps) && status.steps.length
      ? status.steps
      : scripts.map((id) => ({
          id,
          label: SCRIPT_LABELS[id] || id,
          state: 'pending'
        }))

  const totalSteps = Number(status.totalSteps) || steps.length || scripts.length
  const currentIndex = Number.isFinite(Number(status.currentIndex))
    ? Number(status.currentIndex)
    : steps.findIndex((s) => s.state === 'running')
  const doneSteps = steps.filter((s) => s.state === 'done').length
  const remainingSteps = Math.max(totalSteps - doneSteps - (status.state === 'running' ? 1 : 0), 0)

  const page = status.pageProgress || (live?.offset != null ? live : null)
  let percent = Number(status.percent)
  if (!Number.isFinite(percent)) {
    percent = totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0
  }
  if (status.state === 'running' && page?.percentEntity != null && totalSteps > 0) {
    const base = (Math.max(currentIndex, 0) / totalSteps) * 100
    const slice = (1 / totalSteps) * (Number(page.percentEntity) || 0)
    percent = Math.min(99, Math.round(base + slice))
  }
  if (status.state === 'success') percent = 100

  return {
    percent,
    currentIndex: Math.max(currentIndex, 0),
    totalSteps,
    doneSteps,
    remainingSteps,
    currentScript: status.currentScript || live?.scriptId || null,
    currentLabel:
      status.currentLabel ||
      live?.label ||
      SCRIPT_LABELS[status.currentScript] ||
      null,
    page: page
      ? {
          page: page.page ?? null,
          offset: page.offset ?? null,
          total: page.total ?? null,
          remaining: page.remaining ?? null,
          savedTotal: page.savedTotal ?? null,
          percentEntity: page.percentEntity ?? null
        }
      : null,
    steps
  }
}

function getPohodaRoot() {
  return process.env.POHODA_SYNC_ROOT || path.join(process.cwd(), '..', 'pohoda')
}

export function canRunLocalSync() {
  // Na Vercelu nikdy nespouštět lokální spawn (read-only FS, žádná složka pohoda)
  if (process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME) {
    return false
  }
  const pohodaRoot = getPohodaRoot()
  return (
    fs.existsSync(path.join(pohodaRoot, 'scripts', 'sync-gha-batch.mjs')) &&
    fs.existsSync(RUNNER_SCRIPT)
  )
}

function getRailwaySyncConfig() {
  const baseUrl = (process.env.DAKTELA_SYNC_RAILWAY_URL || '').replace(/\/$/, '')
  const token =
    process.env.DAKTELA_SYNC_API_TOKEN || process.env.API_TOKEN || ''
  if (!baseUrl || !token) return null
  return { baseUrl, token }
}

async function triggerRailwaySync() {
  const cfg = getRailwaySyncConfig()
  if (!cfg) {
    throw new Error('Chybí DAKTELA_SYNC_RAILWAY_URL nebo DAKTELA_SYNC_API_TOKEN')
  }

  const response = await fetch(`${cfg.baseUrl}/api/daktela-sync`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/json'
    }
  })

  const body = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(
      body.error ||
        body.message ||
        `Railway sync (${response.status}): ${JSON.stringify(body).slice(0, 300)}`
    )
  }

  const startedAt = new Date().toISOString()
  const prev = readStatusFile()
  writeStatusFile({
    state: 'running',
    mode: 'railway',
    startedAt: body.alreadyRunning && prev.startedAt ? prev.startedAt : startedAt,
    finishedAt: null,
    exitCode: null,
    percent: body.alreadyRunning ? prev.percent || 5 : 5,
    message:
      body.message ||
      'Sync spuštěn na Railway (obvykle rychlejší než GitHub Actions).',
    railway: { baseUrl: cfg.baseUrl }
  })

  return {
    started: Boolean(body.started || body.alreadyRunning),
    alreadyRunning: Boolean(body.alreadyRunning),
    mode: 'railway',
    message:
      body.message ||
      'Synchronizace běží na Railway. Sledujte průběh pod tlačítkem.'
  }
}

async function fetchRailwaySyncStatus() {
  const cfg = getRailwaySyncConfig()
  if (!cfg) return null

  try {
    const response = await fetch(`${cfg.baseUrl}/api/daktela-sync`, {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/json'
      }
    })
    if (!response.ok) return null
    return await response.json()
  } catch {
    return null
  }
}

async function triggerGithubSync() {
  const token = process.env.GITHUB_SYNC_TOKEN || process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_SYNC_REPO || 'VaclavSiriste/pohoda'
  const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'daktela-pause-sync.yml'
  const ref = process.env.GITHUB_SYNC_REF || 'main'

  if (!token) {
    throw new Error(
      'Na produkci nejde spustit lokální sync. Přidej DAKTELA_SYNC_RAILWAY_URL + DAKTELA_SYNC_API_TOKEN (Railway), nebo GITHUB_SYNC_TOKEN / spusť sync lokálně.'
    )
  }

  const [owner, repoName] = repo.split('/')
  if (!owner || !repoName) {
    throw new Error('Neplatné GITHUB_SYNC_REPO – očekávám owner/repo')
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ ref })
    }
  )

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`GitHub Actions (${response.status}): ${body.slice(0, 300)}`)
  }

  const startedAt = new Date().toISOString()
  writeStatusFile({
    state: 'running',
    mode: 'github',
    startedAt,
    finishedAt: null,
    exitCode: null,
    message: 'Sync spuštěn na GitHub Actions (obvykle 5–15 min).',
    github: { repo, workflow, ref }
  })

  return {
    started: true,
    alreadyRunning: false,
    mode: 'github',
    message: 'Synchronizace běží na GitHubu. Data se obvykle aktualizují během 5–15 minut.'
  }
}

function startLocalSync() {
  const current = readStatusFile()
  if (current.state === 'running') {
    const startedMs = current.startedAt ? Date.parse(current.startedAt) : NaN
    const ageMin = Number.isFinite(startedMs) ? (Date.now() - startedMs) / 60000 : 999
    // zaseknutý běh po >45 min uvolníme
    if (ageMin < 45) {
      return {
        started: false,
        alreadyRunning: true,
        mode: 'local',
        status: current,
        message: 'Synchronizace už běží na pozadí.'
      }
    }
  }

  ensureCacheDir()
  const startedAt = new Date().toISOString()
  const scriptList = String(DASHBOARD_SCRIPTS)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)

  writeStatusFile({
    state: 'running',
    mode: 'local',
    startedAt,
    finishedAt: null,
    exitCode: null,
    percent: 0,
    currentIndex: 0,
    totalSteps: scriptList.length,
    steps: scriptList.map((id) => ({
      id,
      label: SCRIPT_LABELS[id] || id,
      state: 'pending'
    })),
    message: 'Spouštím stahování z Daktely…'
  })

  try {
    const logFd = fs.openSync(LOG_FILE, 'a')
    fs.writeSync(logFd, `\n--- API sync trigger ${startedAt} ---\n`)
    fs.closeSync(logFd)
  } catch {
    /* ignore log on read-only FS */
  }

  try {
    const child = spawn(process.execPath, [RUNNER_SCRIPT], {
      cwd: process.cwd(),
      env: process.env,
      detached: true,
      stdio: 'ignore'
    })
    child.unref()

    return {
      started: true,
      alreadyRunning: false,
      mode: 'local',
      pid: child.pid,
      message: 'Synchronizace běží na pozadí. Sledujte průběh pod tlačítkem.'
    }
  } catch (err) {
    writeStatusFile({
      state: 'error',
      finishedAt: new Date().toISOString(),
      message: err.message || 'Nepodařilo se spustit lokální sync proces'
    })
    throw err
  }
}

export async function startDaktelaSync() {
  if (canRunLocalSync()) {
    return startLocalSync()
  }
  // Produkce: Railway (rychlé) → fallback GitHub Actions
  if (getRailwaySyncConfig()) {
    return triggerRailwaySync()
  }
  return triggerGithubSync()
}

async function fetchGithubRunStatus(githubMeta) {
  const token = process.env.GITHUB_SYNC_TOKEN || process.env.GITHUB_TOKEN
  if (!token || !githubMeta?.repo || !githubMeta?.workflow) return null

  const [owner, repoName] = githubMeta.repo.split('/')
  if (!owner || !repoName) return null

  try {
    const response = await fetch(
      `https://api.github.com/repos/${owner}/${repoName}/actions/workflows/${githubMeta.workflow}/runs?per_page=1`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28'
        }
      }
    )
    if (!response.ok) return null

    const data = await response.json()
    const run = data?.workflow_runs?.[0]
    if (!run) return null

    return {
      status: run.status,
      conclusion: run.conclusion,
      htmlUrl: run.html_url,
      updatedAt: run.updated_at,
      createdAt: run.created_at,
      runStartedAt: run.run_started_at || run.created_at,
      displayTitle: run.display_title || run.name || null
    }
  } catch {
    return null
  }
}

/** Odhad průběhu GHA podle uplynulého času (Actions neposílá % stažených stránek). */
function buildGithubEstimate(status, githubRun) {
  const estimateMinutes = Math.max(
    3,
    Number(process.env.GITHUB_SYNC_ESTIMATE_MINUTES) || 12
  )
  const estimateMs = estimateMinutes * 60 * 1000
  const phase =
    githubRun?.status === 'queued'
      ? 'queued'
      : githubRun?.status === 'in_progress'
        ? 'running'
        : status.state === 'running'
          ? 'running'
          : 'idle'

  const startedRaw =
    status.startedAt || githubRun?.runStartedAt || githubRun?.createdAt || null
  const startedMs = startedRaw ? Date.parse(startedRaw) : NaN
  const elapsedMs = Number.isFinite(startedMs)
    ? Math.max(0, Date.now() - startedMs)
    : 0

  let percent = 5
  if (phase === 'queued') {
    percent = Math.min(12, 4 + Math.round(elapsedMs / 15000))
  } else if (phase === 'running') {
    // Cap 92 % dokud Actions neřekne success — přesné % stránek GHA neumí
    percent = Math.min(92, Math.max(8, Math.round((elapsedMs / estimateMs) * 100)))
  }

  const remainingMs =
    phase === 'queued'
      ? estimateMs
      : Math.max(0, estimateMs - elapsedMs)

  const formatDur = (ms) => {
    const totalSec = Math.round(ms / 1000)
    const m = Math.floor(totalSec / 60)
    const s = totalSec % 60
    if (m <= 0) return `${s} s`
    return `${m}:${String(s).padStart(2, '0')} min`
  }

  const remainingLabel =
    remainingMs <= 30 * 1000
      ? 'do minuty'
      : remainingMs < 90 * 1000
        ? 'cca 1–2 min'
        : `cca ${Math.max(1, Math.ceil(remainingMs / 60000))} min`

  let message
  if (phase === 'queued') {
    message = `Ve frontě GitHub Actions… (uplynulo ${formatDur(elapsedMs)}, pak sync cca ${estimateMinutes} min)`
  } else {
    message = `Stahování na GitHub Actions · uplynulo ${formatDur(elapsedMs)} · zbývá ${remainingLabel} (odhad celkem ~${estimateMinutes} min)`
  }

  return {
    percent,
    phase,
    approximate: true,
    estimateMinutes,
    elapsedMs,
    elapsedLabel: formatDur(elapsedMs),
    remainingMs,
    remainingLabel,
    startedAt: startedRaw,
    message
  }
}

export async function fetchDataFreshness() {
  try {
    const pool = getDaktelaPool()
    const { rows } = await pool.query(`
      SELECT
        (SELECT MAX(call_time) FROM call) AS latest_call,
        (SELECT MAX(start_time) FROM pause_sessions) AS latest_pause_session,
        (SELECT MAX(start_time) FROM login_sessions) AS latest_login_session,
        (SELECT MAX(start_time) FROM ready_sessions) AS latest_ready_session,
        (SELECT MAX(time) FROM email) AS latest_email
    `)
    const row = rows[0] || {}
    return {
      call: row.latest_call ? new Date(row.latest_call).toISOString() : null,
      pause_sessions: row.latest_pause_session
        ? new Date(row.latest_pause_session).toISOString()
        : null,
      login_sessions: row.latest_login_session
        ? new Date(row.latest_login_session).toISOString()
        : null,
      ready_sessions: row.latest_ready_session
        ? new Date(row.latest_ready_session).toISOString()
        : null,
      email: row.latest_email ? new Date(row.latest_email).toISOString() : null
    }
  } catch {
    return null
  }
}

export async function getDaktelaSyncStatus() {
  let status = readStatusFile()
  let live = readLiveFile()
  const logTail = (() => {
    try {
      const log = fs.readFileSync(LOG_FILE, 'utf8')
      return log.split('\n').slice(-40).join('\n').trim()
    } catch {
      return ''
    }
  })()
  let dataFreshness = await fetchDataFreshness()
  const canLocal = canRunLocalSync()
  const railwayCfg = getRailwaySyncConfig()

  let githubRun = null
  let railwayRemote = null

  // Prefer Railway stav (živý progress), když je nakonfigurovaný a nejde o lokální/GHA běh
  if (
    railwayCfg &&
    status.mode !== 'local' &&
    status.mode !== 'github' &&
    (status.mode === 'railway' || !canLocal || process.env.VERCEL)
  ) {
    railwayRemote = await fetchRailwaySyncStatus()
    if (railwayRemote) {
      status = {
        ...status,
        state: railwayRemote.state || status.state,
        mode: 'railway',
        startedAt: railwayRemote.startedAt || status.startedAt,
        finishedAt: railwayRemote.finishedAt || status.finishedAt,
        percent: railwayRemote.progress?.percent ?? railwayRemote.percent ?? status.percent,
        currentIndex: railwayRemote.progress?.currentIndex ?? railwayRemote.currentIndex,
        totalSteps: railwayRemote.progress?.totalSteps ?? railwayRemote.totalSteps,
        currentScript: railwayRemote.progress?.currentScript || railwayRemote.currentScript,
        currentLabel: railwayRemote.progress?.currentLabel || railwayRemote.currentLabel,
        pageProgress: railwayRemote.progress?.page || railwayRemote.pageProgress,
        steps: railwayRemote.progress?.steps || railwayRemote.steps || status.steps,
        message:
          railwayRemote.message ||
          (railwayRemote.state === 'running'
            ? 'Sync běží na Railway…'
            : status.message),
        railway: { baseUrl: railwayCfg.baseUrl }
      }
      if (railwayRemote.live) live = railwayRemote.live
      if (railwayRemote.dataFreshness) dataFreshness = railwayRemote.dataFreshness
      // cache na Vercelu /tmp – best effort
      if (railwayRemote.state === 'success' || railwayRemote.state === 'error') {
        writeStatusFile(status)
      }
    }
  }

  const githubMeta = status.github || {
    repo: process.env.GITHUB_SYNC_REPO || 'VaclavSiriste/pohoda',
    workflow: process.env.GITHUB_SYNC_WORKFLOW || 'daktela-pause-sync.yml',
    ref: process.env.GITHUB_SYNC_REF || 'main'
  }

  // Fallback: GitHub Actions, jen když Railway není aktivní
  if (
    !railwayRemote &&
    (status.mode === 'github' ||
      (!railwayCfg && (process.env.VERCEL || process.env.GITHUB_SYNC_TOKEN)))
  ) {
    githubRun = await fetchGithubRunStatus(githubMeta)
    if (githubRun) {
      const runUpdated = githubRun.updatedAt ? Date.parse(githubRun.updatedAt) : 0
      const recent = Date.now() - runUpdated < 30 * 60 * 1000
      if (githubRun.status === 'in_progress' || githubRun.status === 'queued') {
        const estimate = buildGithubEstimate(
          {
            ...status,
            startedAt: status.startedAt || githubRun.runStartedAt || githubRun.createdAt
          },
          githubRun
        )
        status = {
          ...status,
          state: 'running',
          mode: 'github',
          startedAt: estimate.startedAt || status.startedAt,
          message: estimate.message,
          github: githubMeta,
          percent: estimate.percent,
          githubEstimate: estimate,
          currentLabel:
            githubRun.status === 'queued'
              ? 'Fronta Actions'
              : 'Stahování (Actions)'
        }
      } else if (githubRun.conclusion === 'success' && recent && status.state === 'running') {
        status = {
          ...status,
          state: 'success',
          mode: 'github',
          finishedAt: githubRun.updatedAt,
          percent: 100,
          message: 'GitHub sync dokončen.',
          github: githubMeta
        }
        writeStatusFile(status)
      } else if (githubRun.conclusion === 'failure' && recent && status.state === 'running') {
        status = {
          ...status,
          state: 'error',
          mode: 'github',
          finishedAt: githubRun.updatedAt,
          message: 'GitHub sync skončil chybou.',
          github: githubMeta
        }
        writeStatusFile(status)
      }
    }
  }

  const progress = railwayRemote?.progress || buildProgress(status, live)
  if (status.githubEstimate && status.mode === 'github' && status.state === 'running') {
    progress.percent = status.githubEstimate.percent
    progress.approximate = true
    progress.phase = status.githubEstimate.phase
    progress.elapsedLabel = status.githubEstimate.elapsedLabel
    progress.remainingLabel = status.githubEstimate.remainingLabel
    progress.estimateMinutes = status.githubEstimate.estimateMinutes
    progress.currentLabel = status.currentLabel || progress.currentLabel
  }

  return {
    ...status,
    progress,
    live,
    logTail,
    dataFreshness,
    canLocal,
    githubRun,
    railwayConfigured: Boolean(railwayCfg),
    dashboardScripts: DASHBOARD_SCRIPTS.split(',').map((s) => s.trim()).filter(Boolean)
  }
}
