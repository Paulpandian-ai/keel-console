/**
 * The console's only door to Keel.
 *
 * Non-negotiable #1: no business logic lives here or in any component. This
 * module moves payloads and normalizes errors; it never computes a value.
 * Components never call `fetch` directly — they call this client.
 */

import { getBaseUrl, getToken } from './session'
import { SseDecoder, type SseFrame } from './sse'

/** Every Keel response carries this envelope. */
export interface KeelEnvelope {
  ok: boolean
  mode?: string
  request_id?: string
}

export interface KeelErrorBody {
  code: string
  message: string
  details?: unknown
}

export interface KeelErrorEnvelope extends KeelEnvelope {
  ok: false
  error: KeelErrorBody
}

/** `GET /healthz` — the one unauthenticated endpoint. */
export interface KeelHealth {
  status: string
  version?: string
  env?: string
  signing_key_id?: string
  event_seq?: number
  policy_version?: number
}

/** Keel pages with `limit` + `cursor`; the console never loads everything. */
export interface KeelPageRequest {
  limit?: number
  cursor?: string | null
}

export interface KeelPageInfo {
  next_cursor?: string | null
  has_more?: boolean
}

export type ToolPayload = Record<string, unknown>

/**
 * Any failed call, whether Keel answered with an error envelope or the network
 * did. `code`, `message` and `requestId` are shown to the user verbatim so they
 * can be pasted into `explain_error`.
 */
export class KeelApiError extends Error {
  readonly code: string
  readonly requestId?: string
  readonly details?: unknown
  readonly httpStatus?: number
  readonly tool?: string

  constructor(init: {
    code: string
    message: string
    requestId?: string
    details?: unknown
    httpStatus?: number
    tool?: string
  }) {
    super(init.message)
    this.name = 'KeelApiError'
    this.code = init.code
    this.requestId = init.requestId
    this.details = init.details
    this.httpStatus = init.httpStatus
    this.tool = init.tool
  }
}

export function isKeelApiError(error: unknown): error is KeelApiError {
  return error instanceof KeelApiError
}

/** Commit keys are `console:<request_id>:<tool>`, fresh per commit. */
export function makeIdempotencyKey(requestId: string, tool: string): string {
  return `console:${requestId}:${tool}`
}

export interface CallOptions {
  signal?: AbortSignal
  /** Milliseconds before the request is aborted. Default 30s. */
  timeoutMs?: number
}

export interface CommitOptions extends CallOptions {
  idempotencyKey: string
  simulationId?: string
}

export interface KeelClientConfig {
  getBaseUrl: () => string
  getToken: () => string | null
  fetch: typeof fetch
}

type CallKind = 'query' | 'simulate' | 'commit'

const DEFAULT_TIMEOUT_MS = 30_000

function parseErrorEnvelope(body: unknown): KeelErrorBody | null {
  if (typeof body !== 'object' || body === null) return null
  const error = (body as { error?: unknown }).error
  if (typeof error !== 'object' || error === null) return null
  const { code, message } = error as { code?: unknown; message?: unknown }
  if (typeof code !== 'string' || typeof message !== 'string') return null
  return { code, message, details: (error as { details?: unknown }).details }
}

function requestIdOf(body: unknown): string | undefined {
  if (typeof body !== 'object' || body === null) return undefined
  const id = (body as { request_id?: unknown }).request_id
  return typeof id === 'string' ? id : undefined
}


export interface StreamEventsOptions {
  /** Resume point: Keel replays events after this sequence number. */
  afterSeq?: number
  /** Called for every decoded frame, in order. */
  onFrame: (frame: SseFrame) => void
  /** Called once the response headers say the stream is open. */
  onOpen?: () => void
  signal: AbortSignal
}

