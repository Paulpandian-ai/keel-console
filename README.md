# keel-console

A thin, replaceable web head for [Keel](./CLAUDE.md), the headless agent-native ERP.
It talks to Keel only through the HTTP facade, holds no business logic, and has no server
component of its own. See `CLAUDE.md` for the non-negotiables and build order.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run typecheck
npm test
npm run build      # static site in dist/
```

Set the facade origin at build time with `VITE_KEEL_URL` (see `.env.example`); users can
override it at runtime in Settings. Paste a Keel bearer token in Settings — it lives in
`sessionStorage` only and is sent as an `Authorization` header, never in a URL or a log.

## Built — all five steps

| Piece | Notes |
|---|---|
| `src/lib/keelClient.ts` | The only module that calls `fetch`. `query` / `simulate` / `commit`, plus `GET /healthz`. Normalizes every failure into `KeelApiError` carrying `code`, `message`, `request_id`. |
| `src/lib/session.ts` | Token + base-URL override in `sessionStorage`, with a `clearSession`. |
| `/settings` | Base URL, masked token entry, clear session. |
| `/` Status | `GET /healthz`, plus the reads a console token actually holds: `get_trial_balance` (balanced, totals), `get_reconciliation` × gr_ir/ap/ar/inventory, `list_pending_approvals` (count), `get_period` (close readiness) for a period picked from `search_documents(FiscalPeriod)`. |
| `src/lib/sse.ts` | SSE decoder. `EventSource` cannot send an `Authorization` header, so the stream is read with `fetch`. |
| `src/lib/keelFields.ts` | The one place that reads Keel payload keys. Every key is now pinned against a live response — see below. |
| `/events` | Live feed over `/events/stream`, falling back to polling `poll_events` every 5s. Filter by type and document; click through to trace. |
| `/ledger` | Trial balance for a chosen period (or all), each account expanding into `explain_balance`'s grouping by source document and the entries from `get_ledger_entries`, paged by `limit`. |
| `/open-items` | AP and AR tabs over `list_open_items`, with party filter and overdue toggle — both passed to Keel, never evaluated here. Row shape pinned once demo AR data existed. |
| `/inventory` | `get_reconciliation(inventory)` (account 1300 vs sub-ledger) above `get_inventory`'s on-hand, standard cost and value per SKU. |
| `/recon` | Read-only close readiness: `get_period`'s checklist with blockers and warnings verbatim, plus all four reconciliations. No close button — that is the Controller agent's. |
| `src/components/PeriodPicker.tsx` | The period a page looks at: options and the initial pick both from Keel, never from the clock. |
| `src/pages/pages.test.tsx` | Status, Events, Trace, Ledger, Open Items, Inventory and Recon rendered against the recorded payloads with a mocked `keelClient` (jsdom + Testing Library, the harness step 4's approval tests will reuse). |
| `/trace` | `trace_document` rendered as a vertical timeline: each node with its status, total, signed receipts (`tool`, `actor`, `signed_at`) and `event_seqs`. Browse by document type via `search_documents`. |

| `/approvals` | The human inbox and the only page that writes: `list_pending_approvals`, then simulate → confirm → commit for `approve_purchase_order`, `reject_approval`, `accept_goods`, `reject_goods`. |
| `src/components/Effects.tsx` | What a write would do, or has just done — Keel returns the same object for `simulate.projected_effects` and `commit.effects`. |
| `src/pages/approvals.test.tsx` | The write path against recorded envelopes: no commit without a confirmed simulation, the key derived from that simulation, and the per-line goods counts. |

| `src/lib/useWhoami.ts` | `whoami`, once per session, shared by every page. `can(tool)` is Keel's `tools` list; pages hold their reads until it answers, disable what it leaves out, and fail open only if `whoami` itself is unavailable. |
| `/receipts` | `verify_receipt` for a receipt id, `explain_error` for a request id, and the paged `get_request_log` with mode / tool / error-code filters. Every `request_id` shown on an error, and every receipt id on Trace, Events and Approvals, links here. |

## Verified against the live facade

Every shape the console reads is recorded from
`headless-erp-production-0480.up.railway.app` on 2026-09-10, using a token with `*:read`,
`approvals:read`, `procurement:approve`, `procurement:receive`. The recordings live in
`src/lib/*.test.ts`; `src/lib/keelFields.ts` holds the readers.

- **Envelope.** Success is `{ok, mode, request_id, tool, result}` — the payload is `result`, and
  `keelClient.query` unwraps it. Errors are `{ok:false, mode, request_id, error:{code, message,
  details?, retry_advice}}`. `details` *is* returned (an earlier note here said otherwise):
  `required_scope` on FORBIDDEN, `{errors, expected_fields, required_fields}` on
  VALIDATION_ERROR, `{type, ref}` on a missing document. An unknown *tool* answers NOT_FOUND with
  no `request_id`.
- **Events.** `poll_events` → `{count, events, last_seq}`; each event is `{seq, type,
  document_type, document_id, receipt_id, actor_id, occurred_at, payload:{document_type,
  document_id, number, status, receipt_id, summary}}`. An SSE frame carries exactly one of those
  objects in `data:`, with `id:` = seq and `event:` = type.
- **Trace.** `trace_document(id_or_number)` → `{requested, root, nodes, edges,
  journal_entry_count, reversal_journal_entries}`. A node is `{id, number, type, status,
  total_cents, created_at, state_version, event_seqs, receipts:[{id, tool, actor, on_behalf_of,
  signed_at}]}`. `edges` is the one unverified shape — every trace in the seeded dataset returns
  `edges: []` — so it is read loosely and marked as such in `keelFields.ts`.
- **Paging.** `limit` + `offset` (`search_documents`, `get_request_log`) or `after_seq` + `limit`
  (`poll_events`). There is no cursor anywhere in the catalog.
- **Money.** Minor units in `*_cents`. `formatCents` regroups the digits for display; nothing is
  summed, netted or compared. Totals, `is_balanced`, `running_net_cents`, `difference_cents`,
  `value_cents` and the overdue flag are all Keel's.
- **Ledger.** `get_trial_balance` → `{accounts:[{code, name, type, debit_cents, credit_cents,
  net_cents}], is_balanced, period, total_*}`. `explain_balance` → `{account, period, balance,
  by_source_type:[{source_type, count, net_cents}], movements, reversal_pairs}`.
  `get_ledger_entries` → `{account, count, period, entries}` and pages by `limit` alone — there is
  no offset on that tool.
- **Inventory.** `get_inventory(sku?)` → `{items:[{sku, name, on_hand_qty, standard_cost_cents,
  list_price_cents, value_cents, is_active, is_stocked}], total_value_cents}`.
- **Reconciliation.** All four kinds share `{kind, reconciled, difference_cents}`; `gr_ir` adds
  `{gl_1400_net_cents, subledger_open_cents, by_po}`, `ap`/`ar` add `{control_account,
  control_account_cents, subledger_cents, open_items}`, `inventory` adds `{gl_1300_net_cents,
  subledger_value_cents, items, note}`.
- **Open items.** `{kind, as_of, count, total_remaining_cents, items}`, each item
  `{id, kind, status, party_id, amount_cents, remaining_cents, due_date, days_to_due, overdue,
  source_doc_id, source_doc_number, source_doc_type, created_at, updated_at, state_version}`.
  Recorded 2026-09-11 against the AR sub-ledger; `overdue` and `days_to_due` are Keel's, decided
  against its own `as_of`.
- **Approvals.** `list_pending_approvals` → `{count, pending}`, each request
  `{id, kind, status, reason, requested_by, created_at, expires_at, expired, document_type,
  document_id, document_number, tool_name, payload, projected_effects}` — `projected_effects` is
  what the agent's blocked call would have done, in the same shape a simulate returns.
- **Simulate and commit.** Neither has a `result` key; both are flat. A simulate carries
  `{simulation_id, validation:{errors, warnings}, policy, would_commit, commit_would_fail_with,
  projected_effects, state_versions, expires_at, compensating_tool}`. A commit carries
  `{status, document, effects, events_emitted, journal_entry, receipt, policy, warnings}`, where
  `status` is `applied` or — when Keel recognises the idempotency key — `replayed`, returning the
  original receipt and emitting nothing new.
- **Receipts.** `verify_receipt` → `{receipt_id, valid, signature_valid, action_hash_valid,
  key_retired, public_key_id, receipt}`, the receipt being `{id, tool_name, actor_id, actor_kind,
  on_behalf_of, document_type, document_id, document_number, action_hash, before_hash,
  after_hash, public_key_id, signature, signed_at}`. An unknown id is not an error: Keel answers
  `ok: true` with `{receipt_id, valid: false, reason: "receipt not found"}`.
- **Request log.** `get_request_log` → `{count, offset, requests}`, each `{request_id, tool,
  mode, actor_id, actor_kind, on_behalf_of, outcome, error_code, error_message, policy_decision,
  policy, receipt_id, simulation_id, idempotency_key, document_id, document_number, latency_ms,
  started_at, payload, state_snapshot}`. `explain_error(request_id)` returns the same row plus
  `explanation`, Keel's own sentence — and answers for successful requests too ("nothing to
  explain").
- **Identity.** `whoami` → `{subject, kind, scopes, tools, tool_count, token_id, expires_at,
  on_behalf_of}`; any authenticated token may call it. `tools` names every tool the token may
  call and is the only thing the console gates on.
- **Event stream auth.** `/events/stream` answers 401 for a missing or invalid token and 403
  `FORBIDDEN` with `details.required_scope: events:read` for a valid token without the scope. The
  feed shows either verbatim and does not fall back to `poll_events`, which wants the same scope.
- **Goods acceptance.** `details.counted` gives `{sku, po_line_id, expected_qty, qty, damaged_qty,
  short_qty, over_qty, unit_cost_cents, account, note}`. The console sends `accepted_lines` with
  the counts a human typed; `short_qty`, `over_qty`, the journal entry and the value all come back
  from Keel.

`get_system_status` is deliberately **not** used. It requires `admin:status`, and a console token
carries no admin scope, so Keel answers `FORBIDDEN / token lacks scope 'admin:status'`. The
console has no privileged path: it reads what its token allows and shows Keel's refusal verbatim
when it does not.

Both gaps the console used to work around have been closed by the kernel, and both workarounds
are deleted:

- **`get_current_period`** names the current period against Keel's own `as_of`, so `PeriodPicker`
  no longer starts on whatever `search_documents(FiscalPeriod, status: open, limit: 1)` happened
  to return first — which, because the seed creates all 36 periods in the same instant, was
  `2025-01` rather than the live period.
- **`list_document_types`** returns the legal types with how each is keyed, filtered and ordered.
  `loadDocumentTypes` reads it like any other query, so the console no longer takes data from an
  error anywhere.

The last gap — the console could not learn its own token's scopes — closed when the kernel
shipped `whoami`. Every page now disables up front what its `tools` list leaves out, and the top
bar names the token's subject.

Useful for the next step: `list_capabilities` returns all 68 tools with signature and scope, and
`describe_tool(name)` returns one tool's JSON Schema.

## Deploy

`.github/workflows/deploy.yml` typechecks, tests, builds and publishes `dist/` to GitHub Pages on
every push to `main`. Two things make a history-routed SPA work under a project-pages sub-path:

- `VITE_BASE_PATH=/keel-console/` becomes Vite's `base` and the router's `basename`
  (`src/main.tsx`). Leave it unset for `/` on a custom domain or a Railway static service.
- `npm run build` copies `dist/index.html` to `dist/404.html`, which GitHub Pages serves for any
  unknown path, so a deep link like `/keel-console/trace?doc=PO-000001` still loads the app.

Nothing secret enters the build. The Keel token is pasted at runtime and lives in
`sessionStorage`; the only build-time inputs are the facade URL and the base path.
