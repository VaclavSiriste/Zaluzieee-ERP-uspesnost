import { useMemo, useState } from 'react'
import { useRouter } from 'next/router'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const nextPath = useMemo(() => {
    const value = typeof router.query.next === 'string' ? router.query.next : '/'
    return value.startsWith('/') ? value : '/'
  }, [router.query.next])

  async function handleSubmit(event) {
    event.preventDefault()
    setLoading(true)
    setError('')

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ email })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data?.error || 'Přihlášení se nepodařilo.')
      }

      router.replace(nextPath)
    } catch (submitError) {
      setError(submitError.message || 'Přihlášení se nepodařilo.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-kicker">Interní přístup</div>
        <h1>Vstup do dashboardu</h1>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="email">Firemní e-mail</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="vaclav.siriste@zaluzieee.cz"
            autoComplete="email"
            required
          />

          {error ? <p className="login-error">{error}</p> : null}

          <button type="submit" disabled={loading}>
            {loading ? 'Ověřuji...' : 'Pokračovat'}
          </button>
        </form>
      </section>
    </main>
  )
}
