/**
 * Field readers for Keel payloads.
 *
 * Keel owns every shape here. These key names are **pinned against the live
 * facade** (headless-erp-production-0480.up.railway.app) with a token holding
 * `*:read`, `approvals:write`, `procurement:approve`, `procurement:receive` —
 * they are recorded, not guessed. The reads were taken 2026-09-10; open-item
 * rows, pending approvals and the simulate/commit envelopes 2026-09-11, once
 * demo data existed. Anything still unverified says so at its definition.
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
 * One row of `list_open_items` → `items`. Pinned live 2026-09-11 against the AR
 * sub-ledger, which now carries CINV-000001:
 *
 *   {id, kind, status, party_id, amount_cents, remaining_cents, due_date,
 *    days_to_due, overdue, source_doc_id, source_doc_number, source_doc_type,
 *    created_at, updated_at, state_version}
 *
 * `overdue` and `days_to_due` are **Keel's**, decided against its own `as_of`.
 * The console renders them; it never compares a date.
 */
export interface OpenItem {
  id: string | null
  kind: string | null
  status: string | null
  partyId: string | null
  amountCents: number | null
  remainingCents: number | null
  dueDate: string | null
  /** Keel's count, signed: negative once the due date has passed. */
  daysToDue: number | null
  overdue: boolean | null
  sourceDocId: string | null
  sourceDocNumber: string | null
  sourceDocType: string | null
}

export function readOpenItem(raw: unknown): OpenItem {
  const item = asObject(raw)
  return {
    id: scalar(item.id),
    kind: scalar(item.kind),
    status: scalar(item.status),
    partyId: scalar(item.party_id),
    amountCents: asNumber(item.amount_cents),
    remainingCents: asNumber(item.remaining_cents),
    dueDate: scalar(item.due_date),
    daysToDue: asNumber(item.days_to_due),
    overdue: typeof item.overdue === 'boolean' ? item.overdue : null,
    sourceDocId: scalar(item.source_doc_id),
    sourceDocNumber: scalar(item.source_doc_number),
    sourceDocType: scalar(item.source_doc_type),
  }
}

/** What to hand `trace_document` for an open item: its source document. */
export function openItemTarget(item: OpenItem): string | null {
  return item.sourceDocNumber ?? item.sourceDocId
}

/**
 * `list_open_items(kind, party?, overdue_only?, as_of?)` →
 * `{kind, as_of, count, total_remaining_cents, items}`.
 */
export interface OpenItems {
  kind: string | null
  asOf: string | null
  count: number | null
  totalRemainingCents: number | null
  items: OpenItem[]
}

