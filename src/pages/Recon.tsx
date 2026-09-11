import { useState } from 'react'
import { Link } from 'react-router-dom'
import RawRows from '../components/RawRows'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import PeriodPicker from '../components/PeriodPicker'
import { keel } from '../lib/keelClient'
import {
  formatCents,
  readPeriodReadiness,
  readReconciliation,
  scalar,
  type Json,
  type Reconciliation,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** The four reconciliations, with the fields each kind carries. */
const KINDS = [
  {
    kind: 'gr_ir',
    title: 'GR/IR',
    blurb: 'received but not yet invoiced, against account 1400',
    fields: [
      ['GL account 1400', 'gl_1400_net_cents'],
      ['sub-ledger open', 'subledger_open_cents'],
    ],
    rowsKey: 'by_po',
    rowsLabel: 'by purchase order',
  },
  {
    kind: 'ap',
    title: 'Accounts payable',
    blurb: 'supplier open items against the control account',
    fields: [
      ['control account', 'control_account'],
      ['control account balance', 'control_account_cents'],
      ['sub-ledger', 'subledger_cents'],
    ],
    rowsKey: 'open_items',
    rowsLabel: 'open items',
  },
  {
    kind: 'ar',
    title: 'Accounts receivable',
    blurb: 'customer open items against the control account',
    fields: [
      ['control account', 'control_account'],
      ['control account balance', 'control_account_cents'],
      ['sub-ledger', 'subledger_cents'],
    ],
    rowsKey: 'open_items',
    rowsLabel: 'open items',
  },
  {
    kind: 'inventory',
    title: 'Inventory',
    blurb: 'on-hand at standard cost against account 1300',
    fields: [
      ['GL account 1300', 'gl_1300_net_cents'],
      ['sub-ledger value', 'subledger_value_cents'],
    ],
    rowsKey: 'items',
    rowsLabel: 'items',
  },
] as const

export default function Recon() {
  const { baseUrl, hasToken } = useSession()
  const [period, setPeriod] = useState('')

  const reconciliations = useKeelQuery<Json[] | null>(
    (signal) =>
      hasToken
        ? Promise.all(
            KINDS.map(({ kind }) => keel.query<Json>('get_reconciliation', { kind }, { signal })),
          )
        : Promise.resolve(null),
    [baseUrl, hasToken],
  )

  const periodQuery = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && period
        ? keel.query<Json>('get_period', { period_code: period }, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, period],
  )

  const readiness = periodQuery.data ? readPeriodReadiness(periodQuery.data) : null

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Close readiness</h1>
        <p className="lede">
          Read-only. Every check below is Keel's verdict, not the console's, and there is no close
          button here — closing a period is the Controller agent's job.
        </p>
      </header>

      <section className="card">
        <h2>
          Checklist <span className="tool">get_period</span>
        </h2>
        <div className="filters">
          <PeriodPicker value={period} onChange={setPeriod} />
          {readiness?.status && <span className="badge">{readiness.status}</span>}
          {readiness?.ready !== undefined && readiness?.ready !== null && (
            <span className={`badge ${readiness.ready ? 'badge-ok' : 'badge-warn'}`}>
              {readiness.ready ? 'ready to close' : 'not ready'}
            </span>
          )}
        </div>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read close
            readiness.
          </p>
        )}
        {periodQuery.loading && <p className="muted">Loading…</p>}
        {periodQuery.error && <ErrorBlock error={periodQuery.error} onRetry={periodQuery.reload} />}

        {readiness && (
          <>
            <dl className="fields">
              <Field label="period" value={readiness.code} />
              <Field
                label="dates"
                value={`${readiness.startDate ?? '—'} → ${readiness.endDate ?? '—'}`}
              />
              <Field
                label="trial balance"
                value={
                  readiness.trialBalanceOk === null ? null : (
                    <span className={`badge ${readiness.trialBalanceOk ? 'badge-ok' : 'badge-warn'}`}>
                      {readiness.trialBalanceOk ? 'ok' : 'off'}
                    </span>
                  )
                }
              />
              <Field label="pending approvals" value={readiness.pendingApprovals} />
              <Field label="open GR/IR" value={formatCents(readiness.openGrIrCents)} />
              <Field label="uninvoiced shipment lines" value={readiness.uninvoicedShipmentLines} />
              <Field label="draft purchase orders" value={readiness.draftPurchaseOrders.length} />
              <Field
                label="blocked supplier invoices"
                value={readiness.blockedSupplierInvoices.length}
              />
            </dl>

            <div className="notes-pair mt">
              <div>
                <h3>Blockers</h3>
                {readiness.blockers.length === 0 ? (
                  <p className="muted">none</p>
                ) : (
                  <ul className="notes notes-blocker">
                    {readiness.blockers.map((item, index) => (
                      <li key={index}>{scalar(item)}</li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>Warnings</h3>
                {readiness.warnings.length === 0 ? (
                  <p className="muted">none</p>
                ) : (
                  <ul className="notes notes-warning">
                    {readiness.warnings.map((item, index) => (
                      <li key={index}>{scalar(item)}</li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </>
        )}
      </section>

      <section className="card">
        <h2>
          Reconciliations <span className="tool">get_reconciliation</span>
        </h2>
        {reconciliations.loading && <p className="muted">Loading…</p>}
        {reconciliations.error && (
          <ErrorBlock error={reconciliations.error} onRetry={reconciliations.reload} />
        )}
        {reconciliations.data && (
          <div className="recon-grid">
            {reconciliations.data.map((raw, index) => (
              <ReconCard
                key={KINDS[index].kind}
                spec={KINDS[index]}
                reconciliation={readReconciliation(raw)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function ReconCard({
  spec,
  reconciliation,
}: {
  spec: (typeof KINDS)[number]
  reconciliation: Reconciliation
}) {
  const rows = reconciliation.raw[spec.rowsKey]

  return (
    <div className="recon-card">
      <div className="row">
        <h3>{spec.title}</h3>
        {reconciliation.reconciled !== null && (
          <span className={`badge ${reconciliation.reconciled ? 'badge-ok' : 'badge-warn'}`}>
            {reconciliation.reconciled ? 'reconciled' : 'difference'}
          </span>
        )}
      </div>
      <p className="muted hint">{spec.blurb}</p>
      <dl className="fields">
        {spec.fields.map(([label, key]) => (
          <Field
            key={key}
            label={label}
            value={key.endsWith('_cents') ? formatCents(reconciliation.raw[key]) : scalar(reconciliation.raw[key])}
          />
        ))}
        <Field label="difference" value={formatCents(reconciliation.differenceCents)} />
      </dl>
      {Array.isArray(rows) && rows.length > 0 && (
        <details className="raw">
          <summary>
            {rows.length} {spec.rowsLabel}
          </summary>
          <RawRows rows={rows as Json[]} emptyLabel="none" />
        </details>
      )}
    </div>
  )
}
