/**
 * @vitest-environment jsdom
 *
 * The only write page, against envelopes recorded from the live facade on
 * 2026-09-11: a pending `po_approval` and a pending `goods_acceptance`, the
 * simulations of both decisions, and a real commit envelope. `keelClient` is
 * mocked; nothing here touches the network.
 *
 * What these tests are really asserting is the non-negotiable: no commit
 * without a simulation the user saw and confirmed, a fresh idempotency key
 * derived from that simulation, and every quantity and judgement coming from
 * Keel rather than from the console.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { KeelApiError, type CommitOptions, type ToolPayload } from '../lib/keelClient'
import { resetWhoamiCache } from '../lib/useWhoami'
import Approvals from './Approvals'

/* ------------------------------------------------------ recorded payloads */

const PO_REQUEST = {
  created_at: '2026-09-10T19:58:29Z',
  decided_at: null,
  decided_by: null,
  decision_comment: null,
  document_id: '01M26ECY5CGMXQM1NYJ5DFV6F7',
  document_number: 'PO-000001',
  document_type: 'PurchaseOrder',
  expired: false,
  expires_at: '2026-09-13T19:58:29Z',
  id: '01M26ECY5SDKE5DB8G5WM3ABRD',
  kind: 'po_approval',
  payload: {},
  projected_effects: {
    balance_deltas: [],
    details: { supplier: { code: 'ACME', name: 'ACME Industrial' }, total: '12000.00' },
    documents: [
      {
        action: 'create',
        fields: { number: 'PO-000001', status: 'draft', total_cents: 1200000 },
        id: '01M26ECY5CGMXQM1NYJ5DFV6F7',
        number: 'PO-000001',
        status: 'draft',
        type: 'PurchaseOrder',
      },
    ],
    events: ['purchase_order.created'],
    inventory_deltas: [],
    journal_entry: null,
    open_items: [],
  },
  reason: 'PO total 12000.00 exceeds the approval threshold',
  requested_by: 'agent:demo-run',
  status: 'pending',
  tool_name: 'create_purchase_order',
}

const GOODS_REQUEST = {
  created_at: '2026-09-10T19:59:00Z',
  document_id: '01M26ED6JG4HZE8RR40B40C0CP',
  document_number: 'PO-000002',
  document_type: 'PurchaseOrder',
  expired: false,
  expires_at: '2026-09-13T19:59:00Z',
  id: '01M26EDVZEJKDVKT707QQTHHDK',
  kind: 'goods_acceptance',
  payload: { po: 'PO-000002' },
  projected_effects: {
    balance_deltas: [
      { account: '1300', delta_cents: 50000 },
      { account: '1400', delta_cents: -50000 },
    ],
    details: {
      counted: [
        {
          account: '1300',
          damaged_qty: 0,
          expected_qty: 10,
          note: '',
          over_qty: 0,
          po_line_id: '01M26ED6JNEZANTNXKPQTCE2B0',
          qty: 10,
          short_qty: 0,
          sku: 'VALVE-2IN',
          unit_cost_cents: 5000,
        },
      ],
      discrepancies: [],
    },
    documents: [],
    events: ['goods.received'],
    inventory_deltas: [{ qty_delta: 10, sku: 'VALVE-2IN' }],
    journal_entry: null,
    open_items: [],
  },
  reason:
    'goods_acceptance_by_human: goods are posted by a human after counting: the receipt is parked for acceptance (accept_goods / reject_goods)',
  requested_by: 'agent:demo-run',
  status: 'pending',
  tool_name: 'receive_goods',
}

/** `POST /api/simulate/approve_purchase_order` — flat, no `result` key. */
const APPROVE_SIMULATION = {
  ok: true,
  mode: 'simulate',
  request_id: '01M281N3DZXXJZYWN063B05XJV',
  simulation_id: '01M281N3EFWVDP0CSHN4B80P6H',
  tool: 'approve_purchase_order',
  validation: { errors: [], warnings: [] },
  policy: {
    decision: 'allow',
    rules_evaluated: ['po_approver_differs', 'human_approval_only'],
    rules_triggered: [],
    reasons: [],
    warnings: [],
    error_code: null,
    policy_version: 1,
    policy_hash: 'sha256:92739d949a64bb803c45e10efb9796017c70c135b301b072aedac22abf352fec',
  },
  would_commit: true,
  commit_would_fail_with: null,
  projected_effects: {
    documents: [
      {
        type: 'PurchaseOrder',
        id: '01M26ECY5CGMXQM1NYJ5DFV6F7',
        number: 'PO-000001',
        status: 'draft',
        action: 'update',
        fields: { approved_by: 'human:paul-console', status: 'approved' },
      },
    ],
    journal_entry: null,
    open_items: [],
    inventory_deltas: [],
    balance_deltas: [],
    events: ['purchase_order.approved', 'approval.approved'],
  },
  expires_at: '2026-09-11T11:04:14Z',
}

