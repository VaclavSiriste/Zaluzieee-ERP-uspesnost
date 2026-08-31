import { useEffect, useMemo, useRef, useState } from 'react'
import TargetBarInput from '@/components/TargetBarInput'
import { DEFAULT_CZECH_REGIONS, MAP_VIEWBOX } from '@/lib/czech-regions'
import { parseTargetNumber } from '@/lib/targets-storage'

function formatTarget(value) {
  const raw = String(value || '').trim()
  return raw || '—'
}

function computeProgressPct(targetRaw, completedRaw) {
  const target = parseTargetNumber(targetRaw)
  const completed = parseTargetNumber(completedRaw)
  if (target != null && target > 0 && completed != null) {
    return Math.min(100, Math.round((completed / target) * 100))
  }
  return String(completedRaw || '').trim() ? 8 : 0
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
  onLabelChange
}) {
  const [hoveredId, setHoveredId] = useState('')
  const valueInputRef = useRef(null)
  const activeSet = useMemo(() => new Set(activeIds), [activeIds])

  const regionById = useMemo(() => {
    const map = new Map(DEFAULT_CZECH_REGIONS.map((item) => [item.id, item]))
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
  }, [catalog])

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

  function handleRegionClick(regionId) {
    onSelect?.(regionId)
  }

  return (
    <div className="targets-map-panel">
      <p className="targets-map-hint">
        Klikněte na kraj na mapě a zadejte cíl i splněnou hodnotu.
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
          </>
        ) : (
          <span>Najeďte myší na kraj — zobrazí se cíl a splnění</span>
        )}
      </div>
      <svg
        className="targets-map-svg"
        viewBox={MAP_VIEWBOX}
        role="img"
        aria-label="Mapa krajů České republiky"
      >
        {(hoveredId || selectedId
          ? [
              ...DEFAULT_CZECH_REGIONS.filter(
                (region) => region.id !== hoveredId && region.id !== selectedId
              ),
              ...(hoveredId && hoveredId !== selectedId
                ? [DEFAULT_CZECH_REGIONS.find((region) => region.id === hoveredId)]
                : []),
              ...(selectedId
                ? [DEFAULT_CZECH_REGIONS.find((region) => region.id === selectedId)]
                : [])
            ].filter(Boolean)
          : DEFAULT_CZECH_REGIONS
        ).map((region) => {
          const active = activeSet.has(region.id)
          const filled = Boolean(String(values[region.id] || '').trim())
          const isHovered = hoveredId === region.id
          const isSelected = selectedId === region.id
          return (
            <g
              key={region.id}
              className={[
                'targets-map-region-wrap',
                isHovered ? 'is-hovered' : '',
                isSelected ? 'is-selected' : ''
              ]
                .filter(Boolean)
                .join(' ')}
              onMouseEnter={() => setHoveredId(region.id)}
              onMouseLeave={() => setHoveredId('')}
            >
              <path
                d={region.path}
                className={[
                  'targets-map-region',
                  active ? 'is-active' : 'is-inactive',
                  filled ? 'is-filled' : '',
                  isHovered ? 'is-hovered' : '',
                  isSelected ? 'is-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                onFocus={() => setHoveredId(region.id)}
                onBlur={() => setHoveredId('')}
                onClick={() => handleRegionClick(region.id)}
                tabIndex={0}
                aria-label={`${region.name}, cíl ${formatTarget(values[region.id])}, splněno ${formatTarget(completed[region.id])}`}
                aria-current={isSelected ? 'true' : undefined}
              />
            </g>
          )
        })}
      </svg>

      {selected ? (
        <div className="targets-map-editor" aria-label={`Úprava targetu pro ${selected.name}`}>
          <div className="targets-map-editor-head">
            <div>
              <span className="targets-map-editor-kicker">Cíl kraje</span>
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
              <span>Splněno (číslo)</span>
              <TargetBarInput
                value={selectedCompleted}
                fillPct={computeProgressPct(selectedValue, selectedCompleted)}
                badge="Splněno"
                tone="completed"
                onChange={(event) => onCompletedChange?.(selected.id, event.target.value)}
              />
            </label>
          </div>
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
        <p className="targets-map-editor-empty">Vyberte kraj kliknutím na mapu.</p>
      )}
    </div>
  )
}
