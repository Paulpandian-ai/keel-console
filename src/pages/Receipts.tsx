import { useEffect, useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import { keel } from '../lib/keelClient'
import {
  formatTimestamp,
  readReceiptVerification,
  readRequestLogEntry,
  readRequestLogPage,
  type RequestLogEntry,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/**
 * The evidence page: a receipt id verifies against Keel's signing key, a
 * request id explains what Keel did with a call, and the request log lists
 * recent calls newest first. All three are Keel's own verdicts and prose —
 * the console never checks a signature or reads a reason into an error.
 */

/** URL parameters, so other pages can link straight to a verification. Never a token. */
const RECEIPT_PARAM = 'receipt'
const REQUEST_PARAM = 'request'
/** `get_request_log` accepts 1-2000 per page; the console pages by offset. */
const LOG_LIMIT = 25

/** The `mode` filter `get_request_log` accepts. */
const MODES = ['', 'query', 'simulate', 'commit'] as const

export default function Receipts() {
  const { baseUrl, hasToken } = useSession()
  const [params, setParams] = useSearchParams()
  const receiptId = params.get(RECEIPT_PARAM) ?? ''
  const requestId = params.get(REQUEST_PARAM) ?? ''

  const [receiptDraft, setReceiptDraft] = useState(receiptId)
  const [requestDraft, setRequestDraft] = useState(requestId)
  useEffect(() => setReceiptDraft(receiptId), [receiptId])
  useEffect(() => setRequestDraft(requestId), [requestId])

  /** Change one parameter and keep the other, so both panels can stay open. */
  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next)
  }

  function submitReceipt(event: FormEvent) {
    event.preventDefault()
    setParam(RECEIPT_PARAM, receiptDraft.trim())
  }

  function submitRequest(event: FormEvent) {
    event.preventDefault()
    setParam(REQUEST_PARAM, requestDraft.trim())
  }

  const verification = useKeelQuery<unknown>(
    (signal) =>
      hasToken && receiptId
        ? keel.query<unknown>('verify_receipt', { receipt_id: receiptId }, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, receiptId],
  )

  const explanation = useKeelQuery<unknown>(
    (signal) =>
      hasToken && requestId
        ? keel.query<unknown>('explain_error', { request_id: requestId }, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, requestId],
  )

  const verified = verification.data ? readReceiptVerification(verification.data) : null
  const explained = explanation.data ? readRequestLogEntry(explanation.data) : null

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Receipts</h1>
        <p className="lede">
          Every write Keel applies is signed. Paste a receipt id to have Keel verify the signature
          against its key, or a request id to have it explain what happened to that call.
        </p>
      </header>

      {!hasToken && (
        <section className="card">
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> — verifying
            needs <code className="scope">documents:read</code>, explaining and the log need{' '}
            <code className="scope">troubleshoot:read</code>.
          </p>
        </section>
      )}

      <section className="card">
        <h2>
          Verify a receipt <span className="tool">verify_receipt</span>
        </h2>
        <form className="search" onSubmit={submitReceipt}>
          <input
            className="input mono"
            placeholder="receipt id, e.g. 01M281VR4H5KJCXT7BV5G1DXP6"
            value={receiptDraft}
            spellCheck={false}
            aria-label="receipt id"
            onChange={(event) => setReceiptDraft(event.target.value)}
          />
          <button type="submit" className="btn" disabled={!hasToken}>
            Verify
          </button>
        </form>

        {verification.loading && receiptId && <p className="muted">Verifying…</p>}
        {verification.error && (
          <ErrorBlock error={verification.error} onRetry={verification.reload} />
        )}

        {verified && (
          <div className="mt">
            <div className="row">
              {/* Keel's verdict. The console holds no key and checks nothing. */}
              <span className={`badge ${verified.valid ? 'badge-ok' : 'badge-warn'}`}>
                {verified.valid ? 'valid' : 'not valid'}
              </span>
              {verified.reason && <span className="muted">{verified.reason}</span>}
            </div>
            <dl className="fields">
              <Field label="receipt id" value={verified.receiptId} />
              <Field label="signature" value={verdict(verified.signatureValid)} />
              <Field label="action hash" value={verdict(verified.actionHashValid)} />
              <Field
                label="signing key"
                value={
                  verified.publicKeyId && (
                    <>
                      {verified.publicKeyId}
                      {verified.keyRetired && <span className="badge badge-warn"> retired</span>}
                    </>
                  )
                }
              />
            </dl>
            {verified.receipt && (
              <dl className="fields mt">
                <Field label="tool" value={verified.receipt.toolName} />
                <Field label="actor" value={verified.receipt.actorId} />
                <Field label="on behalf of" value={verified.receipt.onBehalfOf} />
                <Field label="signed at" value={formatTimestamp(verified.receipt.signedAt)} />
                <Field
                  label="document"
                  value={documentLink(
                    verified.receipt.documentType,
                    verified.receipt.documentNumber,
                    verified.receipt.documentId,
                  )}
                />
                <Field label="action hash" value={verified.receipt.actionHash} />
                <Field label="before" value={verified.receipt.beforeHash} />
                <Field label="after" value={verified.receipt.afterHash} />
                <Field label="signature" value={verified.receipt.signature} />
              </dl>
            )}
          </div>
        )}
      </section>

      <section className="card">
        <h2>
          Explain a request <span className="tool">explain_error</span>
        </h2>
        <form className="search" onSubmit={submitRequest}>
          <input
            className="input mono"
            placeholder="request id from any error, e.g. 01M281RS7TJ1QH842S68N1964C"
            value={requestDraft}
            spellCheck={false}
            aria-label="request id"
            onChange={(event) => setRequestDraft(event.target.value)}
          />
          <button type="submit" className="btn" disabled={!hasToken}>
            Explain
          </button>
        </form>

        {explanation.loading && requestId && <p className="muted">Asking Keel…</p>}
        {explanation.error && <ErrorBlock error={explanation.error} onRetry={explanation.reload} />}

        {explained && (
          <div className="mt">
            {/* Keel's own sentence about the request. Shown verbatim. */}
            {explained.explanation && <p className="explanation">{explained.explanation}</p>}
            <RequestDetail entry={explained} />
          </div>
        )}
      </section>

      <RequestLog onExplain={(id) => setParam(REQUEST_PARAM, id)} onVerify={(id) => setParam(RECEIPT_PARAM, id)} />
    </div>
  )
}

