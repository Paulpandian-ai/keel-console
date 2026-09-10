import { useCallback, useEffect, useState } from 'react'
import { KeelApiError } from './keelClient'

export interface QueryState<T> {
  data: T | null
  error: KeelApiError | null
  loading: boolean
  /** Re-runs the call. */
  reload: () => void
}

/**
 * Runs one Keel call and tracks its state. Keeps components free of fetch
 * plumbing; all transport still goes through `keelClient`.
 */
export function useKeelQuery<T>(
  run: (signal: AbortSignal) => Promise<T>,
  deps: readonly unknown[],
): QueryState<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<KeelApiError | null>(null)
  const [loading, setLoading] = useState(true)
  const [nonce, setNonce] = useState(0)

  // `run` is redefined each render; deps are supplied by the caller.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const call = useCallback(run, deps)

  useEffect(() => {
    const controller = new AbortController()
    let active = true

    setLoading(true)
    call(controller.signal)
      .then((result) => {
        if (!active) return
        setData(result)
        setError(null)
      })
      .catch((caught: unknown) => {
        if (!active || controller.signal.aborted) return
        setData(null)
        setError(
          caught instanceof KeelApiError
            ? caught
            : new KeelApiError({ code: 'CONSOLE_ERROR', message: String(caught) }),
        )
      })
      .finally(() => {
        if (active) setLoading(false)
      })

    return () => {
      active = false
      controller.abort()
    }
  }, [call, nonce])

  return { data, error, loading, reload: useCallback(() => setNonce((n) => n + 1), []) }
}
