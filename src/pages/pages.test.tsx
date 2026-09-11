/**
 * @vitest-environment jsdom
 *
 * The pages, rendered against payloads recorded from the live facade on
 * 2026-09-10, with the open-item rows and `get_current_period` recorded on
 * 2026-09-11 once demo data existed. `keelClient` is mocked; nothing here
 * touches the network.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeelApiError, type ToolPayload } from '../lib/keelClient'
import Events from './Events'
import Inventory from './Inventory'
import Ledger from './Ledger'
import OpenItems from './OpenItems'
import Recon from './Recon'
import Status from './Status'
import Trace from './Trace'

const HEALTH = {
  status: 'ok',
  version: '0.1.0',
  env: 'dev',
  signing_key_id: '01M1Y420ZTB6BCVYVN1A5S6YG8',
  event_seq: 79,
  policy_version: 1,
}

/** Keyed by tool name, each the `result` of a recorded response. */
const RESULTS: Record<string, unknown> = {
  get_trial_balance: {
    accounts: [
      { code: '1000', credit_cents: 0, debit_cents: 25000000, name: 'Cash', net_cents: 25000000, type: 'asset' },
      { code: '1300', credit_cents: 0, debit_cents: 275000, name: 'Inventory', net_cents: 275000, type: 'asset' },
      { code: '3000', credit_cents: 25275000, debit_cents: 0, name: "Owner's equity", net_cents: -25275000, type: 'equity' },
    ],
    is_balanced: true,
    period: null,
    total_credit_cents: 25275000,
    total_debit_cents: 25275000,
  },
  explain_balance: {
    account: '1300',
    balance: { account: '1300', as_of: null, credit_cents: 0, debit_cents: 275000, net_cents: 275000 },
    by_source_type: [{ count: 3, net_cents: 275000, source_type: 'ItemOpeningBalance' }],
    movements: [],
  },
  get_ledger_entries: {
    account: '1300',
    count: 1,
    period: null,
    entries: [
      {
        credit_cents: 0,
        debit_cents: 25000,
        description: 'opening stock VALVE-2IN',
        entry: 'JE-000001',
        entry_id: '01M25Y1B15XT84M6TEKAW4YJ21',
        memo: 'Opening stock 5 x VALVE-2IN @ 50.00',
        posting_date: '2026-09-01',
        running_net_cents: 25000,
        source_id: '01M25Y1B15Z6PHPYWDGFB8E6S4',
        source_type: 'ItemOpeningBalance',
        status: 'posted',
      },
    ],
  },
  get_inventory: {
    items: [
      {
        is_active: true,
        is_stocked: true,
        list_price_cents: 2400,
        name: 'Flange 4 bolt',
        on_hand_qty: 100,
        sku: 'FLANGE-4',
        standard_cost_cents: 1500,
        value_cents: 150000,
      },
    ],
    total_value_cents: 275000,
  },
  get_current_period: {
    as_of: '2026-09-11',
    is_open: true,
    nearest_open_period: null,
    period: {
      code: '2026-09',
      end_date: '2026-09-30',
      id: '01M25Y1AZ4B69W0M43XQCM7G6N',
      start_date: '2026-09-01',
      status: 'open',
    },
  },
  list_pending_approvals: { count: 0, pending: [] },
  get_period: {
    close_readiness: {
      blocked_supplier_invoices: [],
      blockers: [],
      draft_purchase_orders: [],
      open_gr_ir_cents: 0,
      pending_approvals: 0,
      period: '2026-09',
      ready: true,
      status: 'open',
      trial_balance_ok: true,
      trial_balance_totals: { credit_cents: 25275000, debit_cents: 25275000 },
      uninvoiced_shipment_lines: 0,
      warnings: [],
    },
    period: {
      code: '2026-09',
      end_date: '2026-09-30',
      id: '01M25Y1AZ4B69W0M43XQCM7G6N',
      start_date: '2026-09-01',
      status: 'open',
    },
  },
  trace_document: {
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
    root: { id: '01M25Y1B15Z6PHPYWDGFB8E6S4', number: 'VALVE-2IN', type: 'Item' },
  },
  poll_events: {
    count: 1,
    events: [
      {
        actor_id: 'admin:paul',
        document_id: '01M25Y1B15XT84M6TEKAW4YJ21',
        document_type: 'JournalEntry',
        occurred_at: '2026-09-10T15:12:32Z',
        payload: {
          document_id: '01M25Y1B15XT84M6TEKAW4YJ21',
          document_type: 'JournalEntry',
          number: 'JE-000001',
          receipt_id: '01M25Y1B1M1XYPXJCPW6FBBP95',
          status: 'posted',
          summary: 'Journal entry JE-000001 posted',
        },
        receipt_id: '01M25Y1B1M1XYPXJCPW6FBBP95',
        seq: 66,
        type: 'journal_entry.posted',
      },
    ],
    last_seq: 66,
  },
}

