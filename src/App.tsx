import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Approvals from './pages/Approvals'
import Events from './pages/Events'
import Inventory from './pages/Inventory'
import Ledger from './pages/Ledger'
import OpenItems from './pages/OpenItems'
import Receipts from './pages/Receipts'
import Recon from './pages/Recon'
import Settings from './pages/Settings'
import Status from './pages/Status'
import Trace from './pages/Trace'
import { useSession } from './lib/useSession'
import { useWhoami } from './lib/useWhoami'

/** Every route the console has. */
const ROUTES = [
  { to: '/', label: 'Status', end: true },
  { to: '/events', label: 'Events', end: false },
  { to: '/ledger', label: 'Ledger', end: false },
  { to: '/open-items', label: 'Open items', end: false },
  { to: '/inventory', label: 'Inventory', end: false },
  { to: '/approvals', label: 'Approvals', end: false },
  { to: '/recon', label: 'Close', end: false },
  { to: '/trace', label: 'Trace', end: false },
  { to: '/receipts', label: 'Receipts', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function App() {
  const { hasToken } = useSession()
  const { identity } = useWhoami()

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark" aria-hidden="true" />
          <span>Keel Console</span>
        </div>
        <nav className="nav">
          {ROUTES.map((route) => (
            <NavLink key={route.to} to={route.to} end={route.end} className="nav-link">
              {route.label}
            </NavLink>
          ))}
        </nav>
        <div
          className={`token-pill ${hasToken ? 'is-set' : 'is-unset'}`}
          title={identity ? `${identity.scopes.join(', ')} · ${identity.tools.length} tools` : undefined}
        >
          {/* `whoami`'s subject once Keel has answered; never the token itself. */}
          {hasToken ? (identity?.subject ?? 'token set') : 'no token'}
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Status />} />
          <Route path="/events" element={<Events />} />
          <Route path="/ledger" element={<Ledger />} />
          <Route path="/open-items" element={<OpenItems />} />
          <Route path="/inventory" element={<Inventory />} />
          <Route path="/approvals" element={<Approvals />} />
          <Route path="/recon" element={<Recon />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/receipts" element={<Receipts />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
