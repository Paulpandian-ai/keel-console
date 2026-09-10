import { describe, expect, it, vi } from 'vitest'
import {
  createKeelClient,
  isKeelApiError,
  loadDocumentTypes,
  makeIdempotencyKey,
  type KeelClientConfig,
} from './keelClient'

const BASE = 'https://keel.example'

/**
 * Responses recorded verbatim from the live Keel deployment
 * (headless-erp-production-0480.up.railway.app, 2026-09-10).
 */
const RECORDED = {
  // GET /healthz — unauthenticated, so this shape is confirmed end to end.
  healthz: {
    status: 'ok',
    version: '0.1.0',
    env: 'dev',
    signing_key_id: '01M1Y420ZTB6BCVYVN1A5S6YG8',
    event_seq: 75,
    policy_version: 1,
  },
  // POST /api/query/get_system_status with a rejected token, HTTP 401.
  // Note the envelope carries `retry_advice` and no `request_id`.
  unauthorized: {
    ok: false,
    error: {
      code: 'UNAUTHORIZED',
      message: 'missing or invalid bearer token',
      retry_advice: 'Obtain a valid bearer token (Authorization: Bearer <token>).',
    },
  },
  // POST /api/query/get_system_status with a valid console token: the tool needs
  // `admin:status`, which a console token does not carry. This is the expected
  // answer, not a misconfiguration — the console has no privileged path.
  forbidden: {
    ok: false,
    mode: 'query',
    request_id: '01M268FX3XE85GE0DAJNSQHY1J',
    error: {
      code: 'FORBIDDEN',
      message: "token lacks scope 'admin:status' required by get_system_status",
      details: { required_scope: 'admin:status' },
      retry_advice: 'Obtain a token with the required scope.',
    },
  },
  // POST /api/query/get_trial_balance {} — the success envelope every tool uses.
  trialBalance: {
    ok: true,
    mode: 'query',
    request_id: '01M268JFX7RCMK5ZDEGCVZGW26',
    tool: 'get_trial_balance',
    result: {
      accounts: [{ code: '1000', name: 'Cash', type: 'asset', debit_cents: 25000000 }],
      is_balanced: true,
      period: null,
      total_credit_cents: 25275000,
      total_debit_cents: 25275000,
    },
  },
  // POST /api/query/search_documents {"type":"zzz"} — the only place Keel names
  // the document types.
  unknownType: {
    ok: false,
    mode: 'query',
    request_id: '01M268KPAWEED9WYVR3FQJM5N2',
    error: {
      code: 'VALIDATION_ERROR',
      message: 'unknown document type zzz',
      details: { known: ['Account', 'JournalEntry', 'PurchaseOrder'] },
      retry_advice: 'Fix the payload and retry.',
    },
  },
}

