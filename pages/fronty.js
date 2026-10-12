import { useEffect, useState } from 'react'
import usePersistedDateFilter from '@/hooks/usePersistedDateFilter'
import AppMenu from '@/components/AppMenu'
import FilterAssistant from '@/components/FilterAssistant'
import { OPERATIONS_BRANDS } from '@/lib/operations-brands'

const BRANDS = Object.values(OPERATIONS_BRANDS)

const BRAND_TABS = [
  { id: '', label: 'Všechny' },
  ...BRANDS.map((brand) => ({ id: brand.id, label: brand.menuLabel }))
]

const CALLBACK_DUE = {
  overdue: { label: 'po termínu', tone: 'late' },
  today: { label: 'dnes', tone: 'missing' },
  planned: { label: 'naplánováno', tone: 'new' },
  missing: { label: 'bez termínu', tone: 'missing' }
}

function isErpBrand(brandId) {
  return OPERATIONS_BRANDS[brandId]?.frontySource === 'erp'
}

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

function callbackWhen(row) {
  if (!row.callback_date && !row.callback_time) return '—'
  const day = row.callback_day
    ? new Date(`${row.callback_day}T00:00:00`).toLocaleDateString('cs-CZ', {
        day: 'numeric',
        month: 'numeric',
        year: 'numeric'
      })
    : row.callback_date || ''
  return [day, row.callback_time].filter(Boolean).join(' ')
}

/** Barva buňky podle stáří (index kbelíku) a počtu — čím starší a víc, tím výraznější. */
function cellStyle(count, bucketIndex, max) {
  if (!count) return undefined
  const strength = 0.15 + 0.6 * (count / (max || 1))
  const hue = bucketIndex >= 3 ? '220, 38, 38' : bucketIndex >= 2 ? '217, 119, 6' : '13, 148, 136'
  return { background: `rgba(${hue}, ${strength.toFixed(2)})`, fontWeight: 700 }
}

function AgePill({ ageH }) {
  return (
    <span className={`sla-cmp-pill sla-cmp-tone-${ageH >= 24 ? 'late' : ageH >= 8 ? 'missing' : 'new'}`}>
      {hours(ageH)}
    </span>
  )
}

function OrderLink({ row }) {
  if (!row.order_id) return <span className="drilldown-muted">bez objednávky</span>
  return (
    <a className="drilldown-detail-link" href={row.detail_url} target="_blank" rel="noreferrer">
      {row.customer_name || `#${row.order_id}`}
    </a>
  )
}

