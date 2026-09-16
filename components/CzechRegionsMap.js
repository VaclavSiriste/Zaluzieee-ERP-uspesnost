import { useEffect, useMemo, useRef, useState } from 'react'
import TargetBarInput from '@/components/TargetBarInput'
import {
  ALL_CZECH_REGIONS,
  DEFAULT_CZECH_REGIONS,
  EXTRA_REGIONS,
  MAP_VIEWBOX as CZ_MAP_VIEWBOX
} from '@/lib/czech-regions'
import {
  ALL_SLOVAK_REGIONS,
  DEFAULT_SLOVAK_REGIONS,
  EXTRA_SLOVAK_REGIONS,
  MAP_VIEWBOX as SK_MAP_VIEWBOX
} from '@/lib/slovak-regions'
import { parseTargetNumber } from '@/lib/targets-storage'

const EXTRA_REGION_IDS_CZ = new Set(EXTRA_REGIONS.map((item) => item.id))
const EXTRA_REGION_IDS_SK = new Set(EXTRA_SLOVAK_REGIONS.map((item) => item.id))

function formatTarget(value) {
  const raw = String(value || '').trim()
  return raw || '—'
}

function formatPercent(target, completed) {
  const t = parseTargetNumber(target)
  const c = parseTargetNumber(completed)
  if (t != null && t > 0 && c != null) {
    return `${Math.min(100, Math.round((c / t) * 100))} %`
  }
  return '—'
}

function computeProgressPct(targetRaw, completedRaw) {
  const target = parseTargetNumber(targetRaw)
  const completed = parseTargetNumber(completedRaw)
  if (target != null && target > 0 && completed != null) {
    return Math.min(100, Math.round((completed / target) * 100))
  }
  return String(completedRaw || '').trim() ? 8 : 0
}

