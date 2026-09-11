import { Link } from 'react-router-dom'
import {
  countedLinesOf,
  discrepanciesOf,
  formatCents,
  scalar,
  type Effects as KeelEffects,
} from '../lib/keelFields'

/**
 * What a write would do, or has just done.
 *
 * Keel returns the same object for both: `simulate.projected_effects` and
 * `commit.effects`. Every figure here — the journal entry and whether it
 * balances, each balance delta, each quantity, each short/over count — is
 * Keel's. This component arranges them and formats money for display; it adds
 * nothing up and compares nothing.
 */
export default function Effects({ effects }: { effects: KeelEffects }) {
  const counted = countedLinesOf(effects)
  const discrepancies = discrepanciesOf(effects)
  const journal = effects.journalEntry

  const empty =
    effects.documents.length === 0 &&
    journal === null &&
    effects.balanceDeltas.length === 0 &&
    effects.inventoryDeltas.length === 0 &&
    effects.openItems.length === 0 &&
    counted.length === 0

  if (empty && effects.events.length === 0) {
    return <p className="muted empty">Keel projects no effects.</p>
  }

  return (
    <div className="effects">
      {counted.length > 0 && (
        <section className="effect-group">
          <h4>Counted</h4>
          <div className="table-scroll">
            <table className="feed">
              <thead>
                <tr>
                  <th>sku</th>
                  <th className="col-money">expected</th>
                  <th className="col-money">accepted</th>
                  <th className="col-money">damaged</th>
                  <th className="col-money">short</th>
                  <th className="col-money">over</th>
                  <th>note</th>
                </tr>
              </thead>
              <tbody>
                {counted.map((line, index) => (
                  <tr key={line.poLineId ?? line.sku ?? index}>
                    <td className="mono">{line.sku}</td>
                    <td className="col-money mono">{line.expectedQty}</td>
                    <td className="col-money mono">{line.qty}</td>
                    <td className="col-money mono">{line.damagedQty}</td>
                    {/* short_qty and over_qty are Keel's arithmetic, read back. */}
                    <td className="col-money mono">{line.shortQty}</td>
                    <td className="col-money mono">{line.overQty}</td>
                    <td className="muted">{line.note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {discrepancies.length > 0 && (
            <ul className="notes notes-warning">
              {discrepancies.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          )}
        </section>
      )}

      {effects.documents.length > 0 && (
        <section className="effect-group">
          <h4>Documents</h4>
          <ul className="effect-docs">
            {effects.documents.map((doc, index) => (
              <li key={doc.id ?? index} className="effect-doc">
                <div className="row">
                  <span className={`badge ${doc.action === 'create' ? 'badge-ok' : ''}`}>
                    {doc.action}
                  </span>
                  <span className="doc-type">{doc.type}</span>
                  {doc.number &&
                    (doc.id ? (
                      <Link className="doc-number" to={`/trace?doc=${encodeURIComponent(doc.id)}`}>
                        {doc.number}
                      </Link>
                    ) : (
                      <span className="doc-number">{doc.number}</span>
                    ))}
                  {doc.status && <span className="badge">{doc.status}</span>}
                </div>
                {Object.keys(doc.fields).length > 0 && (
                  <details className="raw">
                    <summary>{Object.keys(doc.fields).length} fields</summary>
                    <pre>{JSON.stringify(doc.fields, null, 2)}</pre>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {journal && (
        <section className="effect-group">
          <h4>
            Journal entry
            {journal.isBalanced !== null && (
              <span className={`badge ${journal.isBalanced ? 'badge-ok' : 'badge-warn'}`}>
                {journal.isBalanced ? 'balanced' : 'unbalanced'}
              </span>
            )}
          </h4>
          {journal.memo && <p className="muted">{journal.memo}</p>}
          <div className="table-scroll">
            <table className="feed">
              <thead>
                <tr>
                  <th className="col-code">account</th>
                  <th>description</th>
                  <th className="col-money">debit</th>
                  <th className="col-money">credit</th>
                </tr>
              </thead>
              <tbody>
                {journal.lines.map((line, index) => (
                  <tr key={index}>
                    <td className="col-code mono">{line.account}</td>
                    <td>{line.description}</td>
                    <td className="col-money mono">{formatCents(line.debitCents)}</td>
                    <td className="col-money mono">{formatCents(line.creditCents)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  {/* Keel's totals, not a sum of the rows above. */}
                  <td colSpan={2} className="muted">
                    posting date {journal.postingDate ?? '—'}
                  </td>
                  <td className="col-money mono">{formatCents(journal.totalDebitCents)}</td>
                  <td className="col-money mono">{formatCents(journal.totalCreditCents)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </section>
      )}

      {effects.balanceDeltas.length > 0 && (
        <section className="effect-group">
          <h4>Balance deltas</h4>
          <ul className="deltas">
            {effects.balanceDeltas.map((delta, index) => (
              <li key={delta.account ?? index}>
                <span className="mono col-code">{delta.account}</span>
                <span className={`mono delta ${(delta.deltaCents ?? 0) < 0 ? 'delta-down' : 'delta-up'}`}>
                  {formatCents(delta.deltaCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {effects.inventoryDeltas.length > 0 && (
        <section className="effect-group">
          <h4>Inventory deltas</h4>
          <ul className="deltas">
            {effects.inventoryDeltas.map((delta, index) => (
              <li key={delta.sku ?? index}>
                <span className="mono">{delta.sku}</span>
                <span className={`mono delta ${(delta.qtyDelta ?? 0) < 0 ? 'delta-down' : 'delta-up'}`}>
                  {delta.qtyDelta}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {effects.openItems.length > 0 && (
        <section className="effect-group">
          <h4>Open items</h4>
          <pre className="raw">{JSON.stringify(effects.openItems, null, 2)}</pre>
        </section>
      )}

      {effects.events.length > 0 && (
        <section className="effect-group">
          <h4>Events</h4>
          <div className="row">
            {effects.events.map((event) => (
              <span key={event} className="inline-tag tag-event">
                {scalar(event)}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}
