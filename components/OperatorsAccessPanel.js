import { useCallback, useEffect, useState } from 'react'

export default function OperatorsAccessPanel() {
  const [open, setOpen] = useState(false)
  const [emails, setEmails] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [info, setInfo] = useState('')
  const [allowed, setAllowed] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const meRes = await fetch('/api/auth/me')
      const me = await meRes.json().catch(() => null)
      if (!meRes.ok || !me?.canManageOperatorsAccess) {
        setAllowed(false)
        setEmails([])
        return
      }
      setAllowed(true)
      const response = await fetch('/api/access/operators-only')
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Načtení seznamu selhalo')
      setEmails(Array.isArray(data.emails) ? data.emails : [])
    } catch (err) {
      setError(err.message || 'Načtení selhalo')
      setAllowed(false)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdd(event) {
    event.preventDefault()
    const email = input.trim()
    if (!email) return
    setSaving(true)
    setError('')
    setInfo('')
    try {
      const response = await fetch('/api/access/operators-only', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Přidání selhalo')
      setEmails(Array.isArray(data.emails) ? data.emails : [])
      setInput('')
      setInfo(
        data.added
          ? `${data.email} teď uvidí jen sekci Operátoři.`
          : `${data.email} už v seznamu je.`
      )
    } catch (err) {
      setError(err.message || 'Přidání selhalo')
    } finally {
      setSaving(false)
    }
  }

  async function handleRemove(email) {
    setSaving(true)
    setError('')
    setInfo('')
    try {
      const response = await fetch('/api/access/operators-only', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data?.error || 'Odebrání selhalo')
      setEmails(Array.isArray(data.emails) ? data.emails : [])
      setInfo(data.removed ? `${email} odebrán — má znovu plný přístup.` : 'E-mail v seznamu nebyl.')
    } catch (err) {
      setError(err.message || 'Odebrání selhalo')
    } finally {
      setSaving(false)
    }
  }

  if (!allowed) return null

  return (
    <section className={`ops-access-panel${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="ops-access-toggle"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span>Přístup jen k Operátorům</span>
        <span className="ops-access-toggle-meta">
          {loading ? '…' : `${emails.length} e-mailů`}
          {open ? ' ▴' : ' ▾'}
        </span>
      </button>

      {open ? (
        <div className="ops-access-body">
          <p className="ops-access-desc">
            Zadaný firemní e-mail uvidí v menu jen sekci <strong>Operátoři</strong> (Příjem zakázek,
            Činnosti, Docházka, SLA, Targety). Ostatní sekce budou skryté.
          </p>

          <form className="ops-access-form" onSubmit={handleAdd}>
            <label htmlFor="ops-access-email" className="sr-only">
              E-mail
            </label>
            <input
              id="ops-access-email"
              type="email"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="jmeno@zaluzieee.cz"
              autoComplete="off"
              disabled={saving}
            />
            <button type="submit" disabled={saving || !input.trim()}>
              {saving ? 'Ukládám…' : 'Přidat'}
            </button>
          </form>

          {error ? <p className="ops-access-msg is-error">{error}</p> : null}
          {info ? <p className="ops-access-msg">{info}</p> : null}

          <ul className="ops-access-list">
            {emails.map((email) => (
              <li key={email}>
                <span>{email}</span>
                <button
                  type="button"
                  className="ops-access-remove"
                  onClick={() => handleRemove(email)}
                  disabled={saving}
                >
                  Odebrat
                </button>
              </li>
            ))}
            {!loading && emails.length === 0 ? (
              <li className="ops-access-empty">Seznam je prázdný.</li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  )
}
