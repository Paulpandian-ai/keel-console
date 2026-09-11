import { useState } from 'react'
import { Link } from 'react-router-dom'
import Effects from '../components/Effects'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import {
  KeelApiError,
  keel,
  makeIdempotencyKey,
  type ToolPayload,
} from '../lib/keelClient'
import {
  approvalTarget,
  countedLinesOf,
  formatTimestamp,
  readCommitOutcome,
  readPendingApprovals,
  readSimulation,
  type ApprovalRequest,
  type CommitOutcome,
  type Json,
  type Simulation,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/**
 * The human inbox: the only page in the console that writes.
 *
 * Every decision goes simulate → show what Keel says it would do → confirm →
 * commit, with the idempotency key built from the simulation's `request_id`.
 * Whether a commit is offered at all is Keel's `would_commit`, never the
 * console's reading of the situation. Nothing here decides what an approval
 * means; it carries a human's answer to a question Keel asked.
 */

/** A decision the user has opened, waiting on a simulation. */
interface Decision {
  requestId: string
  tool: string
  payload: ToolPayload
  /** What the button said, repeated on the confirm. */
  verb: string
  destructive: boolean
}

type Phase = 'simulating' | 'confirm' | 'committing' | 'done'

export default function Approvals() {
  const { baseUrl, hasToken } = useSession()

  const pending = useKeelQuery<Json | null>(
    (signal) =>
      hasToken ? keel.query<Json>('list_pending_approvals', {}, { signal }) : Promise.resolve(null),
    [baseUrl, hasToken],
  )

  const [decision, setDecision] = useState<Decision | null>(null)
  const [phase, setPhase] = useState<Phase>('simulating')
  const [simulation, setSimulation] = useState<Simulation | null>(null)
  const [outcome, setOutcome] = useState<CommitOutcome | null>(null)
  const [failure, setFailure] = useState<KeelApiError | null>(null)

  const inbox = pending.data ? readPendingApprovals(pending.data) : null

  function asKeelError(caught: unknown): KeelApiError {
    return caught instanceof KeelApiError
      ? caught
      : new KeelApiError({ code: 'CONSOLE_ERROR', message: String(caught) })
  }

  /** Step one of every write: ask Keel what it would do. No side effects. */
  async function simulate(next: Decision) {
    setDecision(next)
    setSimulation(null)
    setOutcome(null)
    setFailure(null)
    setPhase('simulating')
    try {
      setSimulation(readSimulation(await keel.simulate(next.tool, next.payload)))
      setPhase('confirm')
    } catch (caught) {
      setFailure(asKeelError(caught))
      setPhase('confirm')
    }
  }

  /** Step two: the write, keyed off the simulation that was just shown. */
  async function commit() {
    if (!decision || !simulation?.requestId) return
    setPhase('committing')
    setFailure(null)
    try {
      const envelope = await keel.commit(decision.tool, decision.payload, {
        idempotencyKey: makeIdempotencyKey(simulation.requestId, decision.tool),
        simulationId: simulation.simulationId ?? undefined,
      })
      setOutcome(readCommitOutcome(envelope))
      setPhase('done')
      pending.reload()
    } catch (caught) {
      setFailure(asKeelError(caught))
      // The key is spent and the state Keel simulated against may have moved.
      // Going back means simulating again, which mints a fresh key.
      setSimulation(null)
      setPhase('confirm')
    }
  }

  function dismiss() {
    setDecision(null)
    setSimulation(null)
    setOutcome(null)
    setFailure(null)
  }

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Approvals</h1>
        <p className="lede">
          What agents parked for a human. Each decision is simulated first, so what you confirm is
          Keel's own projection of the effects — then committed with a fresh idempotency key.
        </p>
      </header>

      <section className="card">
        <h2>
          Waiting <span className="tool">list_pending_approvals</span>
          {inbox?.count !== null && inbox?.count !== undefined && (
            <span className="count">{inbox.count}</span>
          )}
        </h2>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to see the
            inbox — deciding needs <code className="scope">procurement:approve</code> or{' '}
            <code className="scope">procurement:receive</code>, and Keel enforces both.
          </p>
        )}
        {pending.loading && <p className="muted">Loading…</p>}
        {pending.error && <ErrorBlock error={pending.error} onRetry={pending.reload} />}

        {phase === 'done' && outcome && (
          <DecisionPanel
            decision={decision}
            phase={phase}
            simulation={simulation}
            outcome={outcome}
            failure={failure}
            onConfirm={commit}
            onDismiss={dismiss}
          />
        )}

        {inbox && inbox.pending.length === 0 && (
          <p className="muted empty">nothing waiting on a human</p>
        )}

        {inbox?.pending.map((request) => (
          <ApprovalCard
            key={request.id}
            request={request}
            open={decision?.requestId === request.id && phase !== 'done'}
            phase={phase}
            decision={decision}
            simulation={simulation}
            outcome={outcome}
            failure={failure}
            onDecide={simulate}
            onConfirm={commit}
            onDismiss={dismiss}
          />
        ))}
      </section>
    </div>
  )
}

