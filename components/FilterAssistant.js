import { useEffect, useMemo, useState } from 'react'
import MetricInfoTip from '@/components/MetricInfoTip'

const DATE_BASIS_OPTIONS = [
  { key: 'created', label: 'Datum vytvoření' },
  { key: 'navolani', label: 'Datum navolání' },
  { key: 'zamereni', label: 'Datum zaměření' }
]

const PERIOD_OPTIONS = [
  { key: 'week', label: 'Týden' },
  { key: 'month', label: 'Měsíc (od 1. do dnes)' },
  { key: 'ytd', label: 'Rok' }
]

function formatFilterDay(value) {
  if (!value) return ''
  const [year, month, day] = String(value).split('-').map(Number)
  if (!year || !month || !day) return value
  return new Date(year, month - 1, day).toLocaleDateString('cs-CZ', {
    day: 'numeric',
    month: 'numeric'
  })
}

export default function FilterAssistant({
  period,
  onPeriodChange,
  dateBasis = 'navolani',
  onDateBasisChange,
  startDate = '',
  endDate = '',
  onStartDateChange,
  onEndDateChange,
  region = '',
  onRegionChange,
  regions = [],
  hideDateBasis = false,
  metricHelpId = ''
}) {
  const [isOpen, setIsOpen] = useState(false)

  useEffect(() => {
    function handleEscape(event) {
      if (event.key === 'Escape') setIsOpen(false)
    }

    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [])

  const activeSummary = useMemo(() => {
    const activeDateBasis = DATE_BASIS_OPTIONS.find((item) => item.key === dateBasis)?.label || 'Datum navolání'
    const activePeriod =
      startDate && endDate
        ? `${formatFilterDay(startDate)} – ${formatFilterDay(endDate)}`
        : period === 'custom'
          ? `${startDate || 'Od'} - ${endDate || 'Do'}`
          : PERIOD_OPTIONS.find((item) => item.key === period)?.label || 'Měsíc'

    const parts = []
    if (!hideDateBasis) parts.push(activeDateBasis)
    parts.push(activePeriod)
    if (region) parts.push(region)
    return parts.join(' • ')
  }, [dateBasis, period, startDate, endDate, region, hideDateBasis])

  return (
    <>
      {isOpen ? <button className="filter-assistant-backdrop" onClick={() => setIsOpen(false)} aria-label="Zavřít filtr" /> : null}

      <div className="filter-assistant">
        {isOpen ? (
          <section className="filter-assistant-panel">
            <div className="filter-assistant-header">
              <div>
                <p className="filter-assistant-kicker">Filtrovací asistent</p>
                <h2>Vyberte čas a rozsah</h2>
              </div>
              <button
                type="button"
                className="filter-assistant-close"
                onClick={() => setIsOpen(false)}
                aria-label="Zavřít"
              >
                ×
              </button>
            </div>

            <p className="filter-assistant-summary">{activeSummary}</p>

            {!hideDateBasis ? (
              <div className="filter-assistant-section">
                <h3>Časová osa</h3>
                <div className="period-group">
                  {DATE_BASIS_OPTIONS.map((item) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => onDateBasisChange && onDateBasisChange(item.key)}
                      className={`period-button ${dateBasis === item.key ? 'active' : ''}`}
                    >
                      {item.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="filter-assistant-section">
              <h3>Rychlé období</h3>
              <div className="period-group">
                {PERIOD_OPTIONS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onPeriodChange(item.key)}
                    className={`period-button ${period === item.key ? 'active' : ''}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="filter-assistant-section">
              <h3>Vlastní datum</h3>
              <div className="date-range">
                <label>
                  Od:
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => {
                      onStartDateChange && onStartDateChange(event.target.value)
                      onPeriodChange('custom')
                    }}
                    className="region-select"
                  />
                </label>
                <label>
                  Do:
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => {
                      onEndDateChange && onEndDateChange(event.target.value)
                      onPeriodChange('custom')
                    }}
                    className="region-select"
                  />
                </label>
              </div>
            </div>

            {onRegionChange ? (
              <div className="filter-assistant-section">
                <h3>Kraj</h3>
                <label>
                  Výběr kraje:
                  <select
                    value={region}
                    onChange={(event) => onRegionChange(event.target.value)}
                    className="region-select"
                  >
                    <option value="">Všechny kraje</option>
                    {regions.map((item) => (
                      <option key={item} value={item}>
                        {item}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
            ) : null}
          </section>
        ) : null}

        <button
          type="button"
          className="filter-assistant-trigger"
          onClick={() => setIsOpen((value) => !value)}
          aria-label="Otevřít filtrovacího asistenta"
        >
          <span className="filter-assistant-trigger-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" role="img">
              <path d="M12 3a3 3 0 0 0-3 3v.35A7 7 0 0 0 5 12c0 1.77.66 3.39 1.75 4.62L6 21l4.63-.74A7 7 0 0 0 12 20a7 7 0 1 0 0-14Zm-3.5 8.75a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5Zm3.5 0a1.25 1.25 0 1 1 0-2.5 1.25 1.25 0 0 1 0 2.5ZM11 6a1 1 0 1 1 2 0v.3c-.33-.04-.66-.05-1-.05s-.67.01-1 .05V6Z" />
            </svg>
          </span>
          <span className="filter-assistant-trigger-text">
            <strong>
              Filtry
              {metricHelpId ? <MetricInfoTip helpId={metricHelpId} label="Popis období filtru" /> : null}
            </strong>
            <span>{activeSummary}</span>
          </span>
        </button>
      </div>
    </>
  )
}
