import DrilldownCount from '@/components/DrilldownCount'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

function formatPercent(value) {
  return `${Number(value || 0).toLocaleString('cs-CZ', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4
  })} %`
}

export default function VycetSlaPanel({
  metrics,
  expanded,
  onToggle,
  onOpenMetric,
  organizationId = null,
  brandLabel = '',
  source = 'erp-db'
}) {
  if (!metrics) return null

  const isSheet = String(source || '').includes('ovt-sheet') || String(source || '').includes('sheet')
  const orgHint = isSheet
    ? `OVT sheet${brandLabel ? ` · ${brandLabel}` : ''} · A=ID · B=přijetí leadu · K=datum navolání`
    : organizationId != null
      ? `ERP · organization_id (company ID) č. ${organizationId}${brandLabel ? ` · ${brandLabel}` : ''}`
      : 'ERP · všechny organizace (bez filtru company ID)'

  return (
    <section className={`sla-block sla-block-nested sla-block-vycet-sla${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">
        Výčet SLA
        <MetricInfoTip helpId="vycet_sla_celkem" />
      </h2>
      <p className="sla-block-desc">
        {expanded
          ? isSheet
            ? `${orgHint}. Dnes = kalendářní den (Praha). Poptávky / SLA 24·48·72 dle filtru na datum přijetí (B).`
            : `${orgHint}. Business den 20:00–19:59 · kalendářní SLA 24 / 48 / 72 h. Klikněte na číslo pro seznam leadů.`
          : isSheet
            ? `${orgHint}. Přišlo dnes / navoláno a SLA 24·48·72 dle filtru období.`
            : `${orgHint}. Přišlo / navoláno a SLA 24·48·72 dle filtru období.`}
      </p>

      <button
        type="button"
        className={`sla-kpi-root${expanded ? ' is-open' : ''}`}
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <MetricLabel helpId="vycet_sla_celkem" className="sla-kpi-label">
          Splněno navolání (business den)
        </MetricLabel>
        <strong className="sla-kpi-value">{formatPercent(metrics.fulfilled_pct)}</strong>
        <span className="sla-kpi-hint">
          {Number(metrics.navolano || 0).toLocaleString('cs-CZ')} /{' '}
          {Number(metrics.leads || 0).toLocaleString('cs-CZ')} leadů
          {' · '}
          SLA 24 {formatPercent(metrics.sla24_pct)}
        </span>
        <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
      </button>

      {expanded ? (
        <div className="sla-breakdown-stack" aria-label="Rozpad Výčet SLA">
          <div className="sla-kpi-breakdown" aria-label="Business den — přišlo a navoláno">
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_leads">Přišlo leadů</MetricLabel>
              <DrilldownCount
                count={metrics.leads}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('leads', 'Přišlo leadů')}
              />
              <span className="sla-kpi-hint">{isSheet ? 'dnešek · B' : 'business den'}</span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_navolano">Dnes navoláno</MetricLabel>
              <DrilldownCount
                count={metrics.navolano}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('navolano', 'Dnes navoláno')}
              />
              <span className="sla-kpi-hint">{isSheet ? 'B dnes + K vyplněno' : 'stejný business den'}</span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_missing">Dnes chybí</MetricLabel>
              <DrilldownCount
                count={metrics.missing}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('missing', 'Dnes chybí')}
              />
              <span className="sla-kpi-hint">{isSheet ? 'B dnes · K prázdné' : 'přišlo − navoláno'}</span>
            </article>
            <article className="sla-kpi sla-kpi-child sla-kpi-accent">
              <MetricLabel helpId="vycet_sla_celkem">Splněno</MetricLabel>
              <DrilldownCount
                count={metrics.navolano}
                text={formatPercent(metrics.fulfilled_pct)}
                className="sla-kpi-value"
                title="Kliknutím zobrazíte navolané leady"
                onOpen={() => onOpenMetric('navolano', 'Splněno — navolané leady')}
              />
              <span className="sla-kpi-hint">
                {Number(metrics.navolano || 0).toLocaleString('cs-CZ')} /{' '}
                {Number(metrics.leads || 0).toLocaleString('cs-CZ')}
              </span>
            </article>
          </div>

          <div className="sla-kpi-breakdown" aria-label="Kalendářní den — poptávky a SLA">
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_poptavky">Poptávky</MetricLabel>
              <DrilldownCount
                count={metrics.poptavky}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('poptavky', 'Poptávky')}
              />
              <span className="sla-kpi-hint">{isSheet ? 'filtr · datum přijetí (B)' : 'kalendářní den · +2 h'}</span>
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_24">SLA 24</MetricLabel>
              <DrilldownCount
                count={metrics.sla24}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('sla24', 'SLA 24')}
              />
              <DrilldownCount
                count={metrics.sla24}
                text={formatPercent(metrics.sla24_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 24"
                onOpen={() => onOpenMetric('sla24', 'SLA 24 %')}
              />
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_48">SLA 48</MetricLabel>
              <DrilldownCount
                count={metrics.sla48}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('sla48', 'SLA 48')}
              />
              <DrilldownCount
                count={metrics.sla48}
                text={formatPercent(metrics.sla48_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 48"
                onOpen={() => onOpenMetric('sla48', 'SLA 48 %')}
              />
            </article>
            <article className="sla-kpi sla-kpi-child">
              <MetricLabel helpId="vycet_sla_72">SLA 72</MetricLabel>
              <DrilldownCount
                count={metrics.sla72}
                className="sla-kpi-value"
                onOpen={() => onOpenMetric('sla72', 'SLA 72')}
              />
              <DrilldownCount
                count={metrics.sla72}
                text={formatPercent(metrics.sla72_pct)}
                className="sla-kpi-sub"
                title="Procento SLA 72"
                onOpen={() => onOpenMetric('sla72', 'SLA 72 %')}
              />
            </article>
          </div>
        </div>
      ) : null}
    </section>
  )
}