export function createKeelClient(config: KeelClientConfig) {
  async function request<T>(
    method: 'GET' | 'POST',
    path: string,
    body: ToolPayload | undefined,
    options: CallOptions,
    tool?: string,
  ): Promise<T> {
    const url = `${config.getBaseUrl()}${path}`
    const token = config.getToken()

    const headers: Record<string, string> = { Accept: 'application/json' }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    // The token travels in this header and nowhere else — never in the URL.
    if (token) headers.Authorization = `Bearer ${token}`

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS)
    const onAbort = () => controller.abort()
    options.signal?.addEventListener('abort', onAbort)

    let response: Response
    try {
      response = await config.fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (cause) {
      const aborted = options.signal?.aborted ?? false
      throw new KeelApiError({
        code: aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR',
        message: aborted
          ? 'Request cancelled.'
          : `Could not reach Keel at ${config.getBaseUrl()}. Check the base URL in Settings.`,
        details: String(cause),
        tool,
      })
    } finally {
      clearTimeout(timeout)
      options.signal?.removeEventListener('abort', onAbort)
    }

    const text = await response.text()
    let parsed: unknown = undefined
    if (text.length > 0) {
      try {
        parsed = JSON.parse(text)
      } catch {
        throw new KeelApiError({
          code: 'INVALID_RESPONSE',
          message: `Keel returned a non-JSON response (HTTP ${response.status}).`,
          details: text.slice(0, 500),
          httpStatus: response.status,
          tool,
        })
      }
    }

    const errorBody = parseErrorEnvelope(parsed)
    if (errorBody) {
      throw new KeelApiError({
        ...errorBody,
        requestId: requestIdOf(parsed),
        httpStatus: response.status,
        tool,
      })
    }

    if (!response.ok) {
      throw new KeelApiError({
        code: `HTTP_${response.status}`,
        message:
          response.status === 404 && tool
            ? `Keel has no endpoint for \`${tool}\` at this base URL (HTTP 404).`
            : `Keel returned HTTP ${response.status}.`,
        details: parsed ?? text.slice(0, 500),
        httpStatus: response.status,
        tool,
      })
    }

    return parsed as T
  }

  function callTool<T>(
    kind: CallKind,
    tool: string,
    payload: ToolPayload,
    options: CallOptions,
  ): Promise<T> {
    return request<T>('POST', `/api/${kind}/${tool}`, payload, options, tool)
  }

  return {
    /** `GET /healthz`. Unauthenticated; used by Status to prove reachability. */
    health(options: CallOptions = {}): Promise<KeelHealth> {
      return request<KeelHealth>('GET', '/healthz', undefined, options, 'healthz')
    },

    /** Read tools: `POST /api/query/{tool}`. */
    query<T>(tool: string, payload: ToolPayload = {}, options: CallOptions = {}): Promise<T> {
      return callTool<T>('query', tool, payload, options)
    },

    /** Dry run of a write; returns the projected effects to show the user. */
    simulate<T>(tool: string, payload: ToolPayload = {}, options: CallOptions = {}): Promise<T> {
      return callTool<T>('simulate', tool, payload, options)
    },

    /**
     * `GET /events/stream` as SSE. Resolves when the stream ends, rejects with a
     * `KeelApiError` if it cannot be opened, so the caller can fall back to
     * polling `poll_events`.
     */
    async streamEvents(options: StreamEventsOptions): Promise<void> {
      const base = config.getBaseUrl()
      const token = config.getToken()
      const query = options.afterSeq === undefined ? '' : `?after_seq=${encodeURIComponent(options.afterSeq)}`
      const headers: Record<string, string> = { Accept: 'text/event-stream' }
      if (token) headers.Authorization = `Bearer ${token}`

      let response: Response
      try {
        response = await config.fetch(`${base}/events/stream${query}`, {
          method: 'GET',
          headers,
          signal: options.signal,
        })
      } catch (cause) {
        throw new KeelApiError({
          code: options.signal.aborted ? 'REQUEST_CANCELLED' : 'NETWORK_ERROR',
          message: options.signal.aborted
            ? 'Stream cancelled.'
            : `Could not open the event stream at ${base}.`,
          details: String(cause),
          tool: 'events/stream',
        })
      }

      if (!response.ok || !response.body) {
        // Errors on this endpoint arrive as a normal JSON envelope.
        const text = await response.text().catch(() => '')
        let parsed: unknown
        try {
          parsed = text ? JSON.parse(text) : undefined
        } catch {
          parsed = undefined
        }
        const errorBody = parseErrorEnvelope(parsed)
        throw new KeelApiError({
          code: errorBody?.code ?? `HTTP_${response.status}`,
          message: errorBody?.message ?? `Event stream unavailable (HTTP ${response.status}).`,
          requestId: requestIdOf(parsed),
          details: errorBody?.details ?? text.slice(0, 500),
          httpStatus: response.status,
          tool: 'events/stream',
        })
      }

      options.onOpen?.()

      const reader = response.body.getReader()
      const utf8 = new TextDecoder()
      const decoder = new SseDecoder()

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          for (const frame of decoder.push(utf8.decode(value, { stream: true }))) {
            options.onFrame(frame)
          }
        }
        const trailing = decoder.flush()
        if (trailing) options.onFrame(trailing)
      } finally {
        reader.cancel().catch(() => {})
      }
    },

    /** The write itself. Always preceded by `simulate` and a confirmation. */
    commit<T>(tool: string, payload: ToolPayload, options: CommitOptions): Promise<T> {
      const { idempotencyKey, simulationId, ...rest } = options
      return callTool<T>(
        'commit',
        tool,
        {
          ...payload,
          idempotency_key: idempotencyKey,
          ...(simulationId ? { simulation_id: simulationId } : {}),
        },
        rest,
      )
    },
  }
}

export type KeelClient = ReturnType<typeof createKeelClient>

/** The app-wide client, bound to the current session. */
export const keel: KeelClient = createKeelClient({
  getBaseUrl,
  getToken,
  fetch: (...args) => globalThis.fetch(...args),
})
