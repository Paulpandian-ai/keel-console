import { useEffect } from 'react'
import ErrorBlock from './ErrorBlock'
import { keel } from '../lib/keelClient'
import { readCurrentPeriod, readSearchPage, type Json } from '../lib/keelFields'
import { useKeelQuery } from '../lib/useKeelQuery'
import { useSession } from '../lib/useSession'

/** `search_documents` accepts 1-500 per page; the ledger has ~36 periods. */
const PERIOD_PAGE = 500

/**
 * The period a page is looking at.
 *
 * The options are the FiscalPeriod documents Keel lists, and the initial pick
 * is the period `get_current_period` names — Keel deciding against its own
 * `as_of`, not the console against the browser clock. That tool has landed, so
 * the old workaround (take whatever `search_documents(status: open, limit: 1)`
 * happened to return first) is gone.
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

  const current = useKeelQuery<Json | null>(
    (signal) =>
      hasToken && !allowAll
        ? keel.query<Json>('get_current_period', {}, { signal })
        : Promise.resolve(null),
    [baseUrl, hasToken, allowAll],
  )

  // Keel's answer for "now". `nearest_open_period` is what it falls back to
  // when `as_of` sits outside every open period; the console picks neither.
  const currentPeriod = current.data ? readCurrentPeriod(current.data) : null
  const suggested = currentPeriod?.code ?? currentPeriod?.nearestOpenPeriod ?? undefined

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
