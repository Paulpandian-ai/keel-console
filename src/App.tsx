import { NavLink, Navigate, Route, Routes } from 'react-router-dom'
import Events from './pages/Events'
import Settings from './pages/Settings'
import Status from './pages/Status'
import Trace from './pages/Trace'
import { useSession } from './lib/useSession'

/** Routes shipped so far. Later build-order steps add events, ledger, etc. */
const ROUTES = [
  { to: '/', label: 'Status', end: true },
  { to: '/events', label: 'Events', end: false },
  { to: '/trace', label: 'Trace', end: false },
  { to: '/settings', label: 'Settings', end: false },
]

export default function App() {
  const { hasToken } = useSession()

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
        <div className={`token-pill ${hasToken ? 'is-set' : 'is-unset'}`}>
          {hasToken ? 'token set' : 'no token'}
        </div>
      </header>

      <main className="main">
        <Routes>
          <Route path="/" element={<Status />} />
          <Route path="/events" element={<Events />} />
          <Route path="/trace" element={<Trace />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  )
}
