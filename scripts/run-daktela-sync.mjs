/**
 * Spustí pohoda db:cloud:sync-gha na pozadí a zapisuje stav do .cache/
 * Volá se z API /api/daktela-sync (detached).
 */
import { spawnSync } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const POHODA = process.env.POHODA_SYNC_ROOT || path.join(ROOT, '..', 'pohoda')
const CACHE = path.join(ROOT, '.cache')
const STATUS_FILE = path.join(CACHE, 'daktela-sync-status.json')
const LOG_FILE = path.join(CACHE, 'daktela-sync.log')

const DASHBOARD_SCRIPTS =
  process.env.SYNC_GHA_SCRIPTS || 'user,pause,pause-sessions,login-sessions,call,email'

function writeStatus(obj) {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.writeFileSync(
    STATUS_FILE,
    JSON.stringify({ ...obj, updatedAt: new Date().toISOString() }, null, 2)
  )
}

function appendLog(line) {
  fs.mkdirSync(CACHE, { recursive: true })
  fs.appendFileSync(LOG_FILE, `${line}\n`)
}

const startedAt = new Date().toISOString()
writeStatus({ state: 'running', mode: 'local', startedAt })
appendLog(`--- Sync start ${startedAt} ---`)

const env = {
  ...process.env,
  SYNC_GHA_SCRIPTS: DASHBOARD_SCRIPTS,
  SYNC_SKIP_VIEW: '1',
  SYNC_GHA_MAX_PAGES: process.env.SYNC_GHA_MAX_PAGES || '500',
  DAKTELA_PAGE_SIZE: process.env.DAKTELA_PAGE_SIZE || '200',
  DAKTELA_REQUEST_DELAY_MS: process.env.DAKTELA_REQUEST_DELAY_MS || '300'
}

const result = spawnSync('npm', ['run', 'db:cloud:sync-gha'], {
  cwd: POHODA,
  env,
  stdio: 'pipe',
  encoding: 'utf8'
})

if (result.stdout) appendLog(result.stdout.trim())
if (result.stderr) appendLog(result.stderr.trim())

const exitCode = result.status ?? 1
const finishedAt = new Date().toISOString()
appendLog(`--- Sync end ${finishedAt} (exit ${exitCode}) ---`)

writeStatus({
  state: exitCode === 0 ? 'success' : 'error',
  mode: 'local',
  startedAt,
  finishedAt,
  exitCode,
  message:
    exitCode === 0
      ? 'Data z Daktely byla úspěšně aktualizována v Supabase.'
      : 'Synchronizace skončila s chybou – viz log.'
})

process.exit(exitCode)