function QueueTable({ data, erp }) {
  const { totals, buckets, queues } = data
  const maxCell = Math.max(1, ...queues.flatMap((q) => buckets.map((b) => q.buckets[b.key])))

  return (
    <div className="fronty-table-wrap">
      <table className="sla-cmp-table fronty-table">
        <thead>
          <tr>
            <th>Fronta</th>
            <th>{erp ? 'Objednávky' : 'Leady'}</th>
            {buckets.map((b) => (
              <th key={b.key}>{b.label}</th>
            ))}
            <th>Medián stáří</th>
            <th>Nejstarší</th>
          </tr>
        </thead>
        <tbody>
          {queues.map((queue) => (
            <tr key={queue.queue_id || queue.queue_label}>
              <td>
                {queue.queue_label}
                {erp && queue.statuses?.length ? (
                  <span className="drilldown-muted"> · {queue.statuses.join(', ')}</span>
                ) : null}
              </td>
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
  )
}

function CallbacksTable({ data }) {
  const rows = data.callbacks || []
  return (
    <details className="sla-cmp-details" open>
      <summary>
        Volat později ({data.callbacks_total}
        {data.callbacks_overdue ? ` · ${data.callbacks_overdue} po termínu` : ''})
      </summary>
      {!data.audit_available ? (
        <p className="sla-cmp-note">V této ERP instanci chybí audit log — „Kdo zadal“ nelze dohledat.</p>
      ) : null}
      {rows.length ? (
        <div className="fronty-table-wrap">
          <table className="sla-cmp-table">
            <thead>
              <tr>
                <th>Zákazník / objednávka</th>
                <th>Telefon</th>
                <th>Kraj</th>
                <th>Stav v ERP</th>
                <th>Kdo zadal</th>
                <th>Zadáno</th>
                <th>Volat na kdy</th>
                <th>Termín</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const due = CALLBACK_DUE[row.callback_due] || CALLBACK_DUE.missing
                return (
                  <tr key={row.order_id}>
                    <td>
                      <OrderLink row={row} />
                    </td>
                    <td>{row.phone || '—'}</td>
                    <td>{row.region}</td>
                    <td>{row.status}</td>
                    <td>{row.callback_set_by || '—'}</td>
                    <td>{dateTime(row.callback_set_at)}</td>
                    <td>{callbackWhen(row)}</td>
                    <td>
                      <span className={`sla-cmp-pill sla-cmp-tone-${due.tone}`}>{due.label}</span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="sla-cmp-note">Žádné callbacky „Volat později“.</p>
      )}
    </details>
  )
}

function ErpOldestTable({ rows }) {
  if (!rows.length) return null
  return (
    <details className="sla-cmp-details">
      <summary>Nejdéle čekající ({rows.length})</summary>
      <div className="fronty-table-wrap">
        <table className="sla-cmp-table">
          <thead>
            <tr>
              <th>Zákazník / objednávka</th>
              <th>Telefon</th>
              <th>Kraj</th>
              <th>Fronta</th>
              <th>Ve stavu od</th>
              <th>Čeká</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.order_id}>
                <td>
                  <OrderLink row={row} />
                </td>
                <td>{row.phone || '—'}</td>
                <td>{row.region}</td>
                <td>{row.queue_label}</td>
                <td>{dateTime(row.entered_at)}</td>
                <td>
                  <AgePill ageH={row.age_h} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function DaktelaOldestTable({ rows }) {
  if (!rows.length) return null
  return (
    <details className="sla-cmp-details" open>
      <summary>Nejdéle čekající ({rows.length})</summary>
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
            {rows.map((row) => (
              <tr key={row.phone_key}>
                <td>{row.clid || row.phone_key}</td>
                <td>
                  <OrderLink row={row} />
                </td>
                <td>{row.queue_label}</td>
                <td>{dateTime(row.first_missed_at)}</td>
                <td>{dateTime(row.last_missed_at)}</td>
                <td>{row.missed_calls}</td>
                <td>
                  <AgePill ageH={row.age_h} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}

function FrontySection({ brandId, period, startDate, endDate, showHeading }) {
  const erp = isErpBrand(brandId)
  const brand = OPERATIONS_BRANDS[brandId]
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // ERP fronty jsou snapshot — změna období je nemá znovu načítat
  const periodKey = erp ? 'snapshot' : `${period}|${startDate}|${endDate}`

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const params = new URLSearchParams({
          brand: brandId,
          period,
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brandId, periodKey])

  const totals = data?.totals
  const over24 = totals ? totals.buckets.h24_48 + totals.buckets.h48_72 + totals.buckets.h72 : 0

  return (
    <section className="fronty-section">
      {showHeading ? (
        <h2 className="sla-block-title">
          {brand?.menuLabel || brandId}{' '}
          <span className="drilldown-muted">· {erp ? 'ERP' : 'Daktela'}</span>
        </h2>
      ) : null}

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
            {erp
              ? 'Aktuální stav objednávek v ERP (filtr období se tu neuplatní). Stáří = od poslední změny stavu do teď. Lead s důvodem „Volat později“ je jen ve frontě Volat později.'
              : `Zmeškané hovory od ${data.startDate} do ${data.endDate}. Stáří = od prvního nevyřízeného zmeškaného hovoru do teď. Data jsou tak čerstvá jako poslední sync z Daktely.`}
          </p>

          <div className="sla-cmp-hero">
            <div className="sla-cmp-stat">
              <span className="sla-cmp-stat-label">{erp ? 'Ve frontách' : 'Nenavolané leady'}</span>
              <strong className="sla-cmp-stat-value">{totals.leads.toLocaleString('cs-CZ')}</strong>
              <span className="sla-cmp-stat-hint">
                {erp
                  ? `${data.callbacks_total.toLocaleString('cs-CZ')} volat později`
                  : `${totals.missed_calls.toLocaleString('cs-CZ')} zmeškaných hovorů`}
              </span>
            </div>
            <div className="sla-cmp-stat">
              <span className="sla-cmp-stat-label">Čekají déle než 24 h</span>
              <strong className="sla-cmp-stat-value">{over24.toLocaleString('cs-CZ')}</strong>
              <span className="sla-cmp-stat-hint">mimo SLA 24</span>
            </div>
            {erp ? (
              <div className="sla-cmp-stat">
                <span className="sla-cmp-stat-label">Callbacky po termínu</span>
                <strong className="sla-cmp-stat-value">
                  {data.callbacks_overdue.toLocaleString('cs-CZ')}
                </strong>
                <span className="sla-cmp-stat-hint">volat později · termín už minul</span>
              </div>
            ) : (
              <div className="sla-cmp-stat">
                <span className="sla-cmp-stat-label">Nejstarší</span>
                <strong className="sla-cmp-stat-value">{hours(totals.max_age_h)}</strong>
                <span className="sla-cmp-stat-hint">od prvního zmeškaného hovoru</span>
              </div>
            )}
          </div>

          {totals.leads ? (
            <QueueTable data={data} erp={erp} />
          ) : (
            <p className="sla-cmp-note">
              {erp ? 'Ve frontách nejsou žádné objednávky.' : 'Ve zvoleném období nejsou žádné nenavolané leady.'}
            </p>
          )}

          {erp ? (
            <>
              <CallbacksTable data={data} />
              <ErpOldestTable rows={data.oldest} />
            </>
          ) : (
            <DaktelaOldestTable rows={data.oldest} />
          )}
        </div>
      ) : null}
    </section>
  )
}

export default function FrontyPage() {
  const [brand, setBrand] = useState('')
  const { period, setPeriod, startDate, setStartDate, endDate, setEndDate } =
    usePersistedDateFilter({ period: 'week' })

  function handlePeriodChange(nextPeriod) {
    setPeriod(nextPeriod)
    if (nextPeriod !== 'custom') {
      setStartDate('')
      setEndDate('')
    }
  }

  const visibleBrands = brand ? [brand] : BRANDS.map((b) => b.id)

  return (
    <main className="dashboard-container sla-page">
      <div className="dashboard-layout">
        <AppMenu active="fronty" />
        <div className="dashboard-main">
          <header className="sla-hero">
            <div className="sla-hero-copy">
              <p className="sla-kicker">Provoz · fronty všech značek</p>
              <h1>Fronty</h1>
              <p className="sla-hero-lead">
                Žaluzieee (CZ i SK) z ERP — objednávky ve stavu Nový lead, Čeká na trasovače,
                Emailová fronta a Volat později (kdo callback zadal a na kdy). Ostatní značky
                z Daktely — kdo nám volal, nedovolal se a ještě jsme se mu neozvali.
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

          {visibleBrands.map((brandId) => (
            <FrontySection
              key={brandId}
              brandId={brandId}
              period={period}
              startDate={startDate}
              endDate={endDate}
              showHeading={!brand}
            />
          ))}
        </div>
      </div>
    </main>
  )
}
