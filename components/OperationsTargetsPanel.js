import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import TargetBarInput from '@/components/TargetBarInput'
import { sortRegions } from '@/lib/czech-regions'
import {
  formatMonthLabel,
  listMonthOptions,
  parseTargetNumber,
  readMonthBucket,
  readSelectedMonthKey,
  readTargetsView,
  shiftMonthKey,
  writeMonthBucket,
  writeSelectedMonthKey,
  writeTargetsView
} from '@/lib/targets-storage'
import { sortTechnicians } from '@/lib/technician-targets'

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 2 })
}

function sumRows(rows, valuesMap) {
  let total = 0
  let hasNumeric = false
  for (const row of rows) {
    const num = parseTargetNumber(valuesMap[row.id])
    if (num != null) {
      total += num
      hasNumeric = true
    }
  }
  return hasNumeric ? total : null
}

function computeProgressPct(targetRaw, completedRaw) {
  const target = parseTargetNumber(targetRaw)
  const completed = parseTargetNumber(completedRaw)
  if (target != null && target > 0 && completed != null) {
    return Math.min(100, Math.round((completed / target) * 100))
  }
  return null
}

function BreakdownList({ title, rows, values, completed }) {
  if (!rows.length) {
    return (
      <section className="ops-targets-column">
        <h3 className="ops-targets-column-title">{title}</h3>
        <p className="ops-targets-empty">Žádné aktivní položky pro tento měsíc.</p>
      </section>
    )
  }

  return (
    <section className="ops-targets-column">
      <h3 className="ops-targets-column-title">{title}</h3>
      <div className="ops-targets-list">
        {rows.map((row) => {
          const targetValue = values[row.id] ?? ''
          const completedValue = completed[row.id] ?? ''
          const pct = computeProgressPct(targetValue, completedValue)
          return (
            <article key={row.id} className="ops-targets-row">
              <strong className="ops-targets-row-name">{row.name}</strong>
              <div className="ops-targets-row-metrics">
                <span>
                  Cíl: <b>{formatNumber(parseTargetNumber(targetValue))}</b>
                </span>
                <span>
                  Splněno: <b>{formatNumber(parseTargetNumber(completedValue))}</b>
                </span>
                {pct != null ? <span className="ops-targets-row-pct">{pct} %</span> : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

export default function OperationsTargetsPanel() {
  const [monthKey, setMonthKey] = useState('')
  const [bucket, setBucket] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState('technicians')

  const monthOptions = useMemo(() => listMonthOptions(), [])

  function reloadBucket(key = monthKey) {
    if (!key) return
    setBucket(readMonthBucket(key))
  }

  useEffect(() => {
    const month = readSelectedMonthKey()
    setMonthKey(month)
    setView(readTargetsView())
    reloadBucket(month)
  }, [])

  useEffect(() => {
    if (!monthKey) return undefined
    function onStorage(event) {
      if (event.key === 'prvni.targets.monthly.v1' || event.key === 'prvni.targets.selectedMonth') {
        reloadBucket(monthKey)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [monthKey])

  useEffect(() => {
    if (expanded) reloadBucket(monthKey)
  }, [expanded, monthKey])

  const tech = bucket?.technicians
  const regions = bucket?.regions
  const operations = bucket?.operations

  const techRows = useMemo(() => {
    if (!tech) return []
    const active = new Set(tech.activeIds)
    return sortTechnicians(tech.catalog.filter((item) => active.has(item.id)))
  }, [tech])

  const regionRows = useMemo(() => {
    if (!regions) return []
    const active = new Set(regions.activeIds)
    return sortRegions(regions.catalog.filter((item) => active.has(item.id)))
  }, [regions])

  const breakdownTarget = useMemo(() => {
    const techSum = sumRows(techRows, tech?.values || {})
    const regionSum = sumRows(regionRows, regions?.values || {})
    if (techSum == null && regionSum == null) return null
    return (techSum || 0) + (regionSum || 0)
  }, [techRows, regionRows, tech?.values, regions?.values])

  const breakdownCompleted = useMemo(() => {
    const techSum = sumRows(techRows, tech?.completed || {})
    const regionSum = sumRows(regionRows, regions?.completed || {})
    if (techSum == null && regionSum == null) return null
    return (techSum || 0) + (regionSum || 0)
  }, [techRows, regionRows, tech?.completed, regions?.completed])

  const displayTarget =
    String(operations?.target || '').trim() ||
    (breakdownTarget != null ? String(breakdownTarget) : '')
  const displayCompleted =
    String(operations?.completed || '').trim() ||
    (breakdownCompleted != null ? String(breakdownCompleted) : '')

  const summaryPct = computeProgressPct(displayTarget, displayCompleted)
  const targetFillPct = computeProgressPct(displayTarget, displayCompleted) ?? 0
  const completedFillPct = targetFillPct

  if (!bucket || !tech || !regions || !operations) return null

  function persistOperations(patch) {
    const next = {
      ...bucket,
      operations: { ...operations, ...patch }
    }
    setBucket(next)
    writeMonthBucket(monthKey, next)
  }

  function changeMonth(nextMonthKey) {
    setMonthKey(nextMonthKey)
    writeSelectedMonthKey(nextMonthKey)
    reloadBucket(nextMonthKey)
  }

  function changeView(nextView) {
    setView(nextView)
    writeTargetsView(nextView)
  }

  return (
    <section className={`sla-block sla-block-nested sla-block-targets${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">Target celkem</h2>
      <p className="sla-block-desc">
        {expanded
          ? 'Nastavte celkový cíl a splnění, níže rozpad podle krajů a techniků ze stránky Targety.'
          : 'Klikněte pro rozpad targetů — kraje a technici.'}
      </p>

      <button
        type="button"
        className={`sla-kpi-root sla-kpi-root-targets${expanded ? ' is-open' : ''}`}
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
      >
        <span className="sla-kpi-label">Target celkem · {formatMonthLabel(monthKey)}</span>
        <strong className="sla-kpi-value">
          {summaryPct != null ? `${summaryPct} %` : '—'}
        </strong>
        <span className="sla-kpi-hint">
          Splněno {formatNumber(parseTargetNumber(displayCompleted))} / cíl{' '}
          {formatNumber(parseTargetNumber(displayTarget))}
        </span>
        <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
      </button>

      {expanded ? (
        <div className="ops-targets-panel targets-page">
          <div className="ops-targets-toolbar">
            <div className="targets-view-switch" role="tablist" aria-label="Typ targetů">
              <button
                type="button"
                role="tab"
                aria-selected={view === 'technicians'}
                className={`targets-view-btn${view === 'technicians' ? ' is-active' : ''}`}
                onClick={() => changeView('technicians')}
              >
                Technici
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={view === 'regions'}
                className={`targets-view-btn${view === 'regions' ? ' is-active' : ''}`}
                onClick={() => changeView('regions')}
              >
                Kraje
              </button>
            </div>
            <div className="targets-month-switch" aria-label="Měsíc targetů">
              <button
                type="button"
                className="targets-month-nav"
                onClick={() => changeMonth(shiftMonthKey(monthKey, -1))}
                aria-label="Předchozí měsíc"
              >
                ‹
              </button>
              <select
                className="targets-month-select"
                value={monthKey}
                onChange={(event) => changeMonth(event.target.value)}
              >
                {monthOptions.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="targets-month-nav"
                onClick={() => changeMonth(shiftMonthKey(monthKey, 1))}
                aria-label="Další měsíc"
              >
                ›
              </button>
            </div>
            <Link href="/targety" className="ops-targets-edit-link">
              Upravit detailně v Targety →
            </Link>
          </div>

          <div className="ops-targets-overall">
            <label className="targets-map-editor-field">
              <span>Cíl celkem (kolik)</span>
              <TargetBarInput
                value={operations.target}
                fillPct={targetFillPct}
                badge="Cíl"
                onChange={(event) => persistOperations({ target: event.target.value })}
              />
            </label>
            <label className="targets-map-editor-field">
              <span>Splněno celkem</span>
              <TargetBarInput
                value={operations.completed}
                fillPct={completedFillPct}
                badge="Splněno"
                tone="completed"
                onChange={(event) => persistOperations({ completed: event.target.value })}
              />
            </label>
          </div>

          <div className="ops-targets-columns">
            {view === 'regions' ? (
              <BreakdownList
                title="Kraje"
                rows={regionRows}
                values={regions.values}
                completed={regions.completed}
              />
            ) : (
              <BreakdownList
                title="Technici"
                rows={techRows}
                values={tech.values}
                completed={tech.completed}
              />
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
