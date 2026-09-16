import Link from 'next/link'
import { useEffect, useState } from 'react'

const DEFAULT_ACCESS = {
  canSeeOverview: true,
  canSeeOperators: true,
  canSeeOperations: true,
  canSeeFailedOrders: true
}

export default function AppMenu({ active = 'dashboard' }) {
  const [access, setAccess] = useState(DEFAULT_ACCESS)

  useEffect(() => {
    let cancelled = false
    async function loadAccess() {
      try {
        const response = await fetch('/api/auth/me')
        if (!response.ok) return
        const data = await response.json()
        if (!cancelled && data) {
          setAccess({
            canSeeOverview: data.canSeeOverview !== false,
            canSeeOperators: data.canSeeOperators !== false,
            canSeeOperations: data.canSeeOperations !== false,
            canSeeFailedOrders: data.canSeeFailedOrders !== false
          })
        }
      } catch {
        // ponech default (full) — middleware stejně chrání cesty
      }
    }
    loadAccess()
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <aside className="left-menu">
      <h3>Menu</h3>
      {access.canSeeOverview ? (
        <div className="menu-block">
          <div className="menu-block-title">Přehledy</div>
          <ul>
            <li className={active === 'dashboard' ? 'active' : ''}>
              <Link href="/">Dashboard</Link>
            </li>
            <li className={active === 'obchodnici' ? 'active' : ''}>
              <Link href="/obchodnici">Obchodníci</Link>
            </li>
          </ul>
        </div>
      ) : null}

      {access.canSeeOperators ? (
        <div className="menu-block">
          <div className="menu-block-title">Operátoři</div>
          <ul>
            <li className={active === 'operators' ? 'active' : ''}>
              <Link href="/operators">Příjem zakázek</Link>
            </li>
            <li className={active === 'operatorPauses' ? 'active' : ''}>
              <Link href="/pauzy-operatoru">Činnosti operátorů</Link>
            </li>
            <li className={active === 'attendance' ? 'active' : ''}>
              <Link href="/dochazka">Příchody a odchody</Link>
            </li>
            <li className={active === 'sla' ? 'active' : ''}>
              <Link href="/vycet-sla">Výčet SLA</Link>
            </li>
            <li className={active === 'targets' ? 'active' : ''}>
              <Link href="/targety">Targety</Link>
            </li>
          </ul>
        </div>
      ) : null}

      {access.canSeeOperations ? (
        <div className="menu-block">
          <div className="menu-block-title">Provoz</div>
          <ul>
            <li className={active === 'operations-cz' ? 'active' : ''}>
              <Link href="/rizeni-provozu">zaluzieee - CZ</Link>
            </li>
            <li className={active === 'operations-sk' ? 'active' : ''}>
              <Link href="/rizeni-provozu-sk">zaluzieee - SK</Link>
            </li>
            <li className={active === 'operations-malujemeee' ? 'active' : ''}>
              <Link href="/rizeni-provozu-malujemeee">malujemeee</Link>
            </li>
            <li className={active === 'operations-pokladamee' ? 'active' : ''}>
              <Link href="/rizeni-provozu-pokladamee">pokladamee</Link>
            </li>
            <li className={active === 'operations-venkovky' ? 'active' : ''}>
              <Link href="/rizeni-provozu-venkovky">Venkovky</Link>
            </li>
          </ul>
        </div>
      ) : null}

      {access.canSeeFailedOrders ? (
        <div className="menu-block menu-block-secondary">
          <div className="menu-block-title">Neproběhlé zakázky</div>
          <ul>
            <li className={active === 'failedOrdersOvt' ? 'active' : ''}>
              <Link href="/neprobehle-zakazky">Neproběhlé zakázky OVT</Link>
            </li>
            <li className={active === 'failedOrdersPz' ? 'active' : ''}>
              <Link href="/neprobehle-zakazky-pz">Neproběhlé zakázky PZ</Link>
            </li>
          </ul>
        </div>
      ) : null}

      <div className="menu-logout">
        <a href="/api/auth/logout?redirect=/login">Odhlásit se</a>
      </div>
    </aside>
  )
}
