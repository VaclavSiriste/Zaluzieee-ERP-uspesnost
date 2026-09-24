import DrilldownCount from '@/components/DrilldownCount'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

function formatPercent(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })} %`
}

function formatCount(value) {
  return Number(value || 0).toLocaleString('cs-CZ')
}

/**
 * Úspěšnost trasování = Naplánován termín zaměření ANO / Dopadl hovor ANO.
 * Samostatný panel (zaluzieee CZ · org 5).
 */
export default function CallSuccessTrasovaniPanel({
  metrics,
  expanded,
  onToggle,
  onOpenMetric,
  organizationId = 5,
  brandLabel = 'zaluzieee - CZ'
}) {
  if (!metrics) return null

  const pct = metrics.success_trasovani_pct
  const dopadlAno = Number(metrics.dopadl_hovor_ano) || 0
  const zamereniAno = Number(metrics.domluveno_zamereni_ano) || 0
  const operators = Array.isArray(metrics.by_operator)
    ? metrics.by_operator.filter(
        (row) =>
          (Number(row.dopadl_hovor_ano) || 0) > 0 ||
          (Number(row.domluveno_zamereni_ano) || 0) > 0
      )
    : []

  return (
    <section
      className={`sla-block sla-block-nested sla-block-navolani sla-block-trasovani${
        expanded ? ' is-expanded' : ''
      }`}
    >
      <h2 className="sla-block-title">
        Úspěšnost trasování
        <MetricInfoTip helpId="trasovani_uspesnost" />
      </h2>
      <p className="sla-block-desc">
        {expanded
          ? `ERP · organizace č. ${organizationId} (${brandLabel}). Naplánován termín zaměření ANO / Dopadl hovor ANO. Klikněte pro seznam zakázek.`
          : `Organizace č. ${organizationId} · termín zaměření ANO / dopadl hovor ANO · data z ERP.`}
      </p>

      <button
        type="button"
        className={`sla-kpi-root sla-kpi-root-navolani${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MetricLabel helpId="trasovani_uspesnost" className="sla-kpi-label">
          Úspěšnost trasování celkem
        </MetricLabel>
        <strong className="sla-kpi-value">{formatPercent(pct)}</strong>
        <span className="sla-kpi-hint">
          {`${formatCount(zamereniAno)} termín ANO / ${formatCount(dopadlAno)} dopadl ANO`}
        </span>
        <span className="sla-kpi-root-toggle">
          {expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}
        </span>
      </button>

      {expanded ? (
        <>
          <div className="sla-kpi-breakdown" aria-label="Rozpad úspěšnosti trasování">
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="navolani_zamereni_ano">Termín zaměření ANO</MetricLabel>
              {onOpenMetric ? (
                <DrilldownCount
                  count={zamereniAno}
                  className="sla-kpi-value"
                  title="Naplánován termín zaměření ANO"
                  onOpen={() =>
                    onOpenMetric(
                      'domluveno_zamereni_ano',
                      'Naplánován termín zaměření ANO'
                    )
                  }
                />
              ) : (
                <strong className="sla-kpi-value">{formatCount(zamereniAno)}</strong>
              )}
              <span className="sla-kpi-hint">Čitatel úspěšnosti trasování</span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="navolani_dopadl_ano">Dopadl hovor ANO</MetricLabel>
              {onOpenMetric ? (
                <DrilldownCount
                  count={dopadlAno}
                  className="sla-kpi-value"
                  title="Dopadl hovor ANO"
                  onOpen={() => onOpenMetric('dopadl_hovor_ano', 'Dopadl hovor ANO')}
                />
              ) : (
                <strong className="sla-kpi-value">{formatCount(dopadlAno)}</strong>
              )}
              <span className="sla-kpi-hint">Jmenovatel úspěšnosti trasování</span>
            </article>
          </div>

          {operators.length ? (
            <div className="navolani-operator-breakdown" aria-label="Trasování podle operátorů">
              <h3 className="navolani-operator-title">
                Podle operátora
                <MetricInfoTip helpId="trasovani_operator" />
              </h3>
              <div className="navolani-operator-list">
                {operators.map((row) => (
                  <article key={row.operator_name} className="navolani-operator-row">
                    <strong className="navolani-operator-name">{row.operator_name}</strong>
                    <div className="navolani-operator-metrics">
                      <span className="navolani-operator-pct-wrap">
                        {formatPercent(row.success_trasovani_pct)}
                        <MetricInfoTip helpId="trasovani_operator" />
                      </span>
                      <DrilldownCount
                        count={row.domluveno_zamereni_ano}
                        className="navolani-operator-count"
                        title={`${row.operator_name} — termín zaměření ANO`}
                        onOpen={() =>
                          onOpenMetric?.(
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
                          onOpenMetric?.(
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
