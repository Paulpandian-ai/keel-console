import { useEffect, useState, type FormEvent } from 'react'
import { DEFAULT_BASE_URL, maskToken } from '../lib/session'
import { useSession } from '../lib/useSession'

/**
 * Base URL, token entry, clear session. The token is pasted once and lives in
 * `sessionStorage` only (non-negotiable #3), so it is never rendered back in
 * full and never leaves this browser except as a bearer header.
 */
export default function Settings() {
  const session = useSession()
  const [urlDraft, setUrlDraft] = useState(session.baseUrl)
  const [tokenDraft, setTokenDraft] = useState('')
  const [saved, setSaved] = useState<string | null>(null)

  useEffect(() => setUrlDraft(session.baseUrl), [session.baseUrl])

  useEffect(() => {
    if (!saved) return
    const timer = setTimeout(() => setSaved(null), 2500)
    return () => clearTimeout(timer)
  }, [saved])

  function submitToken(event: FormEvent) {
    event.preventDefault()
    if (!tokenDraft.trim()) return
    session.setToken(tokenDraft)
    setTokenDraft('')
    setSaved('Token stored for this browser session.')
  }

  function submitUrl(event: FormEvent) {
    event.preventDefault()
    session.setBaseUrl(urlDraft)
    setSaved('Base URL updated.')
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Settings</h1>
        <p className="lede">
          The console holds no credentials of its own. It uses your Keel token and your scopes;
          Keel decides what you may see and do.
        </p>
      </header>

      <section className="card">
        <h2>Keel base URL</h2>
        <form className="stack" onSubmit={submitUrl}>
          <label className="label" htmlFor="base-url">
            Facade origin
          </label>
          <input
            id="base-url"
            className="input mono"
            type="url"
            inputMode="url"
            spellCheck={false}
            value={urlDraft}
            onChange={(event) => setUrlDraft(event.target.value)}
            placeholder={DEFAULT_BASE_URL}
          />
          <p className="hint">
            Build default: <code>{DEFAULT_BASE_URL}</code>
            {session.isBaseUrlOverridden && <span className="badge badge-warn">overridden</span>}
          </p>
          <div className="row">
            <button type="submit" className="btn">
              Save base URL
            </button>
            {session.isBaseUrlOverridden && (
              <button
                type="button"
                className="btn btn-quiet"
                onClick={() => session.setBaseUrl(DEFAULT_BASE_URL)}
              >
                Reset to default
              </button>
            )}
          </div>
        </form>
      </section>

      <section className="card">
        <h2>Token</h2>
        {session.token ? (
          <p className="token-current">
            Stored: <code className="mono">{maskToken(session.token)}</code>
          </p>
        ) : (
          <p className="muted">No token in this session. Read pages will fail with UNAUTHORIZED.</p>
        )}

        <form className="stack" onSubmit={submitToken}>
          <label className="label" htmlFor="token">
            Paste a Keel bearer token
          </label>
          <input
            id="token"
            className="input mono"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={tokenDraft}
            onChange={(event) => setTokenDraft(event.target.value)}
            placeholder="paste token"
          />
          <p className="hint">
            Kept in <code>sessionStorage</code> only — gone when this tab closes. Never written to
            the repo, a build artifact, a URL, or a log.
          </p>
          <div className="row">
            <button type="submit" className="btn" disabled={!tokenDraft.trim()}>
              Store token
            </button>
          </div>
        </form>
      </section>

      <section className="card card-danger">
        <h2>Session</h2>
        <p className="muted">Clears the token and any base-URL override from this browser.</p>
        <button
          type="button"
          className="btn btn-danger"
          onClick={() => {
            session.clearSession()
            setTokenDraft('')
            setSaved('Session cleared.')
          }}
          disabled={!session.hasToken && !session.isBaseUrlOverridden}
        >
          Clear session
        </button>
      </section>

      {saved && (
        <p className="toast" role="status">
          {saved}
        </p>
      )}
    </div>
  )
}
