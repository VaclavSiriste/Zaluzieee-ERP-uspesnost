import { Fragment, useEffect, useState } from 'react'

function pct(part, total) {
  if (!total) return '—'
  return `${((part / total) * 100).toLocaleString('cs-CZ', { maximumFractionDigits: 1 })} %`
}

function dateTime(value) {
  if (!value) return '—'
  // Daktela call_time = pražský čas bez zóny → zobrazit tak, jak je
  const [d, t] = String(value).replace('T', ' ').split(' ')
  const [y, m, day] = d.split('-')
  return `${Number(day)}. ${Number(m)}. ${t ? t.slice(0, 5) : ''}`
}

/**
 * Důvody nesplnění SLA do 30 s (pracovní doba) — každý nesplněný záznam má důvod.
 * Klik na důvod → seznam záznamů.
 */
export default function Sla30Reasons({ brandId, period, startDate = '', endDate = '' }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)
  const [items, setItems] = useState(null)

  const baseParams = () =>
    new URLSearchParams({
      brand: brandId,
      period,
      ...(startDate ? { startDate } : {}),
      ...(endDate ? { endDate } : {})
    })

  useEffect(() => {
    let cancelled = false
    setOpen(null)
    setItems(null)
    fetch(`/api/sla30-reasons?${baseParams()}`)
      .then((r) => r.json())
      .then((json) => {
        if (cancelled) return
        if (json.error) throw new Error(json.error)
        setData(json)
        setError('')
      })
      .catch((err) => !cancelled && setError(err.message || 'Nepodařilo se načíst důvody'))
    return () => {
      cancelled = true
    }
  }, [brandId, period, startDate, endDate])

  function toggle(reason) {
    if (open === reason) {
      setOpen(null)
      return
    }
    setOpen(reason)
    setItems(null)
    const params = baseParams()
    params.set('reason', reason)
    fetch(`/api/sla30-reasons?${params}`)
      .then((r) => r.json())
      .then((json) => setItems(json.items || []))
      .catch(() => setItems([]))
  }

  if (error) return <p className="danger">Důvody SLA 30 s: {error}</p>
  if (!data) return <div className="sla-loading">Načítám důvody…</div>

  const notMet = data.total_records - data.met_records

  return (
    <div className="s30">
      <p className="s30-title">Proč SLA nesplněno – {notMet.toLocaleString('cs-CZ')} záznamů</p>
      <p className="s30-sub">
        Každý záznam, který nebyl zvednut do 30 s, má důvod. Daktela po vypršení fronty vrací hovor do
        fronty jako nový záznam, proto je záznamů víc než skutečných volání:{' '}
        <strong>{data.total_records.toLocaleString('cs-CZ')} záznamů</strong> ={' '}
        <strong>{data.customer_calls.toLocaleString('cs-CZ')} volání zákazníků</strong>, z nich zvednuto{' '}
        {data.customer_calls_answered.toLocaleString('cs-CZ')} (
        {pct(data.customer_calls_answered, data.customer_calls)}).
      </p>
      <table className="sla-cmp-table s30-table">
        <thead>
          <tr>
            <th>Důvod</th>
            <th>Záznamů</th>
            <th>% z nesplněných</th>
            <th title="Kolika skutečných volání zákazníků se důvod týká">Volání</th>
            <th title="Po záznamu jsme zavolali zpět nebo zákazník volal znovu a zvedli jsme">
              Vyřešeno později
              <span className="rf-th-sub">zavolali jsme zpět / zvedli další hovor</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.reasons
            .filter((reason) => reason.records > 0)
            .map((reason) => (
              <Fragment key={reason.key}>
                <tr
                  className={`s30-row${open === reason.key ? ' is-open' : ''}`}
                  onClick={() => toggle(reason.key)}
                  title="Kliknutím zobrazíte záznamy"
                >
                  <td>
                    <span className="s30-caret">{open === reason.key ? '▾' : '▸'}</span> {reason.label}
                    <span className="s30-hint">
                      {reason.hint}
                      {reason.key === 'other' && reason.causes ? ` (${reason.causes})` : ''}
                    </span>
                  </td>
                  <td>{reason.records.toLocaleString('cs-CZ')}</td>
                  <td>{pct(reason.records, notMet)}</td>
                  <td>{reason.calls.toLocaleString('cs-CZ')}</td>
                  <td>
                    {reason.resolved_later.toLocaleString('cs-CZ')}{' '}
                    <span className="drilldown-muted">({pct(reason.resolved_later, reason.records)})</span>
                  </td>
                </tr>
                {open === reason.key ? (
                  <tr key={`${reason.key}-items`} className="s30-items">
                    <td colSpan={5}>
                      {items == null ? (
                        'Načítám…'
                      ) : (
                        <table className="s30-items-table">
                          <thead>
                            <tr>
                              <th>Čas</th>
                              <th>Telefon</th>
                              <th>Fronta</th>
                              <th>Čekal</th>
                              <th>Kód ukončení</th>
                              <th>Vyřešeno později</th>
                            </tr>
                          </thead>
                          <tbody>
                            {items.map((item) => (
                              <tr key={item.call_id}>
                                <td>{dateTime(item.call_time)}</td>
                                <td>{item.clid || '—'}</td>
                                <td>{item.queue_name}</td>
                                <td>{item.wait_seconds} s</td>
                                <td>{item.cause || '—'}</td>
                                <td>{item.resolved_later ? 'ano' : 'ne'}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            ))}
        </tbody>
      </table>
    </div>
  )
}
