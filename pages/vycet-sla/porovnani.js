import { useEffect, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
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

export default function VycetSlaPorovnaniPage() {
  const [period, setPeriod] = useState('month')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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
          ...(endDate ? { endDate } : {})
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
  }, [period, startDate, endDate, onlyCovered])

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod !== 'custom') {
      setStartDate('')
      setEndDate('')
    }
  }

  const summary = data?.summary
  const missingColumns = data
    ? Object.entries(data.columns)
        .filter(([, present]) => !present)
        .map(([name]) => name)
    : []

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="slaCompare" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Operátoři · SLA reporting</p>
              <h1>SLA – porovnání metod</h1>
              <p className="sla-hero-lead">
                Stejné poptávky jako ve Výčtu SLA, spočítané dvakrát. Stará metoda bere první
                změnu v iframe (<code>first_iframe_change_at</code>). Nová bere razítko prvního
                kontaktu ze zadání SLA reportingu (<code>first_contact_at</code>,{' '}
                <code>first_response_minutes</code>).
              </p>
            </div>
            <div className="sla-hero-glow" aria-hidden="true" />
          </header>

          <FilterAssistant
            period={period}
            onPeriodChange={handlePeriodChange}
            startDate={startDate}
            endDate={endDate}
            onStartDateChange={(value) => {
              setStartDate(value)
              setPeriod('custom')
            }}
            onEndDateChange={(value) => {
              setEndDate(value)
              setPeriod('custom')
            }}
            hideDateBasis
          />

          <label className="sla-block-desc">
            <input
              type="checkbox"
              checked={onlyCovered}
              onChange={(event) => setOnlyCovered(event.target.checked)}
            />{' '}
            Jen objednávky od prvního vyplněného <code>first_contact_at</code> (starší nová pole nemají)
          </label>

          {loading ? (
            <div className="sla-loading">
              <span className="pauses-spinner" />
              Počítám porovnání…
            </div>
          ) : null}

          {error ? (
            <section className="sla-error">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {!loading && data && !data.hasNew ? (
            <section className="sla-error">
              <p>
                V ERP databázi chybí nová SLA pole ({missingColumns.join(', ')}). Změny ze zadání
                SLA reportingu zatím nejsou nasazené (nebo se nepropsaly do DWH), takže není co
                porovnávat.
              </p>
            </section>
          ) : null}

          {!loading && data && data.hasNew && summary ? (
            <>
              <section className="sla-block">
                <h2 className="sla-block-title">Pokrytí dat</h2>
                <p className="sla-block-desc">
                  {data.startDate} – {data.endDate}
                  {summary.first_new_filled
                    ? ` · nová pole vyplněna od ${dateTime(summary.first_new_filled)}`
                    : ''}
                  {missingColumns.length ? ` · v DB chybí: ${missingColumns.join(', ')}` : ''}
                </p>
                <div className="sla-kpis" aria-label="Pokrytí">
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Poptávky</span>
                    <span className="sla-kpi-value">{summary.total.toLocaleString('cs-CZ')}</span>
                    <span className="sla-kpi-hint">společná množina</span>
                  </article>
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Má starý kontakt</span>
                    <span className="sla-kpi-value">{pct(summary.old_filled, summary.total)}</span>
                    <span className="sla-kpi-hint">
                      {summary.old_filled.toLocaleString('cs-CZ')} · medián {hours(summary.old_median_h)}
                    </span>
                  </article>
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Má nový kontakt</span>
                    <span className="sla-kpi-value">{pct(summary.new_filled, summary.total)}</span>
                    <span className="sla-kpi-hint">
                      {summary.new_filled.toLocaleString('cs-CZ')} · medián {hours(summary.new_median_h)}
                    </span>
                  </article>
                  <article className="sla-kpi">
                    <span className="sla-kpi-label">Medián rozdílu</span>
                    <span className="sla-kpi-value">{hours(summary.median_diff_h)}</span>
                    <span className="sla-kpi-hint">
                      nový − starý · záporné hodnoty: {summary.old_negative} / {summary.new_negative}
                    </span>
                  </article>
                </div>
              </section>

              <section className="sla-block">
                <h2 className="sla-block-title">SLA 24 / 48 / 72 — stará vs. nová metoda</h2>
                <p className="sla-block-desc">
                  „Jen stará“ = stará metoda SLA splnila, nová ne (a naopak). Velká čísla v těchto
                  sloupcích znamenají, že metody měří něco jiného.
                </p>
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
                            {pct(row.old, summary.total)}{' '}
                            <span className="drilldown-muted">({row.old})</span>
                          </td>
                          <td>
                            {pct(row.new, summary.total)}{' '}
                            <span className="drilldown-muted">({row.new})</span>
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
              </section>

              {data.byType.length ? (
                <section className="sla-block">
                  <h2 className="sla-block-title">Podle typu prvního kontaktu</h2>
                  <p className="sla-block-desc">
                    <code>first_contact_type</code>: incoming / outgoing / missed. Zmeškaný hovor
                    podle zápisu změn hodiny spouští, ale nezastavuje.
                  </p>
                  <div className="drilldown-table-wrap">
                    <table className="drilldown-table">
                      <thead>
                        <tr>
                          <th>Typ</th>
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
                </section>
              ) : null}

              <section className="sla-block">
                <h2 className="sla-block-title">
                  Objednávky, kde se metody neshodnou na SLA 24 ({data.disagreements.length}
                  {data.disagreements.length === 200 ? '+' : ''})
                </h2>
                <p className="sla-block-desc">Seřazeno podle největšího rozdílu v hodinách.</p>
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
              </section>
            </>
          ) : null}
        </div>
      </div>
    </main>
  )
}