const RECON: Record<string, unknown> = {
  gr_ir: {
    by_po: [],
    difference_cents: 0,
    gl_1400_net_cents: 0,
    kind: 'gr_ir',
    reconciled: true,
    subledger_open_cents: 0,
  },
  ap: {
    control_account: '2000',
    control_account_cents: 0,
    difference_cents: 0,
    kind: 'ap',
    open_items: [],
    reconciled: true,
    subledger_cents: 0,
  },
  ar: {
    control_account: '1200',
    control_account_cents: 0,
    difference_cents: 0,
    kind: 'ar',
    open_items: [],
    reconciled: true,
    subledger_cents: 0,
  },
  inventory: {
    difference_cents: 0,
    gl_1300_net_cents: 275000,
    items: [{ on_hand_qty: 100, sku: 'FLANGE-4', standard_cost_cents: 1500, value_cents: 150000 }],
    kind: 'inventory',
    note: 'differences arise from purchase price variance postings and non-standard receipt costs',
    reconciled: true,
    subledger_value_cents: 275000,
  },
}

const PERIOD_HITS = [
  { id: 'p1', number: '2026-09', status: 'open', type: 'FiscalPeriod', total_cents: null },
  { id: 'p2', number: '2026-08', status: 'closed', type: 'FiscalPeriod', total_cents: null },
]

/** `list_open_items`, recorded live 2026-09-11: AP is empty, AR has one row. */
const OPEN_ITEMS: Record<string, unknown> = {
  ap: { as_of: '2026-09-11', count: 0, items: [], kind: 'ap', total_remaining_cents: 0 },
  ar: {
    as_of: '2026-09-11',
    count: 1,
    kind: 'ar',
    total_remaining_cents: 80000,
    items: [
      {
        amount_cents: 80000,
        created_at: '2026-09-10T19:59:43',
        days_to_due: 29,
        due_date: '2026-10-10',
        id: '01M26EF6MQAM4CK5RZJFPGJGRP',
        kind: 'ar',
        overdue: false,
        party_id: '01M25Y1B0D7KRZ3T7E9AXY49NF',
        remaining_cents: 80000,
        source_doc_id: '01M26EF6MMPW27CN2REQF0PYD7',
        source_doc_number: 'CINV-000001',
        source_doc_type: 'CustomerInvoice',
        state_version: 1,
        status: 'open',
        updated_at: '2026-09-10T19:59:43',
      },
    ],
  },
}

const query = vi.fn(async (tool: string, payload: ToolPayload = {}) => {
  if (tool === 'get_reconciliation') return RECON[String(payload.kind)]
  if (tool === 'list_open_items') return OPEN_ITEMS[String(payload.kind)]
  if (tool === 'search_documents') {
    const items = payload.status ? PERIOD_HITS.filter((p) => p.status === payload.status) : PERIOD_HITS
    return { type: payload.type, count: items.length, offset: 0, items }
  }
  if (tool in RESULTS) return RESULTS[tool]
  throw new KeelApiError({ code: 'NOT_FOUND', message: `unknown tool ${tool}`, tool })
})

const streamEvents = vi.fn(async () => {
  // The stream is refused, so the feed falls back to polling poll_events.
  throw new KeelApiError({ code: 'HTTP_502', message: 'stream unavailable', httpStatus: 502 })
})

vi.mock('../lib/keelClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/keelClient')>('../lib/keelClient')
  return {
    ...actual,
    keel: {
      health: async () => HEALTH,
      query: (...args: Parameters<typeof query>) => query(...args),
      streamEvents: () => streamEvents(),
      simulate: vi.fn(),
      commit: vi.fn(),
    },
    loadDocumentTypes: async () => ['JournalEntry', 'PurchaseOrder'],
  }
})

function show(ui: React.ReactNode, path = '/') {
  return render(<MemoryRouter initialEntries={[path]}>{ui}</MemoryRouter>)
}

// vitest is not running with globals, so Testing Library's auto-cleanup is not
// registered; without this each render would pile up in the same document.
afterEach(cleanup)

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem('keel.token', 'test-token')
  query.mockClear()
})

