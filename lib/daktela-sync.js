import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { getDaktelaPool } from '@/lib/db-esm'

const CACHE_DIR = path.join(process.cwd(), '.cache')
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
  fs.mkdirSync(CACHE_DIR, { recursive: true })
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
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2))
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
  const pohodaRoot = getPohodaRoot()
  return (
    fs.existsSync(path.join(pohodaRoot, 'scripts', 'sync-gha-batch.mjs')) &&
    fs.existsSync(RUNNER_SCRIPT)
  )
}

async function triggerGithubSync() {
  const token = process.env.GITHUB_SYNC_TOKEN || process.env.GITHUB_TOKEN
  const repo = process.env.GITHUB_SYNC_REPO || 'VaclavSiriste/pohoda'
  const workflow = process.env.GITHUB_SYNC_WORKFLOW || 'daktela-pause-sync.yml'
  const ref = process.env.GITHUB_SYNC_REF || 'main'

  if (!token) {
    throw new Error(
      'Sync nelze spustit: chybí GITHUB_SYNC_TOKEN (nebo lokální složka pohoda se skriptem sync).'
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
    return {
      started: false,
      alreadyRunning: true,
      mode: 'local',
      status: current,
      message: 'Synchronizace už běží na pozadí.'
    }
  }

  ensureCacheDir()
  const startedAt = new Date().toISOString()
  writeStatusFile({
    state: 'running',
    mode: 'local',
    startedAt,
    finishedAt: null,
    exitCode: null,
    percent: 0,
    currentIndex: 0,
    totalSteps: DASHBOARD_SCRIPTS.split(',').filter(Boolean).length,
    steps: DASHBOARD_SCRIPTS.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .map((id) => ({
        id,
        label: SCRIPT_LABELS[id] || id,
        state: 'pending'
      })),
    message: 'Spouštím stahování z Daktely…'
  })

  const logFd = fs.openSync(LOG_FILE, 'a')
  fs.writeSync(logFd, `\n--- API sync trigger ${startedAt} ---\n`)
  fs.closeSync(logFd)

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
    message: 'Synchronizace běží na pozadí (cca 5–15 min). Stránku můžete nechat otevřenou.'
  }
}

export async function startDaktelaSync() {
  if (canRunLocalSync()) {
    return startLocalSync()
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
      updatedAt: run.updated_at
    }
  } catch {
    return null
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
  const status = readStatusFile()
  const live = readLiveFile()
  const logTail = (() => {
    try {
      const log = fs.readFileSync(LOG_FILE, 'utf8')
      return log.split('\n').slice(-40).join('\n').trim()
    } catch {
      return ''
    }
  })()
  const dataFreshness = await fetchDataFreshness()
  const canLocal = canRunLocalSync()

  let githubRun = null
  if (status.mode === 'github' && status.github) {
    githubRun = await fetchGithubRunStatus(status.github)
    if (githubRun?.conclusion === 'success' && status.state === 'running') {
      writeStatusFile({
        state: 'success',
        finishedAt: githubRun.updatedAt || new Date().toISOString(),
        percent: 100,
        message: 'GitHub sync dokončen.'
      })
      status.state = 'success'
    } else if (githubRun?.conclusion === 'failure' && status.state === 'running') {
      writeStatusFile({
        state: 'error',
        finishedAt: githubRun.updatedAt || new Date().toISOString(),
        message: 'GitHub sync skončil chybou.'
      })
      status.state = 'error'
    }
  }

  const latest = readStatusFile()
  return {
    ...latest,
    progress: buildProgress(latest, live),
    live,
    logTail,
    dataFreshness,
    canLocal,
    githubRun,
    dashboardScripts: DASHBOARD_SCRIPTS.split(',').map((s) => s.trim()).filter(Boolean)
  }
}
