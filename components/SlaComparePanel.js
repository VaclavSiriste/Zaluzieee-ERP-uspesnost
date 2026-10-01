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

function sameCounts(a, b) {
  return ['old', 'new', 'both', 'only_old_missing', 'only_old_late', 'only_new'].every(
    (key) => a[key] === b[key]
  )
}

function slaLabel(row) {
  return row.mergedUpTo ? `${row.hours}–${row.mergedUpTo} h` : `${row.hours} h`
}

/** Důvod, proč se metody neshodnou na SLA 24 (řádek seznamu rozdílů). */
function disagreementReason(row) {
  if (row.new_h == null) {
    return ['nedovolano', 'nedopadlo'].includes(row.status)
      ? 'Nedovoláno — nová metoda počítá kontakt až po dovolání'
      : 'Nová nemá razítko — hovor nespárovaný s objednávkou nebo zpožděný sync'
  }
  if (row.old_h == null) return 'Stará nemá změnu v iframe'
  if (row.new_h > row.old_h) return `Nová o ${hours(row.new_h - row.old_h)} později`
  return `Stará o ${hours(row.old_h - row.new_h)} později`
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
 * Vkládá se do rozbaleného rozpadu VycetSlaPanel.
 */
export default function SlaComparePanel({
  period,
  startDate = '',
  endDate = '',
  organizationId = null
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
      <p className="danger">Porovnání metod: {error}</p>
    )
  }

  if (!data) return null

  const summary = data.summary
  const hasType = data.columns.first_contact_type
  // 48/72 h shodné s 24 h (typicky krátké období) → jeden řádek místo tří stejných
  const visibleSla = summary.sla.every((row) => sameCounts(row, summary.sla[0]))
    ? [{ ...summary.sla[0], mergedUpTo: summary.sla[summary.sla.length - 1].hours }]
    : summary.sla
  const missingColumns = Object.entries(data.columns)
    .filter(([, present]) => !present)
    .map(([name]) => name)

  return (
    <div className="sla-breakdown-stack" aria-label="Porovnání metod SLA">
      <p className="sla-queue-breakdown-title">Porovnání metod · stará (iframe) vs. nová (první kontakt)</p>
      <p className="sla-block-desc">
        Stejné poptávky jako SLA 24 / 48 / 72 výše. Stará metoda: první změna v iframe (
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

          <ul className="sla-block-desc">
            <li>
              <strong>Splněno – stará / nová:</strong> kolik z {summary.total.toLocaleString('cs-CZ')}{' '}
              poptávek mělo první kontakt do daného limitu podle každé metody.
            </li>
            <li>
              <strong>Shodně splněno:</strong> SLA splnily obě metody — tady se metody shodují.
            </li>
            <li>
              <strong>Nová nemá razítko:</strong> stará SLA splnila, nová pro objednávku nemá žádný
              první kontakt (nedovoláno, nespárovaný hovor, zpožděný sync).
            </li>
            <li>
              <strong>Nová později:</strong> obě mají kontakt, ale podle nové přišel až po limitu.
            </li>
            <li>
              <strong>Jen nová splnila:</strong> opačný případ — nová metoda vidí kontakt dřív než
              stará.
            </li>
          </ul>

          <div className="drilldown-table-wrap">
            <table className="drilldown-table">
              <thead>
                <tr>
                  <th>Limit</th>
                  <th>Splněno – stará</th>
                  <th>Splněno – nová</th>
                  <th>Rozdíl</th>
                  <th>Shodně splněno</th>
                  <th>Nová nemá razítko</th>
                  <th>Nová později</th>
                  <th>Jen nová splnila</th>
                </tr>
              </thead>
              <tbody>
                {visibleSla.map((row) => (
                  <tr key={row.hours}>
                    <td>{slaLabel(row)}</td>
                    <td>
                      {pct(row.old, summary.total)} <span className="drilldown-muted">({row.old})</span>
                    </td>
                    <td>
                      {pct(row.new, summary.total)} <span className="drilldown-muted">({row.new})</span>
                    </td>
                    <td>{diffPp(row.old, row.new, summary.total)}</td>
                    <td>{row.both}</td>
                    <td>{row.only_old_missing}</td>
                    <td>{row.only_old_late}</td>
                    <td>{row.only_new}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {visibleSla.length < summary.sla.length ? (
            <p className="drilldown-muted">
              48 h a 72 h vychází zatím stejně jako 24 h (žádná poptávka v období není kontaktovaná
              později než za 24 h), proto jsou sloučené do jednoho řádku.
            </p>
          ) : null}

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
            <strong>
              Objednávky, kde se metody neshodnou na SLA 24 ({data.disagreements.length}
              {data.disagreements.length === 200 ? '+' : ''})
            </strong>
            . „Hodin do kontaktu“ = doba od vzniku poptávky do prvního kontaktu podle dané metody,
            pomlčka = metoda kontakt nemá. Seřazeno od největšího rozdílu.
          </p>
          <div className="drilldown-table-wrap">
            <table className="drilldown-table">
              <thead>
                <tr>
                  <th>Objednávka</th>
                  <th>Vznik</th>
                  <th>Stav</th>
                  <th>Kontakt – stará (iframe)</th>
                  <th>Kontakt – nová</th>
                  {hasType ? <th>Typ kontaktu</th> : null}
                  <th>Hodin do kontaktu – stará</th>
                  <th>Hodin do kontaktu – nová</th>
                  <th>Proč se liší</th>
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
                    {hasType ? <td>{row.new_type || '—'}</td> : null}
                    <td>{hours(row.old_h)}</td>
                    <td>{hours(row.new_h)}</td>
                    <td>{disagreementReason(row)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