function verdict(flag: boolean | null) {
  if (flag === null) return null
  return <span className={`badge ${flag ? 'badge-ok' : 'badge-warn'}`}>{flag ? 'ok' : 'failed'}</span>
}

function documentLink(type: string | null, number: string | null, id: string | null) {
  const target = number ?? id
  if (!target) return null
  return (
    <>
      <Link className="doc-number" to={`/trace?doc=${encodeURIComponent(target)}`}>
        {target}
      </Link>
      {type && <span className="doc-type">{type}</span>}
    </>
  )
}

/** The fields a log row and an explanation share. */
function RequestDetail({ entry }: { entry: RequestLogEntry }) {
  return (
    <>
      <dl className="fields">
        <Field label="request id" value={entry.requestId} />
        <Field label="tool" value={entry.tool} />
        <Field label="mode" value={entry.mode} />
        <Field label="actor" value={entry.actorId} />
        <Field label="on behalf of" value={entry.onBehalfOf} />
        <Field label="started" value={formatTimestamp(entry.startedAt)} />
        <Field label="outcome" value={<OutcomeBadge entry={entry} />} />
        <Field label="error" value={entry.errorMessage} mono={false} />
        <Field label="policy" value={entry.policyDecision} />
        <Field
          label="rules evaluated"
          value={entry.policy?.rulesEvaluated.join(', ')}
        />
        <Field label="rules triggered" value={entry.policy?.rulesTriggered.join(', ')} />
        <Field label="reasons" value={entry.policy?.reasons.join('; ')} mono={false} />
        <Field label="idempotency key" value={entry.idempotencyKey} />
        <Field label="simulation id" value={entry.simulationId} />
        <Field
          label="receipt"
          value={
            entry.receiptId && (
              <Link to={`/receipts?${RECEIPT_PARAM}=${encodeURIComponent(entry.receiptId)}`}>
                {entry.receiptId}
              </Link>
            )
          }
        />
        <Field
          label="document"
          value={documentLink(null, entry.documentNumber, entry.documentId)}
        />
        <Field label="latency" value={entry.latencyMs !== null ? `${entry.latencyMs} ms` : null} />
      </dl>
      {Object.keys(entry.payload).length > 0 && (
        <details className="raw">
          <summary>payload, as Keel logged it</summary>
          <pre>{JSON.stringify(entry.payload, null, 2)}</pre>
        </details>
      )}
      {Object.keys(entry.stateSnapshot).length > 0 && (
        <details className="raw">
          <summary>state at the time</summary>
          <pre>{JSON.stringify(entry.stateSnapshot, null, 2)}</pre>
        </details>
      )}
    </>
  )
}

function OutcomeBadge({ entry }: { entry: RequestLogEntry }) {
  if (!entry.outcome) return null
  const failed = entry.outcome === 'error'
  return (
    <>
      <span className={`badge ${failed ? 'badge-warn' : 'badge-ok'}`}>{entry.outcome}</span>
      {entry.errorCode && <code className="error-code"> {entry.errorCode}</code>}
    </>
  )
}

