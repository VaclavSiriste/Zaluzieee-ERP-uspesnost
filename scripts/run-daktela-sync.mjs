/**
 * Spustí dashboard sync Daktela → Supabase po jednotlivých tabulkách
 * a průběžně zapisuje progress do .cache/daktela-sync-status.json.
 */
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(__dirname, '..')
const POHODA = process.env.POHODA_SYNC_ROOT || path.join(ROOT, '..', 'pohoda')
const CACHE = path.join(ROOT, '.cache')
const STATUS_FILE = path.join(CACHE, 'daktela-sync-status.json')
const LOG_FILE = path.join(CACHE, 'daktela-sync.log')
const LIVE_FILE = path.join(CACHE, 'daktela-sync-live.json')

const SCRIPT_LABELS = {
  user: 'Uživatelé',
  pause: 'Typy pauz',
  'pause-sessions': 'Pauzy',
  'login-sessions': 'Přihlášení (login)',
  'ready-sessions': 'Doba přihlášení (ready)',
  call: 'Hovory',
  email: 'Maily'
}

const DASHBOARD_SCRIPTS = (
  process.env.SYNC_GHA_SCRIPTS ||
  'user,pause,pause-sessions,login-sessions,ready-sessions,call,email'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)

function ensureCache() {
  fs.mkdirSync(CACHE, { recursive: true })
}

function writeStatus(patch) {
  ensureCache()
  let prev = {}
  try {
    prev = JSON.parse(fs.readFileSync(STATUS_FILE, 'utf8'))
  } catch {
    /* ignore */
  }
  const next = {
    ...prev,
    ...patch,
    updatedAt: new Date().toISOString()
  }
  fs.writeFileSync(STATUS_FILE, JSON.stringify(next, null, 2))
  return next
}

function appendLog(line) {
  ensureCache()
  fs.appendFileSync(LOG_FILE, `${line}\n`)
}

function writeLive(obj) {
  ensureCache()
  fs.writeFileSync(
    LIVE_FILE,
    JSON.stringify({ ...obj, updatedAt: new Date().toISOString() }, null, 2)
  )
}

function parseProgressLine(line) {
  // [call] stránka 3: +200 záznamů, celkem 600 (posun 600/12000), novější než DB: 200
  const m = line.match(
    /\[([^\]]+)\]\s+stránka\s+(\d+):\s+\+(\d+)\s+záznamů,\s+celkem\s+(\d+)\s+\(posun\s+(\d+)\/(\d+|\?)/
  )
  if (!m) return null
  const offset = Number(m[5])
  const total = m[6] === '?' ? null : Number(m[6])
  return {
    entity: m[1],
    page: Number(m[2]),
    savedPage: Number(m[3]),
    savedTotal: Number(m[4]),
    offset,
    total,
    remaining: total != null ? Math.max(total - offset, 0) : null,
    percentEntity: total ? Math.min(100, Math.round((offset / total) * 100)) : null
  }
}

function runScript(scriptName, env) {
  return new Promise((resolve) => {
    const scriptPath = path.join(POHODA, 'scripts', `sync-daktela-${scriptId}.mjs`)
    if (!fs.existsSync(scriptPath)) {
      appendLog(`CHYBÍ skript ${scriptPath}`)
      resolve({ ok: false, code: 1 })
      return
    }

    const child = spawn(process.execPath, [scriptPath], {
      cwd: POHODA,
      env,
      stdio: ['ignore', 'pipe', 'pipe']
    })

    const onChunk = (buf, stream) => {
      const text = buf.toString('utf8')
      appendLog(text.replace(/\r/g, '').trimEnd())
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const parsed = parseProgressLine(trimmed)
        if (parsed) {
          writeLive({
            scriptId,
            label: SCRIPT_LABELS[scriptId] || scriptId,
            ...parsed,
            line: trimmed
          })
          writeStatus({
            state: 'running',
            currentScript: scriptId,
            currentLabel: SCRIPT_LABELS[scriptId] || scriptId,
            pageProgress: parsed,
            message: `${SCRIPT_LABELS[scriptId] || scriptId}: stránka ${parsed.page}${
              parsed.total != null
                ? ` · ${parsed.offset.toLocaleString('cs-CZ')} / ${parsed.total.toLocaleString('cs-CZ')} (zbývá ${parsed.remaining.toLocaleString('cs-CZ')})`
                : ''
            }`
          })
        } else if (trimmed.includes('✓') || trimmed.startsWith('===') || trimmed.includes('Hotovo')) {
          writeStatus({
            state: 'running',
            currentScript: scriptId,
            currentLabel: SCRIPT_LABELS[scriptId] || scriptId,
            message: trimmed.slice(0, 180)
          })
        }
        if (stream === 'stderr') {
          process.stderr.write(line + '\n')
        }
      }
    }

    child.stdout.on('data', (buf) => onChunk(buf, 'stdout'))
    child.stderr.on('data', (buf) => onChunk(buf, 'stderr'))
    child.on('close', (code) => resolve({ ok: code === 0, code: code ?? 1 }))
    child.on('error', (err) => {
      appendLog(`spawn error ${scriptId}: ${err.message}`)
      resolve({ ok: false, code: 1 })
    })
  })
}

