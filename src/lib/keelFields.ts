/**
 * Field readers for Keel payloads.
 *
 * Keel owns every shape here. These key names are **pinned against the live
 * facade** (headless-erp-production-0480.up.railway.app, 2026-09-10) with a
 * token holding `*:read`, `approvals:read`, `procurement:approve`,
 * `procurement:receive` — they are recorded, not guessed. Anything still
 * unverified says so at its definition.
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
  return Array.isArray(value) ? value : []
}

function asObject(value: unknown): Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Json) : {}
}

function asNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value)
  }
  return null
}

/** Rows of a Keel list response, under the key that response uses. */
export function rowsOf(payload: unknown, key: string): unknown[] {
  return asArray(pick(payload, key))
}

/**
 * Money display. Keel sends minor units in `*_cents` fields and the console
 * only ever renders them: the digits are regrouped as text, never summed,
 * averaged or netted. Any figure that needs arithmetic comes from a Keel tool.
 */
export function formatCents(value: unknown): string | null {
  const cents = asNumber(value)
  if (cents === null) return null
  const negative = cents < 0
  const digits = String(Math.abs(Math.trunc(cents))).padStart(3, '0')
  const whole = digits.slice(0, -2)
  const fraction = digits.slice(-2)
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return `${negative ? '-' : ''}${grouped}.${fraction}`
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

/**
 * One event, as `poll_events` returns it and as the SSE `data:` field carries
 * it — the two are the same object:
 *
 *   {seq, type, document_type, document_id, receipt_id, actor_id, occurred_at,
 *    payload: {document_type, document_id, number, status, receipt_id, summary}}
 *
 * `payload.number` and `payload.status` are null for documents that have no
 * human number (Supplier, Customer, ApiToken); `summary` is always prose.
 */
export interface KeelEvent {
  seq: number | null
  type: string
  documentId: string | null
  documentType: string | null
  /** `payload.number` — the human document number, when the document has one. */
  number: string | null
  status: string | null
  summary: string | null
  receiptId: string | null
  actorId: string | null
  occurredAt: string | null
  raw: Json
}

export function readEvent(raw: unknown): KeelEvent {
  const source = asObject(raw)
  const payload = asObject(source.payload)

  return {
    seq: asNumber(source.seq),
    type: scalar(source.type) ?? 'event',
    documentId: scalar(source.document_id),
    documentType: scalar(source.document_type),
    number: scalar(payload.number),
    status: scalar(payload.status),
    summary: scalar(payload.summary),
    receiptId: scalar(source.receipt_id),
    actorId: scalar(source.actor_id),
    occurredAt: scalar(source.occurred_at),
    raw: source,
  }
}

/**
 * What `trace_document` should be asked for when this row is clicked. Keel
 * resolves either a number or a ULID, and prefers the number when there is one.
 */
export function eventTarget(event: KeelEvent): string | null {
  return event.number ?? event.documentId
}

/** `poll_events` → `{count, events, last_seq}`. */
export interface EventPage {
  events: KeelEvent[]
  lastSeq: number | null
}

export function readEventPage(payload: unknown): EventPage {
  return {
    events: rowsOf(payload, 'events').map(readEvent),
    lastSeq: asNumber(pick(payload, 'last_seq')),
  }
}

/* ------------------------------------------------------------------- trace */

/** A signed receipt as `trace_document` inlines it on each node. */
export interface TraceReceipt {
  id: string | null
  tool: string | null
  actor: string | null
  onBehalfOf: string | null
  signedAt: string | null
}

function readReceipt(raw: unknown): TraceReceipt {
  const source = asObject(raw)
  return {
    id: scalar(source.id),
    tool: scalar(source.tool),
    actor: scalar(source.actor),
    onBehalfOf: scalar(source.on_behalf_of),
    signedAt: scalar(source.signed_at),
  }
}

/**
 * A document in the chain:
 *
 *   {id, number, type, status, total_cents, created_at, state_version,
 *    event_seqs: [...], receipts: [{id, tool, actor, on_behalf_of, signed_at}]}
 *
 * `root` carries the same fields minus `event_seqs` and `receipts`.
 */
export interface TraceNode {
  id: string | null
  number: string | null
  type: string
  status: string | null
  /** Minor units, straight from Keel. Formatted for display, never summed. */
  totalCents: number | null
  createdAt: string | null
  stateVersion: number | null
  eventSeqs: number[]
  receipts: TraceReceipt[]
  raw: Json
}

export function readTraceNode(raw: unknown): TraceNode {
  const source = asObject(raw)
  return {
    id: scalar(source.id),
    number: scalar(source.number),
    type: scalar(source.type) ?? 'Document',
    status: scalar(source.status),
    totalCents: asNumber(source.total_cents),
    createdAt: scalar(source.created_at),
    stateVersion: asNumber(source.state_version),
    eventSeqs: asArray(source.event_seqs)
      .map(asNumber)
      .filter((seq): seq is number => seq !== null),
    receipts: asArray(source.receipts).map(readReceipt),
    raw: source,
  }
}

/**
 * An edge between two nodes. **Unverified**: every trace in the seeded dataset
 * comes back with `edges: []`, so the key names inside an edge are the only
 * thing on this page that has not been seen live. Read loosely and shown as
 * "from → to" with whatever label is present.
 */
export interface TraceEdge {
  from: string | null
  to: string | null
  label: string | null
}

export function readTraceEdge(raw: unknown): TraceEdge {
  const source = asObject(raw)
  return {
    from: scalar(pick(source, 'from', 'from_id', 'source', 'parent')),
    to: scalar(pick(source, 'to', 'to_id', 'target', 'child')),
    label: scalar(pick(source, 'kind', 'type', 'relation', 'label')),
  }
}

/**
 * `trace_document` → `{requested, root, nodes, edges, journal_entry_count,
 * reversal_journal_entries}`.
 */
export interface TraceGraph {
  requested: string | null
  root: TraceNode | null
  nodes: TraceNode[]
  edges: TraceEdge[]
  journalEntryCount: number | null
  reversalJournalEntries: Json[]
}

export function readTraceGraph(payload: unknown): TraceGraph {
  const source = asObject(payload)
  return {
    requested: scalar(source.requested),
    root: source.root ? readTraceNode(source.root) : null,
    nodes: asArray(source.nodes).map(readTraceNode),
    edges: asArray(source.edges).map(readTraceEdge),
    journalEntryCount: asNumber(source.journal_entry_count),
    reversalJournalEntries: asArray(source.reversal_journal_entries).map(asObject),
  }
}

/* ---------------------------------------------------------------- searches */

/**
 * `search_documents` → `{type, count, offset, items}`, each item
 * `{id, number, type, status, total_cents, created_at, state_version}`.
 * Paged with `limit` + `offset`; there is no cursor in the Keel catalog.
 */
export interface SearchHit {
  id: string | null
  number: string | null
  type: string | null
  status: string | null
  totalCents: number | null
  createdAt: string | null
}

export function readSearchHit(raw: unknown): SearchHit {
  const source = asObject(raw)
  return {
    id: scalar(source.id),
    number: scalar(source.number),
    type: scalar(source.type),
    status: scalar(source.status),
    totalCents: asNumber(source.total_cents),
    createdAt: scalar(source.created_at),
  }
}

export interface SearchPage {
  hits: SearchHit[]
  count: number | null
  offset: number | null
}

export function readSearchPage(payload: unknown): SearchPage {
  return {
    hits: rowsOf(payload, 'items').map(readSearchHit),
    count: asNumber(pick(payload, 'count')),
    offset: asNumber(pick(payload, 'offset')),
  }
}

/** What to hand `trace_document`: Keel takes a number or a ULID. */
export function hitTarget(hit: SearchHit): string | null {
  return hit.number ?? hit.id
}

/* ------------------------------------------------------------------ ledger */

/** One row of `get_trial_balance` → `accounts`. */
export interface TrialBalanceAccount {
  code: string | null
  name: string | null
  type: string | null
  debitCents: number | null
  creditCents: number | null
  netCents: number | null
}

/** `get_trial_balance(period_code?)` → `{accounts, is_balanced, period, total_*}`. */
export interface TrialBalance {
  accounts: TrialBalanceAccount[]
  isBalanced: boolean | null
  period: string | null
  totalDebitCents: number | null
  totalCreditCents: number | null
}

export function readTrialBalance(payload: unknown): TrialBalance {
  const source = asObject(payload)
  return {
    accounts: asArray(source.accounts).map((raw) => {
      const account = asObject(raw)
      return {
        code: scalar(account.code),
        name: scalar(account.name),
        type: scalar(account.type),
        debitCents: asNumber(account.debit_cents),
        creditCents: asNumber(account.credit_cents),
        netCents: asNumber(account.net_cents),
      }
    }),
    isBalanced: typeof source.is_balanced === 'boolean' ? source.is_balanced : null,
    period: scalar(source.period),
    totalDebitCents: asNumber(source.total_debit_cents),
    totalCreditCents: asNumber(source.total_credit_cents),
  }
}

/** One row of `get_ledger_entries` → `entries`. */
export interface LedgerEntry {
  entry: string | null
  entryId: string | null
  postingDate: string | null
  description: string | null
  memo: string | null
  debitCents: number | null
  creditCents: number | null
  runningNetCents: number | null
  sourceType: string | null
  sourceId: string | null
  status: string | null
}

/** `get_ledger_entries(account_code, period_code?, limit?)`. Paged by `limit` only. */
export interface LedgerPage {
  account: string | null
  period: string | null
  count: number | null
  entries: LedgerEntry[]
}

export function readLedgerPage(payload: unknown): LedgerPage {
  const source = asObject(payload)
  return {
    account: scalar(source.account),
    period: scalar(source.period),
    count: asNumber(source.count),
    entries: asArray(source.entries).map((raw) => {
      const entry = asObject(raw)
      return {
        entry: scalar(entry.entry),
        entryId: scalar(entry.entry_id),
        postingDate: scalar(entry.posting_date),
        description: scalar(entry.description),
        memo: scalar(entry.memo),
        debitCents: asNumber(entry.debit_cents),
        creditCents: asNumber(entry.credit_cents),
        runningNetCents: asNumber(entry.running_net_cents),
        sourceType: scalar(entry.source_type),
        sourceId: scalar(entry.source_id),
        status: scalar(entry.status),
      }
    }),
  }
}

/** `explain_balance` → `by_source_type`: the movements grouped by what caused them. */
export interface BalanceBySource {
  sourceType: string | null
  count: number | null
  netCents: number | null
}

/**
 * `explain_balance(account_code, period_code?)` → `{account, period, balance,
 * by_source_type, movements, reversal_pairs}`. A movement carries `{entry,
 * posting_date, debit_cents, credit_cents, net_cents, running_cents, memo,
 * source, source_type, actor, on_behalf_of, tool, is_reversal, reversed,
 * reversal_of}`; the page shows the grouping and counts, and reads the
 * movements themselves through the paged `get_ledger_entries`.
 */
export interface BalanceExplanation {
  account: string | null
  period: string | null
  debitCents: number | null
  creditCents: number | null
  netCents: number | null
  asOf: string | null
  bySourceType: BalanceBySource[]
  movementCount: number
  /** Reversal/original pairs Keel matched up on this account. */
  reversalPairs: Json[]
}

export function readBalanceExplanation(payload: unknown): BalanceExplanation {
  const source = asObject(payload)
  const balance = asObject(source.balance)
  return {
    account: scalar(source.account),
    period: scalar(source.period),
    debitCents: asNumber(balance.debit_cents),
    creditCents: asNumber(balance.credit_cents),
    netCents: asNumber(balance.net_cents),
    asOf: scalar(balance.as_of),
    bySourceType: asArray(source.by_source_type).map((raw) => {
      const group = asObject(raw)
      return {
        sourceType: scalar(group.source_type),
        count: asNumber(group.count),
        netCents: asNumber(group.net_cents),
      }
    }),
    movementCount: asArray(source.movements).length,
    reversalPairs: asArray(source.reversal_pairs).map(asObject),
  }
}

/* --------------------------------------------------------------- inventory */

/** One row of `get_inventory(sku?)` → `items`. */
export interface InventoryItem {
  sku: string | null
  name: string | null
  onHandQty: number | null
  standardCostCents: number | null
  listPriceCents: number | null
  valueCents: number | null
  isActive: boolean | null
  isStocked: boolean | null
}

export interface Inventory {
  items: InventoryItem[]
  totalValueCents: number | null
}

export function readInventory(payload: unknown): Inventory {
  const source = asObject(payload)
  return {
    items: asArray(source.items).map((raw) => {
      const item = asObject(raw)
      return {
        sku: scalar(item.sku),
        name: scalar(item.name),
        onHandQty: asNumber(item.on_hand_qty),
        standardCostCents: asNumber(item.standard_cost_cents),
        listPriceCents: asNumber(item.list_price_cents),
        valueCents: asNumber(item.value_cents),
        isActive: typeof item.is_active === 'boolean' ? item.is_active : null,
        isStocked: typeof item.is_stocked === 'boolean' ? item.is_stocked : null,
      }
    }),
    totalValueCents: asNumber(source.total_value_cents),
  }
}

/* -------------------------------------------------------------- open items */

/**
 * `list_open_items(kind, party?, overdue_only?, as_of?)` →
 * `{kind, as_of, count, total_remaining_cents, items}`.
 *
 * The envelope above is recorded. **The rows are not**: the seeded dataset has
 * no unpaid invoices, so `items` has only ever come back empty and the console
 * has never seen a row's keys. Rather than guess at them, the page renders
 * whatever columns Keel sends (see `AutoTable`) and this reader keeps the rows
 * untouched. Replace with named fields once a dataset with AP/AR data exists.
 */
export interface OpenItems {
  kind: string | null
  asOf: string | null
  count: number | null
  totalRemainingCents: number | null
  items: Json[]
}

export function readOpenItems(payload: unknown): OpenItems {
  const source = asObject(payload)
  return {
    kind: scalar(source.kind),
    asOf: scalar(source.as_of),
    count: asNumber(source.count),
    totalRemainingCents: asNumber(source.total_remaining_cents),
    items: asArray(source.items).map(asObject),
  }
}

/* ---------------------------------------------------------- reconciliation */

/**
 * `get_reconciliation(kind)`. The three fields below are common to all four
 * kinds; everything else differs by kind and is read from `raw` where it is
 * shown, against these recorded shapes:
 *
 *   gr_ir     {gl_1400_net_cents, subledger_open_cents, by_po: []}
 *   ap | ar   {control_account, control_account_cents, subledger_cents, open_items: []}
 *   inventory {gl_1300_net_cents, subledger_value_cents, items: [...], note}
 */
export interface Reconciliation {
  kind: string | null
  reconciled: boolean | null
  differenceCents: number | null
  raw: Json
}

export function readReconciliation(payload: unknown): Reconciliation {
  const source = asObject(payload)
  return {
    kind: scalar(source.kind),
    reconciled: typeof source.reconciled === 'boolean' ? source.reconciled : null,
    differenceCents: asNumber(source.difference_cents),
    raw: source,
  }
}

/* ------------------------------------------------------------------ period */

/** `get_period(period_code)` → `{period, close_readiness}`. */
export interface PeriodReadiness {
  code: string | null
  status: string | null
  startDate: string | null
  endDate: string | null
  ready: boolean | null
  trialBalanceOk: boolean | null
  pendingApprovals: number | null
  openGrIrCents: number | null
  uninvoicedShipmentLines: number | null
  blockers: unknown[]
  warnings: unknown[]
  blockedSupplierInvoices: unknown[]
  draftPurchaseOrders: unknown[]
}

export function readPeriodReadiness(payload: unknown): PeriodReadiness {
  const source = asObject(payload)
  const period = asObject(source.period)
  const readiness = asObject(source.close_readiness)
  return {
    code: scalar(period.code) ?? scalar(readiness.period),
    status: scalar(period.status) ?? scalar(readiness.status),
    startDate: scalar(period.start_date),
    endDate: scalar(period.end_date),
    ready: typeof readiness.ready === 'boolean' ? readiness.ready : null,
    trialBalanceOk:
      typeof readiness.trial_balance_ok === 'boolean' ? readiness.trial_balance_ok : null,
    pendingApprovals: asNumber(readiness.pending_approvals),
    openGrIrCents: asNumber(readiness.open_gr_ir_cents),
    uninvoicedShipmentLines: asNumber(readiness.uninvoiced_shipment_lines),
    blockers: asArray(readiness.blockers),
    warnings: asArray(readiness.warnings),
    blockedSupplierInvoices: asArray(readiness.blocked_supplier_invoices),
    draftPurchaseOrders: asArray(readiness.draft_purchase_orders),
  }
}