/* -------------------------------------------------------------------- log */

function RequestLog({
  onExplain,
  onVerify,
}: {
  onExplain: (requestId: string) => void
  onVerify: (receiptId: string) => void
}) {
  const { baseUrl, hasToken } = useSession()
  const [mode, setMode] = useState<(typeof MODES)[number]>('')
  const [tool, setTool] = useState('')
  const [errorCode, setErrorCode] = useState('')
  const [applied, setApplied] = useState({ tool: '', errorCode: '' })
  const [offset, setOffset] = useState(0)

  const log = useKeelQuery<unknown>(
    (signal) =>
      hasToken
        ? keel.query<unknown>(
            'get_request_log',
            {
              limit: LOG_LIMIT,
              offset,
              ...(mode ? { mode } : {}),
              ...(applied.tool ? { tool: applied.tool } : {}),
              ...(applied.errorCode ? { error_code: applied.errorCode } : {}),
            },
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, mode, applied.tool, applied.errorCode, offset],
  )

  const page = log.data ? readRequestLogPage(log.data) : null

  return (
    <section className="card">
      <h2>
        Request log <span className="tool">get_request_log</span>
      </h2>
      <form
        className="filters"
        onSubmit={(event) => {
          event.preventDefault()
          setOffset(0)
          setApplied({ tool: tool.trim(), errorCode: errorCode.trim() })
        }}
      >
        <label className="filter">
          <span className="label">Mode</span>
          <select
            className="input mono"
            value={mode}
            onChange={(event) => {
              setOffset(0)
              setMode(event.target.value as (typeof MODES)[number])
            }}
          >
            {MODES.map((option) => (
              <option key={option} value={option}>
                {option || 'any'}
              </option>
            ))}
          </select>
        </label>
        <label className="filter">
          <span className="label">Tool</span>
          <input
            className="input mono"
            placeholder="e.g. accept_goods"
            value={tool}
            spellCheck={false}
            onChange={(event) => setTool(event.target.value)}
          />
        </label>
        <label className="filter">
          <span className="label">Error code</span>
          <input
            className="input mono"
            placeholder="e.g. FORBIDDEN"
            value={errorCode}
            spellCheck={false}
            onChange={(event) => setErrorCode(event.target.value)}
          />
        </label>
        <button type="submit" className="btn btn-quiet">
          Apply
        </button>
      </form>

      {log.loading && <p className="muted">Loading…</p>}
      {log.error && <ErrorBlock error={log.error} onRetry={log.reload} />}

      {page && page.requests.length === 0 && (
        <p className="muted empty">Keel returned no requests for this filter.</p>
      )}

      {page && page.requests.length > 0 && (
        <div className="table-scroll mt">
          <table className="feed">
            <thead>
              <tr>
                <th className="col-time">started</th>
                <th>mode</th>
                <th>tool</th>
                <th>actor</th>
                <th>outcome</th>
                <th className="col-money">ms</th>
                <th>request</th>
                <th>receipt</th>
              </tr>
            </thead>
            <tbody>
              {page.requests.map((entry, index) => (
                <tr key={entry.requestId ?? index}>
                  <td className="col-time mono">{formatTimestamp(entry.startedAt)}</td>
                  <td className="mono">{entry.mode}</td>
                  <td className="mono">{entry.tool}</td>
                  <td className="mono muted">{entry.actorId}</td>
                  <td>
                    <OutcomeBadge entry={entry} />
                  </td>
                  <td className="col-money mono muted">{entry.latencyMs}</td>
                  <td>
                    {entry.requestId && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small mono"
                        onClick={() => onExplain(entry.requestId ?? '')}
                      >
                        explain
                      </button>
                    )}
                  </td>
                  <td>
                    {entry.receiptId && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-small mono"
                        onClick={() => onVerify(entry.receiptId ?? '')}
                      >
                        verify
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {page && (
        <div className="row mt">
          <button
            type="button"
            className="btn btn-quiet btn-small"
            disabled={offset === 0}
            onClick={() => setOffset(Math.max(0, offset - LOG_LIMIT))}
          >
            newer
          </button>
          <span className="muted">
            offset {page.offset ?? offset} · {page.count ?? page.requests.length} on this page
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-small"
            // Keel answers with fewer than `limit` only on the last page.
            disabled={page.requests.length < LOG_LIMIT}
            onClick={() => setOffset(offset + LOG_LIMIT)}
          >
            older
          </button>
        </div>
      )}
    </section>
  )
}