/**
 * `POST /api/simulate/accept_goods` for 7 good and 2 damaged of 10 expected.
 * `short_qty: 1` and the discrepancy prose are Keel's; the console sent counts.
 */
const ACCEPT_SIMULATION = {
  ok: true,
  mode: 'simulate',
  request_id: '01M281N5G1GD3FMXYY7M9MYAKM',
  simulation_id: '01M281N5GMG4A9BY6646M4HQV2',
  tool: 'accept_goods',
  validation: {
    errors: [],
    warnings: ['discrepancy: VALVE-2IN: 1 short', 'discrepancy: VALVE-2IN: 2 damaged'],
  },
  policy: {
    decision: 'allow',
    rules_evaluated: ['human_approval_only'],
    rules_triggered: [],
    reasons: [],
    warnings: [],
    error_code: null,
    policy_version: 1,
    policy_hash: 'sha256:92739d949a64bb803c45e10efb9796017c70c135b301b072aedac22abf352fec',
  },
  would_commit: true,
  commit_would_fail_with: null,
  projected_effects: {
    documents: [],
    journal_entry: {
      id: '01M281N5GJBX11GYPHNVGG1XWJ',
      posting_date: '2026-09-11',
      memo: 'Goods receipt for PO PO-000002',
      source_type: 'GoodsReceipt',
      lines: [
        { account: '1300', debit_cents: 35000, credit_cents: 0, description: 'GRN 7 x VALVE-2IN' },
        { account: '1400', debit_cents: 0, credit_cents: 35000, description: 'GR/IR PO-000002' },
      ],
      total_debit_cents: 35000,
      total_credit_cents: 35000,
      is_balanced: true,
    },
    open_items: [],
    inventory_deltas: [{ sku: 'VALVE-2IN', qty_delta: 7 }],
    balance_deltas: [
      { account: '1300', delta_cents: 35000 },
      { account: '1400', delta_cents: -35000 },
    ],
    events: ['goods.received', 'goods.accepted'],
    details: {
      counted: [
        {
          account: '1300',
          damaged_qty: 2,
          expected_qty: 10,
          note: 'two crushed in transit',
          over_qty: 0,
          po_line_id: '01M26ED6JNEZANTNXKPQTCE2B0',
          qty: 7,
          short_qty: 1,
          sku: 'VALVE-2IN',
          unit_cost_cents: 5000,
        },
      ],
      discrepancies: ['VALVE-2IN: 1 short', 'VALVE-2IN: 2 damaged'],
    },
  },
  expires_at: '2026-09-11T11:04:16Z',
}

/** `POST /api/commit/{tool}` — also flat, with `status` and a signed receipt. */
const COMMIT = {
  ok: true,
  mode: 'commit',
  status: 'applied',
  request_id: '01M281VR41DHNH4MB2B79B4QAA',
  tool: 'approve_purchase_order',
  document: {
    action: 'update',
    id: '01M26ECY5CGMXQM1NYJ5DFV6F7',
    number: 'PO-000001',
    status: 'approved',
    type: 'PurchaseOrder',
  },
  effects: {
    balance_deltas: [],
    documents: [],
    events: ['purchase_order.approved', 'approval.approved'],
    inventory_deltas: [],
    journal_entry: null,
    open_items: [],
  },
  events_emitted: [
    { seq: 91, type: 'purchase_order.approved' },
    { seq: 92, type: 'approval.approved' },
  ],
  journal_entry: null,
  policy: { decision: 'allow', rules_evaluated: [], rules_triggered: [], reasons: [], warnings: [] },
  receipt: {
    actor_id: 'human:paul-console',
    document_type: 'PurchaseOrder',
    id: '01M281VR4H5KJCXT7BV5G1DXP6',
    public_key_id: '01M1Y420ZTB6BCVYVN1A5S6YG8',
    signed_at: '2026-09-11T10:57:52Z',
    tool_name: 'approve_purchase_order',
  },
  warnings: [],
}

