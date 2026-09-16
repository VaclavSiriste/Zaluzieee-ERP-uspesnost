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
  writeTargetsBrandId,
  writeTargetsView
} from '@/lib/targets-storage'
import { syncTargetsCompletedFromErp, syncTargetsCompletedFromOvtSheet } from '@/lib/sync-targets-completed'
import { sortTechnicians, technicianId } from '@/lib/technician-targets'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

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

function summarizeBucket(bucket) {
  if (!bucket?.technicians || !bucket?.regions || !bucket?.operations) {
    return { target: null, completed: null, pct: null }
  }
  const tech = bucket.technicians
  const regions = bucket.regions
  const activeTech = new Set(tech.activeIds || [])
  const activeRegions = new Set(regions.activeIds || [])
  const techRows = (tech.catalog || []).filter((item) => activeTech.has(item.id))
  const regionRows = (regions.catalog || []).filter((item) => activeRegions.has(item.id))
  const techSum = sumRows(techRows, tech.values || {})
  const regionSum = sumRows(regionRows, regions.values || {})
  const breakdown =
    techSum == null && regionSum == null ? null : (techSum || 0) + (regionSum || 0)
  const targetRaw =
    String(bucket.operations.target || '').trim() ||
    (breakdown != null ? String(breakdown) : '')
  const completedRaw = String(bucket.operations.completed || '').trim()
  return {
    target: parseTargetNumber(targetRaw),
    completed: parseTargetNumber(completedRaw),
    pct: computeProgressPct(targetRaw, completedRaw)
  }
}

function BreakdownList({ title, rows, values, completed, helpId }) {
  if (!rows.length) {
    return (
      <section className="ops-targets-column">
        <h3 className="ops-targets-column-title">
          {title}
          {helpId ? <MetricInfoTip helpId={helpId} /> : null}
        </h3>
        <p className="ops-targets-empty">Žádné aktivní položky pro tento měsíc.</p>
      </section>
    )
  }

  return (
    <section className="ops-targets-column">
      <h3 className="ops-targets-column-title">
        {title}
        {helpId ? <MetricInfoTip helpId={helpId} /> : null}
      </h3>
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
                  <MetricInfoTip
                    helpId={helpId === 'targets_technik' ? 'targets_technik' : 'targets_kraj'}
                    label="Popis cíle"
                  />
                </span>
                <span>
                  Splněno: <b>{formatNumber(parseTargetNumber(completedValue))}</b>
                  <MetricInfoTip
                    helpId={helpId === 'targets_technik' ? 'targets_technik' : 'targets_kraj'}
                    label="Popis splněno"
                  />
                </span>
                {pct != null ? (
                  <span className="ops-targets-row-pct">
                    {pct} %
                    <MetricInfoTip helpId="targets_celkem" />
                  </span>
                ) : null}
              </div>
            </article>
          )
        })}
      </div>
    </section>
  )
}

function TargetSummaryCard({
  label,
  monthLabel,
  summary,
  expanded,
  expandable,
  onToggle
}) {
  const pct = summary?.pct
  const content = (
    <>
      <MetricLabel helpId="targets_celkem" className="sla-kpi-label">
        {label} · {monthLabel}
      </MetricLabel>
      <strong className="sla-kpi-value">{pct != null ? `${pct} %` : '—'}</strong>
      <span className="sla-kpi-hint">
        Splněno {formatNumber(summary?.completed)} / cíl {formatNumber(summary?.target)}
      </span>
      {expandable ? (
        <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
      ) : null}
    </>
  )

  if (!expandable) {
    return (
      <div className="sla-kpi-root sla-kpi-root-targets sla-kpi-root-targets-static" aria-label={label}>
        {content}
      </div>
    )
  }

  return (
    <button
      type="button"
      className={`sla-kpi-root sla-kpi-root-targets${expanded ? ' is-open' : ''}`}
      onClick={onToggle}
      aria-expanded={expanded}
    >
      {content}
    </button>
  )
}

