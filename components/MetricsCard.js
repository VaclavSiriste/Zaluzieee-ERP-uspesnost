export default function MetricsCard({ label, value, unit, trend, onClick, clickable }) {
  const trendClass = trend === 0 ? 'neutral' : trend > 0 ? 'up' : 'down'
  const numericValue = typeof value === 'number' ? value : Number(String(value).replace(/\s/g, ''))
  const isClickable = clickable !== false && typeof onClick === 'function' && numericValue > 0

  function handleKeyDown(event) {
    if (!isClickable) return
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      onClick()
    }
  }

  return (
    <article
      className={`metric-card${isClickable ? ' metric-card-clickable' : ''}`}
      onClick={isClickable ? onClick : undefined}
      onKeyDown={handleKeyDown}
      role={isClickable ? 'button' : undefined}
      tabIndex={isClickable ? 0 : undefined}
      title={isClickable ? 'Kliknutím zobrazíte seznam zakázek' : undefined}
    >
      <span className="metric-label">{label}</span>
      <div className="metric-value-row">
        <span className="metric-value">
          {typeof value === 'number' ? value.toLocaleString('cs-CZ') : value}
        </span>
        {unit ? <span className="metric-unit">{unit}</span> : null}
      </div>
      {typeof trend === 'number' ? (
        <span className={`metric-trend ${trendClass}`}>
          {trend > 0 ? '+' : ''}
          {trend}%
        </span>
      ) : null}
    </article>
  )
}