/* ------------------------------------------------------------------ mocks */

/** `whoami`, recorded live 2026-09-11 for the console token. */
const WHOAMI = {
  expires_at: null,
  kind: 'human',
  on_behalf_of: null,
  scopes: ['*:read', 'approvals:write', 'procurement:approve', 'procurement:receive'],
  subject: 'human:paul-console',
  token_id: '01M267Y8BX4CFRAVYN8CWR69G0',
  tool_count: 30,
  tools: [
    'accept_goods', 'approve_purchase_order', 'describe_tool', 'explain_balance', 'explain_error',
    'find_duplicates', 'get_account_balance', 'get_agent_activity', 'get_current_period',
    'get_document', 'get_inventory', 'get_ledger_entries', 'get_period', 'get_reconciliation',
    'get_request_log', 'get_trial_balance', 'list_capabilities', 'list_document_types',
    'list_open_items', 'list_pending_approvals', 'poll_events', 'receive_goods', 'reject_approval',
    'reject_goods', 'replay_simulate', 'request_approval', 'search_documents', 'trace_document',
    'verify_receipt', 'whoami',
  ],
}

let whoami: unknown = WHOAMI
let pending: unknown = { count: 2, pending: [PO_REQUEST, GOODS_REQUEST] }
let simulation: unknown = APPROVE_SIMULATION

const query = vi.fn(async (tool: string) => {
  if (tool === 'whoami') return whoami
  if (tool === 'list_pending_approvals') return pending
  throw new KeelApiError({ code: 'NOT_FOUND', message: `unknown tool ${tool}`, tool })
})

const simulate = vi.fn(async (_tool: string, _payload: ToolPayload = {}) => simulation)
const commit = vi.fn(async (_tool: string, _payload: ToolPayload, _options: CommitOptions) => COMMIT)

vi.mock('../lib/keelClient', async () => {
  const actual = await vi.importActual<typeof import('../lib/keelClient')>('../lib/keelClient')
  return {
    ...actual,
    keel: {
      health: vi.fn(),
      query: (...args: Parameters<typeof query>) => query(...args),
      streamEvents: vi.fn(),
      simulate: (...args: Parameters<typeof simulate>) => simulate(...args),
      commit: (...args: Parameters<typeof commit>) => commit(...args),
    },
  }
})

function show() {
  return render(
    <MemoryRouter initialEntries={['/approvals']}>
      <Approvals />
    </MemoryRouter>,
  )
}

/**
 * The card for one pending request, so queries do not cross between them.
 * Keyed on the request id, which appears once; the document number appears
 * again inside the "what the agent's call would do" projection.
 */
const CARD = {
  po: PO_REQUEST.id,
  goods: GOODS_REQUEST.id,
} as const

async function card(which: keyof typeof CARD) {
  const field = await screen.findByText(CARD[which])
  return field.closest('article') as HTMLElement
}

afterEach(cleanup)

beforeEach(() => {
  sessionStorage.clear()
  sessionStorage.setItem('keel.token', 'test-token')
  whoami = WHOAMI
  resetWhoamiCache()
  pending = { count: 2, pending: [PO_REQUEST, GOODS_REQUEST] }
  simulation = APPROVE_SIMULATION
  query.mockClear()
  simulate.mockClear()
  commit.mockClear()
})

/* ------------------------------------------------------------------ tests */

describe('Approvals inbox', () => {
  it('lists what agents parked, with Keel\'s reason verbatim', async () => {
    show()

    expect((await screen.findAllByText('PO-000001')).length).toBeGreaterThan(0)
    expect(await screen.findByText('PO total 12000.00 exceeds the approval threshold')).toBeTruthy()
    expect(await screen.findByText('po_approval')).toBeTruthy()
    expect(await screen.findByText('goods_acceptance')).toBeTruthy()
    // Both requests came from the same agent.
    expect((await screen.findAllByText('agent:demo-run')).length).toBe(2)
  })

  it('offers no decision until a token is in the session', async () => {
    sessionStorage.clear()
    show()

    expect(await screen.findByText(/No token in this session/)).toBeTruthy()
    expect(query).not.toHaveBeenCalled()
  })
})

