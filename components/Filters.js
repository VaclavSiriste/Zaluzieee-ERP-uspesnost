/**
 * Komponenta pro filtrování a segmentaci
 */

export default function Filters({
  period,
  onPeriodChange,
  dateBasis = 'navolani',
  onDateBasisChange,
  filters,
  onFiltersChange,
  regions = []
}) {
  const handleFilterChange = (key, value) => {
    onFiltersChange({
      ...filters,
      [key]: value
    })
  }

  return (
    <section className="filters">
      <div>
        <h3>Casove obdobi</h3>
        <div className="period-group">
          {[
            { key: 'created', label: 'Datum vytvoreni' },
            { key: 'navolani', label: 'Datum navolani' },
            { key: 'zamereni', label: 'Datum zamereni' }
          ].map((item) => (
            <button
              key={item.key}
              onClick={() => onDateBasisChange && onDateBasisChange(item.key)}
              className={`period-button ${dateBasis === item.key ? 'active' : ''}`}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="period-group">
          {['week', 'month', 'ytd'].map(p => (
            <button
              key={p}
              onClick={() => onPeriodChange(p)}
              className={`period-button ${period === p ? 'active' : ''}`}
            >
              {p === 'week' && 'Tyden'}
              {p === 'month' && 'Mesic'}
              {p === 'ytd' && 'YTD'}
            </button>
          ))}
        </div>
        <div className="date-range">
          <label>
            Od:
            <input
              type="date"
              value={filters.startDate || ''}
              onChange={(e) => {
                handleFilterChange('startDate', e.target.value)
                onPeriodChange('custom')
              }}
              className="region-select"
            />
          </label>
          <label>
            Do:
            <input
              type="date"
              value={filters.endDate || ''}
              onChange={(e) => {
                handleFilterChange('endDate', e.target.value)
                onPeriodChange('custom')
              }}
              className="region-select"
            />
          </label>
        </div>
      </div>

      <div>
        <h3>Filtrace</h3>
        <label>
          Kraj:
          <select
            value={filters.region || ''}
            onChange={(e) => handleFilterChange('region', e.target.value)}
            className="region-select"
          >
            <option value="">Vsechny kraje</option>
            {regions.map(region => (
              <option key={region} value={region}>{region}</option>
            ))}
          </select>
        </label>
      </div>
    </section>
  )
}