function clientWith(
  handler: (url: string, init: RequestInit) => Response | Promise<Response>,
  token: string | null = 'test-token',
) {
  const fetchMock = vi.fn(async (input: unknown, init?: unknown) =>
    handler(String(input), (init ?? {}) as RequestInit),
  )
  const config: KeelClientConfig = {
    getBaseUrl: () => BASE,
    getToken: () => token,
    fetch: fetchMock as unknown as typeof fetch,
  }
  return { client: createKeelClient(config), fetchMock }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('keelClient', () => {
  it('reads health from GET /healthz', async () => {
    const { client, fetchMock } = clientWith(() => json(RECORDED.healthz))
    const health = await client.health()

    expect(health.env).toBe('dev')
    expect(health.event_seq).toBe(75)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/healthz`)
    expect(init.method).toBe('GET')
  })

  it('posts read tools to /api/query/{tool} with the payload as the body', async () => {
    const { client, fetchMock } = clientWith(() =>
      json({ ok: true, request_id: 'req_1', tool: 'list_open_items', result: { items: [] } }),
    )
    await client.query('list_open_items', { kind: 'ap', limit: 50 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/query/list_open_items`)
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'ap', limit: 50 })
  })

  it("unwraps the envelope's result for read tools", async () => {
    const { client } = clientWith(() => json(RECORDED.trialBalance))

    const balance = await client.query<{ is_balanced: boolean; total_debit_cents: number }>(
      'get_trial_balance',
    )
    expect(balance.is_balanced).toBe(true)
    expect(balance.total_debit_cents).toBe(25275000)
    // The envelope's own keys are not mixed into the payload.
    expect((balance as Record<string, unknown>).request_id).toBeUndefined()
  })

  it('shows a scope refusal exactly as Keel sent it', async () => {
    const { client } = clientWith(() => json(RECORDED.forbidden, 403))

    await expect(client.query('get_system_status')).rejects.toMatchObject({
      code: 'FORBIDDEN',
      message: "token lacks scope 'admin:status' required by get_system_status",
      requestId: '01M268FX3XE85GE0DAJNSQHY1J',
      details: { required_scope: 'admin:status' },
      retryAdvice: 'Obtain a token with the required scope.',
    })
  })

  it('sends the token as a bearer header and never in the URL', async () => {
    const { client, fetchMock } = clientWith(() => json({ ok: true }), 'secret-token-value')
    await client.query('get_system_status')

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    const headers = init.headers as Record<string, string>
    expect(headers.Authorization).toBe('Bearer secret-token-value')
    expect(url).not.toContain('secret-token-value')
  })

  it('omits the Authorization header when there is no token', async () => {
    const { client, fetchMock } = clientWith(() => json({ status: 'ok' }), null)
    await client.health()

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined()
  })

  it('surfaces the Keel error envelope verbatim', async () => {
    const { client } = clientWith(() => json({ ...RECORDED.unauthorized, request_id: 'req_9' }, 401))

    await expect(client.query('get_trial_balance')).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'missing or invalid bearer token',
      requestId: 'req_9',
      httpStatus: 401,
    })
  })

  it("carries the envelope's retry_advice through to the UI", async () => {
    // The live facade sends `retry_advice` and no `request_id` on a 401.
    const { client } = clientWith(() => json(RECORDED.unauthorized, 401))

    const error = await client.query('get_system_status').catch((e: unknown) => e)
    expect((error as { retryAdvice?: string }).retryAdvice).toBe(
      'Obtain a valid bearer token (Authorization: Bearer <token>).',
    )
    expect((error as { requestId?: string }).requestId).toBeUndefined()
  })

  it('normalizes an HTTP error that carries no envelope', async () => {
    const { client } = clientWith(() => json({ detail: 'Not Found' }, 404))

    const error = await client.query('get_system_status').catch((e: unknown) => e)
    expect(isKeelApiError(error)).toBe(true)
    expect((error as { code: string }).code).toBe('HTTP_404')
    expect((error as { tool: string }).tool).toBe('get_system_status')
  })

  it('normalizes a non-JSON response', async () => {
    const { client } = clientWith(() => new Response('<html>gateway</html>', { status: 502 }))

    await expect(client.query('get_inventory')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
  })

  it('normalizes a network failure', async () => {
    const { client } = clientWith(() => {
      throw new TypeError('Failed to fetch')
    })

    await expect(client.health()).rejects.toMatchObject({ code: 'NETWORK_ERROR' })
  })

  it('carries the idempotency key and simulation id on commit', async () => {
    const { client, fetchMock } = clientWith(() => json({ ok: true, request_id: 'req_2' }))
    await client.commit(
      'approve_purchase_order',
      { approval_id: 'apr_1' },
      { idempotencyKey: makeIdempotencyKey('req_1', 'approve_purchase_order'), simulationId: 'sim_1' },
    )

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/commit/approve_purchase_order`)
    expect(JSON.parse(String(init.body))).toEqual({
      approval_id: 'apr_1',
      idempotency_key: 'console:req_1:approve_purchase_order',
      simulation_id: 'sim_1',
    })
  })

  it('builds idempotency keys as console:<request_id>:<tool>', () => {
    expect(makeIdempotencyKey('req_abc', 'accept_goods')).toBe('console:req_abc:accept_goods')
  })

  it('opens the event stream with the bearer header and a resume point', async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"seq":71}\n\n'))
        controller.close()
      },
    })
    const { client, fetchMock } = clientWith(
      () => new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } }),
    )

    const seen: unknown[] = []
    let opened = false
    await client.streamEvents({
      afterSeq: 70,
      signal: new AbortController().signal,
      onOpen: () => {
        opened = true
      },
      onFrame: (frame) => seen.push(JSON.parse(frame.data)),
    })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/events/stream?after_seq=70`)
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer test-token')
    expect(opened).toBe(true)
    expect(seen).toEqual([{ seq: 71 }])
  })

  it('rejects with the Keel envelope when the stream is refused', async () => {
    const { client } = clientWith(() => json(RECORDED.unauthorized, 401))

    await expect(
      client.streamEvents({
        signal: new AbortController().signal,
        onFrame: () => undefined,
      }),
    ).rejects.toMatchObject({
      code: 'UNAUTHORIZED',
      message: 'missing or invalid bearer token',
      httpStatus: 401,
    })
  })

  it('omits after_seq when there is no resume point', async () => {
    const empty = new ReadableStream<Uint8Array>({
      start: (controller) => controller.close(),
    })
    const { client, fetchMock } = clientWith(() => new Response(empty, { status: 200 }))

    await client.streamEvents({ signal: new AbortController().signal, onFrame: () => undefined })
    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/events/stream`)
  })

  it('simulates on /api/simulate/{tool} and keeps the envelope for the commit', async () => {
    const { client, fetchMock } = clientWith(() =>
      json({ ok: true, mode: 'simulate', request_id: 'req_sim', result: { effects: [] } }),
    )
    const simulation = await client.simulate('accept_goods', { request_id: 'apr_1' })

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/api/simulate/accept_goods`)
    // The commit that follows needs this request_id for its idempotency key.
    expect(simulation.request_id).toBe('req_sim')
    expect(makeIdempotencyKey(simulation.request_id!, 'accept_goods')).toBe(
      'console:req_sim:accept_goods',
    )
  })

  it("learns the document types from search_documents' own refusal", async () => {
    const { client, fetchMock } = clientWith(() => json(RECORDED.unknownType, 422))

    const types = await loadDocumentTypes(client)
    expect(types).toEqual(['Account', 'JournalEntry', 'PurchaseOrder'])
    // Cached: a second caller does not probe again.
    await loadDocumentTypes(client)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
