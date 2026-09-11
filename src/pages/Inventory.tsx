import { useState } from 'react'
import { Link } from 'react-router-dom'
import ErrorBlock from '../components/ErrorBlock'
import ScopeNote from '../components/ScopeNote'
import Field from '../components/Field'
import { keel } from '../lib/keelClient'
import { formatCents, readInventory, readReconciliation, scalar, type Json } from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'
import { useWhoami } from '../lib/useWhoami'

export default function Inventory() {
  const { baseUrl, hasToken } = useSession()
  const { can, ready } = useWhoami()
  const [sku, setSku] = useState('')
  const [appliedSku, setAppliedSku] = useState('')

  const inventory = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && ready && can('get_inventory') !== false
        ? keel.query<Json>('get_inventory', appliedSku ? { sku: appliedSku } : {}, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, appliedSku, can, ready],
  )

  const recon = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && ready && can('get_reconciliation') !== false
        ? keel.query<Json>('get_reconciliation', { kind: 'inventory' }, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, can, ready],
  )

  const stock = inventory.data ? readInventory(inventory.data) : null
  const reconciliation = recon.data ? readReconciliation(recon.data) : null

  return (
    <div className="page page-wide">
      <header className="page-head">
        <h1>Inventory</h1>
        <p className="lede">
          On-hand quantities at standard cost, and the difference Keel reports between account 1300
          and the stock sub-ledger.
        </p>
      </header>

      <section className="card">
        <h2>
          GL vs sub-ledger <span className="tool">get_reconciliation(inventory)</span>
        </h2>
        {recon.loading && <p className="muted">Loading…</p>}
        {recon.error && <ErrorBlock error={recon.error} onRetry={recon.reload} />}
        {reconciliation && (
          <>
            <dl className="fields">
              <Field
                label="reconciled"
                value={
                  reconciliation.reconciled === null ? null : (
                    <span
                      className={`badge ${reconciliation.reconciled ? 'badge-ok' : 'badge-warn'}`}
                    >
                      {reconciliation.reconciled ? 'reconciled' : 'difference'}
                    </span>
                  )
                }
              />
              <Field label="GL account 1300" value={formatCents(reconciliation.raw.gl_1300_net_cents)} />
              <Field
                label="sub-ledger value"
                value={formatCents(reconciliation.raw.subledger_value_cents)}
              />
              <Field label="difference" value={formatCents(reconciliation.differenceCents)} />
            </dl>
            {reconciliation.raw.note && (
              <p className="muted hint">{scalar(reconciliation.raw.note)}</p>
            )}
          </>
        )}
      </section>

      <section className="card">
        <h2>
          Stock <span className="tool">get_inventory</span>
        </h2>

        <form
          className="filters"
          onSubmit={(event) => {
            event.preventDefault()
            setAppliedSku(sku.trim())
          }}
        >
          <label className="filter filter-grow">
            <span className="label">SKU</span>
            <input
              className="input mono"
              placeholder="one sku, e.g. VALVE-2IN — blank for all"
              value={sku}
              spellCheck={false}
              onChange={(event) => setSku(event.target.value)}
            />
          </label>
          <button type="submit" className="btn btn-quiet">
            Apply
          </button>
          {stock && (
            <span className="muted count">total {formatCents(stock.totalValueCents) ?? '—'}</span>
          )}
        </form>

        {!hasToken && (
          <p className="muted">
            No token in this session. <Link to="/settings">Add one in Settings</Link> to read
            inventory — it needs the <code className="scope">inventory:read</code> scope.
          </p>
        )}
        {hasToken && can('get_inventory') === false && (
          <ScopeNote tool="get_inventory" what="stock cannot be read" />
        )}
        {inventory.loading && <p className="muted">Loading…</p>}
        {inventory.error && <ErrorBlock error={inventory.error} onRetry={inventory.reload} />}

        {stock && stock.items.length === 0 && <p className="muted empty">Keel returned no items.</p>}
        {stock && stock.items.length > 0 && (
          <div className="table-scroll">
            <table className="feed">
              <thead>
                <tr>
                  <th className="col-code">sku</th>
                  <th>name</th>
                  <th className="col-money">on hand</th>
                  <th className="col-money">standard cost</th>
                  <th className="col-money">list price</th>
                  <th className="col-money">value</th>
                </tr>
              </thead>
              <tbody>
                {stock.items.map((item) => (
                  <tr key={item.sku}>
                    <td className="mono col-code">
                      <Link to={`/trace?doc=${encodeURIComponent(item.sku ?? '')}`}>{item.sku}</Link>
                    </td>
                    <td>
                      {item.name}
                      {item.isStocked === false && <span className="badge">not stocked</span>}
                      {item.isActive === false && <span className="badge badge-warn">inactive</span>}
                    </td>
                    <td className="mono col-money">{item.onHandQty}</td>
                    <td className="mono col-money">{formatCents(item.standardCostCents)}</td>
                    <td className="mono col-money">{formatCents(item.listPriceCents)}</td>
                    <td className="mono col-money">{formatCents(item.valueCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th colSpan={5}>total value</th>
                  <th className="mono col-money">{formatCents(stock.totalValueCents)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
