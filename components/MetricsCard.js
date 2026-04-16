export default function MetricsCard({ label, value, unit, trend }) {
  const trendClass = trend === 0 ? 'neutral' : trend > 0 ? 'up' : 'down'

  return (
    <article className="metric-card">
      <span className="metric-label">{label}</span>
      <div className="metric-value-row">
        <span className="metric-value">{value}</span>
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
