import { formatCents, formatTimestamp, scalar, type Json } from '../lib/keelFields'

/**
 * A table for rows whose keys vary by the argument Keel was called with.
 *
 * `get_reconciliation` answers with a different detail array per kind —
 * `open_items` for ap/ar, `items` for inventory, `by_po` for gr_ir — and only
 * the first two have ever come back populated (`by_po` is still empty on the
 * seeded dataset). Those drilldowns sit behind a `<details>` and are rendered
 * as whatever keys Keel sends, in the order it sends them, formatted by suffix:
 * `*_cents` as money, `*_date` / `*_at` as a timestamp, everything else
 * verbatim.
 *
 * This is deliberately *not* used for a shape the console has recorded. Open
 * items had a reader written the moment a live row existed; see `readOpenItem`.
 */
export default function RawRows({ rows, emptyLabel }: { rows: Json[]; emptyLabel: string }) {
  if (rows.length === 0) return <p className="muted empty">{emptyLabel}</p>

  const columns: string[] = []
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key)
    }
  }

  return (
    <div className="table-scroll">
      <table className="feed">
        <thead>
          <tr>
            {columns.map((column) => (
              <th key={column}>{column.replace(/_/g, ' ')}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index}>
              {columns.map((column) => (
                <td key={column} className="mono">
                  {renderCell(column, row[column])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function renderCell(column: string, value: unknown) {
  if (value === null || value === undefined) return <span className="muted">—</span>
  if (column.endsWith('_cents')) return formatCents(value) ?? <span className="muted">—</span>
  if (column.endsWith('_date') || column.endsWith('_at')) return formatTimestamp(value)
  return scalar(value)
}
