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

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  })} %`
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
        Natrasování · SLA trasovačů
        <MetricInfoTip helpId="trasovac_sla12" />
      </h2>
      <p className="sla-block-desc">
        {orgHint}. SLA z doby nastavení stavu „Čeká na trasovače“ → první změna v logu (grace{' '}
        {grace} min). % = splněno / odbavené ve filtru. Klikněte na číslo pro seznam leadů.
      </p>

      <button
        type="button"
        className={`sla-kpi-root${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MetricLabel helpId="trasovac_sla12" className="sla-kpi-label">
          SLA 12
        </MetricLabel>
        <DrilldownCount
          count={metrics.sla12}
          text={formatPercent(metrics.sla12_pct)}
          className="sla-kpi-value"
          title="Odbaveno do 12 h — kliknutím seznam"
          onOpen={() => openMetric('sla12', 'SLA 12 h')}
        />
        <span className="sla-kpi-hint">
          {formatNumber(metrics.sla12)} / {formatNumber(metrics.with_response)} odbavených
          {' · '}
          SLA 24 {formatPercent(metrics.sla24_pct)}
          {' · '}
          SLA 36 {formatPercent(metrics.sla36_pct)}
          {' · '}
          průměr {formatHours(metrics.avg_hours)}
        </span>
        <span className="sla-kpi-root-toggle">
          {expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}
        </span>
      </button>

      {expanded ? (
        <>
          <div className="sla-kpi-breakdown" aria-label="SLA trasovačů">
            <article className="sla-kpi sla-kpi-child sla-kpi-accent">
              <MetricLabel helpId="trasovac_sla12">SLA 12</MetricLabel>
              <DrilldownCount
                count={metrics.sla12}
                className="sla-kpi-value"
                title="Odbaveno do 12 h"
                onOpen={() => openMetric('sla12', 'SLA 12 h')}
              />
              <DrilldownCount
                count={metrics.sla12}
                text={formatPercent(metrics.sla12_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 12"
                onOpen={() => openMetric('sla12', 'SLA 12 h')}
              />
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="trasovac_sla24">SLA 24</MetricLabel>
              <DrilldownCount
                count={metrics.sla24}
                className="sla-kpi-value"
                title="Odbaveno do 24 h"
                onOpen={() => openMetric('sla24', 'SLA 24 h')}
              />
              <DrilldownCount
                count={metrics.sla24}
                text={formatPercent(metrics.sla24_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 24"
                onOpen={() => openMetric('sla24', 'SLA 24 h')}
              />
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="trasovac_sla36">SLA 36</MetricLabel>
              <DrilldownCount
                count={metrics.sla36}
                className="sla-kpi-value"
                title="Odbaveno do 36 h"
                onOpen={() => openMetric('sla36', 'SLA 36 h')}
              />
              <DrilldownCount
                count={metrics.sla36}
                text={formatPercent(metrics.sla36_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 36"
                onOpen={() => openMetric('sla36', 'SLA 36 h')}
              />
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="trasovac_avg">Průměr / medián</MetricLabel>
              <DrilldownCount
                count={metrics.with_response}
                text={formatHours(metrics.avg_hours)}
                className="sla-kpi-value"
                title="Leady s reakcí"
                onOpen={() => openMetric('with_response', 'Leady s reakcí trasovače')}
              />
              <span className="sla-kpi-hint">medián {formatHours(metrics.median_hours)}</span>
            </article>
          </div>

          <div
            className="sla-kpi-breakdown"
            aria-label="Fronta a vstupy"
            style={{ marginTop: '0.75rem' }}
          >
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
              <span className="sla-kpi-label">Odbavené ve filtru</span>
              <DrilldownCount
                count={metrics.with_response}
                className="sla-kpi-value"
                title="S reakcí trasovače"
                onOpen={() => openMetric('with_response', 'Leady s reakcí trasovače')}
              />
              <span className="sla-kpi-hint">jmenovatel SLA %</span>
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
                  ERP sloupec „Důvod ne“ u leadů ve stavu Čeká na trasovače · bez filtru období
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
