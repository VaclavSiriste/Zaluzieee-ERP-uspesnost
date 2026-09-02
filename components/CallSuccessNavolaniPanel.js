import DrilldownCount from '@/components/DrilldownCount'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} %`
}

function buildBreakdownItems(metrics) {
  return [
    {
      metric: 'domluveno_zamereni_ano',
      title: 'Naplánován termín zaměření ANO',
      label: 'Termín zaměření ANO',
      helpId: 'navolani_zamereni_ano',
      count: metrics.domluveno_zamereni_ano
    },
    {
      metric: 'dopadl_hovor_ano',
      title: 'Dopadl hovor ANO',
      label: 'Dopadl hovor ANO',
      helpId: 'navolani_dopadl_ano',
      count: metrics.dopadl_hovor_ano,
      hint: 'Jmenovatel úspěšnosti'
    },
    {
      metric: 'domluveno_zamereni_ne',
      title: 'Naplánován termín zaměření NE',
      label: 'Termín zaměření NE',
      helpId: 'navolani_zamereni_ne',
      count: metrics.domluveno_zamereni_ne
    },
    {
      metric: 'dopadl_hovor_ne',
      title: 'Dopadl hovor NE',
      label: 'Dopadl hovor NE',
      helpId: 'navolani_dopadl_ne',
      count: metrics.dopadl_hovor_ne
    }
  ]
}

export default function CallSuccessNavolaniPanel({
  metrics,
  expanded,
  onToggle,
  onOpenMetric,
  navolaniHint = 'ERP · termín zaměření ANO / dopadl hovor ANO',
  organizationId = null
}) {
  if (!metrics) return null

  const breakdownItems = buildBreakdownItems(metrics)
  const pct = metrics.success_navolani_pct

  return (
    <section className={`sla-block sla-block-nested sla-block-navolani${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">
        Úspěšnost navolání
        <MetricInfoTip helpId="navolani_celkem" />
      </h2>
      <p className="sla-block-desc">
        {expanded
          ? `${navolaniHint}. Klikněte pro seznam zakázek.`
          : organizationId != null
            ? `Organizace č. ${organizationId} · klikněte pro rozpad — data z ERP, ne z Daktely.`
            : 'Klikněte pro rozpad — data z ERP, ne z Daktely.'}
      </p>

      <button
        type="button"
        className={`sla-kpi-root sla-kpi-root-navolani${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MetricLabel helpId="navolani_celkem" className="sla-kpi-label">
          Úspěšnost navolání celkem
        </MetricLabel>
        <strong className="sla-kpi-value">{formatPercent(pct)}</strong>
        <span className="sla-kpi-hint">
          {metrics.domluveno_zamereni_ano.toLocaleString('cs-CZ')} termín ANO /{' '}
          {metrics.dopadl_hovor_ano.toLocaleString('cs-CZ')} dopadl hovor ANO
        </span>
        <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
      </button>

      {expanded ? (
        <>
          <div className="sla-kpi-breakdown" aria-label="Rozpad úspěšnosti navolání">
            {breakdownItems.map((item) => (
              <article key={item.metric} className="sla-kpi sla-kpi-child">
                <MetricLabel helpId={item.helpId}>{item.label}</MetricLabel>
                <DrilldownCount
                  count={item.count}
                  className="sla-kpi-value"
                  title={`Kliknutím zobrazíte záznamy: ${item.title}`}
                  onOpen={() => onOpenMetric(item.metric, item.title)}
                />
                {item.hint ? <span className="sla-kpi-hint">{item.hint}</span> : null}
              </article>
            ))}
          </div>

          {metrics.by_operator?.length ? (
            <div className="navolani-operator-breakdown" aria-label="Rozpad podle operátorů">
              <h3 className="navolani-operator-title">
                Podle operátora
                <MetricInfoTip helpId="navolani_operator" />
              </h3>
              <div className="navolani-operator-list">
                {metrics.by_operator.map((row) => (
                  <article key={row.operator_name} className="navolani-operator-row">
                    <strong className="navolani-operator-name">{row.operator_name}</strong>
                    <div className="navolani-operator-metrics">
                      <span className="navolani-operator-pct-wrap">
                        {formatPercent(row.success_navolani_pct)}
                        <MetricInfoTip helpId="navolani_operator" />
                      </span>
                      <DrilldownCount
                        count={row.domluveno_zamereni_ano}
                        className="navolani-operator-count"
                        title={`${row.operator_name} — termín zaměření ANO`}
                        onOpen={() =>
                          onOpenMetric(
                            'domluveno_zamereni_ano',
                            `${row.operator_name} — termín zaměření ANO`,
                            row.operator_name
                          )
                        }
                      />
                      <span className="navolani-operator-sep">/</span>
                      <DrilldownCount
                        count={row.dopadl_hovor_ano}
                        className="navolani-operator-count"
                        title={`${row.operator_name} — dopadl hovor ANO`}
                        onOpen={() =>
                          onOpenMetric(
                            'dopadl_hovor_ano',
                            `${row.operator_name} — dopadl hovor ANO`,
                            row.operator_name
                          )
                        }
                      />
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  )
}