describe('Status', () => {
  it('renders health, books, reconciliations, approvals and period readiness', async () => {
    show(<Status />)

    expect(await screen.findByText('01M1Y420ZTB6BCVYVN1A5S6YG8')).toBeTruthy()
    // "balanced" is both the field label and the badge Keel's `is_balanced` earns.
    expect((await screen.findAllByText('balanced')).length).toBe(2)
    // Minor units are regrouped for display, not summed: debit and credit both.
    expect((await screen.findAllByText('252,750.00')).length).toBe(2)
    expect((await screen.findAllByText('reconciled')).length).toBe(4)
    expect(await screen.findByText('nothing waiting on a human')).toBeTruthy()
    // The period starts on the newest open period Keel returns.
    expect(await screen.findByText('ready')).toBeTruthy()
    expect(await screen.findByText('2026-09-01 → 2026-09-30')).toBeTruthy()
  })

  it('never calls get_system_status', async () => {
    show(<Status />)
    await screen.findAllByText('balanced')
    expect(query.mock.calls.map(([tool]) => tool)).not.toContain('get_system_status')
  })

  it('shows a scope refusal verbatim instead of hiding the card', async () => {
    query.mockImplementationOnce(async () => {
      throw new KeelApiError({
        code: 'FORBIDDEN',
        message: "token lacks scope 'finance:read' required by get_trial_balance",
        requestId: '01M268FX3XE85GE0DAJNSQHY1J',
        retryAdvice: 'Obtain a token with the required scope.',
      })
    })
    show(<Status />)

    expect(await screen.findByText('FORBIDDEN')).toBeTruthy()
    expect(await screen.findByText('01M268FX3XE85GE0DAJNSQHY1J')).toBeTruthy()
    expect(await screen.findByText('Obtain a token with the required scope.')).toBeTruthy()
  })
})

describe('Events', () => {
  it('falls back to polling and renders the event with its summary', async () => {
    show(<Events />)

    // Once in the row, once as an option in the type filter.
    expect((await screen.findAllByText('journal_entry.posted')).length).toBe(2)
    expect(await screen.findByText('Journal entry JE-000001 posted')).toBeTruthy()
    expect(await screen.findByText('66')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('polling every 5s')).toBeTruthy())
  })

  it('arrives filtered when the URL names a document', async () => {
    show(<Events />, '/events?doc=NOTHING-MATCHES')
    await waitFor(() => expect(screen.getByText('0 of 1')).toBeTruthy())
  })
})

describe('Trace', () => {
  it('renders the chain with the receipt that signed each node', async () => {
    show(<Trace />, '/trace?doc=JE-000001')

    const chain = (await screen.findByText('Chain')).closest('section') as HTMLElement
    expect(within(chain).getByText('VALVE-2IN')).toBeTruthy()
    expect(within(chain).getByText('Item')).toBeTruthy()
    expect(within(chain).getByText('create_item')).toBeTruthy()
    expect(within(chain).getByText('admin:paul')).toBeTruthy()
    expect(within(chain).getByText('#65')).toBeTruthy()
  })

  it('asks trace_document for the reference in the URL', async () => {
    show(<Trace />, '/trace?doc=JE-000001')
    await screen.findByText('Chain')
    expect(query).toHaveBeenCalledWith(
      'trace_document',
      { id_or_number: 'JE-000001' },
      expect.anything(),
    )
  })

  it('shows the NOT_FOUND Keel returns for an unknown document', async () => {
    query.mockImplementationOnce(async () => {
      throw new KeelApiError({
        code: 'NOT_FOUND',
        message: "Document 'PO-9999' not found",
        requestId: '01M268MKM04CXKEBFYFZ7XS6P9',
        details: { type: 'Document', ref: 'PO-9999' },
      })
    })
    show(<Trace />, '/trace?doc=PO-9999')

    expect(await screen.findByText('NOT_FOUND')).toBeTruthy()
    expect(await screen.findByText("Document 'PO-9999' not found")).toBeTruthy()
  })
})

describe('Ledger', () => {
  it('renders the trial balance Keel computed, totals and all', async () => {
    show(<Ledger />, '/ledger')

    expect(await screen.findByText('Inventory')).toBeTruthy()
    expect(await screen.findByText("Owner's equity")).toBeTruthy()
    // Keel's own totals and balanced flag, formatted but not recomputed:
    // account 3000's credit, then the debit and credit totals in the footer.
    expect((await screen.findAllByText('252,750.00')).length).toBe(3)
    expect(await screen.findByText('balanced')).toBeTruthy()
    expect(await screen.findByText('-252,750.00')).toBeTruthy()
  })

  it('expands an account into its movements by source and its entries', async () => {
    const user = userEvent.setup()
    show(<Ledger />, '/ledger')

    await user.click(await screen.findByText('Inventory'))

    // Once as the by-source grouping, once as the entry's source column.
    expect((await screen.findAllByText('ItemOpeningBalance')).length).toBe(2)
    expect(await screen.findByText('2,750.00 over 3 entries')).toBeTruthy()
    expect(await screen.findByText('JE-000001')).toBeTruthy()
    expect(await screen.findByText('opening stock VALVE-2IN')).toBeTruthy()

    const asked = query.mock.calls.filter(([tool]) => tool === 'explain_balance')
    expect(asked[0][1]).toEqual({ account_code: '1300' })
    const entries = query.mock.calls.filter(([tool]) => tool === 'get_ledger_entries')
    expect(entries[0][1]).toEqual({ account_code: '1300', limit: 25 })
  })
})

