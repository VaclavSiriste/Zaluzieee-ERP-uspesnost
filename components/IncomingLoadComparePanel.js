import { useEffect, useState } from 'react'
import MetricInfoTip, { MetricLabel } from '@/components/MetricInfoTip'

function formatNumber(value) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('cs-CZ')
}

function formatDelta(pct) {
  if (pct == null || Number.isNaN(Number(pct))) return '—'
  const n = Number(pct)
  const sign = n > 0 ? '+' : ''
  return `${sign}${n.toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

function deltaClass(pct) {
  const n = Number(pct)
  if (!Number.isFinite(n) || n === 0) return ''
  return n > 0 ? 'is-up' : 'is-down'
}

function CompareStat({ label, helpId, current, previous, delta, previousLabel }) {
  return (
    <article className="sla-kpi sla-kpi-child">
      <MetricLabel helpId={helpId}>{label}</MetricLabel>
      <strong className="sla-kpi-value">{formatNumber(current)}</strong>
      <span className="sla-kpi-hint">
        minule {formatNumber(previous)}
        {previousLabel ? ` (${previousLabel})` : ''}
        {' · '}
        <span className={`ops-load-delta ${deltaClass(delta)}`}>{formatDelta(delta)}</span>
      </span>
    </article>
  )
}

export default function IncomingLoadComparePanel({ brandId = 'cz', brandLabel = '' }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function load() {
      setLoading(true)
      setError('')
      try {
        const response = await fetch(`/api/incoming-load-compare?brand=${encodeURIComponent(brandId)}`)
        const json = await response.json()
        if (!response.ok || json.error) throw new Error(json.error || `HTTP ${response.status}`)
        if (!cancelled) setData(json)
      } catch (err) {
        if (!cancelled) {
          setData(null)
          setError(err.message || 'Nepodařilo se načíst nápor / odmítnuté')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [brandId])

  if (loading) {
    return (
      <section className="sla-block sla-block-nested">
        <h2 className="sla-block-title">Nápor a odmítnuté</h2>
        <p className="sla-block-desc">Načítám srovnání s minulým měsícem…</p>
      </section>
    )
  }

  if (error) {
    return (
      <section className="sla-block sla-block-nested">
        <h2 className="sla-block-title">Nápor a odmítnuté</h2>
        <p className="danger">{error}</p>
      </section>
    )
  }

  if (!data?.thisMonth || !data?.lastMonth) return null

  const asOf = data.asOfDate
    ? new Date(`${data.asOfDate}T12:00:00`).toLocaleDateString('cs-CZ')
    : ''

  return (
    <section className="sla-block sla-block-nested sla-block-load-compare">
      <h2 className="sla-block-title">
        Nápor a odmítnuté
        <MetricInfoTip helpId="incoming_load_compare" />
      </h2>
      <p className="sla-block-desc">
        {brandLabel || data.brandLabel}: tento měsíc vs. stejné dny minulého měsíce (aktualizace k{' '}
        {asOf}). Příchozí IN na linkách značky · odmítnuté = answered ne.
      </p>
      <div className="sla-kpi-breakdown" aria-label="Nápor a odmítnuté — srovnání měsíců">
        <CompareStat
          label="Nápor · příchozí"
          helpId="incoming_load_napor"
          current={data.thisMonth.incoming_calls}
          previous={data.lastMonth.incoming_calls}
          delta={data.delta?.incoming_calls_pct}
          previousLabel={data.lastMonth.label}
        />
        <CompareStat
          label="Odmítnuté celkem"
          helpId="incoming_load_rejected"
          current={data.thisMonth.rejected_calls}
          previous={data.lastMonth.rejected_calls}
          delta={data.delta?.rejected_calls_pct}
          previousLabel={data.lastMonth.label}
        />
        <CompareStat
          label="Odmítnuté operátorem"
          helpId="incoming_load_rejected_operator"
          current={data.thisMonth.rejected_by_operator}
          previous={data.lastMonth.rejected_by_operator}
          delta={data.delta?.rejected_by_operator_pct}
          previousLabel={data.lastMonth.label}
        />
        <CompareStat
          label="Odmítnuté zákazníkem"
          helpId="incoming_load_rejected_customer"
          current={data.thisMonth.rejected_by_customer}
          previous={data.lastMonth.rejected_by_customer}
          delta={data.delta?.rejected_by_customer_pct}
          previousLabel={data.lastMonth.label}
        />
      </div>
    </section>
  )
}
