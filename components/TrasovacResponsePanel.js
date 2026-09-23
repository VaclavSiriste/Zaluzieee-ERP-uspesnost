import DrilldownCount from '@/components/DrilldownCount'
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
  onOpenMetric,
  brandLabel = 'zaluzieee - CZ',
  organizationId = null
}) {
  if (!metrics) return null

  const grace = metrics.grace_minutes || 15
  const duvodBreakdown = Array.isArray(metrics.duvod_breakdown) ? metrics.duvod_breakdown : []
  const orgHint =
    organizationId != null
      ? `ERP · organizace č. ${organizationId} (${brandLabel})`
      : `ERP · ${brandLabel}`

  function openMetric(metric, title, duvodReason = null) {
    if (typeof onOpenMetric === 'function') onOpenMetric(metric, title, duvodReason)
  }

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
        {grace} min po vstupu do stavu). Klikněte na číslo pro seznam leadů.
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
        <DrilldownCount
          count={metrics.with_response}
          text={formatHours(metrics.avg_hours)}
          className="sla-kpi-value"
          title="Kliknutím zobrazíte leady s reakcí (vstup + první změna)"
          onOpen={() => openMetric('with_response', 'Leady s reakcí trasovače')}
        />
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
        <>
          <div className="sla-kpi-breakdown" aria-label="Rozpad fronty trasovačů">
            <article className="sla-kpi sla-kpi-child sla-kpi-accent">
              <MetricLabel helpId="trasovac_waiting">Čeká na trasovače</MetricLabel>
              <DrilldownCount
                count={metrics.waiting_now}
                className="sla-kpi-value"
                title="Aktuální fronta — kliknutím seznam"
                onOpen={() => openMetric('waiting', 'Čeká na trasovače (aktuálně)')}
              />
              <span className="sla-kpi-hint">aktuální stav · snapshot</span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="trasovac_avg">Průměr</MetricLabel>
              <DrilldownCount
                count={metrics.with_response}
                text={formatHours(metrics.avg_hours)}
                className="sla-kpi-value"
                title="Leady s reakcí — vstup a čas první změny"
                onOpen={() => openMetric('avg', 'Průměr — leady s reakcí')}
              />
              <span className="sla-kpi-hint">
                vstup → první změna v logu (≥ {grace} min)
              </span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="trasovac_median">Medián</MetricLabel>
              <DrilldownCount
                count={metrics.with_response}
                text={formatHours(metrics.median_hours)}
                className="sla-kpi-value"
                title="Leady s reakcí — vstup a čas první změny"
                onOpen={() => openMetric('median', 'Medián — leady s reakcí')}
              />
              <span className="sla-kpi-hint">
                {formatNumber(metrics.with_response)} leadů s reakcí ve filtru
              </span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <span className="sla-kpi-label">Vešlo do fronty</span>
              <DrilldownCount
                count={metrics.entered_in_period}
                className="sla-kpi-value"
                title="Všechny vstupy do stavu ve filtru"
                onOpen={() => openMetric('entered', 'Vešlo do fronty')}
              />
              <span className="sla-kpi-hint">status → čeká na trasovače · období filtru</span>
            </article>
          </div>

          {duvodBreakdown.length > 0 ? (
            <div
              className="sla-kpi-breakdown"
              aria-label="Rozpad Důvod ne — aktuální fronta"
              style={{ marginTop: '0.75rem' }}
            >
              <article className="sla-kpi sla-kpi-child" style={{ gridColumn: '1 / -1' }}>
                <MetricLabel helpId="trasovac_duvod">Důvod ne · aktuální fronta</MetricLabel>
                <span className="sla-kpi-hint">
                  ERP sloupec „Důvod ne“ (proc_nedopadl_hovor) u leadů ve stavu Čeká na trasovače
                </span>
              </article>
              {duvodBreakdown.map((item) => (
                <article key={item.key} className="sla-kpi sla-kpi-child">
                  <span className="sla-kpi-label">{item.label}</span>
                  <DrilldownCount
                    count={item.count}
                    className="sla-kpi-value"
                    title={`${item.label} — kliknutím seznam`}
                    onOpen={() =>
                      openMetric('waiting', `Čeká na trasovače · ${item.label}`, item.key)
                    }
                  />
                </article>
              ))}
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