/* ------------------------------------------------------------------- card */

function ApprovalCard({
  request,
  open,
  decision,
  phase,
  simulation,
  outcome,
  failure,
  onDecide,
  onConfirm,
  onDismiss,
}: {
  request: ApprovalRequest
  open: boolean
  decision: Decision | null
  phase: Phase
  simulation: Simulation | null
  outcome: CommitOutcome | null
  failure: KeelApiError | null
  onDecide: (decision: Decision) => void
  onConfirm: () => void
  onDismiss: () => void
}) {
  const [reason, setReason] = useState('')
  const [comment, setComment] = useState('')
  const requestId = request.id ?? ''
  const target = approvalTarget(request)
  const busy = open && (phase === 'simulating' || phase === 'committing')

  // Goods acceptance arrives with the quantities the agent expected; the human
  // edits what actually turned up. Keel works out short, over and the value.
  const expected = countedLinesOf(request.projectedEffects)
  const [counts, setCounts] = useState(() =>
    expected.map((line) => ({
      sku: line.sku ?? '',
      qty: String(line.expectedQty ?? line.qty ?? 0),
      damaged: '0',
      note: '',
    })),
  )

  const acceptedLines = counts.map((line) => ({
    sku: line.sku,
    qty: Number(line.qty || 0),
    damaged_qty: Number(line.damaged || 0),
    ...(line.note ? { note: line.note } : {}),
  }))

  const countsValid = counts.every(
    (line) => Number.isInteger(Number(line.qty)) && Number.isInteger(Number(line.damaged)),
  )

  return (
    <article className={`approval-card ${open ? 'is-open' : ''}`}>
      <div className="approval-head">
        <span className="badge approval-kind">{request.kind}</span>
        {target ? (
          <Link className="doc-number" to={`/trace?doc=${encodeURIComponent(target)}`}>
            {request.documentNumber ?? request.documentId}
          </Link>
        ) : (
          <span className="muted">—</span>
        )}
        <span className="doc-type">{request.documentType}</span>
        {request.expired && <span className="badge badge-warn">expired</span>}
      </div>

      {/* Keel's own words for why a human is needed. Never reworded here. */}
      <p className="approval-reason">{request.reason}</p>

      <dl className="fields">
        <Field label="requested by" value={request.requestedBy} />
        <Field label="parked tool" value={request.toolName} />
        <Field label="created" value={formatTimestamp(request.createdAt)} />
        <Field label="expires" value={formatTimestamp(request.expiresAt)} />
        <Field label="request id" value={requestId} />
      </dl>

      <details className="raw">
        <summary>what the agent's call would do</summary>
        <Effects effects={request.projectedEffects} />
      </details>

      {request.kind === 'goods_acceptance' && expected.length > 0 && (
        <div className="counted-editor">
          <h4>Counted on the dock</h4>
          <div className="table-scroll">
            <table className="feed">
              <thead>
                <tr>
                  <th>sku</th>
                  <th className="col-money">expected</th>
                  <th className="col-money">accepted</th>
                  <th className="col-money">damaged</th>
                  <th>note</th>
                </tr>
              </thead>
              <tbody>
                {expected.map((line, index) => (
                  <tr key={line.poLineId ?? line.sku ?? index}>
                    <td className="mono">{line.sku}</td>
                    <td className="col-money mono">{line.expectedQty}</td>
                    <td className="col-money">
                      <input
                        className="input input-qty mono"
                        type="number"
                        min={0}
                        step={1}
                        aria-label={`accepted ${line.sku}`}
                        value={counts[index]?.qty ?? ''}
                        onChange={(event) =>
                          setCounts((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, qty: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td className="col-money">
                      <input
                        className="input input-qty mono"
                        type="number"
                        min={0}
                        step={1}
                        aria-label={`damaged ${line.sku}`}
                        value={counts[index]?.damaged ?? ''}
                        onChange={(event) =>
                          setCounts((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, damaged: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        aria-label={`note ${line.sku}`}
                        placeholder="optional"
                        value={counts[index]?.note ?? ''}
                        onChange={(event) =>
                          setCounts((rows) =>
                            rows.map((row, i) =>
                              i === index ? { ...row, note: event.target.value } : row,
                            ),
                          )
                        }
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted hint">
            Short, over and the value of what is accepted are Keel's to work out — the simulation
            below shows what it made of these counts.
          </p>
        </div>
      )}

      <div className="approval-actions">
        {request.kind === 'po_approval' && (
          <>
            <label className="filter filter-grow">
              <span className="label">Comment</span>
              <input
                className="input"
                placeholder="optional, recorded on the decision"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !target}
              onClick={() =>
                onDecide({
                  requestId,
                  tool: 'approve_purchase_order',
                  payload: { po: target ?? '', ...(comment ? { comment } : {}) },
                  verb: 'Approve purchase order',
                  destructive: false,
                })
              }
            >
              Approve
            </button>
          </>
        )}

        {request.kind === 'goods_acceptance' && (
          <>
            <label className="filter filter-grow">
              <span className="label">Comment</span>
              <input
                className="input"
                placeholder="optional, recorded on the decision"
                value={comment}
                onChange={(event) => setComment(event.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn"
              disabled={busy || !countsValid}
              onClick={() =>
                onDecide({
                  requestId,
                  tool: 'accept_goods',
                  payload: {
                    request_id: requestId,
                    accepted_lines: acceptedLines,
                    ...(comment ? { comment } : {}),
                  },
                  verb: 'Accept goods',
                  destructive: false,
                })
              }
            >
              Accept goods
            </button>
          </>
        )}

        <label className="filter filter-grow">
          <span className="label">Reason to reject</span>
          <input
            className="input"
            placeholder="required by Keel"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn-danger"
          disabled={busy || reason.trim() === ''}
          onClick={() =>
            onDecide({
              requestId,
              tool: request.kind === 'goods_acceptance' ? 'reject_goods' : 'reject_approval',
              payload: { request_id: requestId, reason: reason.trim() },
              verb: request.kind === 'goods_acceptance' ? 'Reject goods' : 'Reject approval',
              destructive: true,
            })
          }
        >
          Reject
        </button>
      </div>

      {request.kind !== 'po_approval' && request.kind !== 'goods_acceptance' && (
        <p className="muted hint">
          The console can only reject a <code>{request.kind}</code> request. Approving one is not
          among the four writes it performs.
        </p>
      )}

      {open && (
        <DecisionPanel
          decision={decision}
          phase={phase}
          simulation={simulation}
          outcome={outcome}
          failure={failure}
          onConfirm={onConfirm}
          onDismiss={onDismiss}
        />
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ panel */

/**
 * The confirmation. It shows Keel's projection, Keel's policy decision and
 * Keel's validation, and offers Confirm only when Keel says `would_commit`.
 */
function DecisionPanel({
  decision,
  phase,
  simulation,
  outcome,
  failure,
  onConfirm,
  onDismiss,
}: {
  decision: Decision | null
  phase: Phase
  simulation: Simulation | null
  outcome: CommitOutcome | null
  failure: KeelApiError | null
  onConfirm: () => void
  onDismiss: () => void
}) {
  if (phase === 'done' && outcome) {
    return (
      <div className="decision-panel is-done">
        <div className="row">
          <h3>{decision?.verb ?? 'Committed'}</h3>
          <span className={`badge ${outcome.status === 'applied' ? 'badge-ok' : ''}`}>
            {outcome.status}
          </span>
          <span className="tool">{outcome.tool}</span>
          <button type="button" className="btn btn-quiet btn-small" onClick={onDismiss}>
            Dismiss
          </button>
        </div>
        {outcome.status === 'replayed' && (
          <p className="muted">
            Keel had already seen this idempotency key and returned the original receipt. Nothing
            was written twice.
          </p>
        )}
        <dl className="fields">
          <Field label="request id" value={outcome.requestId} />
          <Field
            label="receipt"
            value={
              outcome.receiptId && (
                <Link to={`/receipts?receipt=${encodeURIComponent(outcome.receiptId)}`}>
                  {outcome.receiptId}
                </Link>
              )
            }
          />
          <Field
            label="events"
            value={outcome.eventsEmitted
              .map((event) => `#${event.seq ?? '?'} ${event.type ?? ''}`)
              .join(', ')}
          />
        </dl>
        {outcome.warnings.length > 0 && (
          <ul className="notes notes-warning">
            {outcome.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        )}
        <Effects effects={outcome.effects} />
      </div>
    )
  }

  return (
    <div className="decision-panel">
      <div className="row">
        <h3>{decision?.verb ?? 'Decision'}</h3>
        <span className="muted">
          simulated, no side effects — this is what Keel says would happen
        </span>
        <button type="button" className="btn btn-quiet btn-small" onClick={onDismiss}>
          Cancel
        </button>
      </div>

      {phase === 'simulating' && <p className="muted">Simulating…</p>}
      {failure && <ErrorBlock error={failure} />}

      {simulation && (
        <>
          <dl className="fields">
            <Field
              label="would commit"
              value={
                simulation.wouldCommit === null ? null : (
                  <span className={`badge ${simulation.wouldCommit ? 'badge-ok' : 'badge-warn'}`}>
                    {simulation.wouldCommit ? 'yes' : 'no'}
                  </span>
                )
              }
            />
            <Field
              label="policy"
              value={
                simulation.policy.decision ? (
                  <span
                    className={`badge ${simulation.policy.decision === 'allow' ? 'badge-ok' : 'badge-warn'}`}
                  >
                    {simulation.policy.decision}
                  </span>
                ) : null
              }
            />
            <Field label="rules evaluated" value={simulation.policy.rulesEvaluated.join(', ')} />
            <Field label="rules triggered" value={simulation.policy.rulesTriggered.join(', ')} />
            <Field label="simulation expires" value={formatTimestamp(simulation.expiresAt)} />
            <Field label="simulation id" value={simulation.simulationId} />
          </dl>

          {simulation.commitWouldFailWith && (
            <p className="notes-blocker">
              A commit would fail with <code>{simulation.commitWouldFailWith}</code>.
            </p>
          )}
          {simulation.errors.length > 0 && (
            <ul className="notes notes-blocker">
              {simulation.errors.map((error) => (
                <li key={error}>{error}</li>
              ))}
            </ul>
          )}
          {simulation.warnings.length > 0 && (
            <ul className="notes notes-warning">
              {simulation.warnings.map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          )}
          {simulation.policy.reasons.length > 0 && (
            <ul className="notes notes-blocker">
              {simulation.policy.reasons.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}

          <Effects effects={simulation.effects} />

          <div className="row confirm-row">
            <button
              type="button"
              className={`btn ${decision?.destructive ? 'btn-danger' : 'btn-strong'}`}
              disabled={phase === 'committing' || simulation.wouldCommit === false}
              onClick={onConfirm}
            >
              {phase === 'committing' ? 'Committing…' : `Confirm — ${decision?.verb ?? 'commit'}`}
            </button>
            {simulation.requestId && (
              <span className="muted mono keybox">
                idempotency_key {makeIdempotencyKey(simulation.requestId, simulation.tool ?? '')}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
