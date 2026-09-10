import { Fragment, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import { eventTarget, formatTime, scalar } from '../lib/keelFields'
import { useEventFeed, type FeedMode } from '../lib/useEventFeed'
import { useSession } from '../lib/useSession'

const MODE_LABEL: Record<FeedMode, string> = {
  idle: 'paused',
  connecting: 'connecting…',
  live: 'live',
  polling: 'polling every 5s',
  error: 'disconnected',
}

export default function Events() {
  const { hasToken } = useSession()
  const navigate = useNavigate()
  const [running, setRunning] = useState(true)
  const [typeFilter, setTypeFilter] = useState('')
  const [documentFilter, setDocumentFilter] = useState('')
  const [expanded, setExpanded] = useState<number | null>(null)

  const feed = useEventFeed(hasToken && running)

  const types = useMemo(
    () => [...new Set(feed.events.map((event) => event.type))].sort(),
    [feed.events],
  )

  const visible = useMemo(() => {
    const needle = documentFilter.trim().toLowerCase()
    return feed.events.filter((event) => {
      if (typeFilter && event.type !== typeFilter) return false
      if (!needle) return true
      const target = `${event.documentLabel ?? ''} ${event.documentId ?? ''}`.toLowerCase()
      return target.includes(needle)
    })
  }, [feed.events, typeFilter, documentFilter])

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Events</h1>
        <div className="row">
          <span className={`badge feed-${feed.mode}`}>{MODE_LABEL[running ? feed.mode : 'idle']}</span>
          <button type="button" className="btn btn-quiet" onClick={() => setRunning((r) => !r)}>
            {running ? 'Pause' : 'Resume'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={feed.reconnect} disabled={!running}>
            Reconnect
          </button>
          <button type="button" className="btn btn-quiet" onClick={feed.clear}>
            Clear
          </button>
        </div>
      </header>

      {!hasToken && (
        <section className="card">
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read the
            event stream — it needs the <code className="scope">events:read</code> scope.
          </p>
        </section>
      )}

      {feed.error && (
        <section className="card">
          <ErrorBlock error={feed.error} onRetry={feed.reconnect} />
        </section>
      )}

      <section className="card">
        <div className="filters">
          <label className="filter">
            <span className="label">Type</span>
            <select
              className="input"
              value={typeFilter}
              onChange={(event) => setTypeFilter(event.target.value)}
            >
              <option value="">all types</option>
              {types.map((type) => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </label>
          <label className="filter filter-grow">
            <span className="label">Document</span>
            <input
              className="input mono"
              placeholder="filter by document number or id"
              value={documentFilter}
              onChange={(event) => setDocumentFilter(event.target.value)}
            />
          </label>
          <span className="muted count">
            {visible.length} of {feed.events.length}
          </span>
        </div>

        {feed.events.length === 0 ? (
          <p className="muted empty">
            {hasToken
              ? running
                ? 'Waiting for events…'
                : 'Feed paused.'
              : 'Nothing to show without a token.'}
          </p>
        ) : (
          <table className="feed">
            <thead>
              <tr>
                <th className="col-seq">seq</th>
                <th className="col-time">time</th>
                <th>type</th>
                <th>document</th>
                <th className="col-actions" />
              </tr>
            </thead>
            <tbody>
              {visible.map((event, index) => {
                const key = event.seq ?? -index - 1
                const target = eventTarget(event)
                return (
                  <Fragment key={key}>
                    <tr
                      className="feed-row"
                      onClick={() => setExpanded(expanded === key ? null : key)}
                    >
                      <td className="mono col-seq">{scalar(event.seq) ?? '—'}</td>
                      <td className="mono col-time muted">{formatTime(event.occurredAt) ?? '—'}</td>
                      <td>
                        <code className="event-type">{event.type}</code>
                      </td>
                      <td className="mono">{target ?? <span className="muted">—</span>}</td>
                      <td className="col-actions">
                        {target && (
                          <button
                            type="button"
                            className="btn btn-quiet btn-small"
                            onClick={(clickEvent) => {
                              clickEvent.stopPropagation()
                              navigate(`/trace?doc=${encodeURIComponent(target)}`)
                            }}
                          >
                            Trace
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === key && (
                      <tr>
                        <td colSpan={5} className="raw-cell">
                          <pre>{JSON.stringify(event.raw, null, 2)}</pre>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
