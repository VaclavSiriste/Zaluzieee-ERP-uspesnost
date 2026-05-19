import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/router'

export default function LoginPage() {
  const router = useRouter()
  const [step, setStep] = useState('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [challengeId, setChallengeId] = useState('')
  const [info, setInfo] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [devCode, setDevCode] = useState('')

  const nextPath = useMemo(() => {
    const value = typeof router.query.next === 'string' ? router.query.next : '/'
    return value.startsWith('/') ? value : '/'
  }, [router.query.next])

  useEffect(() => {
    if (typeof router.query.error === 'string') {
      setError(router.query.error)
    }
  }, [router.query.error])

  async function handleRequestCode(event) {
    event.preventDefault()
    setLoading(true)
    setError('')
    setInfo('')
    setDevCode('')

    try {
      const response = await fetch('/api/auth/request-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, next: nextPath })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Odeslání kódu se nepodařilo.')
      }

      setChallengeId(data.challengeId)
      setStep('code')
      setInfo(data.message || 'Na e-mail jsme odeslali kód a přihlašovací odkaz.')
      if (data.devCode) {
        setDevCode(data.devCode)
      }
    } catch (requestError) {
      setError(requestError.message || 'Odeslání kódu se nepodařilo.')
    } finally {
      setLoading(false)
    }
  }

  async function handleVerifyCode(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/verify-code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, challengeId })
      })
      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Ověření kódu se nepodařilo.')
      }

      router.replace(nextPath)
    } catch (verifyError) {
      setError(verifyError.message || 'Ověření kódu se nepodařilo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-kicker">Interní přístup</div>
        <h1>Vstup do dashboardu</h1>

        {step === 'email' ? (
          <form className="login-form" onSubmit={handleRequestCode}>
            <label htmlFor="email">Firemní e-mail</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="jmeno@zaluzieee.cz"
              autoComplete="email"
              required
            />
            <p className="login-hint">Povolené domény: @zaluzieee.cz a @demaxia.cz</p>

            {error ? <p className="login-error">{error}</p> : null}

            <button type="submit" disabled={loading}>
              {loading ? 'Odesílám...' : 'Poslat přihlašovací kód'}
            </button>
          </form>
        ) : (
          <form className="login-form" onSubmit={handleVerifyCode}>
            <p className="login-success">{info}</p>
            <p className="login-hint">E-mail: {email}</p>

            {devCode ? (
              <p className="login-hint">
                Vývojový režim (bez SMTP): kód <strong>{devCode}</strong>
              </p>
            ) : null}

            <label htmlFor="code">Potvrzovací kód z e-mailu</label>
            <input
              id="code"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
              placeholder="123456"
              autoComplete="one-time-code"
              required
            />

            {error ? <p className="login-error">{error}</p> : null}

            <button type="submit" disabled={loading || code.length !== 6}>
              {loading ? 'Ověřuji...' : 'Přihlásit se'}
            </button>

            <button
              type="button"
              className="login-secondary-button"
              disabled={loading}
              onClick={() => {
                setStep('email')
                setCode('')
                setError('')
                setInfo('')
                setDevCode('')
              }}
            >
              Změnit e-mail
            </button>
          </form>
        )}
      </section>
    </main>
  )
}
