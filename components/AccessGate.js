import { useEffect, useState } from 'react'
import { useRouter } from 'next/router'
import {
  ACCESS_ROLES,
  canAccessPathWithRole,
  OPERATORS_HOME_PATH
} from '@/lib/access-control'

/**
 * Live kontrola role (Operátoři-only) — přesměruje mimo povolené stránky.
 */
export default function AccessGate({ children }) {
  const router = useRouter()
  const [ready, setReady] = useState(false)

  useEffect(() => {
    if (!router.isReady) return undefined
    let cancelled = false

    async function check() {
      const path = router.pathname || '/'
      if (path === '/login' || path.startsWith('/api/')) {
        if (!cancelled) setReady(true)
        return
      }

      try {
        const response = await fetch('/api/auth/me')
        if (!response.ok) {
          if (!cancelled) setReady(true)
          return
        }
        const profile = await response.json()
        if (cancelled) return

        const role = profile.role || ACCESS_ROLES.FULL
        if (!canAccessPathWithRole(role, path)) {
          const home = profile.homePath || OPERATORS_HOME_PATH
          if (path !== home) {
            await router.replace(home)
            return
          }
        }

        if (path === '/' && role === ACCESS_ROLES.OPERATORS) {
          await router.replace(profile.homePath || OPERATORS_HOME_PATH)
          return
        }

        setReady(true)
      } catch {
        if (!cancelled) setReady(true)
      }
    }

    setReady(false)
    check()
    return () => {
      cancelled = true
    }
  }, [router.isReady, router.pathname])

  if (!ready && router.pathname !== '/login') {
    return (
      <div className="access-gate-loading" aria-busy="true">
        Načítám přístup…
      </div>
    )
  }

  return children
}
