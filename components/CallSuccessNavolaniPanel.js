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
      metric: 'dopadl_hovor_ano',
      title: 'Dopadl hovor ANO',
      label: 'Dopadl hovor ANO',
      helpId: 'navolani_dopadl_ano',
      count: metrics.dopadl_hovor_ano,
      hint: 'Čitatel úspěšnosti'
    },
    {
      metric: 'dopadl_hovor_ne',
      title: 'Dopadl hovor NE',
      label: 'Dopadl hovor NE',
      helpId: 'navolani_dopadl_ne',
      count: metrics.dopadl_hovor_ne,
      hint: 'Součást jmenovatele'
    },
    {
      metric: 'dopadl_hovor_pocet',
      title: 'Dopadl hovor ANO + NE',
      label: 'Celkem ANO + NE',
      helpId: 'navolani_celkem',
      count: metrics.dopadl_hovor_pocet,
      hint: 'Jmenovatel úspěšnosti'
    },
    {
      metric: 'domluveno_zamereni_ano',
      title: 'Naplánován termín zaměření ANO',
      label: 'Termín zaměření ANO',
      helpId: 'navolani_zamereni_ano',
      count: metrics.domluveno_zamereni_ano
    },
    {
      metric: 'domluveno_zamereni_ne',
      title: 'Naplánován termín zaměření NE',
      label: 'Termín zaměření NE',
      helpId: 'navolani_zamereni_ne',
      count: metrics.domluveno_zamereni_ne
    }
  ]
}

export default function CallSuccessNavolaniPanel({
  metrics,
  expanded,
  onToggle,
  onOpenMetric,
  navolaniHint = 'ERP · Dopadl hovor ANO / (ANO + NE)',
  organizationId = null,
  source = 'erp-db'
}) {
  if (!metrics) return null

  const fromSheet =
    source === 'pokladamee-ovt-sheet' ||
    source === 'malujemeee-ovt-sheet' ||
    metrics.source === 'pokladamee-ovt-sheet' ||
    metrics.source === 'malujemeee-ovt-sheet'
  const breakdownItems = fromSheet
    ? [
        {
          metric: 'dopadl_hovor_ano',
          title: 'Dopadl hovor ANO',
          label: 'Dopadl hovor ANO',
          helpId: 'navolani_dopadl_ano',
          count: metrics.dopadl_hovor_ano,
          hint: 'Čitatel úspěšnosti (sloupec L)'
        },
        {
          metric: 'dopadl_hovor_pocet',
          title: 'Dopadl hovor ANO + NE',
          label: 'Celkem ANO + NE',
          helpId: 'navolani_celkem',
          count: metrics.dopadl_hovor_pocet,
          hint: 'Jmenovatel · pouze ANO a NE ve sloupci L (bez vyloučených N)'
        }
      ]
    : buildBreakdownItems(metrics)
  const pct = metrics.success_navolani_pct

  return (
    <section className={`sla-block sla-block-nested sla-block-navolani${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">
        Úspěšnost navolání
        <MetricInfoTip helpId="navolani_celkem" />
      </h2>
      <p className="sla-block-desc">
        {expanded
          ? `${navolaniHint}${fromSheet ? '' : '. Klikněte pro seznam zakázek.'}`
          : fromSheet
            ? 'Google Sheet OVT · klikněte pro rozpad — Dopadl hovor ANO / (ANO + NE).'
            : organizationId != null
              ? `Organizace č. ${organizationId} · Dopadl hovor ANO / (ANO + NE) · data z ERP.`
              : 'Klikněte pro rozpad — Dopadl hovor ANO / (ANO + NE) · data z ERP.'}
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
          {`${Number(metrics.dopadl_hovor_ano || 0).toLocaleString('cs-CZ')} ANO / ${Number(metrics.dopadl_hovor_pocet || 0).toLocaleString('cs-CZ')} (ANO + NE)`}
        </span>
        <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
      </button>

      {expanded ? (
        <>
          <div className="sla-kpi-breakdown" aria-label="Rozpad úspěšnosti navolání">
            {breakdownItems.map((item) => (
              <article key={item.metric} className="sla-kpi sla-kpi-child">
                <MetricLabel helpId={item.helpId}>{item.label}</MetricLabel>
                {fromSheet || !onOpenMetric ? (
                  <strong className="sla-kpi-value">
                    {Number(item.count || 0).toLocaleString('cs-CZ')}
                  </strong>
                ) : (
                  <DrilldownCount
                    count={item.count}
                    className="sla-kpi-value"
                    title={`Kliknutím zobrazíte záznamy: ${item.title}`}
                    onOpen={() => onOpenMetric(item.metric, item.title)}
                  />
                )}
                {item.hint ? <span className="sla-kpi-hint">{item.hint}</span> : null}
              </article>
            ))}
          </div>

          {!fromSheet && metrics.by_operator?.length ? (
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
                      <span className="navolani-operator-sep">/</span>
                      <DrilldownCount
                        count={row.dopadl_hovor_pocet}
                        className="navolani-operator-count"
                        title={`${row.operator_name} — dopadl hovor ANO + NE`}
                        onOpen={() =>
                          onOpenMetric(
                            'dopadl_hovor_pocet',
                            `${row.operator_name} — dopadl hovor ANO + NE`,
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
