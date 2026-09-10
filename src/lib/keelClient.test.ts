import { describe, expect, it, vi } from 'vitest'
import {
  createKeelClient,
  isKeelApiError,
  makeIdempotencyKey,
  type KeelClientConfig,
} from './keelClient'

const BASE = 'https://keel.example'

/** Responses recorded from the live Keel deployment. */
const RECORDED = {
  healthz: {
    status: 'ok',
    version: '0.1.0',
    env: 'dev',
    signing_key_id: '01M1Y420ZTB6BCVYVN1A5S6YG8',
    event_seq: 70,
    policy_version: 1,
  },
  unauthorized: {
    ok: false,
    error: { code: 'UNAUTHORIZED', message: 'bearer token with events:read required' },
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
    expect(health.event_seq).toBe(70)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/healthz`)
    expect(init.method).toBe('GET')
  })

  it('posts read tools to /api/query/{tool} with the payload as the body', async () => {
    const { client, fetchMock } = clientWith(() => json({ ok: true, request_id: 'req_1', rows: [] }))
    await client.query('list_open_items', { kind: 'ap', limit: 50 })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe(`${BASE}/api/query/list_open_items`)
    expect(JSON.parse(String(init.body))).toEqual({ kind: 'ap', limit: 50 })
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
      message: 'bearer token with events:read required',
      requestId: 'req_9',
      httpStatus: 401,
    })
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
      message: 'bearer token with events:read required',
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

  it('simulates on /api/simulate/{tool}', async () => {
    const { client, fetchMock } = clientWith(() => json({ ok: true, mode: 'simulate' }))
    await client.simulate('accept_goods', { receipt_id: 'gr_1' })

    expect((fetchMock.mock.calls[0] as [string])[0]).toBe(`${BASE}/api/simulate/accept_goods`)
  })
})
