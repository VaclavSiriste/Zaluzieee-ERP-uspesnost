import fs from 'fs'
import path from 'path'
import { spawn } from 'child_process'
import { getDaktelaPool } from '@/lib/db-esm'

const CACHE_DIR = path.join(process.cwd(), '.cache')
const STATUS_FILE = path.join(CACHE_DIR, 'daktela-sync-status.json')
const LOG_FILE = path.join(CACHE_DIR, 'daktela-sync.log')
const RUNNER_SCRIPT = path.join(process.cwd(), 'scripts', 'run-daktela-sync.mjs')

const DASHBOARD_SCRIPTS =
  process.env.SYNC_GHA_SCRIPTS || 'user,pause,pause-sessions,login-sessions,call,email'

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

function readLogTail(maxLines = 40) {
  try {
    const log = fs.readFileSync(LOG_FILE, 'utf8')
    return log.split('\n').slice(-maxLines).join('\n').trim()
  } catch {
    return ''
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
    message: 'Stahuji data z Daktely do Supabase…'
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
      email: row.latest_email ? new Date(row.latest_email).toISOString() : null
    }
  } catch {
    return null
  }
}

export async function getDaktelaSyncStatus() {
  const status = readStatusFile()
  const logTail = readLogTail()
  const dataFreshness = await fetchDataFreshness()
  const canLocal = canRunLocalSync()

  let githubRun = null
  if (status.mode === 'github' && status.github) {
    githubRun = await fetchGithubRunStatus(status.github)
    if (githubRun?.conclusion === 'success' && status.state === 'running') {
      writeStatusFile({
        state: 'success',
        finishedAt: githubRun.updatedAt || new Date().toISOString(),
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

  return {
    ...readStatusFile(),
    logTail,
    dataFreshness,
    canLocal,
    githubRun,
    dashboardScripts: DASHBOARD_SCRIPTS.split(',').map((s) => s.trim()).filter(Boolean)
  }
}
