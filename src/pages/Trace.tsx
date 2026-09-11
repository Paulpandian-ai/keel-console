import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import ScopeNote from '../components/ScopeNote'
import Field from '../components/Field'
import { keel, loadDocumentTypes } from '../lib/keelClient'
import {
  formatCents,
  formatTimestamp,
  hitTarget,
  readSearchPage,
  readTraceGraph,
  type TraceNode,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'
import { useWhoami } from '../lib/useWhoami'

/** A document reference in the URL, e.g. /trace?doc=JE-000001. Never a token. */
const DOC_PARAM = 'doc'
const TYPE_PARAM = 'type'
/** `search_documents` accepts 1-500 per page and answers newest first. */
const BROWSE_LIMIT = 25

export default function Trace() {
  const { baseUrl, hasToken } = useSession()
  const { can, ready } = useWhoami()
  const [params, setParams] = useSearchParams()
  const docRef = params.get(DOC_PARAM) ?? ''
  const browseType = params.get(TYPE_PARAM) ?? ''
  const [draft, setDraft] = useState(docRef)

  useEffect(() => setDraft(docRef), [docRef])

  function submit(event: FormEvent) {
    event.preventDefault()
    const next = draft.trim()
    setParams(next ? { [DOC_PARAM]: next } : {}, { replace: false })
  }

  function open(target: string) {
    setParams({ [DOC_PARAM]: target })
  }

  const trace = useKeelQuery<unknown>(
    (signal) =>
      docRef && hasToken && ready && can('trace_document') !== false
        ? keel.query<unknown>('trace_document', { id_or_number: docRef }, { signal })
        : Promise.resolve(null),
    [baseUrl, docRef, hasToken, can, ready],
  )

  // The type list is Keel's; it is only fetched once the user browses.
  const types = useKeelQuery<string[] | null>(
    (signal) => (hasToken && browseType ? loadDocumentTypes(keel, { signal }) : Promise.resolve(null)),
    [baseUrl, hasToken, browseType !== ''],
  )

  const browse = useKeelQuery<unknown>(
    (signal) =>
      hasToken && ready && browseType && can('search_documents') !== false
        ? keel.query<unknown>(
            'search_documents',
            { type: browseType, limit: BROWSE_LIMIT },
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, browseType, can, ready],
  )

  const graph = trace.data ? readTraceGraph(trace.data) : null
  const hits = browse.data ? readSearchPage(browse.data) : null

  return (
    <div className="page">
      <header className="page-head">
        <h1>Trace</h1>
        <p className="lede">
          Follow one document through the chain Keel recorded for it, with the receipts that signed
          each step inline.
        </p>
      </header>

      <section className="card">
        <form className="search" onSubmit={submit}>
          <input
            className="input mono"
            placeholder="document number or id, e.g. JE-000001"
            value={draft}
            spellCheck={false}
            onChange={(event) => setDraft(event.target.value)}
            aria-label="Document number or id"
          />
          <button
            type="submit"
            className="btn"
            disabled={!draft.trim() || can('trace_document') === false}
          >
            Trace
          </button>
        </form>
        {hasToken && can('trace_document') === false && (
          <ScopeNote tool="trace_document" what="documents cannot be traced" />
        )}
        {!hasToken ? (
          <p className="muted hint">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to search.
          </p>
        ) : (
          <div className="filters browse">
            <label className="filter">
              <span className="label">Browse by type</span>
              <select
                className="input"
                value={browseType}
                onChange={(event) => {
                  const next = event.target.value
                  setParams(next ? { [TYPE_PARAM]: next } : {})
                }}
              >
                <option value="">—</option>
                {/* Seeded with the requested type so the select shows it before
                    Keel's full list has come back. */}
                {(types.data ?? (browseType ? [browseType] : [])).map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </label>
            {hits && (
              <span className="muted count">
                {hits.count ?? 0} {browseType}
                {hits.count === 1 ? '' : 's'}
              </span>
            )}
          </div>
        )}
        {types.error && <ErrorBlock error={types.error} onRetry={types.reload} />}
        {browse.error && <ErrorBlock error={browse.error} onRetry={browse.reload} />}
        {hits && hits.hits.length > 0 && (
          <ul className="hits">
            {hits.hits.map((hit, index) => {
              const target = hitTarget(hit)
              return (
                <li key={hit.id ?? index}>
                  <button
                    type="button"
                    className="hit"
                    onClick={() => target && open(target)}
                    disabled={!target}
                  >
                    <code className="mono">{hit.number ?? hit.id ?? '—'}</code>
                    {hit.status && <span className="badge">{hit.status}</span>}
                    {hit.totalCents !== null && (
                      <span className="mono node-amount">{formatCents(hit.totalCents)}</span>
                    )}
                    <span className="muted">{formatTimestamp(hit.createdAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
        {hits && hits.hits.length === 0 && (
          <p className="muted empty">Keel has no {browseType} documents.</p>
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
        </section>
      )}

      {graph && (
        <section className="card">
          <h2>
            Chain <span className="tool">trace_document</span>
          </h2>
          <dl className="fields">
            <Field label="requested" value={graph.requested} />
            <Field
              label="root"
              value={
                graph.root ? `${graph.root.type} ${graph.root.number ?? graph.root.id ?? ''}` : null
              }
            />
            <Field label="journal entries" value={graph.journalEntryCount} />
            <Field label="reversals" value={graph.reversalJournalEntries.length || null} />
          </dl>

          {graph.nodes.length > 0 ? (
            <ol className="timeline mt">
              {graph.nodes.map((node, index) => (
                <TraceNodeView
                  key={node.id ?? `${node.type}-${index}`}
                  node={node}
                  isRoot={graph.root?.id === node.id}
                />
              ))}
            </ol>
          ) : (
            <p className="muted empty">Keel returned no nodes for {docRef}.</p>
          )}

          {graph.edges.length > 0 && (
            <>
              <h2 className="mt">Links</h2>
              <ul className="hits">
                {graph.edges.map((edge, index) => (
                  <li key={index} className="edge">
                    <code className="mono">{edge.from ?? '—'}</code>
                    <span className="muted">→</span>
                    <code className="mono">{edge.to ?? '—'}</code>
                    {edge.relation && <span className="badge">{edge.relation}</span>}
                  </li>
                ))}
              </ul>
            </>
          )}

          <details className="raw">
            <summary>raw response</summary>
            <pre>{JSON.stringify(trace.data, null, 2)}</pre>
          </details>
        </section>
      )}
    </div>
  )
}

function TraceNodeView({ node, isRoot }: { node: TraceNode; isRoot: boolean }) {
  const [open, setOpen] = useState(false)
  const reference = node.number ?? node.id

  return (
    <li className={`node ${isRoot ? 'node-root' : ''}`}>
      <div className="node-marker" aria-hidden="true" />
      <div className="node-body">
        <button type="button" className="node-head" onClick={() => setOpen((value) => !value)}>
          <span className="badge">{node.type}</span>
          <code className="mono node-label">{reference ?? '—'}</code>
          {node.status && <span className="node-status">{node.status}</span>}
          {node.totalCents !== null && (
            <span className="mono node-amount">{formatCents(node.totalCents)}</span>
          )}
          <span className="muted node-time">{formatTimestamp(node.createdAt) ?? ''}</span>
        </button>

        {(node.receipts.length > 0 || node.eventSeqs.length > 0) && (
          <div className="node-inline">
            {node.receipts.map((receipt, index) => (
              <div className="inline-row" key={`receipt-${receipt.id ?? index}`}>
                <span className="inline-tag tag-receipt">receipt</span>
                <code className="mono">{receipt.tool ?? '—'}</code>
                <span className="muted">{receipt.actor ?? '—'}</span>
                {receipt.onBehalfOf && <span className="muted">for {receipt.onBehalfOf}</span>}
                <span className="muted">{formatTimestamp(receipt.signedAt) ?? ''}</span>
                {receipt.id ? (
                  <Link
                    className="mono muted receipt-id"
                    to={`/receipts?receipt=${encodeURIComponent(receipt.id)}`}
                  >
                    {receipt.id}
                  </Link>
                ) : (
                  <code className="mono muted receipt-id">—</code>
                )}
              </div>
            ))}
            {node.eventSeqs.length > 0 && (
              <div className="inline-row">
                <span className="inline-tag tag-event">events</span>
                {node.eventSeqs.map((seq) => (
                  <code className="mono seq-chip" key={seq}>
                    #{seq}
                  </code>
                ))}
                {reference && (
                  <Link className="muted" to={`/events?doc=${encodeURIComponent(reference)}`}>
                    in the feed
                  </Link>
                )}
              </div>
            )}
          </div>
        )}

        {open && (
          <dl className="fields node-fields">
            <Field label="id" value={node.id} />
            <Field label="number" value={node.number} />
            <Field label="type" value={node.type} />
            <Field label="status" value={node.status} />
            <Field label="total" value={formatCents(node.totalCents)} />
            <Field label="created at" value={formatTimestamp(node.createdAt)} />
            <Field label="state version" value={node.stateVersion} />
          </dl>
        )}
      </div>
    </li>
  )
}
