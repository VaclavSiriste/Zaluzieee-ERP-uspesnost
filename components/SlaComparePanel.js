import { useEffect, useState } from 'react'
import { SYSTEEEM_ORDER_URL } from '@/lib/metrics-query'

function pct(part, total) {
  if (!total) return '—'
  return `${((part / total) * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

function hours(value) {
  if (value == null) return '—'
  return `${Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} h`
}

function dateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function diffPp(oldPart, newPart, total) {
  if (!total) return '—'
  const diff = ((newPart - oldPart) / total) * 100
  const sign = diff > 0 ? '+' : ''
  return `${sign}${diff.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} p. b.`
}

/**
 * SLA 24/48/72: stará metoda (first_iframe_change_at) vs. nová pole ze zadání
 * SLA reportingu (first_contact_at / first_response_minutes). Data si načítá sám.
 */
export default function SlaComparePanel({
  period,
  startDate = '',
  endDate = '',
  organizationId = null,
  expanded,
  onToggle
}) {
  const [onlyCovered, setOnlyCovered] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          period,
          onlyCovered: onlyCovered ? '1' : '0',
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {}),
          ...(organizationId != null ? { organizationId: String(organizationId) } : {})
        })
        const response = await fetch(`/api/vycet-sla-porovnani?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst porovnání')
          setData(null)
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [period, startDate, endDate, organizationId, onlyCovered])

  if (loading && !data) {
    return (
      <div className="sla-loading">
        <span className="pauses-spinner" />
        Počítám porovnání SLA metod…
      </div>
    )
  }

  if (error) {
    return (
      <section className="sla-error">
        <p className="danger">SLA – porovnání metod: {error}</p>
      </section>
    )
  }

  if (!data) return null

  const summary = data.summary
  const sla24 = summary.sla.find((row) => row.hours === 24)
  const missingColumns = Object.entries(data.columns)
    .filter(([, present]) => !present)
    .map(([name]) => name)

  return (
    <section className={`sla-block sla-block-nested${expanded ? ' is-expanded' : ''}`}>
      <h2 className="sla-block-title">SLA – porovnání metod</h2>
      <p className="sla-block-desc">
        Stejné poptávky jako Výčet SLA. Stará metoda: první změna v iframe (
        <code>first_iframe_change_at</code>). Nová: první kontakt ze zadání SLA reportingu (
        <code>first_contact_at</code>, <code>first_response_minutes</code>).
        {data.hasNew && summary.first_new_filled
          ? ` Nová pole vyplněna od ${dateTime(summary.first_new_filled)}.`
          : ''}
        {data.hasNew && missingColumns.length ? ` V DB chybí: ${missingColumns.join(', ')}.` : ''}
      </p>

      {!data.hasNew ? (
        <p className="sla-block-desc">
          V ERP databázi chybí nová SLA pole ({missingColumns.join(', ')}), není co porovnávat.
        </p>
      ) : (
        <>
          <button
            type="button"
            className={`sla-kpi-root${expanded ? ' is-open' : ''}`}
            onClick={onToggle}
            aria-expanded={expanded}
          >
            <span className="sla-kpi-label">SLA 24 · stará / nová</span>
            <strong className="sla-kpi-value">
              {pct(sla24.old, summary.total)} / {pct(sla24.new, summary.total)}
            </strong>
            <span className="sla-kpi-hint">
              {summary.total.toLocaleString('cs-CZ')} poptávek · jen stará {sla24.only_old} · jen nová{' '}
              {sla24.only_new} · medián rozdílu {hours(summary.median_diff_h)}
            </span>
            <span className="sla-kpi-root-toggle">{expanded ? 'Skrýt rozpad ▴' : 'Zobrazit rozpad ▾'}</span>
          </button>

          {expanded ? (
            <div className="sla-breakdown-stack" aria-label="Rozpad porovnání SLA">
              <label className="sla-block-desc">
                <input
                  type="checkbox"
                  checked={onlyCovered}
                  onChange={(event) => setOnlyCovered(event.target.checked)}
                />{' '}
                Jen objednávky od prvního vyplněného <code>first_contact_at</code> (starší nová pole
                nemají)
              </label>

              <div className="sla-kpi-breakdown" aria-label="Pokrytí dat">
                <article className="sla-kpi sla-kpi-child">
                  <span className="sla-kpi-label">Poptávky</span>
                  <strong className="sla-kpi-value">{summary.total.toLocaleString('cs-CZ')}</strong>
                  <span className="sla-kpi-hint">společná množina</span>
                </article>
                <article className="sla-kpi sla-kpi-child">
                  <span className="sla-kpi-label">Má starý kontakt</span>
                  <strong className="sla-kpi-value">{pct(summary.old_filled, summary.total)}</strong>
                  <span className="sla-kpi-hint">
                    {summary.old_filled.toLocaleString('cs-CZ')} · medián {hours(summary.old_median_h)}
                  </span>
                </article>
                <article className="sla-kpi sla-kpi-child">
                  <span className="sla-kpi-label">Má nový kontakt</span>
                  <strong className="sla-kpi-value">{pct(summary.new_filled, summary.total)}</strong>
                  <span className="sla-kpi-hint">
                    {summary.new_filled.toLocaleString('cs-CZ')} · medián {hours(summary.new_median_h)}
                  </span>
                </article>
                <article className="sla-kpi sla-kpi-child">
                  <span className="sla-kpi-label">Medián rozdílu</span>
                  <strong className="sla-kpi-value">{hours(summary.median_diff_h)}</strong>
                  <span className="sla-kpi-hint">
                    nový − starý · záporné: {summary.old_negative} / {summary.new_negative}
                  </span>
                </article>
              </div>

              <div className="drilldown-table-wrap">
                <table className="drilldown-table">
                  <thead>
                    <tr>
                      <th>SLA</th>
                      <th>Stará metoda</th>
                      <th>Nová metoda</th>
                      <th>Rozdíl</th>
                      <th>Obě splněno</th>
                      <th>Jen stará</th>
                      <th>Jen nová</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.sla.map((row) => (
                      <tr key={row.hours}>
                        <td>{row.hours} h</td>
                        <td>
                          {pct(row.old, summary.total)} <span className="drilldown-muted">({row.old})</span>
                        </td>
                        <td>
                          {pct(row.new, summary.total)} <span className="drilldown-muted">({row.new})</span>
                        </td>
                        <td>{diffPp(row.old, row.new, summary.total)}</td>
                        <td>{row.both}</td>
                        <td>{row.only_old}</td>
                        <td>{row.only_new}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {data.byType.length ? (
                <div className="drilldown-table-wrap">
                  <table className="drilldown-table">
                    <thead>
                      <tr>
                        <th>Typ prvního kontaktu</th>
                        <th>Poptávky</th>
                        <th>SLA 24 nová</th>
                        <th>SLA 24 stará</th>
                        <th>Medián (nová)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.byType.map((row) => (
                        <tr key={row.type}>
                          <td>{row.type}</td>
                          <td>{row.total}</td>
                          <td>{pct(row.new_sla24, row.total)}</td>
                          <td>{pct(row.old_sla24, row.total)}</td>
                          <td>{hours(row.new_median_h)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              <p className="sla-block-desc">
                Objednávky, kde se metody neshodnou na SLA 24 ({data.disagreements.length}
                {data.disagreements.length === 200 ? '+' : ''}), podle největšího rozdílu:
              </p>
              <div className="drilldown-table-wrap">
                <table className="drilldown-table">
                  <thead>
                    <tr>
                      <th>Objednávka</th>
                      <th>Vznik</th>
                      <th>Stav</th>
                      <th>Iframe (stará)</th>
                      <th>První kontakt (nová)</th>
                      <th>Typ</th>
                      <th>Stará</th>
                      <th>Nová</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.disagreements.map((row) => (
                      <tr key={row.order_id}>
                        <td>
                          <a
                            className="drilldown-detail-link"
                            href={`${SYSTEEEM_ORDER_URL}${row.order_id}`}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {row.order_id}
                          </a>
                        </td>
                        <td>{dateTime(row.created_at)}</td>
                        <td>{row.status || '—'}</td>
                        <td>{dateTime(row.old_at)}</td>
                        <td>{dateTime(row.new_at)}</td>
                        <td>{row.new_type || '—'}</td>
                        <td>{hours(row.old_h)}</td>
                        <td>{hours(row.new_h)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </>
      )}
    </section>
  )
}