describe('Scope gating from whoami', () => {
  it('disables a decision Keel does not list for this token, and says which tool', async () => {
    whoami = {
      ...WHOAMI,
      scopes: ['*:read', 'procurement:receive'],
      tools: WHOAMI.tools.filter(
        (tool) => tool !== 'approve_purchase_order' && tool !== 'reject_approval',
      ),
    }
    show()
    const po = await card('po')
    const goods = await card('goods')

    // The PO decision is out of reach; goods acceptance is not.
    await waitFor(() =>
      expect((within(po).getByText('Approve') as HTMLButtonElement).disabled).toBe(true),
    )
    expect(within(po).getByText('approve_purchase_order')).toBeTruthy()
    expect(within(po).getByText('reject_approval')).toBeTruthy()
    expect((within(goods).getByText('Accept goods') as HTMLButtonElement).disabled).toBe(false)
    expect(simulate).not.toHaveBeenCalled()
  })
})

describe('Approving a purchase order', () => {
  it('simulates before it commits, and commits nothing without a confirmation', async () => {
    const user = userEvent.setup()
    show()

    await user.click(within(await card('po')).getByText('Approve'))

    await waitFor(() =>
      expect(simulate).toHaveBeenCalledWith('approve_purchase_order', {
        po: 'PO-000001',
      }),
    )
    // The projection is on screen and nothing has been written.
    const panel = (await screen.findByText(/simulated, no side effects/)).closest(
      '.decision-panel',
    ) as HTMLElement
    expect(within(panel).getByText('purchase_order.approved')).toBeTruthy()
    expect(within(panel).getByText('approval.approved')).toBeTruthy()
    expect(within(panel).getByText('po_approver_differs, human_approval_only')).toBeTruthy()
    expect(commit).not.toHaveBeenCalled()
  })

  it('sends the comment the approver typed', async () => {
    const user = userEvent.setup()
    show()
    const po = await card('po')

    await user.type(within(po).getByLabelText('Comment'), 'ok by me')
    await user.click(within(po).getByText('Approve'))

    await waitFor(() =>
      expect(simulate).toHaveBeenCalledWith('approve_purchase_order', {
        po: 'PO-000001',
        comment: 'ok by me',
      }),
    )
  })

  it('commits with an idempotency key built from the simulation it showed', async () => {
    const user = userEvent.setup()
    show()

    await user.click(within(await card('po')).getByText('Approve'))
    await user.click(await screen.findByText('Confirm — Approve purchase order'))

    await waitFor(() => expect(commit).toHaveBeenCalled())
    const [tool, payload, options] = commit.mock.calls[0]
    expect(tool).toBe('approve_purchase_order')
    expect(payload).toEqual({ po: 'PO-000001' })
    expect(options.idempotencyKey).toBe(
      `console:${APPROVE_SIMULATION.request_id}:approve_purchase_order`,
    )
    expect(options.simulationId).toBe(APPROVE_SIMULATION.simulation_id)

    // The receipt Keel signed, and the sequence numbers it emitted.
    expect(await screen.findByText('applied')).toBeTruthy()
    expect(await screen.findByText('01M281VR4H5KJCXT7BV5G1DXP6')).toBeTruthy()
    expect(
      await screen.findByText('#91 purchase_order.approved, #92 approval.approved'),
    ).toBeTruthy()
  })

  it('keeps the receipt on screen after the decided request leaves the inbox', async () => {
    const user = userEvent.setup()
    show()

    await user.click(within(await card('po')).getByText('Approve'))

    // Once decided, Keel stops listing it — the commit reloads into this.
    pending = { count: 1, pending: [GOODS_REQUEST] }
    await user.click(await screen.findByText('Confirm — Approve purchase order'))

    // The card goes away with the request.
    await waitFor(() => expect(screen.queryByText(PO_REQUEST.id)).toBeNull())

    // The receipt and the emitted sequence numbers are still readable.
    expect(screen.getByText('01M281VR4H5KJCXT7BV5G1DXP6')).toBeTruthy()
    expect(screen.getByText('applied')).toBeTruthy()
  })

  it('refuses to offer a commit when Keel says it would not commit', async () => {
    simulation = {
      ...APPROVE_SIMULATION,
      would_commit: false,
      commit_would_fail_with: 'PRECONDITION_FAILED',
      policy: { ...APPROVE_SIMULATION.policy, decision: 'deny', reasons: ['self-approval'] },
    }
    const user = userEvent.setup()
    show()

    await user.click(within(await card('po')).getByText('Approve'))

    const confirm = (await screen.findByText(
      'Confirm — Approve purchase order',
    )) as HTMLButtonElement
    expect(confirm.disabled).toBe(true)
    expect(await screen.findByText('PRECONDITION_FAILED')).toBeTruthy()
    expect(await screen.findByText('self-approval')).toBeTruthy()
  })

  it('shows a refusal from Keel verbatim and writes nothing', async () => {
    simulate.mockImplementationOnce(async () => {
      throw new KeelApiError({
        code: 'POLICY_DENIED',
        message: 'approver must differ from the creator',
        requestId: '01M281N3DZXXJZYWN063B05XJV',
        retryAdvice: 'Have another human approve this order.',
      })
    })
    const user = userEvent.setup()
    show()

    await user.click(within(await card('po')).getByText('Approve'))

    expect(await screen.findByText('POLICY_DENIED')).toBeTruthy()
    expect(await screen.findByText('Have another human approve this order.')).toBeTruthy()
    expect(commit).not.toHaveBeenCalled()
  })
})