export function readOpenItems(payload: unknown): OpenItems {
  const source = asObject(payload)
  return {
    kind: scalar(source.kind),
    asOf: scalar(source.as_of),
    count: asNumber(source.count),
    totalRemainingCents: asNumber(source.total_remaining_cents),
    items: asArray(source.items).map(readOpenItem),
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

/**
 * `get_current_period()` → `{as_of, is_open, nearest_open_period, period,
 * close_readiness}`. Keel names the current period against its own `as_of`;
 * the console never reads the browser clock to work one out.
 */
export interface CurrentPeriod {
  asOf: string | null
  code: string | null
  isOpen: boolean | null
  /** Set when `as_of` falls outside every open period. */
  nearestOpenPeriod: string | null
}

export function readCurrentPeriod(payload: unknown): CurrentPeriod {
  const source = asObject(payload)
  const period = asObject(source.period)
  return {
    asOf: scalar(source.as_of),
    code: scalar(period.code),
    isOpen: typeof source.is_open === 'boolean' ? source.is_open : null,
    nearestOpenPeriod: scalar(source.nearest_open_period),
  }
}

/* --------------------------------------------------------------- approvals */

/**
 * The effects of a write, as Keel projects them (`simulate.projected_effects`)
 * and as it reports them afterwards (`commit.effects`) — the same shape both
 * times, pinned live 2026-09-11:
 *
 *   {documents, journal_entry, open_items, inventory_deltas, balance_deltas,
 *    events, details?}
 *
 * Every figure in here is Keel's. The console lays them out; it does not net a
 * delta, total a journal entry or decide whether one balances.
 */
export interface EffectDocument {
  type: string | null
  id: string | null
  number: string | null
  status: string | null
  /** `create` or `update`. */
  action: string | null
  /** The columns that would be written. Rendered as-is. */
  fields: Json
}

export interface BalanceDelta {
  account: string | null
  deltaCents: number | null
}

export interface InventoryDelta {
  sku: string | null
  qtyDelta: number | null
}

/** `journal_entry` — Keel's own lines, totals and `is_balanced`. */
export interface EffectJournalLine {
  account: string | null
  debitCents: number | null
  creditCents: number | null
  description: string | null
}

export interface EffectJournalEntry {
  id: string | null
  postingDate: string | null
  memo: string | null
  sourceType: string | null
  lines: EffectJournalLine[]
  totalDebitCents: number | null
  totalCreditCents: number | null
  isBalanced: boolean | null
}

export interface Effects {
  documents: EffectDocument[]
  journalEntry: EffectJournalEntry | null
  balanceDeltas: BalanceDelta[]
  inventoryDeltas: InventoryDelta[]
  openItems: Json[]
  events: string[]
  /** Per-tool extras: `accept_goods` puts `{counted, discrepancies}` here. */
  details: Json
}

export function readEffects(payload: unknown): Effects {
  const source = asObject(payload)
  const journal = source.journal_entry ? asObject(source.journal_entry) : null
  return {
    documents: asArray(source.documents).map((raw) => {
      const doc = asObject(raw)
      return {
        type: scalar(doc.type),
        id: scalar(doc.id),
        number: scalar(doc.number),
        status: scalar(doc.status),
        action: scalar(doc.action),
        fields: asObject(doc.fields),
      }
    }),
    journalEntry: journal && {
      id: scalar(journal.id),
      postingDate: scalar(journal.posting_date),
      memo: scalar(journal.memo),
      sourceType: scalar(journal.source_type),
      lines: asArray(journal.lines).map((raw) => {
        const line = asObject(raw)
        return {
          account: scalar(line.account),
          debitCents: asNumber(line.debit_cents),
          creditCents: asNumber(line.credit_cents),
          description: scalar(line.description),
        }
      }),
      totalDebitCents: asNumber(journal.total_debit_cents),
      totalCreditCents: asNumber(journal.total_credit_cents),
      isBalanced: typeof journal.is_balanced === 'boolean' ? journal.is_balanced : null,
    },
    balanceDeltas: asArray(source.balance_deltas).map((raw) => {
      const delta = asObject(raw)
      return { account: scalar(delta.account), deltaCents: asNumber(delta.delta_cents) }
    }),
    inventoryDeltas: asArray(source.inventory_deltas).map((raw) => {
      const delta = asObject(raw)
      return { sku: scalar(delta.sku), qtyDelta: asNumber(delta.qty_delta) }
    }),
    openItems: asArray(source.open_items).map(asObject),
    events: asArray(source.events)
      .map(scalar)
      .filter((event): event is string => event !== null),
    details: asObject(source.details),
  }
}

/**
 * One line as Keel counts it, under `details.counted` on a `goods_acceptance`
 * request and on every `accept_goods` simulation:
 *
 *   {sku, po_line_id, expected_qty, qty, damaged_qty, short_qty, over_qty,
 *    unit_cost_cents, account, note}
 *
 * `short_qty` and `over_qty` are **Keel's arithmetic**, not the console's: the
 * page sends the counts a human typed and reads back what Keel made of them.
 */
export interface CountedLine {
  sku: string | null
  poLineId: string | null
  expectedQty: number | null
  qty: number | null
  damagedQty: number | null
  shortQty: number | null
  overQty: number | null
  unitCostCents: number | null
  account: string | null
  note: string | null
}

export function readCountedLine(raw: unknown): CountedLine {
  const line = asObject(raw)
  return {
    sku: scalar(line.sku),
    poLineId: scalar(line.po_line_id),
    expectedQty: asNumber(line.expected_qty),
    qty: asNumber(line.qty),
    damagedQty: asNumber(line.damaged_qty),
    shortQty: asNumber(line.short_qty),
    overQty: asNumber(line.over_qty),
    unitCostCents: asNumber(line.unit_cost_cents),
    account: scalar(line.account),
    note: scalar(line.note),
  }
}

/** `details.counted` wherever it appears — on a request or on a simulation. */
export function countedLinesOf(effects: Effects): CountedLine[] {
  return asArray(effects.details.counted).map(readCountedLine)
}

/** `details.discrepancies` — Keel's prose, e.g. "VALVE-2IN: 1 short". */
export function discrepanciesOf(effects: Effects): string[] {
  return asArray(effects.details.discrepancies)
    .map(scalar)
    .filter((note): note is string => note !== null)
}

/**
 * One pending item from `list_pending_approvals` → `pending`, pinned live
 * 2026-09-11 against a `po_approval` and a `goods_acceptance`:
 *
 *   {id, kind, status, reason, requested_by, created_at, expires_at, expired,
 *    decided_at, decided_by, decision_comment, document_type, document_id,
 *    document_number, tool_name, payload, projected_effects}
 *
 * `projected_effects` is what the agent's blocked call *would* do — the same
 * shape a simulate returns, carried on the request itself.
 */
export interface ApprovalRequest {
  id: string | null
  /** `po_approval`, `goods_acceptance` or `invoice_variance`. */
  kind: string | null
  status: string | null
  /** Why Keel parked it. Prose, shown verbatim. */
  reason: string | null
  requestedBy: string | null
  createdAt: string | null
  expiresAt: string | null
  /** Keel's judgement against its own clock; never a date comparison here. */
  expired: boolean | null
  documentType: string | null
  documentId: string | null
  documentNumber: string | null
  /** The tool whose call was parked, e.g. `create_purchase_order`. */
  toolName: string | null
  payload: Json
  projectedEffects: Effects
}

export function readApprovalRequest(raw: unknown): ApprovalRequest {
  const source = asObject(raw)
  return {
    id: scalar(source.id),
    kind: scalar(source.kind),
    status: scalar(source.status),
    reason: scalar(source.reason),
    requestedBy: scalar(source.requested_by),
    createdAt: scalar(source.created_at),
    expiresAt: scalar(source.expires_at),
    expired: typeof source.expired === 'boolean' ? source.expired : null,
    documentType: scalar(source.document_type),
    documentId: scalar(source.document_id),
    documentNumber: scalar(source.document_number),
    toolName: scalar(source.tool_name),
    payload: asObject(source.payload),
    projectedEffects: readEffects(source.projected_effects),
  }
}

/** `list_pending_approvals` → `{count, pending}`. */
export interface PendingApprovals {
  count: number | null
  pending: ApprovalRequest[]
}

export function readPendingApprovals(payload: unknown): PendingApprovals {
  const source = asObject(payload)
  return {
    count: asNumber(source.count),
    pending: asArray(source.pending).map(readApprovalRequest),
  }
}

/** What to hand `trace_document` for an approval: the document it is about. */
export function approvalTarget(request: ApprovalRequest): string | null {
  return request.documentNumber ?? request.documentId
}

/* ------------------------------------------------------- simulate & commit */

/** `policy` on a simulation and on a commit. Keel's decision, shown verbatim. */
export interface PolicyDecision {
  decision: string | null
  rulesEvaluated: string[]
  rulesTriggered: string[]
  reasons: string[]
  warnings: string[]
  errorCode: string | null
  version: number | null
  hash: string | null
}

function readStrings(value: unknown): string[] {
  return asArray(value)
    .map(scalar)
    .filter((entry): entry is string => entry !== null)
}

export function readPolicy(payload: unknown): PolicyDecision {
  const source = asObject(payload)
  return {
    decision: scalar(source.decision),
    rulesEvaluated: readStrings(source.rules_evaluated),
    rulesTriggered: readStrings(source.rules_triggered),
    reasons: readStrings(source.reasons),
    warnings: readStrings(source.warnings),
    errorCode: scalar(source.error_code),
    version: asNumber(source.policy_version),
    hash: scalar(source.policy_hash),
  }
}

/**
 * A simulation, read from the flat envelope `POST /api/simulate/{tool}`
 * returns. `wouldCommit` is Keel's verdict and the only thing that decides
 * whether the console offers a Confirm button — the console never works out for
 * itself whether a write is allowed.
 */
export interface Simulation {
  requestId: string | null
  simulationId: string | null
  tool: string | null
  wouldCommit: boolean | null
  commitWouldFailWith: string | null
  errors: string[]
  warnings: string[]
  policy: PolicyDecision
  effects: Effects
  expiresAt: string | null
}

export function readSimulation(envelope: unknown): Simulation {
  const source = asObject(envelope)
  const validation = asObject(source.validation)
  return {
    requestId: scalar(source.request_id),
    simulationId: scalar(source.simulation_id),
    tool: scalar(source.tool),
    wouldCommit: typeof source.would_commit === 'boolean' ? source.would_commit : null,
    commitWouldFailWith: scalar(source.commit_would_fail_with),
    errors: readStrings(validation.errors),
    warnings: readStrings(validation.warnings),
    policy: readPolicy(source.policy),
    effects: readEffects(source.projected_effects),
    expiresAt: scalar(source.expires_at),
  }
}

/**
 * A commit, read from the flat envelope `POST /api/commit/{tool}` returns.
 * `status` is `applied` the first time and `replayed` when Keel recognises the
 * idempotency key, in which case `eventsEmitted` repeats the original sequence
 * numbers and no new events exist.
 */
export interface CommitOutcome {
  requestId: string | null
  tool: string | null
  status: string | null
  receiptId: string | null
  receipt: Json
  document: EffectDocument | null
  effects: Effects
  /** `[{seq, type}]`, as Keel emitted them. */
  eventsEmitted: { seq: number | null; type: string | null }[]
  warnings: string[]
  policy: PolicyDecision
}

export function readCommitOutcome(envelope: unknown): CommitOutcome {
  const source = asObject(envelope)
  const receipt = asObject(source.receipt)
  const document = source.document ? asObject(source.document) : null
  return {
    requestId: scalar(source.request_id),
    tool: scalar(source.tool),
    status: scalar(source.status),
    receiptId: scalar(receipt.id),
    receipt,
    document: document && {
      type: scalar(document.type),
      id: scalar(document.id),
      number: scalar(document.number),
      status: scalar(document.status),
      action: scalar(document.action),
      fields: asObject(document.fields),
    },
    effects: readEffects(source.effects),
    eventsEmitted: asArray(source.events_emitted).map((raw) => {
      const event = asObject(raw)
      return { seq: asNumber(event.seq), type: scalar(event.type) }
    }),
    warnings: readStrings(source.warnings),
    policy: readPolicy(source.policy),
  }
}

/* ---------------------------------------------------------------- receipts */

/**
 * The signed receipt itself, as `verify_receipt` returns it under `receipt`
 * and as a commit envelope returns it directly (pinned live 2026-09-11):
 *
 *   {id, tool_name, actor_id, actor_kind, on_behalf_of, document_type,
 *    document_id, document_number, action_hash, before_hash, after_hash,
 *    public_key_id, signature, signed_at}
 */
export interface SignedReceipt {
  id: string | null
  toolName: string | null
  actorId: string | null
  actorKind: string | null
  onBehalfOf: string | null
  documentType: string | null
  documentId: string | null
  documentNumber: string | null
  actionHash: string | null
  beforeHash: string | null
  afterHash: string | null
  publicKeyId: string | null
  signature: string | null
  signedAt: string | null
}

export function readSignedReceipt(raw: unknown): SignedReceipt {
  const source = asObject(raw)
  return {
    id: scalar(source.id),
    toolName: scalar(source.tool_name),
    actorId: scalar(source.actor_id),
    actorKind: scalar(source.actor_kind),
    onBehalfOf: scalar(source.on_behalf_of),
    documentType: scalar(source.document_type),
    documentId: scalar(source.document_id),
    documentNumber: scalar(source.document_number),
    actionHash: scalar(source.action_hash),
    beforeHash: scalar(source.before_hash),
    afterHash: scalar(source.after_hash),
    publicKeyId: scalar(source.public_key_id),
    signature: scalar(source.signature),
    signedAt: scalar(source.signed_at),
  }
}

/**
 * `verify_receipt(receipt_id)` → `{receipt_id, valid, signature_valid,
 * action_hash_valid, key_retired, public_key_id, receipt}`.
 *
 * An unknown id is **not an error**: Keel answers `ok: true` with
 * `{receipt_id, valid: false, reason: "receipt not found"}` and nothing else.
 * `valid` is Keel's verdict — the console never checks a signature itself.
 */
export interface ReceiptVerification {
  receiptId: string | null
  valid: boolean | null
  signatureValid: boolean | null
  actionHashValid: boolean | null
  keyRetired: boolean | null
  publicKeyId: string | null
  /** Set when `valid` is false and there is no receipt to show. */
  reason: string | null
  receipt: SignedReceipt | null
}

export function readReceiptVerification(payload: unknown): ReceiptVerification {
  const source = asObject(payload)
  const flag = (value: unknown) => (typeof value === 'boolean' ? value : null)
  return {
    receiptId: scalar(source.receipt_id),
    valid: flag(source.valid),
    signatureValid: flag(source.signature_valid),
    actionHashValid: flag(source.action_hash_valid),
    keyRetired: flag(source.key_retired),
    publicKeyId: scalar(source.public_key_id),
    reason: scalar(source.reason),
    receipt: source.receipt ? readSignedReceipt(source.receipt) : null,
  }
}

/**
 * One row of `get_request_log` → `requests`, and — with `explanation` added —
 * the whole result of `explain_error(request_id)`. Same object both ways,
 * pinned live 2026-09-11:
 *
 *   {request_id, tool, mode, actor_id, actor_kind, on_behalf_of, outcome,
 *    error_code, error_message, policy_decision, policy, receipt_id,
 *    simulation_id, idempotency_key, document_id, document_number, latency_ms,
 *    started_at, payload, state_snapshot}
 *
 * `outcome` is `ok` / `simulated` / `applied` / `replayed` / `error`.
 * `explain_error` on a request that succeeded still answers, with an
 * `explanation` saying there is nothing to explain.
 */
export interface RequestLogEntry {
  requestId: string | null
  tool: string | null
  mode: string | null
  actorId: string | null
  actorKind: string | null
  onBehalfOf: string | null
  outcome: string | null
  errorCode: string | null
  errorMessage: string | null
  policyDecision: string | null
  policy: PolicyDecision | null
  receiptId: string | null
  simulationId: string | null
  idempotencyKey: string | null
  documentId: string | null
  documentNumber: string | null
  latencyMs: number | null
  startedAt: string | null
  /** The request body as Keel logged it, already redacted by Keel. */
  payload: Json
  stateSnapshot: Json
  /** Keel's prose, on `explain_error` only. */
  explanation: string | null
}

export function readRequestLogEntry(raw: unknown): RequestLogEntry {
  const source = asObject(raw)
  return {
    requestId: scalar(source.request_id),
    tool: scalar(source.tool),
    mode: scalar(source.mode),
    actorId: scalar(source.actor_id),
    actorKind: scalar(source.actor_kind),
    onBehalfOf: scalar(source.on_behalf_of),
    outcome: scalar(source.outcome),
    errorCode: scalar(source.error_code),
    errorMessage: scalar(source.error_message),
    policyDecision: scalar(source.policy_decision),
    policy: source.policy ? readPolicy(source.policy) : null,
    receiptId: scalar(source.receipt_id),
    simulationId: scalar(source.simulation_id),
    idempotencyKey: scalar(source.idempotency_key),
    documentId: scalar(source.document_id),
    documentNumber: scalar(source.document_number),
    latencyMs: asNumber(source.latency_ms),
    startedAt: scalar(source.started_at),
    payload: asObject(source.payload),
    stateSnapshot: asObject(source.state_snapshot),
    explanation: scalar(source.explanation),
  }
}

/**
 * `get_request_log(since?, actor?, tool?, error_code?, mode?, limit?, offset?)`
 * → `{count, offset, requests}`, newest first. Paged by `limit` + `offset`.
 */
export interface RequestLogPage {
  count: number | null
  offset: number | null
  requests: RequestLogEntry[]
}

export function readRequestLogPage(payload: unknown): RequestLogPage {
  const source = asObject(payload)
  return {
    count: asNumber(source.count),
    offset: asNumber(source.offset),
    requests: asArray(source.requests).map(readRequestLogEntry),
  }
}
