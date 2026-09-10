import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import { keel } from '../lib/keelClient'
import {
  formatTimestamp,
  pick,
  readSearchHit,
  readTraceChain,
  rowsOf,
  scalar,
  type Json,
  type TraceEntry,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** A document reference in the URL, e.g. /trace?doc=PO-1042. Never a token. */
const DOC_PARAM = 'doc'

export default function Trace() {
  const { hasToken } = useSession()
  const [params, setParams] = useSearchParams()
  const docRef = params.get(DOC_PARAM) ?? ''
  const [draft, setDraft] = useState(docRef)

  useEffect(() => setDraft(docRef), [docRef])

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = draft.trim()
    setParams(next ? { [DOC_PARAM]: next } : {}, { replace: false })
  }

  const trace = useKeelQuery<unknown>(
    (signal) =>
      docRef && hasToken
        ? keel.query<unknown>('trace_document', { document: docRef }, { signal })
        : Promise.resolve(null),
    [docRef, hasToken],
  )

  // Only consulted when the reference does not resolve to a trace directly.
  const search = useKeelQuery<unknown>(
    (signal) =>
      docRef && hasToken && trace.error
        ? keel.query<unknown>('search_documents', { query: docRef, limit: 20 }, { signal })
        : Promise.resolve(null),
    [docRef, hasToken, trace.error],
  )

  const chain = trace.data ? readTraceChain(pick(trace.data, 'chain', 'nodes', 'steps', 'documents', 'trace') ?? trace.data) : []
  const hits = search.data ? rowsOf(search.data, 'documents', 'matches').map(readSearchHit) : []

  return (
    <div className="page">
      <header className="page-head">
        <h1>Trace</h1>
        <p className="lede">
          Follow one document through the chain Keel recorded for it, with its events and receipts
          inline.
        </p>
      </header>

      <section className="card">
        <form className="search" onSubmit={submit}>
          <input
            className="input mono"
            placeholder="document number, e.g. PO-1042"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Document number"
          />
          <button type="submit" className="btn" disabled={!draft.trim()}>
            Trace
          </button>
        </form>
        {!hasToken && (
          <p className="muted hint">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to search.
          </p>
        )}
      </section>

      {docRef && hasToken && trace.loading && (
        <section className="card">
          <p className="muted">Tracing {docRef}…</p>
        </section>
      )}

      {docRef && hasToken && trace.error && (
        <section className="card">
          <ErrorBlock error={trace.error} onRetry={trace.reload} />
          {hits.length > 0 && (
            <>
              <h2 className="mt">
                Matches <span className="tool">search_documents</span>
              </h2>
              <ul className="hits">
                {hits.map((hit, index) => {
                  const target = hit.label ?? hit.id
                  return (
                    <li key={hit.id ?? index}>
                      <button
                        type="button"
                        className="hit"
                        onClick={() => target && setParams({ [DOC_PARAM]: target })}
                      >
                        <code className="mono">{target ?? '—'}</code>
                        {hit.kind && <span className="badge">{hit.kind}</span>}
                        {hit.status && <span className="muted">{hit.status}</span>}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </section>
      )}

      {chain.length > 0 && (
        <section className="card">
          <h2>
            Chain <span className="tool">trace_document</span>
          </h2>
          <ol className="timeline">
            {chain.map((entry, index) => (
              <TraceNode key={entry.id ?? `${entry.kind}-${index}`} entry={entry} />
            ))}
          </ol>
        </section>
      )}

      {docRef && hasToken && !trace.loading && !trace.error && chain.length === 0 && (
        <section className="card">
          <p className="muted">Keel returned no chain for {docRef}.</p>
          {trace.data !== null && (
            <details className="raw">
              <summary>raw response</summary>
              <pre>{JSON.stringify(trace.data, null, 2)}</pre>
            </details>
          )}
        </section>
      )}
    </div>
  )
}

function TraceNode({ entry }: { entry: TraceEntry }) {
  const [open, setOpen] = useState(false)

  return (
    <li className="node">
      <div className="node-marker" aria-hidden="true" />
      <div className="node-body">
        <button type="button" className="node-head" onClick={() => setOpen((value) => !value)}>
          <span className="badge">{entry.kind}</span>
          <code className="mono node-label">{entry.label ?? entry.id ?? '—'}</code>
          {entry.status && <span className="node-status">{entry.status}</span>}
          {entry.amount && <span className="mono node-amount">{entry.amount}</span>}
          <span className="muted node-time">{formatTimestamp(entry.occurredAt) ?? ''}</span>
        </button>

        {(entry.events.length > 0 || entry.receipts.length > 0) && (
          <div className="node-inline">
            {entry.events.map((event, index) => (
              <div className="inline-row" key={`event-${index}`}>
                <span className="inline-tag tag-event">event</span>
                <code className="mono">{scalar(pick(event, 'type', 'event_type', 'name')) ?? '—'}</code>
                <span className="muted">
                  {formatTimestamp(pick(event, 'occurred_at', 'created_at', 'timestamp')) ?? ''}
                </span>
              </div>
            ))}
            {entry.receipts.map((receipt, index) => (
              <div className="inline-row" key={`receipt-${index}`}>
                <span className="inline-tag tag-receipt">receipt</span>
                <code className="mono">
                  {scalar(
                    typeof receipt === 'string'
                      ? receipt
                      : pick(receipt as Json, 'id', 'receipt_id', 'hash'),
                  ) ?? '—'}
                </code>
              </div>
            ))}
          </div>
        )}

        {open && (
          <dl className="fields node-fields">
            <Field label="id" value={entry.id} />
            <Field label="type" value={entry.kind} />
            <Field label="status" value={entry.status} />
            <Field label="amount" value={entry.amount} />
            <Field label="occurred at" value={formatTimestamp(entry.occurredAt)} />
            <div className="field">
              <dt>raw</dt>
              <dd>
                <pre>{JSON.stringify(entry.raw, null, 2)}</pre>
              </dd>
            </div>
          </dl>
        )}
      </div>
    </li>
  )
}