function regionStateClasses({ active, filled, done, isHovered, isSelected, isExtra }) {
  return [
    'targets-map-region',
    active || isExtra ? 'is-active' : 'is-inactive',
    filled ? 'is-filled' : '',
    done ? 'is-completed' : '',
    isHovered ? 'is-hovered' : '',
    isSelected ? 'is-selected' : '',
    isExtra ? 'is-extra' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

function wrapStateClasses({ isHovered, isSelected, isExtra }) {
  return [
    'targets-map-region-wrap',
    isHovered ? 'is-hovered' : '',
    isSelected ? 'is-selected' : '',
    isExtra ? 'is-extra' : ''
  ]
    .filter(Boolean)
    .join(' ')
}

export default function CzechRegionsMap({
  catalog,
  values,
  completed = {},
  labels = {},
  activeIds,
  selectedId,
  onSelect,
  onValueChange,
  onCompletedChange,
  onLabelChange,
  completedReadOnly = false,
  overallTarget = null,
  overallCompleted = null,
  /** 'cz' | 'sk' */
  mapBrand = 'cz'
}) {
  const isSk = mapBrand === 'sk'
  const mapViewBox = isSk ? SK_MAP_VIEWBOX : CZ_MAP_VIEWBOX
  const defaultRegions = isSk ? DEFAULT_SLOVAK_REGIONS : DEFAULT_CZECH_REGIONS
  const allRegions = isSk ? ALL_SLOVAK_REGIONS : ALL_CZECH_REGIONS
  const extraRegions = isSk ? EXTRA_SLOVAK_REGIONS : EXTRA_REGIONS
  const extraIds = isSk ? EXTRA_REGION_IDS_SK : EXTRA_REGION_IDS_CZ

  const [hoveredId, setHoveredId] = useState('')
  const valueInputRef = useRef(null)
  const activeSet = useMemo(() => new Set(activeIds), [activeIds])

  const regionById = useMemo(() => {
    const map = new Map(allRegions.map((item) => [item.id, item]))
    for (const item of catalog) {
      if (!map.has(item.id)) {
        map.set(item.id, {
          id: item.id,
          name: item.name,
          shortName: item.shortName || item.name,
          path: null
        })
      }
    }
    return map
  }, [catalog, allRegions])

  const hovered = hoveredId ? regionById.get(hoveredId) : null
  const hoveredValue = hovered ? values[hovered.id] : ''
  const hoveredCompleted = hovered ? completed[hovered.id] : ''
  const selected = selectedId ? regionById.get(selectedId) : null
  const selectedValue = selected ? values[selected.id] ?? '' : ''
  const selectedCompleted = selected ? completed[selected.id] ?? '' : ''
  const selectedLabel = selected ? labels[selected.id] ?? '' : ''

  useEffect(() => {
    if (!selectedId) return undefined
    const timeoutId = setTimeout(() => valueInputRef.current?.focus(), 80)
    return () => clearTimeout(timeoutId)
  }, [selectedId])

  function handleRegionClick(regionIdValue, event) {
    event?.stopPropagation?.()
    onSelect?.(regionIdValue)
  }

  function renderKrajOrder() {
    const liftId =
      hoveredId && !extraIds.has(hoveredId)
        ? hoveredId
        : selectedId && !extraIds.has(selectedId)
          ? selectedId
          : ''
    if (!liftId) return defaultRegions
    const rest = defaultRegions.filter((region) => region.id !== liftId)
    const lifted = defaultRegions.find((region) => region.id === liftId)
    return lifted ? [...rest, lifted] : defaultRegions
  }

  function renderRegionInteraction(region, isExtra = false) {
    const active = activeSet.has(region.id)
    const filled = Boolean(String(values[region.id] || '').trim())
    const done = Boolean(String(completed[region.id] || '').trim())
    const isHovered = hoveredId === region.id
    const isSelected = selectedId === region.id
    const ariaLabel = `${region.name}, cíl ${formatTarget(values[region.id])}, splněno ${formatTarget(completed[region.id])}`
    const commonHandlers = {
      onMouseEnter: () => setHoveredId(region.id),
      onMouseLeave: () => setHoveredId(''),
      onFocus: () => setHoveredId(region.id),
      onBlur: () => setHoveredId(''),
      onClick: (event) => handleRegionClick(region.id, event),
      tabIndex: 0,
      'aria-label': ariaLabel,
      'aria-current': isSelected ? 'true' : undefined
    }
    const regionClasses = regionStateClasses({
      active,
      filled,
      done,
      isHovered,
      isSelected,
      isExtra
    })
    const wrapClasses = wrapStateClasses({ isHovered, isSelected, isExtra })

    if (isExtra && region.mapX != null && region.mapY != null) {
      return (
        <g key={region.id} className={wrapClasses}>
          <circle
            className="targets-map-marker-hit"
            cx={region.mapX}
            cy={region.mapY}
            r={26}
            {...commonHandlers}
            role="button"
          />
          <circle
            className={regionClasses}
            cx={region.mapX}
            cy={region.mapY}
            r={12}
            pointerEvents="none"
          />
          <text
            className="targets-map-marker-label"
            x={region.mapX}
            y={region.mapY + 26}
            textAnchor="middle"
            pointerEvents="none"
          >
            {region.shortName || region.name}
          </text>
        </g>
      )
    }

    if (!region.path) return null

    return (
      <g key={region.id} className={wrapClasses}>
        <path d={region.path} className={regionClasses} {...commonHandlers} />
      </g>
    )
  }

  return (
    <div className="targets-map-panel">
      <section className="targets-overall-completion" aria-label="Celkově splněno">
        <div className="targets-overall-copy">
          <span className="targets-overall-label">
            Celkově splněno{isSk ? ' · SK' : ''}
          </span>
          <strong className="targets-overall-pct">
            {formatPercent(overallTarget, overallCompleted)}
          </strong>
          <span className="targets-overall-hint">
            splněno{' '}
            {overallCompleted != null
              ? Number(overallCompleted).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })
              : '—'}{' '}
            / cíl{' '}
            {overallTarget != null
              ? Number(overallTarget).toLocaleString('cs-CZ', { maximumFractionDigits: 0 })
              : '—'}
          </span>
        </div>
      </section>

      <p className="targets-map-hint">
        {isSk
          ? 'Klikněte na mapu Slovenska (region sk). Celkový target pod mapou = SK.'
          : 'Klikněte na kraj nebo Benešov na mapě. Splněno se načítá z ERP podle data zaměření.'}
      </p>
      <div className="targets-map-tooltip" aria-live="polite">
        {hovered ? (
          <>
            <strong>{hovered.name}</strong>
            <span>
              Cíl: <b>{formatTarget(hoveredValue)}</b>
            </span>
            <span>
              Splněno: <b>{formatTarget(hoveredCompleted)}</b>
            </span>
            <span>
              Plnění: <b>{formatPercent(hoveredValue, hoveredCompleted)}</b>
            </span>
          </>
        ) : (
          <span>
            {isSk
              ? 'Najeďte myší na Slovensko — zobrazí se cíl, splněno a %'
              : 'Najeďte myší na kraj — zobrazí se cíl, splněno a %'}
          </span>
        )}
      </div>
      <svg
        className="targets-map-svg"
        viewBox={mapViewBox}
        role="img"
        aria-label={isSk ? 'Mapa Slovenska' : 'Mapa krajů České republiky'}
      >
        <g className="targets-map-kraje-layer">
          {renderKrajOrder().map((region) => renderRegionInteraction(region, false))}
        </g>
        {extraRegions.length ? (
          <g className="targets-map-extra-layer">
            {extraRegions.map((region) => renderRegionInteraction(region, true))}
          </g>
        ) : null}
      </svg>

      {selected ? (
        <div className="targets-map-editor" aria-label={`Úprava targetu pro ${selected.name}`}>
          <div className="targets-map-editor-head">
            <div>
              <span className="targets-map-editor-kicker">
                {isSk ? 'Cíl SK' : 'Cíl kraje'}
              </span>
              <strong>{selected.name}</strong>
            </div>
            <button
              type="button"
              className="targets-map-editor-close"
              onClick={() => onSelect?.('')}
              aria-label="Zavřít editor kraje"
            >
              ×
            </button>
          </div>
          <div className="targets-metrics-row">
            <label className="targets-map-editor-field">
              <span>Cíl k splnění (číslo)</span>
              <TargetBarInput
                value={selectedValue}
                fillPct={String(selectedValue).trim() ? 100 : 0}
                badge="Cíl"
                inputRef={valueInputRef}
                onChange={(event) => onValueChange?.(selected.id, event.target.value)}
              />
            </label>
            <label className="targets-map-editor-field">
              <span>Splněno {completedReadOnly ? '(ERP)' : '(číslo)'}</span>
              <TargetBarInput
                value={selectedCompleted}
                fillPct={computeProgressPct(selectedValue, selectedCompleted)}
                badge="Splněno"
                tone="completed"
                readOnly={completedReadOnly}
                onChange={
                  completedReadOnly
                    ? undefined
                    : (event) => onCompletedChange?.(selected.id, event.target.value)
                }
              />
            </label>
          </div>
          <p className="targets-map-editor-pct">
            Plnění: <strong>{formatPercent(selectedValue, selectedCompleted)}</strong>
          </p>
          <label className="targets-map-editor-field">
            <span>Co target znamená (volitelně)</span>
            <input
              type="text"
              className="targets-label-input"
              placeholder="Např. počet montáží, trasa, km…"
              value={selectedLabel}
              onChange={(event) => onLabelChange?.(selected.id, event.target.value)}
            />
          </label>
        </div>
      ) : (
        <p className="targets-map-editor-empty">
          {isSk
            ? 'Vyberte Slovensko (sk) kliknutím na mapu.'
            : 'Vyberte kraj nebo Benešov kliknutím na mapu.'}
        </p>
      )}
    </div>
  )
}