export default function OperationsTargetsPanel({
  brandId = 'cz',
  organizationId = null,
  brandLabel = 'zaluzieee - CZ',
  sheetTechnicians = null,
  /** 'erp' | 'ovt-sheet' — pokladamee bere techniky + splněno ze sheetu */
  completedSource = 'erp',
  /** U zaluzieee CZ/SK: pod sebou Target CZ i Target SK */
  enableCzSkSwitch = false
}) {
  const targetsBrandId = brandId === 'sk' ? 'sk' : brandId
  const showCzSkStack = enableCzSkSwitch && (targetsBrandId === 'cz' || targetsBrandId === 'sk')
  const fromOvtSheet = completedSource === 'ovt-sheet'

  const [monthKey, setMonthKey] = useState('')
  const [bucket, setBucket] = useState(null)
  const [czSummary, setCzSummary] = useState(null)
  const [skSummary, setSkSummary] = useState(null)
  const [expanded, setExpanded] = useState(false)
  const [view, setView] = useState('technicians')
  const [erpSyncing, setErpSyncing] = useState(false)

  const monthOptions = useMemo(() => listMonthOptions(), [])

  useEffect(() => {
    if (!fromOvtSheet || !Array.isArray(sheetTechnicians) || !sheetTechnicians.length || !monthKey) {
      return
    }
    const incoming = sheetTechnicians
      .map((item) => ({
        id: item.id || technicianId(item.name),
        name: String(item.name || '').trim()
      }))
      .filter((item) => item.id && item.name)
    if (!incoming.length) return

    setBucket((current) => {
      if (!current?.technicians) return current
      const catalog = sortTechnicians(incoming)
      const activeIds = catalog.map((item) => item.id)
      const prevValues = current.technicians.values || {}
      const values = {}
      for (const tech of catalog) {
        if (prevValues[tech.id] != null) values[tech.id] = prevValues[tech.id]
      }
      const next = {
        ...current,
        technicians: {
          ...current.technicians,
          catalog,
          activeIds,
          values
        }
      }
      writeMonthBucket(monthKey, next, targetsBrandId)
      return next
    })
  }, [sheetTechnicians, monthKey, targetsBrandId, fromOvtSheet])

  function refreshStackSummaries(key = monthKey, primaryBucket = null) {
    if (!showCzSkStack || !key) {
      setCzSummary(null)
      setSkSummary(null)
      return
    }
    const czBucket =
      targetsBrandId === 'cz' && primaryBucket
        ? primaryBucket
        : readMonthBucket(key, 'cz')
    const skBucket =
      targetsBrandId === 'sk' && primaryBucket
        ? primaryBucket
        : readMonthBucket(key, 'sk')
    setCzSummary(summarizeBucket(czBucket))
    setSkSummary(summarizeBucket(skBucket))
  }

  async function reloadBucket(key = monthKey, syncRemote = false) {
    if (!key) return
    const initial = readMonthBucket(key, targetsBrandId)
    if (!syncRemote) {
      setBucket(initial)
      refreshStackSummaries(key, initial)
      return
    }
    setErpSyncing(true)
    try {
      if (fromOvtSheet) {
        const { bucket: synced } = await syncTargetsCompletedFromOvtSheet(key, initial, {
          brandId: targetsBrandId
        })
        setBucket(synced)
        refreshStackSummaries(key, synced)
      } else if (organizationId == null) {
        setBucket(initial)
        refreshStackSummaries(key, initial)
      } else {
        const { bucket: synced } = await syncTargetsCompletedFromErp(key, initial, {
          organizationId,
          brandId: targetsBrandId
        })
        setBucket(synced)
        refreshStackSummaries(key, synced)
      }
    } catch {
      setBucket(initial)
      refreshStackSummaries(key, initial)
    } finally {
      setErpSyncing(false)
    }
  }

  useEffect(() => {
    const month = readSelectedMonthKey()
    setMonthKey(month)
    setView(readTargetsView())
    reloadBucket(month, true)
  }, [targetsBrandId, organizationId, completedSource])

  useEffect(() => {
    if (!monthKey) return undefined
    function onStorage(event) {
      if (
        event.key === `prvni.targets.monthly.v1.${targetsBrandId}` ||
        event.key === 'prvni.targets.monthly.v1.cz' ||
        event.key === 'prvni.targets.monthly.v1.sk' ||
        event.key === 'prvni.targets.selectedMonth'
      ) {
        reloadBucket(monthKey)
      }
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [monthKey, targetsBrandId])

  useEffect(() => {
    if (expanded) reloadBucket(monthKey, true)
  }, [expanded, monthKey])

  function changeMonth(nextMonthKey) {
    setMonthKey(nextMonthKey)
    writeSelectedMonthKey(nextMonthKey)
    reloadBucket(nextMonthKey, true)
  }

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

  const displayTarget =
    String(operations?.target || '').trim() ||
    (breakdownTarget != null ? String(breakdownTarget) : '')
  const displayCompleted = String(operations?.completed || '').trim()

  const summaryPct = computeProgressPct(displayTarget, displayCompleted)
  const targetFillPct = computeProgressPct(displayTarget, displayCompleted) ?? 0
  const completedFillPct = targetFillPct

  const pageSummary = useMemo(
    () => ({
      target: parseTargetNumber(displayTarget),
      completed: parseTargetNumber(displayCompleted),
      pct: summaryPct
    }),
    [displayTarget, displayCompleted, summaryPct]
  )

  if (!bucket || !tech || !regions || !operations) return null

  function persistOperations(patch) {
    const next = {
      ...bucket,
      operations: { ...operations, ...patch }
    }
    setBucket(next)
    writeMonthBucket(monthKey, next, targetsBrandId)
    refreshStackSummaries(monthKey, next)
  }

  function changeView(nextView) {
    setView(nextView)
    writeTargetsView(nextView)
  }

  const monthLabel = formatMonthLabel(monthKey)
  const resolvedCz = showCzSkStack
    ? targetsBrandId === 'cz'
      ? pageSummary
      : czSummary
    : null
  const resolvedSk = showCzSkStack
    ? targetsBrandId === 'sk'
      ? pageSummary
      : skSummary
    : null

  return (
    <section className={`sla-block sla-block-nested sla-block-targets${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">
        Target celkem
        <MetricInfoTip helpId="targets_celkem" />
      </h2>
      <p className="sla-block-desc">
        {expanded
          ? fromOvtSheet
            ? 'Cíl zadáte ručně. Technici = sloupec Q (OVT). Splněno = počet řádků s Datum zaměření (P) ve zvoleném měsíci ze sheetu.'
            : `Cíl zadáte ručně. Splněno = počet naplánovaných zaměření (datum_zamereni) v měsíci z ERP${
                organizationId != null ? ` · organizace č. ${organizationId}` : ''
              }.`
          : showCzSkStack
            ? 'Výsledky CZ i SK pod sebou. Rozbalte pro úpravu targetu této značky.'
            : 'Klikněte pro rozpad targetů — kraje a technici.'}
        {erpSyncing
          ? fromOvtSheet
            ? ' · Načítám techniky a splněno ze sheetu…'
            : ' · Načítám splněno z ERP…'
          : ''}
      </p>

      {showCzSkStack ? (
        <div className="ops-targets-stack" aria-label="Target CZ a SK">
          <TargetSummaryCard
            label="Target CZ"
            monthLabel={monthLabel}
            summary={resolvedCz}
            expanded={expanded && targetsBrandId === 'cz'}
            expandable={targetsBrandId === 'cz'}
            onToggle={() => setExpanded((open) => !open)}
          />
          <TargetSummaryCard
            label="Target SK"
            monthLabel={monthLabel}
            summary={resolvedSk}
            expanded={expanded && targetsBrandId === 'sk'}
            expandable={targetsBrandId === 'sk'}
            onToggle={() => setExpanded((open) => !open)}
          />
        </div>
      ) : (
        <button
          type="button"
          className={`sla-kpi-root sla-kpi-root-targets${expanded ? ' is-open' : ''}`}
          onClick={() => setExpanded((open) => !open)}
          aria-expanded={expanded}
        >
          <MetricLabel helpId="targets_celkem" className="sla-kpi-label">
            Target celkem · {brandLabel} · {monthLabel}
          </MetricLabel>
          <strong className="sla-kpi-value">
            {summaryPct != null ? `${summaryPct} %` : '—'}
          </strong>
          <span className="sla-kpi-hint">
            Splněno {formatNumber(parseTargetNumber(displayCompleted))} / cíl{' '}
            {formatNumber(parseTargetNumber(displayTarget))}
          </span>
          <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
        </button>
      )}

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
                {targetsBrandId === 'sk' ? 'Slovensko' : 'Kraje'}
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
            <Link
              href="/targety"
              className="ops-targets-edit-link"
              onClick={() => {
                if (targetsBrandId === 'sk' || targetsBrandId === 'cz') {
                  writeTargetsBrandId(targetsBrandId)
                }
              }}
            >
              Upravit detailně v Targety →
            </Link>
          </div>

          <div className="ops-targets-overall">
            <label className="targets-map-editor-field">
              <span className="targets-field-label">
                Cíl celkem (kolik)
                <MetricInfoTip helpId="targets_cil_celkem" />
              </span>
              <TargetBarInput
                value={operations.target}
                fillPct={targetFillPct}
                badge="Cíl"
                onChange={(event) => persistOperations({ target: event.target.value })}
              />
            </label>
            <label className="targets-map-editor-field">
              <span className="targets-field-label">
                Splněno celkem
                <MetricInfoTip helpId="targets_splneno_celkem" />
              </span>
              <TargetBarInput
                value={operations.completed}
                fillPct={completedFillPct}
                badge="Splněno"
                tone="completed"
                readOnly={targetsBrandId !== 'sk'}
                onChange={
                  targetsBrandId === 'sk'
                    ? (event) => persistOperations({ completed: event.target.value })
                    : undefined
                }
              />
            </label>
          </div>

          <div className="ops-targets-columns">
            {view === 'regions' ? (
              <BreakdownList
                title={targetsBrandId === 'sk' ? 'Slovensko (sk)' : 'Kraje'}
                rows={regionRows}
                values={regions.values}
                completed={regions.completed}
                helpId="targets_kraj"
              />
            ) : (
              <BreakdownList
                title="Technici"
                rows={techRows}
                values={tech.values}
                completed={tech.completed}
                helpId="targets_technik"
              />
            )}
          </div>
        </div>
      ) : null}
    </section>
  )
}
