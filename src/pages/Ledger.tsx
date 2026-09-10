import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import PeriodPicker from '../components/PeriodPicker'
import { keel } from '../lib/keelClient'
import {
  formatCents,
  readBalanceExplanation,
  readLedgerPage,
  readTrialBalance,
  type Json,
} from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** `get_ledger_entries` pages by `limit` alone; "show more" asks for a bigger page. */
const ENTRY_PAGE = 25

export default function Ledger() {
  const { baseUrl, hasToken } = useSession()
  const [period, setPeriod] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const trialBalance = useKeelQuery<Json | null>(
    (signal) =>
      hasToken
        ? keel.query<Json>(
            'get_trial_balance',
            period ? { period_code: period } : {},
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, period],
  )

  const balance = trialBalance.data ? readTrialBalance(trialBalance.data) : null

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Ledger</h1>
        <p className="lede">
          The trial balance Keel computes. Every figure below is Keel's; expand an account to see
          what moved it, grouped by the document that caused it.
        </p>
      </header>

      <section className="card">
        <div className="filters">
          <PeriodPicker value={period} onChange={setPeriod} allowAll />
          <span className="muted count">
            {balance?.period ? `period ${balance.period}` : 'all periods'}
          </span>
        </div>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read the
            ledger — it needs the <code className="scope">finance:read</code> scope.
          </p>
        )}
        {trialBalance.loading && <p className="muted">Loading…</p>}
        {trialBalance.error && (
          <ErrorBlock error={trialBalance.error} onRetry={trialBalance.reload} />
        )}

        {balance && (
          <>
            <div className="table-scroll">
              <table className="feed">
                <thead>
                  <tr>
                    <th className="col-code">account</th>
                    <th>name</th>
                    <th>type</th>
                    <th className="col-money">debit</th>
                    <th className="col-money">credit</th>
                    <th className="col-money">net</th>
                  </tr>
                </thead>
                <tbody>
                  {balance.accounts.map((account) => {
                    const code = account.code ?? ''
                    const open = expanded === code
                    return (
                      <Fragment key={code}>
                        <tr
                          className="feed-row"
                          onClick={() => setExpanded(open ? null : code)}
                        >
                          <td className="mono col-code">{code}</td>
                          <td>{account.name ?? <span className="muted">—</span>}</td>
                          <td className="muted">{account.type}</td>
                          <td className="mono col-money">{formatCents(account.debitCents)}</td>
                          <td className="mono col-money">{formatCents(account.creditCents)}</td>
                          <td className="mono col-money">{formatCents(account.netCents)}</td>
                        </tr>
                        {open && (
                          <tr>
                            <td colSpan={6} className="raw-cell">
                              <AccountDetail code={code} period={period} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th colSpan={3}>
                      {balance.isBalanced === null ? null : (
                        <span className={`badge ${balance.isBalanced ? 'badge-ok' : 'badge-warn'}`}>
                          {balance.isBalanced ? 'balanced' : 'out of balance'}
                        </span>
                      )}
                    </th>
                    <th className="mono col-money">{formatCents(balance.totalDebitCents)}</th>
                    <th className="mono col-money">{formatCents(balance.totalCreditCents)}</th>
                    <th />
                  </tr>
                </tfoot>
              </table>
            </div>
            <p className="muted hint">
              Totals and the balanced flag come from <code>get_trial_balance</code>; the console
              adds nothing up.
            </p>
          </>
        )}
      </section>
    </div>
  )
}

/** One account's movements: what caused them, then the entries themselves. */
function AccountDetail({ code, period }: { code: string; period: string }) {
  const { baseUrl } = useSession()
  const [limit, setLimit] = useState(ENTRY_PAGE)

  const explanation = useKeelQuery<Json>(
    (signal) =>
      keel.query<Json>(
        'explain_balance',
        { account_code: code, ...(period ? { period_code: period } : {}) },
        { signal },
      ),
    [baseUrl, code, period],
  )

  const ledger = useKeelQuery<Json>(
    (signal) =>
      keel.query<Json>(
        'get_ledger_entries',
        { account_code: code, limit, ...(period ? { period_code: period } : {}) },
        { signal },
      ),
    [baseUrl, code, period, limit],
  )

  const explained = explanation.data ? readBalanceExplanation(explanation.data) : null
  const entries = ledger.data ? readLedgerPage(ledger.data) : null

  return (
    <div className="detail">
      <h3>
        By source <span className="tool">explain_balance</span>
      </h3>
      {explanation.loading && <p className="muted">Loading…</p>}
      {explanation.error && <ErrorBlock error={explanation.error} onRetry={explanation.reload} />}
      {explained && (
        <dl className="fields">
          <Field label="debit" value={formatCents(explained.debitCents)} />
          <Field label="credit" value={formatCents(explained.creditCents)} />
          <Field label="net" value={formatCents(explained.netCents)} />
          {explained.reversalPairs.length > 0 && (
            <Field label="reversal pairs" value={explained.reversalPairs.length} />
          )}
          {explained.bySourceType.map((group) => (
            <Field
              key={group.sourceType ?? 'unknown'}
              label={group.sourceType ?? 'unknown'}
              value={`${formatCents(group.netCents) ?? '—'} over ${group.count ?? '—'} entries`}
            />
          ))}
        </dl>
      )}

      <h3 className="mt">
        Entries <span className="tool">get_ledger_entries</span>
      </h3>
      {ledger.loading && <p className="muted">Loading…</p>}
      {ledger.error && <ErrorBlock error={ledger.error} onRetry={ledger.reload} />}
      {entries && entries.entries.length === 0 && (
        <p className="muted empty">No entries on this account.</p>
      )}
      {entries && entries.entries.length > 0 && (
        <div className="table-scroll">
          <table className="feed">
            <thead>
              <tr>
                <th>entry</th>
                <th>posted</th>
                <th>description</th>
                <th>source</th>
                <th className="col-money">debit</th>
                <th className="col-money">credit</th>
                <th className="col-money">running</th>
              </tr>
            </thead>
            <tbody>
              {entries.entries.map((entry, index) => (
                <tr key={entry.entryId ?? index}>
                  <td className="mono">
                    <Link to={`/trace?doc=${encodeURIComponent(entry.entry ?? '')}`}>
                      {entry.entry ?? '—'}
                    </Link>
                  </td>
                  <td className="mono muted">{entry.postingDate}</td>
                  <td>{entry.description ?? entry.memo}</td>
                  <td className="muted">{entry.sourceType}</td>
                  <td className="mono col-money">{formatCents(entry.debitCents)}</td>
                  <td className="mono col-money">{formatCents(entry.creditCents)}</td>
                  <td className="mono col-money">{formatCents(entry.runningNetCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {entries && entries.entries.length >= limit && (
        <button
          type="button"
          className="btn btn-quiet btn-small mt"
          onClick={() => setLimit((current) => current + ENTRY_PAGE)}
        >
          Show {ENTRY_PAGE} more
        </button>
      )}
    </div>
  )
}
