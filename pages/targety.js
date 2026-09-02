import { useEffect, useMemo, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import CzechRegionsMap from '@/components/CzechRegionsMap'
import RegionDirectory from '@/components/RegionDirectory'
import TargetBarInput from '@/components/TargetBarInput'
import TechnicianDirectory from '@/components/TechnicianDirectory'
import { normalizeRegionName, resolveErpRegionId, sortRegions, buildDefaultRegionCatalog } from '@/lib/czech-regions'
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
import { syncTargetsCompletedFromErp } from '@/lib/sync-targets-completed'
import {
  normalizeTechnicianName,
  sortTechnicians,
  technicianId
} from '@/lib/technician-targets'

function initials(name) {
  const parts = String(name || '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
  if (!parts.length) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase()
}

function computeStats(rows, values, completed = {}) {
  let filled = 0
  let completedFilled = 0
  let totalValue = 0
  let totalCompleted = 0
  let hasNumeric = false
  let hasCompletedNumeric = false
  let maxValue = 0
  for (const row of rows) {
    const raw = values[row.id]
    if (String(raw || '').trim()) {
      filled += 1
      const num = parseTargetNumber(raw)
      if (num != null) {
        totalValue += num
        hasNumeric = true
        if (num > maxValue) maxValue = num
      }
    }
    const completedRaw = completed[row.id]
    if (String(completedRaw || '').trim()) {
      completedFilled += 1
      const completedNum = parseTargetNumber(completedRaw)
      if (completedNum != null) {
        totalCompleted += completedNum
        hasCompletedNumeric = true
      }
    }
  }
  return {
    active: rows.length,
    filled,
    completedFilled,
    totalValue: hasNumeric ? totalValue : null,
    totalCompleted: hasCompletedNumeric ? totalCompleted : null,
    maxValue: hasNumeric ? maxValue : null
  }
}

function computeProgressPct(targetRaw, completedRaw) {
  const target = parseTargetNumber(targetRaw)
  const completed = parseTargetNumber(completedRaw)
  if (target != null && target > 0 && completed != null) {
    return Math.min(100, Math.round((completed / target) * 100))
  }
  return String(completedRaw || '').trim() ? 8 : 0
}

function formatOverallPercent(totalTarget, totalCompleted) {
  if (totalTarget != null && totalTarget > 0 && totalCompleted != null) {
    return `${Math.min(100, Math.round((totalCompleted / totalTarget) * 100))} %`
  }
  return '—'
}

function remapValues(valuesMap, idMap) {
  const next = {}
  for (const [oldId, value] of Object.entries(valuesMap)) {
    next[idMap[oldId] || oldId] = value
  }
  return next
}

export default function TargetyPage() {
  const [view, setView] = useState('technicians')
  const [monthKey, setMonthKey] = useState('')
  const [bucket, setBucket] = useState(null)
  const [directoryOpen, setDirectoryOpen] = useState(false)
  const [message, setMessage] = useState('')
  const [query, setQuery] = useState('')
  const [focusRegionId, setFocusRegionId] = useState('')
  const [selectedRegionId, setSelectedRegionId] = useState('')
  const [erpSyncing, setErpSyncing] = useState(false)
  const [erpSyncError, setErpSyncError] = useState('')

  async function loadMonthWithErp(nextMonthKey) {
    const initial = readMonthBucket(nextMonthKey)
    setBucket(initial)
    setErpSyncing(true)
    setErpSyncError('')
    try {
      const { bucket: synced } = await syncTargetsCompletedFromErp(nextMonthKey, initial)
      setBucket(synced)
    } catch (err) {
      setErpSyncError(err.message || 'Nepodařilo se načíst splněno z ERP')
    } finally {
      setErpSyncing(false)
    }
  }

  useEffect(() => {
    const month = readSelectedMonthKey()
    setMonthKey(month)
    setView(readTargetsView())
    loadMonthWithErp(month)
  }, [])

  useEffect(() => {
    if (!message) return undefined
    const timeoutId = setTimeout(() => setMessage(''), 3200)
    return () => clearTimeout(timeoutId)
  }, [message])

  useEffect(() => {
    if (!focusRegionId) return undefined
    const node = document.getElementById(`region-row-${focusRegionId}`)
    node?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    const timeoutId = setTimeout(() => setFocusRegionId(''), 1200)
    return () => clearTimeout(timeoutId)
  }, [focusRegionId])

  const monthLabel = useMemo(() => formatMonthLabel(monthKey), [monthKey])
  const monthOptions = useMemo(() => listMonthOptions(), [])

  function persistBucket(nextBucket) {
    setBucket(nextBucket)
    writeMonthBucket(monthKey, nextBucket)
  }

  function changeMonth(nextMonthKey) {
    setMonthKey(nextMonthKey)
    writeSelectedMonthKey(nextMonthKey)
    setQuery('')
    setSelectedRegionId('')
    loadMonthWithErp(nextMonthKey)
  }

  function changeView(nextView) {
    setView(nextView)
    writeTargetsView(nextView)
    setQuery('')
    setSelectedRegionId('')
  }

  const tech = bucket?.technicians
  const regions = bucket?.regions

  const techActiveSet = useMemo(
    () => new Set(tech?.activeIds || []),
    [tech?.activeIds]
  )
  const regionActiveSet = useMemo(
    () => new Set(regions?.activeIds || []),
    [regions?.activeIds]
  )

  const techRows = useMemo(() => {
    if (!tech) return []
    return sortTechnicians(tech.catalog.filter((item) => techActiveSet.has(item.id)))
  }, [tech, techActiveSet])

  const regionRows = useMemo(() => {
    if (!regions) return []
    return sortRegions(regions.catalog.filter((item) => regionActiveSet.has(item.id)))
  }, [regions, regionActiveSet])

  const filteredTechRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return techRows
    return techRows.filter((row) => row.name.toLowerCase().includes(q))
  }, [techRows, query])

  const filteredRegionRows = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return regionRows
    return regionRows.filter((row) => row.name.toLowerCase().includes(q))
  }, [regionRows, query])

  const techStats = useMemo(
    () => computeStats(techRows, tech?.values || {}, tech?.completed || {}),
    [techRows, tech?.values, tech?.completed]
  )
  const regionStats = useMemo(
    () => computeStats(regionRows, regions?.values || {}, regions?.completed || {}),
    [regionRows, regions?.values, regions?.completed]
  )

  const stats = view === 'regions' ? regionStats : techStats
  const catalogCount = view === 'regions' ? regions?.catalog.length || 0 : tech?.catalog.length || 0

  if (!bucket || !tech || !regions) {
    return (
      <main className="dashboard-container pauses-page targets-page">
        <div className="dashboard-layout">
          <AppMenu active="targets" />
          <div className="dashboard-main">
            <div className="pauses-loading">Načítám targety…</div>
          </div>
        </div>
      </main>
    )
  }

  function updateTechnicians(patch) {
    persistBucket({ ...bucket, technicians: { ...tech, ...patch } })
  }

  function updateRegions(patch) {
    persistBucket({ ...bucket, regions: { ...regions, ...patch } })
  }

  function handleTechValueChange(id, rawValue) {
    updateTechnicians({ values: { ...tech.values, [id]: rawValue } })
  }

  function handleRegionValueChange(id, rawValue) {
    updateRegions({ values: { ...regions.values, [id]: rawValue } })
  }

  function handleRegionLabelChange(id, rawLabel) {
    updateRegions({ labels: { ...regions.labels, [id]: rawLabel } })
  }

  function handleTechToggleActive(id) {
    const key = String(id)
    const next = techActiveSet.has(key)
      ? tech.activeIds.filter((item) => item !== key)
      : [...tech.activeIds, key]
    updateTechnicians({ activeIds: next })
  }

  function handleRegionToggleActive(id) {
    const key = String(id)
    const next = regionActiveSet.has(key)
      ? regions.activeIds.filter((item) => item !== key)
      : [...regions.activeIds, key]
    updateRegions({ activeIds: next })
  }

  function handleTechAddName(name) {
    const normalized = normalizeTechnicianName(name)
    if (!normalized) return
    const id = technicianId(normalized)
    if (tech.catalog.some((item) => item.id === id)) {
      setMessage('Technik už je v číselníku.')
      return
    }
    const nextCatalog = sortTechnicians([...tech.catalog, { id, name: normalized }])
    updateTechnicians({
      catalog: nextCatalog,
      activeIds: techActiveSet.has(id) ? tech.activeIds : [...tech.activeIds, id]
    })
    setMessage(`Přidán technik ${normalized}.`)
  }

  function handleRegionAddName(name) {
    const normalized = normalizeRegionName(name)
    if (!normalized) return
    const catalog = buildDefaultRegionCatalog()
    const id = resolveErpRegionId(normalized, catalog)
    if (!id) {
      setMessage('Neznámý kraj — zadejte název z číselníku (14 krajů + Benešov).')
      return
    }
    if (regionActiveSet.has(id)) {
      setMessage('Kraj už je aktivní v tabulce.')
      return
    }
    updateRegions({
      catalog,
      activeIds: [...regions.activeIds, id]
    })
    setMessage(`Přidán ${catalog.find((item) => item.id === id)?.name || normalized}.`)
  }

  function handleTechRename(oldId, name) {
    const normalized = normalizeTechnicianName(name)
    if (!normalized) return
    const newId = technicianId(normalized)
    if (oldId !== newId && tech.catalog.some((item) => item.id === newId)) {
      setMessage('Technik s tímto jménem už v číselníku je.')
      return
    }
    updateTechnicians({
      catalog: sortTechnicians(
        tech.catalog.map((item) => (item.id === oldId ? { id: newId, name: normalized } : item))
      ),
      activeIds: tech.activeIds.map((id) => (id === oldId ? newId : id)),
      values: remapValues(tech.values, { [oldId]: newId }),
      completed: remapValues(tech.completed, { [oldId]: newId })
    })
    setMessage(`Technik přejmenován na ${normalized}.`)
  }

  function handleRegionRename(oldId, name) {
    setMessage('Přejmenování krajů není podporováno — použijte číselník 14 krajů + Benešov.')
  }

  function handleTechRemove(id) {
    const key = String(id)
    const item = tech.catalog.find((entry) => entry.id === key)
    const nextValues = { ...tech.values }
    const nextCompleted = { ...tech.completed }
    delete nextValues[key]
    delete nextCompleted[key]
    updateTechnicians({
      catalog: tech.catalog.filter((entry) => entry.id !== key),
      activeIds: tech.activeIds.filter((entry) => entry !== key),
      values: nextValues,
      completed: nextCompleted
    })
    setMessage(item ? `Odebrán technik ${item.name}.` : 'Technik odebrán.')
  }

  function handleRegionRemove(id) {
    const key = String(id)
    const item = regions.catalog.find((entry) => entry.id === key)
    const nextValues = { ...regions.values }
    const nextCompleted = { ...regions.completed }
    const nextLabels = { ...regions.labels }
    delete nextValues[key]
    delete nextCompleted[key]
    delete nextLabels[key]
    updateRegions({
      catalog: regions.catalog.filter((entry) => entry.id !== key),
      activeIds: regions.activeIds.filter((entry) => entry !== key),
      values: nextValues,
      completed: nextCompleted,
      labels: nextLabels
    })
    setMessage(item ? `Odebrán kraj ${item.name}.` : 'Kraj odebrán.')
  }

  const rows = view === 'regions' ? filteredRegionRows : filteredTechRows
  const totalRows = view === 'regions' ? regionRows.length : techRows.length

  return (
    <main className="dashboard-container pauses-page targets-page">
      <div className="dashboard-layout">
        <AppMenu active="targets" />
        <div className="dashboard-main">
          <header className="targets-hero">
            <div className="targets-hero-copy">
              <p className="targets-kicker">Operátoři · plánování</p>
              <h1>Targety</h1>
              <p>
                Cílové hodnoty podle techniků nebo krajů. Splněno z ERP: technik = zaměřovač,
                kraj = region z adresy zákazníka, obojí podle data zaměření v měsíci.
              </p>
              <div className="targets-hero-actions">
                <button
                  type="button"
                  className="targets-directory-btn"
                  onClick={() => setDirectoryOpen(true)}
                >
                  {view === 'regions' ? 'Číselník krajů' : 'Číselník techniků'}
                  <span className="targets-directory-badge">{catalogCount}</span>
                </button>
              </div>
            </div>
            <div className="targets-hero-glow" aria-hidden="true" />
          </header>

          <section className="targets-controls">
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
          </section>

          {erpSyncing ? (
            <div className="targets-toast" role="status">
              Načítám splněno z ERP…
            </div>
          ) : null}

          {erpSyncError ? (
            <div className="targets-toast targets-toast-error" role="alert">
              {erpSyncError}
            </div>
          ) : null}

          {message ? (
            <div className="targets-toast" role="status">
              {message}
            </div>
          ) : null}

          <section className="targets-overall-completion targets-overall-completion-page" aria-label="Celkově splněno">
            <div className="targets-overall-copy">
              <span className="targets-overall-label">
                Celkově splněno · {view === 'regions' ? 'kraje' : 'technici'} · {monthLabel}
              </span>
              <strong className="targets-overall-pct">
                {formatOverallPercent(stats.totalValue, stats.totalCompleted)}
              </strong>
              <span className="targets-overall-hint">
                splněno{' '}
                {stats.totalCompleted != null
                  ? stats.totalCompleted.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })
                  : '—'}{' '}
                / cíl{' '}
                {stats.totalValue != null
                  ? stats.totalValue.toLocaleString('cs-CZ', { maximumFractionDigits: 0 })
                  : '—'}
              </span>
            </div>
          </section>

          <section className="targets-kpis" aria-label="Souhrn targetů">
            <article className="targets-kpi">
              <span className="targets-kpi-label">Měsíc</span>
              <strong className="targets-kpi-value targets-kpi-value-month">{monthLabel}</strong>
              <span className="targets-kpi-hint">{view === 'regions' ? 'kraje' : 'technici'}</span>
            </article>
            <article className="targets-kpi">
              <span className="targets-kpi-label">V tabulce</span>
              <strong className="targets-kpi-value">{stats.active.toLocaleString('cs-CZ')}</strong>
              <span className="targets-kpi-hint">{view === 'regions' ? 'krajů' : 'techniků'}</span>
            </article>
            <article className="targets-kpi targets-kpi-accent">
              <span className="targets-kpi-label">Vyplněno</span>
              <strong className="targets-kpi-value">{stats.filled.toLocaleString('cs-CZ')}</strong>
              <span className="targets-kpi-hint">
                {stats.active > 0
                  ? `${Math.round((stats.filled / stats.active) * 100)} %`
                  : 'zatím prázdné'}
              </span>
            </article>
            <article className="targets-kpi targets-kpi-sum">
              <span className="targets-kpi-label">Součet targetů</span>
              <strong className="targets-kpi-value">
                {stats.totalValue != null
                  ? stats.totalValue.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })
                  : '—'}
              </strong>
              <span className="targets-kpi-hint">
                splněno:{' '}
                {stats.totalCompleted != null
                  ? stats.totalCompleted.toLocaleString('cs-CZ', { maximumFractionDigits: 2 })
                  : '—'}
              </span>
            </article>
          </section>

          {view === 'regions' ? (
            <CzechRegionsMap
              catalog={regions.catalog}
              values={regions.values}
              completed={regions.completed}
              labels={regions.labels}
              activeIds={regions.activeIds}
              selectedId={selectedRegionId}
              overallTarget={regionStats.totalValue}
              overallCompleted={regionStats.totalCompleted}
              onSelect={(id) => {
                setSelectedRegionId(id)
                if (id) setFocusRegionId(id)
              }}
              onValueChange={handleRegionValueChange}
              onLabelChange={handleRegionLabelChange}
              completedReadOnly
            />
          ) : null}

          <section className="targets-toolbar">
            <input
              type="search"
              className="targets-search"
              placeholder={
                view === 'regions' ? 'Hledat kraj v tabulce…' : 'Hledat technika v tabulce…'
              }
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            <p className="targets-toolbar-meta">
              {rows.length} z {totalRows} · {monthLabel}
            </p>
          </section>

          {totalRows === 0 ? (
            <div className="targets-empty">
              <h2>Tabulka je prázdná</h2>
              <p>Otevřete číselník a zapněte položky pro tento měsíc.</p>
              <button
                type="button"
                className="targets-directory-btn"
                onClick={() => setDirectoryOpen(true)}
              >
                Otevřít číselník
              </button>
            </div>
          ) : rows.length === 0 ? (
            <div className="targets-empty">
              <h2>Žádný výsledek</h2>
              <p>Pro hledání „{query}“ nic neodpovídá.</p>
            </div>
          ) : view === 'technicians' ? (
            <section className="targets-list-panel" aria-label="Targety techniků">
              <div className="targets-list-head targets-list-head-metrics">
                <span>Jméno technika</span>
                <span>Target</span>
                <span>Splněno</span>
              </div>
              <div className="targets-list">
                {filteredTechRows.map((row, index) => {
                  const value = tech.values[row.id] ?? ''
                  const completed = tech.completed[row.id] ?? ''
                  const filled = Boolean(String(value).trim())
                  const completedFilled = Boolean(String(completed).trim())
                  const numeric = parseTargetNumber(value)
                  const fillPct =
                    techStats.maxValue && numeric != null && techStats.maxValue > 0
                      ? Math.min(100, Math.round((numeric / techStats.maxValue) * 100))
                      : filled
                        ? 8
                        : 0
                  const completedPct = computeProgressPct(value, completed)
                  return (
                    <article
                      key={row.id}
                      className={`targets-row targets-row-metrics${filled || completedFilled ? ' is-filled' : ''}`}
                      style={{ '--targets-delay': `${Math.min(index, 20) * 24}ms` }}
                    >
                      <div className="targets-row-person">
                        <div className="targets-avatar" aria-hidden="true">
                          {initials(row.name)}
                        </div>
                        <div className="targets-row-name">
                          <strong>{row.name}</strong>
                          <span>
                            {filled || completedFilled
                              ? `Cíl ${value || '—'} · Splněno ${completed || '—'}`
                              : 'Čeká na zadání'}
                          </span>
                        </div>
                      </div>
                      <label className="targets-bar-field">
                        <span className="sr-only">Target pro {row.name}</span>
                        <TargetBarInput
                          value={value}
                          fillPct={fillPct}
                          badge="Cíl"
                          onChange={(event) => handleTechValueChange(row.id, event.target.value)}
                        />
                      </label>
                      <label className="targets-bar-field">
                        <span className="sr-only">Splněno pro {row.name}</span>
                        <TargetBarInput
                          value={completed}
                          fillPct={completedPct}
                          badge="Splněno"
                          tone="completed"
                          readOnly
                        />
                      </label>
                    </article>
                  )
                })}
              </div>
            </section>
          ) : (
            <section className="targets-list-panel" aria-label="Targety krajů">
              <div className="targets-list-head targets-list-head-regions">
                <span>Přehled krajů — cíl k splnění</span>
              </div>
              <div className="targets-list targets-list-regions">
                {filteredRegionRows.map((row, index) => {
                  const value = regions.values[row.id] ?? ''
                  const completed = regions.completed[row.id] ?? ''
                  const label = regions.labels[row.id] ?? ''
                  const filled = Boolean(String(value).trim())
                  const completedFilled = Boolean(String(completed).trim())
                  const numeric = parseTargetNumber(value)
                  const fillPct =
                    regionStats.maxValue && numeric != null && regionStats.maxValue > 0
                      ? Math.min(100, Math.round((numeric / regionStats.maxValue) * 100))
                      : filled
                        ? 8
                        : 0
                  const completedPct = computeProgressPct(value, completed)
                  const isSelected = selectedRegionId === row.id
                  return (
                    <article
                      id={`region-row-${row.id}`}
                      key={row.id}
                      className={`targets-row targets-region-row${filled || completedFilled ? ' is-filled' : ''}${focusRegionId === row.id ? ' is-focused' : ''}${isSelected ? ' is-selected' : ''}`}
                      style={{ '--targets-delay': `${Math.min(index, 20) * 24}ms` }}
                    >
                      <div className="targets-region-card">
                        <div className="targets-region-card-head">
                          <strong className="targets-region-title">{row.name}</strong>
                          <span className="targets-region-pct">
                            {formatOverallPercent(parseTargetNumber(value), parseTargetNumber(completed))}
                          </span>
                          <button
                            type="button"
                            className="targets-region-select-btn"
                            onClick={() => {
                              setSelectedRegionId(row.id)
                              setFocusRegionId(row.id)
                            }}
                          >
                            {isSelected ? 'Vybráno na mapě' : 'Upravit na mapě'}
                          </button>
                        </div>
                        <div className="targets-metrics-row">
                          <label className="targets-map-editor-field">
                            <span>Cíl k splnění (číslo)</span>
                            <TargetBarInput
                              value={value}
                              fillPct={fillPct}
                              badge="Cíl"
                              onChange={(event) => handleRegionValueChange(row.id, event.target.value)}
                            />
                          </label>
                          <label className="targets-map-editor-field">
                            <span>Splněno (číslo)</span>
                            <TargetBarInput
                              value={completed}
                              fillPct={completedPct}
                              badge="Splněno"
                              tone="completed"
                              readOnly
                            />
                          </label>
                        </div>
                        <label className="targets-map-editor-field">
                          <span>Co target znamená (volitelně)</span>
                          <input
                            type="text"
                            className="targets-label-input"
                            placeholder="Např. počet montáží, trasa, km…"
                            value={label}
                            onChange={(event) => handleRegionLabelChange(row.id, event.target.value)}
                          />
                        </label>
                      </div>
                    </article>
                  )
                })}
              </div>
            </section>
          )}
        </div>
      </div>

      {view === 'technicians' ? (
        <TechnicianDirectory
          open={directoryOpen}
          onClose={() => setDirectoryOpen(false)}
          monthLabel={monthLabel}
          catalog={tech.catalog}
          activeIds={tech.activeIds}
          onToggleActive={handleTechToggleActive}
          onAddName={handleTechAddName}
          onRename={handleTechRename}
          onRemove={handleTechRemove}
          onShowAll={() => updateTechnicians({ activeIds: tech.catalog.map((item) => item.id) })}
          onHideAll={() => updateTechnicians({ activeIds: [] })}
        />
      ) : (
        <RegionDirectory
          open={directoryOpen}
          onClose={() => setDirectoryOpen(false)}
          monthLabel={monthLabel}
          catalog={regions.catalog}
          activeIds={regions.activeIds}
          onToggleActive={handleRegionToggleActive}
          onAddName={handleRegionAddName}
          onRename={handleRegionRename}
          onRemove={handleRegionRemove}
          onShowAll={() => updateRegions({ activeIds: regions.catalog.map((item) => item.id) })}
          onHideAll={() => updateRegions({ activeIds: [] })}
        />
      )}
    </main>
  )
}