describe('Accepting goods', () => {
  it('starts from the expected quantities on the request', async () => {
    show()
    const goods = await card('goods')

    expect((within(goods).getByLabelText('accepted VALVE-2IN') as HTMLInputElement).value).toBe('10')
    expect((within(goods).getByLabelText('damaged VALVE-2IN') as HTMLInputElement).value).toBe('0')
  })

  it('sends the counts a human typed, per line', async () => {
    simulation = ACCEPT_SIMULATION
    const user = userEvent.setup()
    show()
    const goods = await card('goods')

    await user.clear(within(goods).getByLabelText('accepted VALVE-2IN'))
    await user.type(within(goods).getByLabelText('accepted VALVE-2IN'), '7')
    await user.clear(within(goods).getByLabelText('damaged VALVE-2IN'))
    await user.type(within(goods).getByLabelText('damaged VALVE-2IN'), '2')
    await user.type(within(goods).getByLabelText('note VALVE-2IN'), 'two crushed in transit')
    await user.click(within(goods).getByText('Accept goods'))

    await waitFor(() =>
      expect(simulate).toHaveBeenCalledWith('accept_goods', {
        request_id: '01M26EDVZEJKDVKT707QQTHHDK',
        accepted_lines: [
          { sku: 'VALVE-2IN', qty: 7, damaged_qty: 2, note: 'two crushed in transit' },
        ],
      }),
    )
  })

  it('reads short, over and the value back from Keel rather than working them out', async () => {
    simulation = ACCEPT_SIMULATION
    const user = userEvent.setup()
    show()
    const goods = await card('goods')

    await user.clear(within(goods).getByLabelText('accepted VALVE-2IN'))
    await user.type(within(goods).getByLabelText('accepted VALVE-2IN'), '7')
    await user.click(within(goods).getByText('Accept goods'))

    const panel = (await screen.findByText(/simulated, no side effects/)).closest(
      '.decision-panel',
    ) as HTMLElement

    // Keel's discrepancy prose, its journal entry and its balanced verdict.
    expect(within(panel).getByText('VALVE-2IN: 1 short')).toBeTruthy()
    expect(within(panel).getByText('VALVE-2IN: 2 damaged')).toBeTruthy()
    // The two journal lines, Keel's two totals, and the 1300 balance delta.
    expect(within(panel).getAllByText('350.00').length).toBe(5)
    expect(within(panel).getByText('balanced')).toBeTruthy()
  })
})

describe('Rejecting', () => {
  it('will not reject without the reason Keel requires', async () => {
    const user = userEvent.setup()
    show()
    const po = await card('po')

    expect((within(po).getByText('Reject') as HTMLButtonElement).disabled).toBe(true)

    await user.type(within(po).getByLabelText('Reason to reject'), 'over budget')
    expect((within(po).getByText('Reject') as HTMLButtonElement).disabled).toBe(false)
  })

  it('sends a goods rejection to reject_goods, not reject_approval', async () => {
    const user = userEvent.setup()
    show()
    const goods = await card('goods')

    await user.type(within(goods).getByLabelText('Reason to reject'), 'never arrived')
    await user.click(within(goods).getByText('Reject'))

    await waitFor(() =>
      expect(simulate).toHaveBeenCalledWith('reject_goods', {
        request_id: '01M26EDVZEJKDVKT707QQTHHDK',
        reason: 'never arrived',
      }),
    )
  })
})
