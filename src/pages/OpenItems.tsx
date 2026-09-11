import { useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import Field from '../components/Field'
import { keel } from '../lib/keelClient'
import { formatCents, openItemTarget, readOpenItems, type Json } from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** The two sub-ledgers `list_open_items` serves. */
const TABS = [
  { kind: 'ap', label: 'Payable', hint: 'what we owe suppliers' },
  { kind: 'ar', label: 'Receivable', hint: 'what customers owe us' },
] as const

export default function OpenItems() {
  const { baseUrl, hasToken } = useSession()
  const [kind, setKind] = useState<'ap' | 'ar'>('ap')
  const [overdueOnly, setOverdueOnly] = useState(false)
  const [party, setParty] = useState('')
  const [appliedParty, setAppliedParty] = useState('')

  const openItems = useKeelQuery<Json | null>(
    (signal) =>
      hasToken
        ? keel.query<Json>(
            'list_open_items',
            {
              kind,
              overdue_only: overdueOnly,
              ...(appliedParty ? { party: appliedParty } : {}),
            },
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, kind, overdueOnly, appliedParty],
  )

  const items = openItems.data ? readOpenItems(openItems.data) : null
  const tab = TABS.find((entry) => entry.kind === kind)

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Open items</h1>
        <p className="lede">
          Unpaid invoices with the remaining amounts and due dates Keel holds. Overdue is Keel's
          judgement, made against its own <code>as_of</code> date — the console does not compare
          dates.
        </p>
      </header>

      <section className="card">
        <div className="tabs">
          {TABS.map((entry) => (
            <button
              key={entry.kind}
              type="button"
              className={`tab ${kind === entry.kind ? 'is-active' : ''}`}
              onClick={() => setKind(entry.kind)}
            >
              {entry.label}
              <span className="muted tab-hint">{entry.hint}</span>
            </button>
          ))}
        </div>

        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedParty(party.trim())
          }}
        >
          <label className="filter filter-grow">
            <span className="label">Party</span>
            <input
              className="input mono"
              placeholder="supplier or customer code, e.g. ACME"
              value={party}
              spellCheck={false}
              onChange={(event) => setParty(event.target.value)}
            />
          </label>
          <label className="filter checkbox">
            <input
              type="checkbox"
              checked={overdueOnly}
              onChange={(event) => setOverdueOnly(event.target.checked)}
            />
            <span className="label">Overdue only</span>
          </label>
          <button type="submit" className="btn btn-quiet">
            Apply
          </button>
        </form>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read open
            items — it needs the <code className="scope">finance:read</code> scope.
          </p>
        )}
        {openItems.loading && <p className="muted">Loading…</p>}
        {openItems.error && <ErrorBlock error={openItems.error} onRetry={openItems.reload} />}

        {items && (
          <>
            <dl className="fields">
              <Field label="sub-ledger" value={`${items.kind ?? kind} — ${tab?.hint ?? ''}`} />
              <Field label="as of" value={items.asOf} />
              <Field label="open items" value={items.count} />
              <Field label="total remaining" value={formatCents(items.totalRemainingCents)} />
            </dl>

            {items.items.length === 0 ? (
              <p className="muted empty">
                {overdueOnly || appliedParty
                  ? 'Keel returned no open items for this filter.'
                  : `Keel has no open ${items.kind ?? kind} items.`}
              </p>
            ) : (
              <div className="table-scroll mt">
                <table className="feed">
                  <thead>
                    <tr>
                      <th className="col-doc">document</th>
                      <th>party</th>
                      <th className="col-money">amount</th>
                      <th className="col-money">remaining</th>
                      <th>due</th>
                      <th>status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.items.map((item) => {
                      const target = openItemTarget(item)
                      return (
                        <tr key={item.id ?? target}>
                          <td>
                            {target ? (
                              <Link className="doc-number" to={`/trace?doc=${encodeURIComponent(target)}`}>
                                {item.sourceDocNumber ?? item.sourceDocId}
                              </Link>
                            ) : (
                              <span className="muted">—</span>
                            )}
                            <span className="doc-type">{item.sourceDocType}</span>
                          </td>
                          <td className="mono">{item.partyId ?? <span className="muted">—</span>}</td>
                          <td className="col-money mono">{formatCents(item.amountCents)}</td>
                          <td className="col-money mono">{formatCents(item.remainingCents)}</td>
                          <td className="mono">
                            {item.dueDate ?? <span className="muted">—</span>}
                            {/* Keel's own count and verdict, never a date compared here. */}
                            {item.daysToDue !== null && (
                              <span className="muted"> · {item.daysToDue}d</span>
                            )}
                          </td>
                          <td>
                            <span className={`badge ${item.overdue ? 'badge-warn' : 'badge-ok'}`}>
                              {item.overdue ? 'overdue' : (item.status ?? 'open')}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  )
}
