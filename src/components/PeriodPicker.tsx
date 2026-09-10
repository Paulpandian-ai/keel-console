import { useEffect } from 'react'
import ErrorBlock from './ErrorBlock'
import { keel } from '../lib/keelClient'
import { readSearchPage, type Json } from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** `search_documents` accepts 1-500 per page; the ledger has ~36 periods. */
const PERIOD_PAGE = 500

/**
 * The period a page is looking at.
 *
 * Keel has no "current period" tool, so which period to show is a choice the
 * user makes, not a value the console derives: the options are the FiscalPeriod
 * documents Keel lists, and the initial pick is whatever Keel returns first for
 * `status: open`. Nothing here reads the browser clock.
 *
 * TODO: replace the two searches with a Keel tool that names the current period
 * (requested from the kernel alongside `list_document_types`).
 */
export default function PeriodPicker({
  value,
  onChange,
  allowAll = false,
}: {
  value: string
  onChange: (period: string) => void
  /** Offer "all periods", which is `get_trial_balance` with no `period_code`. */
  allowAll?: boolean
}) {
  const { baseUrl, hasToken } = useSession()

  const periods = useKeelQuery<Json | null>(
    (signal) =>
      hasToken
        ? keel.query<Json>(
            'search_documents',
            { type: 'FiscalPeriod', limit: PERIOD_PAGE },
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken],
  )

  const newestOpen = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && !allowAll
        ? keel.query<Json>(
            'search_documents',
            { type: 'FiscalPeriod', status: 'open', limit: 1 },
            { signal },
          )
        : Promise.resolve(null),
    [baseUrl, hasToken, allowAll],
  )

  const suggested = newestOpen.data ? readSearchPage(newestOpen.data).hits[0]?.number : undefined

  useEffect(() => {
    if (!value && suggested) onChange(suggested)
  }, [value, suggested, onChange])

  const options = periods.data ? readSearchPage(periods.data).hits : []

  return (
    <>
      <label className="filter">
        <span className="label">Period</span>
        <select
          className="input mono"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={!hasToken}
        >
          {allowAll ? (
            <option value="">all periods</option>
          ) : (
            !value && <option value="">select a period…</option>
          )}
          {options.map((hit) => (
            <option key={hit.id ?? hit.number} value={hit.number ?? ''}>
              {hit.number} — {hit.status}
            </option>
          ))}
        </select>
      </label>
      {periods.error && <ErrorBlock error={periods.error} onRetry={periods.reload} />}
    </>
  )
}
