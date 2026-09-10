import { Link } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import { keel, type KeelHealth } from '../lib/keelClient'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** `get_system_status` payload, read defensively: Keel owns the shape. */
type SystemStatus = Record<string, unknown>

/** Read the first key that is present. Display only — never a computation. */
function pick(source: SystemStatus | null, ...keys: string[]): unknown {
  if (!source) return undefined
  for (const key of keys) {
    const path = key.split('.')
    let value: unknown = source
    for (const segment of path) {
      if (typeof value !== 'object' || value === null) {
        value = undefined
        break
      }
      value = (value as Record<string, unknown>)[segment]
    }
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function scalar(value: unknown): React.ReactNode {
  if (value === undefined || value === null) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function Scopes({ value }: { value: unknown }) {
  const list = Array.isArray(value)
    ? value.map(String)
    : typeof value === 'string'
      ? value.split(/[\s,]+/).filter(Boolean)
      : []
  if (list.length === 0) return null
  return (
    <span className="scopes">
      {list.map((scope) => (
        <code key={scope} className="scope">
          {scope}
        </code>
      ))}
    </span>
  )
}

export default function Status() {
  const { baseUrl, hasToken } = useSession()

  const health = useKeelQuery<KeelHealth>((signal) => keel.health({ signal }), [baseUrl])
  const system = useKeelQuery<SystemStatus>(
    (signal) =>
      hasToken
        ? keel.query<SystemStatus>('get_system_status', {}, { signal })
        : Promise.resolve({} as SystemStatus),
    [baseUrl, hasToken],
  )

  const env = scalar(health.data?.env)

  return (
    <div className="page">
      <header className="page-head">
        <h1>Status</h1>
        <div className="row">
          {env && <span className={`badge badge-env env-${String(env).toLowerCase()}`}>{env}</span>}
          <code className="muted mono">{baseUrl}</code>
          <button
            type="button"
            className="btn btn-quiet"
            onClick={() => {
              health.reload()
              system.reload()
            }}
          >
            Refresh
          </button>
        </div>
      </header>

      <section className="card">
        <h2>
          Reachability <span className="tool">GET /healthz</span>
        </h2>
        {health.loading && <p className="muted">Checking…</p>}
        {health.error && <ErrorBlock error={health.error} onRetry={health.reload} />}
        {health.data && (
          <dl className="fields">
            <Field label="status" value={scalar(health.data.status)} />
            <Field label="version" value={scalar(health.data.version)} />
            <Field label="environment" value={env} />
            <Field label="signing key id" value={scalar(health.data.signing_key_id)} />
            <Field label="event seq" value={scalar(health.data.event_seq)} />
            <Field label="policy version" value={scalar(health.data.policy_version)} />
          </dl>
        )}
      </section>

      <section className="card">
        <h2>
          System <span className="tool">get_system_status</span>
        </h2>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read system
            status, your token subject, and your scopes.
          </p>
        )}

        {hasToken && system.loading && <p className="muted">Loading…</p>}
        {hasToken && system.error && <ErrorBlock error={system.error} onRetry={system.reload} />}
        {hasToken && system.data && (
          <>
            <dl className="fields">
              <Field
                label="migration head"
                value={scalar(pick(system.data, 'migration_head', 'migration.head', 'schema_version'))}
              />
              <Field
                label="signing key id"
                value={scalar(pick(system.data, 'signing_key_id', 'key_id'))}
              />
              <Field label="event seq" value={scalar(pick(system.data, 'event_seq', 'last_event_seq'))} />
              <Field label="policy version" value={scalar(pick(system.data, 'policy_version'))} />
              <Field
                label="token subject"
                value={scalar(pick(system.data, 'token.subject', 'subject', 'token_subject', 'sub'))}
              />
              <Field
                label="scopes"
                value={<Scopes value={pick(system.data, 'token.scopes', 'scopes', 'token_scopes')} />}
              />
            </dl>
            <details className="raw">
              <summary>raw response</summary>
              <pre>{JSON.stringify(system.data, null, 2)}</pre>
            </details>
          </>
        )}
      </section>
    </div>
  )
}
