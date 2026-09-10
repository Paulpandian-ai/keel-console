import { describe, expect, it } from 'vitest'
import {
  eventTarget,
  formatCents,
  hitTarget,
  pick,
  readEvent,
  readEventPage,
  readSearchPage,
  readTraceGraph,
  rowsOf,
  scalar,
} from './keelFields'

/**
 * Payloads recorded verbatim from the live facade
 * (headless-erp-production-0480.up.railway.app, 2026-09-10), with a token
 * holding `*:read`, `approvals:read`, `procurement:approve`,
 * `procurement:receive`. The `result` unwrapping happens in the client, so what
 * these readers see is the inner payload.
 */
const RECORDED = {
  // POST /api/query/poll_events {"after_seq":0,"limit":3}
  pollEvents: {
    count: 1,
    events: [
      {
        actor_id: 'admin:paul',
        document_id: '01M25Y1AZR9Q7WWM79JM3YMP2Z',
        document_type: 'Supplier',
        occurred_at: '2026-09-10T15:12:32Z',
        payload: {
          document_id: '01M25Y1AZR9Q7WWM79JM3YMP2Z',
          document_type: 'Supplier',
          number: null,
          receipt_id: '01M25Y1AZX590D0YYCS14FMWQQ',
          status: null,
          summary: 'Supplier ACME (ACME Industrial) created',
        },
        receipt_id: '01M25Y1AZX590D0YYCS14FMWQQ',
        seq: 60,
        type: 'supplier.created',
      },
    ],
    last_seq: 62,
  },
  // POST /api/query/trace_document {"id_or_number":"JE-000001"}
  trace: {
    edges: [],
    journal_entry_count: 0,
    nodes: [
      {
        created_at: '2026-09-10T15:12:32Z',
        event_seqs: [65],
        id: '01M25Y1B15Z6PHPYWDGFB8E6S4',
        number: 'VALVE-2IN',
        receipts: [
          {
            actor: 'admin:paul',
            id: '01M25Y1B1M1XYPXJCPW6FBBP95',
            on_behalf_of: null,
            signed_at: '2026-09-10T15:12:32Z',
            tool: 'create_item',
          },
        ],
        state_version: 1,
        status: null,
        total_cents: null,
        type: 'Item',
      },
    ],
    requested: 'JE-000001',
    reversal_journal_entries: [],
    root: {
      created_at: '2026-09-10T15:12:32Z',
      id: '01M25Y1B15Z6PHPYWDGFB8E6S4',
      number: 'VALVE-2IN',
      state_version: 1,
      status: null,
      total_cents: null,
      type: 'Item',
    },
  },
  // POST /api/query/search_documents {"type":"JournalEntry","limit":3}
  search: {
    count: 3,
    items: [
      {
        created_at: '2026-09-10T15:12:32Z',
        id: '01M25Y1B15XT84M6TEKAW4YJ21',
        number: 'JE-000001',
        state_version: 1,
        status: 'posted',
        total_cents: 25000,
        type: 'JournalEntry',
      },
    ],
    offset: 0,
    type: 'JournalEntry',
  },
}

describe('field readers', () => {
  it('picks the first present dotted path', () => {
    expect(pick({ a: { b: 2 } }, 'x', 'a.b')).toBe(2)
    expect(pick({ a: null }, 'a', 'b')).toBeUndefined()
  })

  it('renders primitives and falls back to JSON for objects', () => {
    expect(scalar(0)).toBe('0')
    expect(scalar(false)).toBe('false')
    expect(scalar(null)).toBeNull()
    expect(scalar({ a: 1 })).toBe('{"a":1}')
  })

  it('reads rows under the key the response uses', () => {
    expect(rowsOf({ events: [1, 2] }, 'events')).toEqual([1, 2])
    expect(rowsOf({ items: [3] }, 'items')).toEqual([3])
    expect(rowsOf({ nothing: true }, 'items')).toEqual([])
  })

  it('formats minor units for display without arithmetic on the value', () => {
    expect(formatCents(25275000)).toBe('252,750.00')
    expect(formatCents(25000)).toBe('250.00')
    expect(formatCents(0)).toBe('0.00')
    expect(formatCents(7)).toBe('0.07')
    expect(formatCents(-1500)).toBe('-15.00')
    expect(formatCents(null)).toBeNull()
  })
})

describe('events', () => {
  it('reads a recorded event, summary and all', () => {
    const page = readEventPage(RECORDED.pollEvents)
    expect(page.lastSeq).toBe(62)
    expect(page.events).toHaveLength(1)
    expect(page.events[0]).toMatchObject({
      seq: 60,
      type: 'supplier.created',
      documentType: 'Supplier',
      documentId: '01M25Y1AZR9Q7WWM79JM3YMP2Z',
      number: null,
      summary: 'Supplier ACME (ACME Industrial) created',
      receiptId: '01M25Y1AZX590D0YYCS14FMWQQ',
      actorId: 'admin:paul',
    })
  })

  it('traces by document number when there is one, by id otherwise', () => {
    expect(eventTarget(readEvent(RECORDED.pollEvents.events[0]))).toBe(
      '01M25Y1AZR9Q7WWM79JM3YMP2Z',
    )
    const numbered = readEvent({
      seq: 66,
      type: 'journal_entry.posted',
      document_id: '01M25Y1B15XT84M6TEKAW4YJ21',
      payload: { number: 'JE-000001', status: 'posted' },
    })
    expect(eventTarget(numbered)).toBe('JE-000001')
  })

  it('defaults an unrecognized event to a usable row', () => {
    const event = readEvent({})
    expect(event.type).toBe('event')
    expect(event.seq).toBeNull()
    expect(eventTarget(event)).toBeNull()
  })
})

describe('trace', () => {
  it('reads the graph Keel returns, with receipts on each node', () => {
    const graph = readTraceGraph(RECORDED.trace)
    expect(graph.requested).toBe('JE-000001')
    expect(graph.root?.number).toBe('VALVE-2IN')
    expect(graph.journalEntryCount).toBe(0)
    expect(graph.nodes).toHaveLength(1)
    expect(graph.nodes[0]).toMatchObject({ type: 'Item', number: 'VALVE-2IN', eventSeqs: [65] })
    expect(graph.nodes[0].receipts[0]).toMatchObject({
      id: '01M25Y1B1M1XYPXJCPW6FBBP95',
      tool: 'create_item',
      actor: 'admin:paul',
      onBehalfOf: null,
    })
  })

  it('survives a graph with no root and no nodes', () => {
    const graph = readTraceGraph({ requested: 'PO-1', nodes: [], edges: [] })
    expect(graph.root).toBeNull()
    expect(graph.nodes).toEqual([])
  })
})

describe('search', () => {
  it('reads a page of hits with its window', () => {
    const page = readSearchPage(RECORDED.search)
    expect(page).toMatchObject({ count: 3, offset: 0 })
    expect(page.hits[0]).toMatchObject({
      number: 'JE-000001',
      type: 'JournalEntry',
      status: 'posted',
      totalCents: 25000,
    })
    expect(hitTarget(page.hits[0])).toBe('JE-000001')
  })
})
