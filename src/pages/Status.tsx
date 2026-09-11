import { useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import ScopeNote from '../components/ScopeNote'
import Field from '../components/Field'
import PeriodPicker from '../components/PeriodPicker'
import { keel, type KeelHealth } from '../lib/keelClient'
import { formatCents, scalar, type Json } from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'
import { useWhoami } from '../lib/useWhoami'

/**
 * `get_system_status` is deliberately absent from this page. It requires the
 * `admin:status` scope, which a console token is not meant to hold: the console
 * has no privileged path, so it reads what its own token can read and lets Keel
 * refuse the rest. Everything below comes from tools a read token can call.
 */

/** The four reconciliations Keel exposes, in the order `get_reconciliation` names them. */
const RECON_KINDS = ['gr_ir', 'ap', 'ar', 'inventory'] as const

function Ok({ value, trueLabel, falseLabel }: { value: unknown; trueLabel: string; falseLabel: string }) {
  if (typeof value !== 'boolean') return null
  return (
    <span className={`badge ${value ? 'badge-ok' : 'badge-warn'}`}>
      {value ? trueLabel : falseLabel}
    </span>
  )
}

/** A `blockers` / `warnings` list from `close_readiness`, shown verbatim. */
function Notes({ items, tone }: { items: unknown; tone: 'blocker' | 'warning' }) {
  const list = Array.isArray(items) ? items : []
  if (list.length === 0) return <span className="muted">none</span>
  return (
    <ul className={`notes notes-${tone}`}>
      {list.map((item, index) => (
        <li key={index}>{scalar(item)}</li>
      ))}
    </ul>
  )
}

export default function Status() {
  const { baseUrl, hasToken } = useSession()
  const { can, ready } = useWhoami()

  const health = useKeelQuery<KeelHealth>((signal) => keel.health({ signal }), [baseUrl])

  const trialBalance = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && ready && can('get_trial_balance') !== false
        ? keel.query<Json>('get_trial_balance', {}, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, can, ready],
  )

  const recon = useKeelQuery<Json[] | null>(
    (signal) =>
      hasToken && ready && can('get_reconciliation') !== false
        ? Promise.all(
            RECON_KINDS.map((kind) => keel.query<Json>('get_reconciliation', { kind }, { signal })),
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, can, ready],
  )

  const approvals = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && ready && can('list_pending_approvals') !== false
        ? keel.query<Json>('list_pending_approvals', {}, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, can, ready],
  )

  // Which period to show is a choice, not a computation: PeriodPicker asks Keel
  // for the options and for the one to start on.
  const [periodCode, setPeriodCode] = useState<string>('')

  const period = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && ready && periodCode && can('get_period') !== false
        ? keel.query<Json>('get_period', { period_code: periodCode }, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, periodCode, can, ready],
  )

  const env = scalar(health.data?.env)
  const balance = trialBalance.data
  const readiness = period.data?.close_readiness as Json | undefined
  const periodDoc = period.data?.period as Json | undefined
  const pending = approvals.data?.count

  function refreshAll() {
    health.reload()
    trialBalance.reload()
    recon.reload()
    approvals.reload()
    period.reload()
  }

  return (
    <div className="page">
      <header className="page-head">
        <h1>Status</h1>
        <div className="row">
          {env && <span className={`badge badge-env env-${String(env).toLowerCase()}`}>{env}</span>}
          <code className="muted mono">{baseUrl}</code>
          <button type="button" className="btn btn-quiet" onClick={refreshAll}>
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

      {!hasToken && (
        <section className="card">
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read the
            books, the reconciliations, the approval queue and a period's close readiness. Whatever
            your token cannot reach, Keel refuses and the refusal is shown here verbatim.
          </p>
        </section>
      )}

      {hasToken && (
        <>
          <section className="card">
            <h2>
              Books <span className="tool">get_trial_balance</span>
            </h2>
            {can('get_trial_balance') === false && <ScopeNote tool="get_trial_balance" />}
            {trialBalance.loading && <p className="muted">Loading…</p>}
            {trialBalance.error && (
              <ErrorBlock error={trialBalance.error} onRetry={trialBalance.reload} />
            )}
            {balance && (
              <dl className="fields">
                <Field
                  label="balanced"
                  value={<Ok value={balance.is_balanced} trueLabel="balanced" falseLabel="out of balance" />}
                />
                <Field label="period" value={scalar(balance.period) ?? 'all periods'} />
                <Field label="total debit" value={formatCents(balance.total_debit_cents)} />
                <Field label="total credit" value={formatCents(balance.total_credit_cents)} />
              </dl>
            )}
          </section>

          <section className="card">
            <h2>
              Reconciliation <span className="tool">get_reconciliation</span>
            </h2>
            {can('get_reconciliation') === false && <ScopeNote tool="get_reconciliation" />}
            {recon.loading && <p className="muted">Loading…</p>}
            {recon.error && <ErrorBlock error={recon.error} onRetry={recon.reload} />}
            {recon.data && (
              <dl className="fields">
                {recon.data.map((row, index) => (
                  <Field
                    key={scalar(row.kind) ?? index}
                    label={scalar(row.kind) ?? RECON_KINDS[index]}
                    value={
                      <span className="row">
                        <Ok value={row.reconciled} trueLabel="reconciled" falseLabel="difference" />
                        <span className="mono">{formatCents(row.difference_cents) ?? '—'}</span>
                      </span>
                    }
                  />
                ))}
              </dl>
            )}
          </section>

          <section className="card">
            <h2>
              Approvals waiting <span className="tool">list_pending_approvals</span>
            </h2>
            {can('list_pending_approvals') === false && (
              <ScopeNote tool="list_pending_approvals" />
            )}
            {approvals.loading && <p className="muted">Loading…</p>}
            {approvals.error && <ErrorBlock error={approvals.error} onRetry={approvals.reload} />}
            {approvals.data && (
              <p className="headline">
                <span className="headline-number">{scalar(pending) ?? '—'}</span>
                <span className="muted">
                  {pending === 0 ? 'nothing waiting on a human' : 'waiting on a human decision'}
                </span>
              </p>
            )}
          </section>

          <section className="card">
            <h2>
              Period <span className="tool">get_period</span>
            </h2>

            <div className="filters">
              <PeriodPicker value={periodCode} onChange={setPeriodCode} />
              <Link className="muted hint" to="/recon">
                full close-readiness checklist →
              </Link>
            </div>
            {can('get_period') === false && <ScopeNote tool="get_period" />}
            {period.loading && <p className="muted">Loading…</p>}
            {period.error && <ErrorBlock error={period.error} onRetry={period.reload} />}
            {readiness && (
              <dl className="fields">
                <Field label="status" value={scalar(periodDoc?.status)} />
                <Field label="dates" value={`${scalar(periodDoc?.start_date) ?? '—'} → ${scalar(periodDoc?.end_date) ?? '—'}`} />
                <Field
                  label="close ready"
                  value={<Ok value={readiness.ready} trueLabel="ready" falseLabel="not ready" />}
                />
                <Field
                  label="trial balance"
                  value={<Ok value={readiness.trial_balance_ok} trueLabel="ok" falseLabel="off" />}
                />
                <Field label="pending approvals" value={scalar(readiness.pending_approvals)} />
                <Field label="open GR/IR" value={formatCents(readiness.open_gr_ir_cents)} />
                <Field
                  label="uninvoiced shipment lines"
                  value={scalar(readiness.uninvoiced_shipment_lines)}
                />
                <Field label="blockers" value={<Notes items={readiness.blockers} tone="blocker" />} mono={false} />
                <Field label="warnings" value={<Notes items={readiness.warnings} tone="warning" />} mono={false} />
              </dl>
            )}
          </section>
        </>
      )}
    </div>
  )
}
