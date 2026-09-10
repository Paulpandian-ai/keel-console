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
  /**
   * Present on some errors and not others, verified live: `VALIDATION_ERROR`
   * carries `{errors, expected_fields, required_fields}`, `NOT_FOUND` on a
   * document carries `{type, ref}`, `FORBIDDEN` carries `{required_scope}`.
   * `NOT_FOUND` for an unknown tool carries no `details` and no `request_id`.
   */
  details?: unknown
  /** Every error envelope observed so far carries this. Shown verbatim. */
  retry_advice?: string
}

export interface KeelErrorEnvelope extends KeelEnvelope {
  ok: false
  error: KeelErrorBody
}

/**
 * Success envelope of every tool call: `{ok, mode, request_id, tool, result}`,
 * verified live against the facade. The payload a page wants is `result`.
 */
export interface KeelResultEnvelope<T> extends KeelEnvelope {
  ok: true
  tool?: string
  result: T
}

/** `GET /healthz` — the one unauthenticated endpoint, and the only bare body. */
export interface KeelHealth {
  status: string
  version?: string
  env?: string
  signing_key_id?: string
  event_seq?: number
  policy_version?: number
}

/**
 * Keel pages with `limit` + `offset` (`search_documents`, `get_request_log`) or
 * with `after_seq` + `limit` (`poll_events`). There is no cursor anywhere in the
 * catalog. The console never loads everything.
 */
export interface KeelPageRequest {
  limit?: number
  offset?: number
}

/** What a paged list response carries back: the window it answered with. */
export interface KeelPageInfo {
  count?: number
  offset?: number
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
  /** Keel's own guidance on what to do next. Shown verbatim. */
  readonly retryAdvice?: string
  readonly httpStatus?: number
  readonly tool?: string

  constructor(init: {
    code: string
    message: string
    requestId?: string
    details?: unknown
    retryAdvice?: string
    httpStatus?: number
    tool?: string
  }) {
    super(init.message)
    this.name = 'KeelApiError'
    this.code = init.code
    this.requestId = init.requestId
    this.details = init.details
    this.retryAdvice = init.retryAdvice
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
  const advice = (error as { retry_advice?: unknown }).retry_advice
  return {
    code,
    message,
    details: (error as { details?: unknown }).details,
    retry_advice: typeof advice === 'string' ? advice : undefined,
  }
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
        code: errorBody.code,
        message: errorBody.message,
        details: errorBody.details,
        retryAdvice: errorBody.retry_advice,
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
  ): Promise<KeelResultEnvelope<T>> {
    return request<KeelResultEnvelope<T>>('POST', `/api/${kind}/${tool}`, payload, options, tool)
  }

  return {
    /** `GET /healthz`. Unauthenticated; used by Status to prove reachability. */
    health(options: CallOptions = {}): Promise<KeelHealth> {
      return request<KeelHealth>('GET', '/healthz', undefined, options, 'healthz')
    },

    /**
     * Read tools: `POST /api/query/{tool}`. Resolves to the envelope's `result`,
     * which is the only part a read page has any use for.
     */
    async query<T>(tool: string, payload: ToolPayload = {}, options: CallOptions = {}): Promise<T> {
      const envelope = await callTool<T>('query', tool, payload, options)
      return envelope.result
    },

    /**
     * Dry run of a write; returns the projected effects to show the user. Unlike
     * `query` this hands back the whole envelope, because the commit that
     * follows needs its `request_id` for the idempotency key.
     */
    simulate<T>(
      tool: string,
      payload: ToolPayload = {},
      options: CallOptions = {},
    ): Promise<KeelResultEnvelope<T>> {
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
          retryAdvice: errorBody?.retry_advice,
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
    commit<T>(
      tool: string,
      payload: ToolPayload,
      options: CommitOptions,
    ): Promise<KeelResultEnvelope<T>> {
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

/**
 * The document types Keel knows about.
 *
 * `search_documents` requires a `type`, but no query tool in the catalog returns
 * the list of legal types — the only component that will name them is
 * `search_documents` itself, which rejects an unknown type with
 * `details.known: [...]`. So the console asks it once, lazily, and caches the
 * answer for the page view. The list is still Keel's, never the console's.
 *
 * This is the one place in the console that leans on an error for data.
 *
 * TODO: replace with `list_document_types` (requested from the kernel) — or
 * type enums on `list_capabilities` — and delete this function once it lands.
 */
const UNKNOWN_TYPE_PROBE = '__console_type_probe__'
let cachedDocumentTypes: string[] | null = null

export async function loadDocumentTypes(
  client: KeelClient,
  options: CallOptions = {},
): Promise<string[]> {
  if (cachedDocumentTypes) return cachedDocumentTypes
  try {
    await client.query('search_documents', { type: UNKNOWN_TYPE_PROBE, limit: 1 }, options)
  } catch (caught) {
    if (isKeelApiError(caught)) {
      const known = (caught.details as { known?: unknown } | undefined)?.known
      if (Array.isArray(known)) {
        cachedDocumentTypes = known.map(String)
        return cachedDocumentTypes
      }
    }
    throw caught
  }
  // Keel accepted the probe: it is no longer rejecting unknown types, so there
  // is nothing to read here and the caller should fall back to a plain input.
  return []
}

/** The app-wide client, bound to the current session. */
export const keel: KeelClient = createKeelClient({
  getBaseUrl,
  getToken,
  fetch: (...args) => globalThis.fetch(...args),
})
