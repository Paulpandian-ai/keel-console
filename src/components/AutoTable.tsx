import { formatCents, formatTimestamp, scalar, type Json } from '../lib/keelFields'

/**
 * A table for rows whose keys the console has not recorded yet.
 *
 * `list_open_items` has only ever answered with `items: []` on the seeded
 * dataset, so no row has been seen and there is nothing to pin. Rather than
 * invent column names, this renders whatever keys Keel sends, in the order it
 * sends them, formatting by suffix: `*_cents` as money, `*_date` / `*_at` as a
 * timestamp, everything else verbatim. When a dataset with AP/AR data exists,
 * record the shape and replace this with a real table.
 */
export default function AutoTable({ rows, emptyLabel }: { rows: Json[]; emptyLabel: string }) {
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
