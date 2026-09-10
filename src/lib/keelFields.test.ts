import { describe, expect, it } from 'vitest'
import { eventTarget, nextCursorOf, pick, readEvent, readTraceChain, rowsOf, scalar } from './keelFields'

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

  it('finds rows under any of the usual keys', () => {
    expect(rowsOf({ events: [1, 2] }, 'events')).toEqual([1, 2])
    expect(rowsOf({ items: [3] })).toEqual([3])
    expect(rowsOf([4, 5])).toEqual([4, 5])
    expect(rowsOf({ nothing: true })).toEqual([])
  })

  it('reads a cursor only when it is a non-empty string', () => {
    expect(nextCursorOf({ next_cursor: 'abc' })).toBe('abc')
    expect(nextCursorOf({ next_cursor: '' })).toBeNull()
    expect(nextCursorOf({})).toBeNull()
  })

  it('normalizes an event and prefers the document number for the trace link', () => {
    const event = readEvent({
      seq: 71,
      type: 'po.approved',
      document_number: 'PO-1042',
      document_id: 'doc_9',
      occurred_at: '2026-09-10T10:00:00Z',
    })
    expect(event).toMatchObject({ seq: 71, type: 'po.approved', documentLabel: 'PO-1042' })
    expect(eventTarget(event)).toBe('PO-1042')
  })

  it('falls back to the document id when there is no number', () => {
    expect(eventTarget(readEvent({ seq: 1, type: 'x', document_id: 'doc_9' }))).toBe('doc_9')
  })

  it('defaults an unrecognized event to a usable row', () => {
    const event = readEvent({})
    expect(event.type).toBe('event')
    expect(event.seq).toBeNull()
    expect(eventTarget(event)).toBeNull()
  })

  it('reads a trace chain with inline events and receipts', () => {
    const chain = readTraceChain({
      chain: [
        {
          id: 'po_1',
          type: 'purchase_order',
          number: 'PO-1042',
          status: 'approved',
          total: '1,200.00 USD',
          events: [{ type: 'po.approved' }],
          receipts: ['rcpt_1'],
        },
      ],
    })
    expect(chain).toHaveLength(1)
    expect(chain[0]).toMatchObject({
      label: 'PO-1042',
      kind: 'purchase_order',
      status: 'approved',
      amount: '1,200.00 USD',
    })
    expect(chain[0].events).toHaveLength(1)
    expect(chain[0].receipts).toEqual(['rcpt_1'])
  })
})