describe('Open items', () => {
  it('shows the AP sub-ledger envelope and Keel\'s own as_of date', async () => {
    show(<OpenItems />, '/open-items')

    expect(await screen.findByText('2026-09-11')).toBeTruthy()
    expect(await screen.findByText('Keel has no open ap items.')).toBeTruthy()
    expect(query).toHaveBeenCalledWith(
      'list_open_items',
      { kind: 'ap', overdue_only: false },
      expect.anything(),
    )
  })

  it('asks Keel for the AR sub-ledger when that tab is chosen', async () => {
    const user = userEvent.setup()
    show(<OpenItems />, '/open-items')
    await screen.findByText('2026-09-11')

    await user.click(screen.getByText('Receivable'))

    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        'list_open_items',
        { kind: 'ar', overdue_only: false },
        expect.anything(),
      ),
    )
  })

  it('renders the recorded AR row rather than guessing at its columns', async () => {
    const user = userEvent.setup()
    show(<OpenItems />, '/open-items')
    await screen.findByText('2026-09-11')

    await user.click(screen.getByText('Receivable'))

    expect(await screen.findByText('CINV-000001')).toBeTruthy()
    expect(await screen.findByText('CustomerInvoice')).toBeTruthy()
    // The amount and the remaining amount, both Keel's, both regrouped only.
    expect((await screen.findAllByText('800.00')).length).toBe(3)
    // Keel's own due date and its own signed day count, never computed here.
    expect(await screen.findByText('2026-10-10')).toBeTruthy()
    expect(await screen.findByText('· 29d')).toBeTruthy()
    // `overdue: false` is Keel's verdict; the console never compares dates.
    expect(await screen.findByText('open')).toBeTruthy()
  })

  it('leaves the overdue judgement to Keel', async () => {
    const user = userEvent.setup()
    show(<OpenItems />, '/open-items')
    await screen.findByText('2026-09-11')

    await user.click(screen.getByLabelText('Overdue only'))

    await waitFor(() =>
      expect(query).toHaveBeenCalledWith(
        'list_open_items',
        { kind: 'ap', overdue_only: true },
        expect.anything(),
      ),
    )
  })
})

describe('Inventory', () => {
  it('renders stock at standard cost beside the GL difference', async () => {
    show(<Inventory />, '/inventory')

    expect(await screen.findByText('FLANGE-4')).toBeTruthy()
    expect(await screen.findByText('Flange 4 bolt')).toBeTruthy()
    expect(await screen.findByText('15.00')).toBeTruthy()
    // The field label, and the badge Keel's `reconciled` earns.
    expect((await screen.findAllByText('reconciled')).length).toBe(2)
    // Account 1300, the sub-ledger value and the stock total all 2,750.00.
    expect((await screen.findAllByText('2,750.00')).length).toBe(3)
    expect(await screen.findByText('0.00')).toBeTruthy()
  })
})

describe('Close readiness', () => {
  it('renders all four reconciliations and the period checklist', async () => {
    show(<Recon />, '/recon')

    expect(await screen.findByText('GR/IR')).toBeTruthy()
    expect(await screen.findByText('Accounts payable')).toBeTruthy()
    expect(await screen.findByText('Accounts receivable')).toBeTruthy()
    expect((await screen.findAllByText('reconciled')).length).toBe(4)
    expect(await screen.findByText('ready to close')).toBeTruthy()
    expect(await screen.findByText('2026-09-01 → 2026-09-30')).toBeTruthy()
  })

  it('offers no way to close the period', async () => {
    show(<Recon />, '/recon')
    await screen.findByText('GR/IR')

    const labels = screen.queryAllByRole('button').map((button) => button.textContent ?? '')
    expect(labels.some((label) => /close/i.test(label))).toBe(false)
    expect(query.mock.calls.map(([tool]) => tool)).not.toContain('close_period')
  })
})
