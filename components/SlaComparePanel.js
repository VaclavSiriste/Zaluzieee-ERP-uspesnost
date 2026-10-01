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

/** Důvod, proč se metody neshodnou na SLA 24 → { tone, label } pro štítek. */
function disagreementReason(row) {
  if (row.new_h == null) {
    return ['nedovolano', 'nedopadlo'].includes(row.status)
      ? { tone: 'missing', label: 'Nedovoláno – nová počítá až dovolání' }
      : { tone: 'missing', label: 'Nová nemá razítko' }
  }
  if (row.old_h == null) return { tone: 'new', label: 'Stará nemá změnu v iframe' }
  if (row.new_h > row.old_h) return { tone: 'late', label: `Nová o ${hours(row.new_h - row.old_h)} později` }
  return { tone: 'new', label: `Stará o ${hours(row.old_h - row.new_h)} později` }
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

  const main = summary.sla[0]
  const neither = Math.max(summary.total - main.both - main.only_old - main.only_new, 0)
  const segments = [
    {
      key: 'both',
      count: main.both,
      label: 'Shodně splněno',
      hint: 'obě metody: kontakt do 24 h'
    },
    {
      key: 'missing',
      count: main.only_old_missing,
      label: 'Nová nemá razítko',
      hint: 'stará splnila, nová kontakt nezná'
    },
    {
      key: 'late',
      count: main.only_old_late,
      label: 'Nová později',
      hint: 'obě mají kontakt, nová až po 24 h'
    },
    {
      key: 'new',
      count: main.only_new,
      label: 'Jen nová splnila',
      hint: 'nová vidí kontakt dřív než stará'
    },
    {
      key: 'none',
      count: neither,
      label: 'Nesplnila ani jedna',
      hint: 'zatím bez kontaktu nebo po 24 h'
    }
  ]

  return (
    <div className="sla-cmp" aria-label="Porovnání metod SLA">
      <div className="sla-cmp-head">
        <p className="sla-cmp-title">Porovnání metod měření SLA</p>
        <p className="sla-cmp-sub">
          Stejné poptávky jako SLA výše, změřené dvakrát. <strong>Stará</strong> = první změna
          v iframe operátora. <strong>Nová</strong> = první kontakt z historie hovorů (zadání SLA
          reportingu).
          {data.hasNew && summary.first_new_filled
            ? ` Nová data jsou od ${dateTime(summary.first_new_filled)}.`
            : ''}
        </p>
      </div>

      {!data.hasNew ? (
        <p className="sla-cmp-note">
          V ERP databázi chybí nová SLA pole ({missingColumns.join(', ')}), není co porovnávat.
        </p>
      ) : (
        <>
          <div className="sla-cmp-hero">
            <div className="sla-cmp-stat">
              <span className="sla-cmp-stat-label">SLA 24 · stará metoda</span>
              <strong className="sla-cmp-stat-value">{pct(main.old, summary.total)}</strong>
              <span className="sla-cmp-stat-hint">
                {main.old} z {summary.total} poptávek
              </span>
            </div>
            <div className="sla-cmp-stat">
              <span className="sla-cmp-stat-label">SLA 24 · nová metoda</span>
              <strong className="sla-cmp-stat-value">{pct(main.new, summary.total)}</strong>
              <span className="sla-cmp-stat-hint">
                {main.new} z {summary.total} poptávek
              </span>
            </div>
            <div className="sla-cmp-stat">
              <span className="sla-cmp-stat-label">Kde mají obě kontakt</span>
              <strong className="sla-cmp-stat-value">{hours(summary.median_diff_h)}</strong>
              <span className="sla-cmp-stat-hint">medián rozdílu nová − stará</span>
            </div>
          </div>

          <div className="sla-cmp-bar-wrap">
            <p className="sla-cmp-bar-caption">
              Všech {summary.total} poptávek podle toho, jak je vidí obě metody (SLA 24 h)
            </p>
            <div className="sla-cmp-bar" role="img" aria-label="Rozpad poptávek podle shody metod">
              {segments
                .filter((seg) => seg.count > 0)
                .map((seg) => (
                  <span
                    key={seg.key}
                    className={`sla-cmp-seg sla-cmp-tone-${seg.key}`}
                    style={{ flexGrow: seg.count }}
                    title={`${seg.label}: ${seg.count}`}
                  >
                    {seg.count}
                  </span>
                ))}
            </div>
            <ul className="sla-cmp-legend">
              {segments.map((seg) => (
                <li key={seg.key}>
                  <span className={`sla-cmp-dot sla-cmp-tone-${seg.key}`} aria-hidden="true" />
                  <span className="sla-cmp-legend-label">{seg.label}</span>
                  <span className="sla-cmp-legend-count">{seg.count}</span>
                  <span className="sla-cmp-legend-hint">{seg.hint}</span>
                </li>
              ))}
            </ul>
          </div>

          {visibleSla.length > 1 ? (
            <table className="sla-cmp-table">
              <thead>
                <tr>
                  <th>Limit</th>
                  <th>Stará</th>
                  <th>Nová</th>
                  <th>Rozdíl</th>
                  <th>Shodně</th>
                  <th>Nová nemá razítko</th>
                  <th>Nová později</th>
                  <th>Jen nová</th>
                </tr>
              </thead>
              <tbody>
                {visibleSla.map((row) => (
                  <tr key={row.hours}>
                    <td>{slaLabel(row)}</td>
                    <td>{pct(row.old, summary.total)}</td>
                    <td>{pct(row.new, summary.total)}</td>
                    <td>{diffPp(row.old, row.new, summary.total)}</td>
                    <td>{row.both}</td>
                    <td>{row.only_old_missing}</td>
                    <td>{row.only_old_late}</td>
                    <td>{row.only_new}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="sla-cmp-note">
              SLA 48 h a 72 h vychází v tomto období stejně jako 24 h, proto je nezobrazuju zvlášť.
            </p>
          )}

          {data.byType.length ? (
            <table className="sla-cmp-table">
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
          ) : null}

          {data.disagreements.length ? (
            <details className="sla-cmp-details">
              <summary>
                Objednávky, kde se metody neshodnou ({data.disagreements.length}
                {data.disagreements.length === 200 ? '+' : ''})
              </summary>
              <table className="sla-cmp-table">
                <thead>
                  <tr>
                    <th>Objednávka</th>
                    <th>Vznik</th>
                    <th>Stav</th>
                    <th>Do kontaktu · stará</th>
                    <th>Do kontaktu · nová</th>
                    {hasType ? <th>Typ</th> : null}
                    <th>Proč se liší</th>
                  </tr>
                </thead>
                <tbody>
                  {data.disagreements.map((row) => {
                    const reason = disagreementReason(row)
                    return (
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
                        <td>
                          <span className="sla-cmp-status">{row.status || '—'}</span>
                        </td>
                        <td>{hours(row.old_h)}</td>
                        <td>{hours(row.new_h)}</td>
                        {hasType ? <td>{row.new_type || '—'}</td> : null}
                        <td>
                          <span className={`sla-cmp-pill sla-cmp-tone-${reason.tone}`}>
                            {reason.label}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </details>
          ) : null}

          <label className="sla-cmp-toggle">
            <input
              type="checkbox"
              checked={onlyCovered}
              onChange={(event) => setOnlyCovered(event.target.checked)}
            />
            Počítat jen objednávky od chvíle, kdy se nová data začala plnit
          </label>
        </>
      )}
    </div>
  )
}
