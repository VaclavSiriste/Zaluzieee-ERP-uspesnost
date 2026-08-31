import DrilldownCount from '@/components/DrilldownCount'

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
      count: metrics.domluveno_zamereni_ano
    },
    {
      metric: 'dopadl_hovor_ano',
      title: 'Dopadl hovor ANO',
      label: 'Dopadl hovor ANO',
      count: metrics.dopadl_hovor_ano,
      hint: 'Jmenovatel úspěšnosti'
    },
    {
      metric: 'domluveno_zamereni_ne',
      title: 'Naplánován termín zaměření NE',
      label: 'Termín zaměření NE',
      count: metrics.domluveno_zamereni_ne
    },
    {
      metric: 'dopadl_hovor_ne',
      title: 'Dopadl hovor NE',
      label: 'Dopadl hovor NE',
      count: metrics.dopadl_hovor_ne
    }
  ]
}

export default function CallSuccessNavolaniPanel({ metrics, expanded, onToggle, onOpenMetric }) {
  if (!metrics) return null

  const breakdownItems = buildBreakdownItems(metrics)
  const pct = metrics.success_navolani_pct

  return (
    <section className={`sla-block sla-block-nested sla-block-navolani${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">Úspěšnost navolání</h2>
      <p className="sla-block-desc">
        {expanded
          ? 'ERP · Naplánován termín zaměření ANO ku Dopadl hovor ANO. Klikněte pro seznam zakázek.'
          : 'Klikněte pro rozpad — data z ERP, ne z Daktely.'}
      </p>

      <button
        type="button"
        className={`sla-kpi-root sla-kpi-root-navolani${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className="sla-kpi-label">Úspěšnost navolání celkem</span>
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
                <span className="sla-kpi-label">{item.label}</span>
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
              <h3 className="navolani-operator-title">Podle operátora</h3>
              <div className="navolani-operator-list">
                {metrics.by_operator.map((row) => (
                  <article key={row.operator_name} className="navolani-operator-row">
                    <strong className="navolani-operator-name">{row.operator_name}</strong>
                    <div className="navolani-operator-metrics">
                      <span>{formatPercent(row.success_navolani_pct)}</span>
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
