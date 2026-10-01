import { useEffect, useState } from 'react'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'

const BRAND_TABS = [
  { id: '', label: 'Všechny' },
  ...Object.values(OPERATIONS_BRANDS).map((brand) => ({ id: brand.id, label: brand.menuLabel }))
]

function hours(value) {
  if (value == null) return '—'
  if (value >= 48) {
    return `${(value / 24).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} dne`
  }
  return `${Number(value).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} h`
}

function dateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('cs-CZ', {
    day: 'numeric',
    month: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

/** Barva buňky podle stáří (index kbelíku) a počtu — čím starší a víc, tím výraznější. */
function cellStyle(count, bucketIndex, max) {
  if (!count) return undefined
  const strength = 0.15 + 0.6 * (count / (max || 1))
  const hue = bucketIndex >= 3 ? '220, 38, 38' : bucketIndex >= 2 ? '217, 119, 6' : '13, 148, 136'
  return { background: `rgba(${hue}, ${strength.toFixed(2)})`, fontWeight: 700 }
}

export default function FrontyPage() {
  const [brand, setBrand] = useState('')
  const [period, setPeriod] = useState('week')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
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
          ...(brand ? { brand } : {}),
          ...(startDate ? { startDate } : {}),
          ...(endDate ? { endDate } : {})
        })
        const response = await fetch(`/api/fronty?${params}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setError(err.message || 'Nepodařilo se načíst fronty')
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
  }, [brand, period, startDate, endDate])

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod !== 'custom') {
      setStartDate('')
      setEndDate('')
    }
  }

  const totals = data?.totals
  const buckets = data?.buckets || []
  const maxCell = data
    ? Math.max(1, ...data.queues.flatMap((q) => buckets.map((b) => q.buckets[b.key])))
    : 1
  const over24 = totals ? totals.buckets.h24_48 + totals.buckets.h48_72 + totals.buckets.h72 : 0

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="fronty" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Operátoři · Daktela</p>
              <h1>Fronty – nenavolané leady</h1>
              <p className="sla-hero-lead">
                Kolik lidí nám volalo, nedovolali se a ještě jsme se jim neozvali — a jak dlouho už
                čekají. Jeden lead = jedno telefonní číslo. Za vyřízené se bere náš odchozí hovor
                zpět, nebo když zákazník zavolá znovu a my to zvedneme.
              </p>
            </div>
            <div className="sla-hero-glow" aria-hidden="true" />
          </header>

          <div className="fronty-tabs" role="tablist" aria-label="Značka">
            {BRAND_TABS.map((tab) => (
              <button
                key={tab.id || 'all'}
                type="button"
                role="tab"
                aria-selected={brand === tab.id}
                className={`fronty-tab${brand === tab.id ? ' is-active' : ''}`}
                onClick={() => setBrand(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

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

          {loading ? (
            <div className="sla-loading">
              <span className="pauses-spinner" />
              Načítám fronty…
            </div>
          ) : null}

          {error ? (
            <section className="sla-error">
              <p className="danger">{error}</p>
            </section>
          ) : null}

          {!loading && data ? (
            <div className="sla-cmp">
              <p className="sla-cmp-sub">
                Zmeškané hovory od {data.startDate} do {data.endDate}. Stáří = od prvního
                nevyřízeného zmeškaného hovoru do teď. Data jsou tak čerstvá jako poslední sync
                z Daktely.
              </p>

              <div className="sla-cmp-hero">
                <div className="sla-cmp-stat">
                  <span className="sla-cmp-stat-label">Nenavolané leady</span>
                  <strong className="sla-cmp-stat-value">{totals.leads.toLocaleString('cs-CZ')}</strong>
                  <span className="sla-cmp-stat-hint">
                    {totals.missed_calls.toLocaleString('cs-CZ')} zmeškaných hovorů
                  </span>
                </div>
                <div className="sla-cmp-stat">
                  <span className="sla-cmp-stat-label">Čekají déle než 24 h</span>
                  <strong className="sla-cmp-stat-value">{over24.toLocaleString('cs-CZ')}</strong>
                  <span className="sla-cmp-stat-hint">mimo SLA 24</span>
                </div>
                <div className="sla-cmp-stat">
                  <span className="sla-cmp-stat-label">Nejstarší</span>
                  <strong className="sla-cmp-stat-value">{hours(totals.max_age_h)}</strong>
                  <span className="sla-cmp-stat-hint">od prvního zmeškaného hovoru</span>
                </div>
              </div>

              {data.queues.length ? (
                <div className="fronty-table-wrap">
                  <table className="sla-cmp-table fronty-table">
                    <thead>
                      <tr>
                        <th>Fronta</th>
                        <th>Leady</th>
                        {buckets.map((b) => (
                          <th key={b.key}>{b.label}</th>
                        ))}
                        <th>Medián stáří</th>
                        <th>Nejstarší</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.queues.map((queue) => (
                        <tr key={queue.queue_id || queue.queue_label}>
                          <td>{queue.queue_label}</td>
                          <td>
                            <strong>{queue.leads}</strong>
                          </td>
                          {buckets.map((b, index) => (
                            <td
                              key={b.key}
                              className="fronty-cell"
                              style={cellStyle(queue.buckets[b.key], index, maxCell)}
                            >
                              {queue.buckets[b.key] || '·'}
                            </td>
                          ))}
                          <td>{hours(queue.median_age_h)}</td>
                          <td>{hours(queue.max_age_h)}</td>
                        </tr>
                      ))}
                      <tr className="fronty-total">
                        <td>Celkem</td>
                        <td>{totals.leads}</td>
                        {buckets.map((b) => (
                          <td key={b.key} className="fronty-cell">
                            {totals.buckets[b.key]}
                          </td>
                        ))}
                        <td />
                        <td>{hours(totals.max_age_h)}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="sla-cmp-note">Ve zvoleném období nejsou žádné nenavolané leady.</p>
              )}

              {data.oldest.length ? (
                <details className="sla-cmp-details" open>
                  <summary>Nejdéle čekající ({data.oldest.length})</summary>
                  <div className="fronty-table-wrap">
                    <table className="sla-cmp-table">
                      <thead>
                        <tr>
                          <th>Telefon</th>
                          <th>Zákazník / objednávka</th>
                          <th>Fronta</th>
                          <th>První zmeškaný</th>
                          <th>Poslední zmeškaný</th>
                          <th>Pokusů zákazníka</th>
                          <th>Čeká</th>
                        </tr>
                      </thead>
                      <tbody>
                        {data.oldest.map((row) => (
                          <tr key={row.phone_key}>
                            <td>{row.clid || row.phone_key}</td>
                            <td>
                              {row.order_id ? (
                                <a
                                  className="drilldown-detail-link"
                                  href={row.detail_url}
                                  target="_blank"
                                  rel="noreferrer"
                                >
                                  {row.customer_name || `#${row.order_id}`}
                                </a>
                              ) : (
                                <span className="drilldown-muted">bez objednávky</span>
                              )}
                            </td>
                            <td>{row.queue_label}</td>
                            <td>{dateTime(row.first_missed_at)}</td>
                            <td>{dateTime(row.last_missed_at)}</td>
                            <td>{row.missed_calls}</td>
                            <td>
                              <span
                                className={`sla-cmp-pill sla-cmp-tone-${
                                  row.age_h >= 24 ? 'late' : row.age_h >= 8 ? 'missing' : 'new'
                                }`}
                              >
                                {hours(row.age_h)}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  )
}
