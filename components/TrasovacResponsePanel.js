import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

function formatHours(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const hours = Number(value)
  if (hours < 1) {
    const minutes = Math.round(hours * 60)
    return minutes > 0 ? `${minutes} min` : '< 1 min'
  }
  if (hours >= 48) {
    const days = Math.floor(hours / 24)
    const rest = Math.round(hours % 24)
    return rest > 0 ? `${days} d ${rest} h` : `${days} d`
  }
  return `${hours.toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} h`
}

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('cs-CZ')
}

export default function TrasovacResponsePanel({
  metrics,
  expanded,
  onToggle,
  brandLabel = 'zaluzieee - CZ',
  organizationId = null
}) {
  if (!metrics) return null

  const grace = metrics.grace_minutes || 15
  const orgHint =
    organizationId != null
      ? `ERP · organizace č. ${organizationId} (${brandLabel})`
      : `ERP · ${brandLabel}`

  return (
    <section
      className={`sla-block sla-block-nested sla-block-trasovac${expanded ? ' is-expanded' : ''}`}
    >
      <h2 className="sla-block-title">
        Natrasování · fronta trasovačů
        <MetricInfoTip helpId="trasovac_waiting" />
      </h2>
      <p className="sla-block-desc">
        {orgHint}. Aktuální počet ve stavu „Čeká na trasovače“ a doba do první změny v logu (grace{' '}
        {grace} min po vstupu do stavu).
      </p>

      <button
        type="button"
        className={`sla-kpi-root${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MetricLabel helpId="trasovac_avg" className="sla-kpi-label">
          Průměrná doba do reakce trasovače
        </MetricLabel>
        <strong className="sla-kpi-value">{formatHours(metrics.avg_hours)}</strong>
        <span className="sla-kpi-hint">
          medián {formatHours(metrics.median_hours)}
          {' · '}
          {formatNumber(metrics.with_response)} s reakcí z {formatNumber(metrics.entered_in_period)}{' '}
          ve filtru
          {' · '}
          teď ve frontě {formatNumber(metrics.waiting_now)}
        </span>
        <span className="sla-kpi-root-toggle">
          {expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}
        </span>
      </button>

      {expanded ? (
        <div className="sla-kpi-breakdown" aria-label="Rozpad fronty trasovačů">
          <article className="sla-kpi sla-kpi-child sla-kpi-accent">
            <MetricLabel helpId="trasovac_waiting">Čeká na trasovače</MetricLabel>
            <strong className="sla-kpi-value">{formatNumber(metrics.waiting_now)}</strong>
            <span className="sla-kpi-hint">aktuální stav · snapshot</span>
          </article>
          <article className="sla-kpi sla-kpi-child">
            <MetricLabel helpId="trasovac_avg">Průměr</MetricLabel>
            <strong className="sla-kpi-value">{formatHours(metrics.avg_hours)}</strong>
            <span className="sla-kpi-hint">
              vstup → první změna v logu (≥ {grace} min)
            </span>
          </article>
          <article className="sla-kpi sla-kpi-child">
            <MetricLabel helpId="trasovac_median">Medián</MetricLabel>
            <strong className="sla-kpi-value">{formatHours(metrics.median_hours)}</strong>
            <span className="sla-kpi-hint">
              {formatNumber(metrics.with_response)} leadů s reakcí ve filtru
            </span>
          </article>
          <article className="sla-kpi sla-kpi-child">
            <span className="sla-kpi-label">Vešlo do fronty</span>
            <strong className="sla-kpi-value">{formatNumber(metrics.entered_in_period)}</strong>
            <span className="sla-kpi-hint">status → čeká na trasovače · období filtru</span>
          </article>
        </div>
      ) : null}
    </section>
  )
}
