import Link from 'next/link'

export default function AppMenu({ active = 'dashboard' }) {
  return (
    <aside className="left-menu">
      <h3>Menu</h3>
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
        </ul>
      </div>

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

      <div className="menu-logout">
        <a href="/api/auth/logout?redirect=/login">Odhlásit se</a>
      </div>
    </aside>
  )
}
