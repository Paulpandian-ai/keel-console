/**
 * Field readers for Keel payloads.
 *
 * Keel owns every shape here. The facade is not reachable from the current
 * deployment, so the exact key names for events and traces are not yet
 * confirmed; each reader tries the plausible spellings and falls back to "—" in
 * the UI. **This is the only file that guesses at a payload shape** — when the
 * facade ships, correct the key lists here and nothing else changes.
 *
 * Nothing in this file computes a value. It reads, and it formats for display.
 */

export type Json = Record<string, unknown>

/** First present value among dotted key paths. */
export function pick(source: unknown, ...keys: string[]): unknown {
  if (typeof source !== 'object' || source === null) return undefined
  for (const key of keys) {
    let value: unknown = source
    for (const segment of key.split('.')) {
      if (typeof value !== 'object' || value === null) {
        value = undefined
        break
      }
      value = (value as Json)[segment]
    }
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

/** Render a primitive; objects become compact JSON rather than "[object Object]". */
export function scalar(value: unknown): string | null {
  if (value === undefined || value === null) return null
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return JSON.stringify(value)
}

export function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  return []
}

/**
 * Find the row array in a Keel list response without caring what it is called.
 */
export function rowsOf(payload: unknown, ...keys: string[]): unknown[] {
  const named = pick(payload, ...keys, 'items', 'rows', 'results', 'data')
  if (Array.isArray(named)) return named
  return Array.isArray(payload) ? payload : []
}

/** `limit`/`cursor` paging, as Keel pages. */
export function nextCursorOf(payload: unknown): string | null {
  const cursor = pick(payload, 'next_cursor', 'cursor', 'page.next_cursor')
  return typeof cursor === 'string' && cursor !== '' ? cursor : null
}

/** Display-only timestamp formatting. Never arithmetic on dates. */
export function formatTimestamp(value: unknown): string | null {
  const raw = scalar(value)
  if (raw === null) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export function formatTime(value: unknown): string | null {
  const raw = scalar(value)
  if (raw === null) return null
  const parsed = new Date(raw)
  if (Number.isNaN(parsed.getTime())) return raw
  return parsed.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

/* ------------------------------------------------------------------ events */

/** One row in the live feed, as the console needs to render it. */
export interface KeelEvent {
  seq: number | null
  type: string
  documentId: string | null
  documentLabel: string | null
  occurredAt: string | null
  raw: Json
}

export function readEvent(raw: unknown): KeelEvent {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Json
  const seq = pick(source, 'seq', 'event_seq', 'sequence', 'id')
  const documentId = scalar(
    pick(source, 'document_id', 'document.id', 'doc_id', 'aggregate_id', 'entity_id'),
  )
  const documentLabel = scalar(
    pick(
      source,
      'document_number',
      'document.number',
      'document_no',
      'doc_number',
      'document.label',
    ),
  )

  return {
    seq: typeof seq === 'number' ? seq : typeof seq === 'string' ? Number(seq) || null : null,
    type: scalar(pick(source, 'type', 'event_type', 'name', 'kind')) ?? 'event',
    documentId,
    documentLabel,
    occurredAt: scalar(pick(source, 'occurred_at', 'created_at', 'timestamp', 'ts', 'at')),
    raw: source,
  }
}

/** The document reference an event points at, for the click-through to trace. */
export function eventTarget(event: KeelEvent): string | null {
  return event.documentLabel ?? event.documentId
}

/* ------------------------------------------------------------------- trace */

export interface TraceEntry {
  id: string | null
  label: string | null
  kind: string
  status: string | null
  occurredAt: string | null
  amount: string | null
  events: Json[]
  receipts: Json[]
  raw: Json
}

export function readTraceEntry(raw: unknown): TraceEntry {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Json
  return {
    id: scalar(pick(source, 'id', 'document_id', 'doc_id')),
    label: scalar(
      pick(source, 'number', 'document_number', 'doc_number', 'label', 'name', 'id'),
    ),
    kind: scalar(pick(source, 'type', 'document_type', 'kind', 'doc_type')) ?? 'document',
    status: scalar(pick(source, 'status', 'state')),
    occurredAt: scalar(pick(source, 'occurred_at', 'created_at', 'date', 'posted_at', 'timestamp')),
    // Money arrives formatted from Keel; the console never does arithmetic on it.
    amount: scalar(pick(source, 'amount', 'total', 'total_amount', 'value', 'gross_amount')),
    events: asArray(pick(source, 'events', 'event_log')) as Json[],
    receipts: asArray(pick(source, 'receipts', 'receipt_ids', 'receipt')) as Json[],
    raw: source,
  }
}

/** The chain of documents behind a `trace_document` response. */
export function readTraceChain(payload: unknown): TraceEntry[] {
  return rowsOf(payload, 'chain', 'nodes', 'steps', 'documents', 'trace', 'timeline').map(
    readTraceEntry,
  )
}

export interface SearchHit {
  id: string | null
  label: string | null
  kind: string | null
  status: string | null
  occurredAt: string | null
}

export function readSearchHit(raw: unknown): SearchHit {
  const source = (typeof raw === 'object' && raw !== null ? raw : {}) as Json
  return {
    id: scalar(pick(source, 'id', 'document_id', 'doc_id')),
    label: scalar(pick(source, 'number', 'document_number', 'doc_number', 'label', 'name')),
    kind: scalar(pick(source, 'type', 'document_type', 'kind')),
    status: scalar(pick(source, 'status', 'state')),
    occurredAt: scalar(pick(source, 'occurred_at', 'created_at', 'date')),
  }
}
