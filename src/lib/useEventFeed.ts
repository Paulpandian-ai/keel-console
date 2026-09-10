import { useCallback, useEffect, useRef, useState } from 'react'
import { KeelApiError, keel } from './keelClient'
import { readEvent, rowsOf, type KeelEvent } from './keelFields'
import { useSession } from './useSession'

export type FeedMode = 'idle' | 'connecting' | 'live' | 'polling' | 'error'

const POLL_INTERVAL_MS = 5_000
const MAX_BUFFERED = 500

/** Auth failures are not a transport problem: polling would fail identically. */
function isAuthError(error: KeelApiError): boolean {
  return (
    error.httpStatus === 401 ||
    error.httpStatus === 403 ||
    error.code === 'UNAUTHORIZED' ||
    error.code === 'FORBIDDEN'
  )
}

/**
 * The live feed: SSE from `/events/stream`, falling back to polling
 * `poll_events` every 5s when the stream cannot be opened.
 */
export function useEventFeed(enabled: boolean) {
  const { baseUrl, hasToken } = useSession()
  const [events, setEvents] = useState<KeelEvent[]>([])
  const [mode, setMode] = useState<FeedMode>('idle')
  const [error, setError] = useState<KeelApiError | null>(null)
  const [nonce, setNonce] = useState(0)

  /** Highest sequence seen, so reconnects and polls resume from there. */
  const lastSeq = useRef<number | undefined>(undefined)

  const ingest = useCallback((incoming: KeelEvent[]) => {
    if (incoming.length === 0) return
    for (const event of incoming) {
      if (event.seq !== null && (lastSeq.current === undefined || event.seq > lastSeq.current)) {
        lastSeq.current = event.seq
      }
    }
    setEvents((current) => {
      const seen = new Set(current.map((e) => e.seq).filter((s): s is number => s !== null))
      const fresh = incoming.filter((e) => e.seq === null || !seen.has(e.seq))
      if (fresh.length === 0) return current
      // Newest first; the buffer is bounded rather than "load everything".
      return [...fresh.reverse(), ...current].slice(0, MAX_BUFFERED)
    })
  }, [])

  useEffect(() => {
    if (!enabled) {
      setMode('idle')
      return
    }

    const controller = new AbortController()
    let stopped = false
    let pollTimer: ReturnType<typeof setTimeout> | undefined

    function fail(caught: unknown) {
      if (stopped) return
      const asKeel =
        caught instanceof KeelApiError
          ? caught
          : new KeelApiError({ code: 'CONSOLE_ERROR', message: String(caught) })
      setError(asKeel)
      setMode('error')
    }

    async function poll() {
      if (stopped) return
      try {
        const payload = await keel.query<unknown>(
          'poll_events',
          { after_seq: lastSeq.current ?? 0, limit: 100 },
          { signal: controller.signal },
        )
        if (stopped) return
        ingest(rowsOf(payload, 'events').map(readEvent))
        setError(null)
        setMode('polling')
        pollTimer = setTimeout(poll, POLL_INTERVAL_MS)
      } catch (caught) {
        if (stopped || controller.signal.aborted) return
        fail(caught)
      }
    }

    async function start() {
      setMode('connecting')
      try {
        await keel.streamEvents({
          afterSeq: lastSeq.current,
          signal: controller.signal,
          onOpen: () => {
            if (stopped) return
            setError(null)
            setMode('live')
          },
          onFrame: (frame) => {
            if (stopped || frame.data === '') return
            try {
              const parsed: unknown = JSON.parse(frame.data)
              ingest(rowsOf(parsed, 'events').length > 0
                ? rowsOf(parsed, 'events').map(readEvent)
                : [readEvent(parsed)])
            } catch {
              // A frame that is not JSON still belongs in the feed.
              ingest([readEvent({ type: frame.event ?? 'message', message: frame.data })])
            }
          },
        })
        // The stream ended cleanly; keep the feed current by polling.
        if (!stopped && !controller.signal.aborted) void poll()
      } catch (caught) {
        if (stopped || controller.signal.aborted) return
        if (caught instanceof KeelApiError && isAuthError(caught)) {
          fail(caught)
          return
        }
        void poll()
      }
    }

    void start()

    return () => {
      stopped = true
      controller.abort()
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [enabled, baseUrl, hasToken, nonce, ingest])

  return {
    events,
    mode,
    error,
    clear: useCallback(() => setEvents([]), []),
    reconnect: useCallback(() => {
      setError(null)
      setNonce((n) => n + 1)
    }, []),
  }
}