async function main() {
  const startedAt = new Date().toISOString()
  const steps = DASHBOARD_SCRIPTS.map((id) => ({
    id,
    label: SCRIPT_LABELS[id] || id,
    state: 'pending',
    saved: 0
  }))

  writeStatus({
    state: 'running',
    mode: 'local',
    startedAt,
    finishedAt: null,
    exitCode: null,
    steps,
    currentIndex: 0,
    totalSteps: steps.length,
    percent: 0,
    currentScript: steps[0]?.id || null,
    currentLabel: steps[0]?.label || null,
    pageProgress: null,
    message: `Spouštím sync (0 / ${steps.length})…`
  })
  writeLive({ phase: 'start', startedAt })
  appendLog(`--- Sync start ${startedAt} ---`)
  appendLog(`Scripts: ${DASHBOARD_SCRIPTS.join(', ')}`)

  const env = {
    ...process.env,
    SYNC_INCREMENTAL: '1',
    SYNC_INCREMENTAL_ALWAYS: '1',
    SYNC_SKIP_VIEW: '1',
    SYNC_GHA_MAX_PAGES: process.env.SYNC_GHA_MAX_PAGES || '500',
    DAKTELA_PAGE_SIZE: process.env.DAKTELA_PAGE_SIZE || '200',
    DAKTELA_REQUEST_DELAY_MS: process.env.DAKTELA_REQUEST_DELAY_MS || '300',
    SYNC_PROGRESS_FILE: LIVE_FILE
  }

  let failed = 0
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i]
    step.state = 'running'
    writeStatus({
      state: 'running',
      steps: [...steps],
      currentIndex: i,
      totalSteps: steps.length,
      percent: Math.round((i / steps.length) * 100),
      currentScript: step.id,
      currentLabel: step.label,
      pageProgress: null,
      message: `Stahuji: ${step.label} (${i + 1} / ${steps.length})`
    })
    writeLive({
      scriptId: step.id,
      label: step.label,
      stepIndex: i,
      totalSteps: steps.length,
      phase: 'script-start'
    })
    appendLog(`=== ${step.id} (${i + 1}/${steps.length}) ===`)

    const result = await runScript(step.id, env)
    if (result.ok) {
      step.state = 'done'
    } else {
      step.state = 'error'
      failed += 1
    }

    writeStatus({
      state: 'running',
      steps: [...steps],
      currentIndex: i,
      totalSteps: steps.length,
      percent: Math.round(((i + 1) / steps.length) * 100),
      currentScript: step.id,
      currentLabel: step.label,
      message: result.ok
        ? `Hotovo: ${step.label} (${i + 1} / ${steps.length})`
        : `Chyba: ${step.label} (${i + 1} / ${steps.length})`
    })
  }

  const finishedAt = new Date().toISOString()
  const exitCode = failed ? 1 : 0
  appendLog(`--- Sync end ${finishedAt} (exit ${exitCode}, failed ${failed}) ---`)
  writeLive({ phase: 'done', exitCode, failed, finishedAt })
  writeStatus({
    state: exitCode === 0 ? 'success' : 'error',
    mode: 'local',
    startedAt,
    finishedAt,
    exitCode,
    steps,
    currentIndex: steps.length,
    totalSteps: steps.length,
    percent: 100,
    currentScript: null,
    currentLabel: null,
    pageProgress: null,
    message:
      exitCode === 0
        ? `Hotovo — všech ${steps.length} tabulek aktualizováno.`
        : `Sync skončil s ${failed} chybami z ${steps.length} tabulek.`
  })

  process.exit(exitCode)
}

main().catch((err) => {
  appendLog(`FATAL: ${err.message}`)
  writeStatus({
    state: 'error',
    finishedAt: new Date().toISOString(),
    message: err.message || 'Fatal sync error'
  })
  process.exit(1)
})
