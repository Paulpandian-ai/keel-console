# keel-console — CLAUDE.md

Keel is a headless, agent-native ERP. This repo is a **head**: a thin, replaceable web console that talks to Keel only through its HTTP facade. The console exists to let humans see what agents did and to serve as the approval and goods-acceptance inbox. It proves a thesis from the research paper: because every fact in Keel is behind a tool, a UI can be built in an afternoon and thrown away.

## Non-negotiables

1. **No business logic here.** Every number, status, and decision comes from Keel. The console never computes totals, balances, variances, or due dates. If a screen needs a derived value, ask for a Keel tool that returns it.
2. **No privileged path.** The console uses exactly the same bearer tokens and scopes as agents. What a user can see or do is whatever their token allows; the UI hides or disables what the token cannot do, and Keel is the enforcer.
3. **Token stays in the browser.** The user pastes a Keel token once; it lives in `sessionStorage` only. Never in the repo, never in a build artifact, never in a URL, never logged.
4. **Read-mostly.** The only writes the console performs are the human decisions: `approve_purchase_order`, `reject_approval`, `accept_goods`, `reject_goods`. Each shows the projected effects from Keel first (simulate) and asks for confirmation before commit, with a fresh idempotency key per commit (`console:<request_id>:<tool>`).
5. **Keep vendor names out.** No AI-vendor SDKs, no cloud-provider SDKs. This is a static site that calls one API.

## How it talks to Keel

- Base URL from `VITE_KEEL_URL` at build time (default `https://headless-erp-production-0480.up.railway.app`), overridable by the user in Settings.
- `POST {base}/api/query/{tool}` for read tools, `POST {base}/api/simulate/{tool}` and `POST {base}/api/commit/{tool}` for writes. Body is the tool payload; commit bodies also carry `idempotency_key` and optional `simulation_id`. Header `Authorization: Bearer <token>`.
- Events: `GET {base}/events/stream?after_seq=N` (SSE) with the same header, falling back to polling `poll_events` every 5 s if SSE is unavailable.
- Success responses for **query** are `{ok, mode, request_id, tool, result}` — the tool's payload is `result`, which `keelClient.query` unwraps. **`simulate` and `commit` are flat: they have no `result` key at all.** A simulate is `{ok, mode, request_id, simulation_id, tool, validation:{errors, warnings}, policy, would_commit, commit_would_fail_with, projected_effects, state_versions, expires_at, compensating_tool}`; a commit is `{ok, mode, status, request_id, tool, document, effects, events_emitted, journal_entry, receipt, policy, warnings}`. Both hand back the whole envelope: the commit's idempotency key is built from the simulate's `request_id`, and `status` is `applied` or, when Keel recognises the key, `replayed` with the original receipt and no new events.
- Errors are `{ok:false, mode, request_id, error:{code, message, details?, retry_advice}}`. Show `error.code`, `error.message` and `retry_advice` verbatim, plus `request_id` so it can be pasted into `explain_error`. `details` varies by code — `required_scope` on FORBIDDEN, `{errors, expected_fields, required_fields}` on VALIDATION_ERROR, `{type, ref}` on a missing document. An unknown *tool* answers NOT_FOUND with no `request_id` at all.
- `list_capabilities` returns all 67 tools with their signature and required scope, and `describe_tool(name)` returns one tool's JSON Schema. Read those before guessing a payload.

## Pages

| Route | Keel tools | Notes |
|---|---|---|
| `/` Status | `GET /healthz`, `get_trial_balance`, `get_reconciliation`, `list_pending_approvals`, `get_period`, `get_current_period`, `search_documents(FiscalPeriod)` | env badge, version, key id, event seq, policy version; books balanced + totals; the four reconciliations; approvals waiting; close readiness for a chosen period. **Not `get_system_status`** — it needs `admin:status`, which a console token has no business holding |
| `/events` | SSE stream, `poll_events` | live feed, filter by type and document, click → trace |
| `/ledger` | `get_trial_balance`, `explain_balance`, `get_ledger_entries` | period selector (all periods by default); account row expands into `by_source_type` from `explain_balance` plus the entries themselves, paged by `limit` alone. `get_account_balance` is unused — `explain_balance.balance` is the same figures |
| `/open-items` | `list_open_items(kind, party?, overdue_only?)` | AP and AR tabs, party filter, overdue toggle — overdue is Keel's judgement against its own `as_of`, never a date comparison here. Row shape pinned 2026-09-11: `{id, kind, status, party_id, amount_cents, remaining_cents, due_date, days_to_due, overdue, source_doc_*}`; the source document links to its trace |
| `/inventory` | `get_inventory(sku?)`, `get_reconciliation(inventory)` | account 1300 vs sub-ledger first, then on-hand × standard cost per SKU with Keel's own `value_cents` and `total_value_cents`; SKU links to its trace |
| `/approvals` | `list_pending_approvals`, `approve_purchase_order`, `reject_approval`, `accept_goods`, `reject_goods` | the human inbox, and the only page that writes. Each request carries its own `projected_effects` — what the agent's blocked call would have done. Goods acceptance shows expected quantities from `details.counted` and editable accepted/damaged counts per line; `short_qty`/`over_qty` and the value come back from Keel, never computed here. Confirm is offered only when the simulation says `would_commit` |
| `/trace` | `trace_document`, `search_documents`, `get_document` | search box for a document number or ULID; render `nodes` as a vertical timeline with each node's signed receipts inline and its `event_seqs` linking back to the feed; browse by document type |
| `/receipts` | `verify_receipt`, `get_request_log`, `explain_error` | paste a receipt id or request id |
| `/recon` | `get_reconciliation` for gr_ir, ap, ar, inventory; `get_period` | close-readiness checklist as read-only, blockers and warnings verbatim; no close button (Controller agent's job) — a test asserts the page renders no such control |
| `/settings` | — | base URL, token entry (masked), clear session |

## Stack and conventions

- Vite + React + TypeScript, single-page, client-side routing. Plain CSS or a small utility layer; no heavy component library.
- One `keelClient.ts` module wraps every call; components never call `fetch` directly.
- Money arrives from Keel in minor units (`*_cents`); regroup the digits for display only, never do arithmetic.
- Every list is paged the way Keel pages — `limit` + `offset` (`search_documents`, `get_request_log`) or `after_seq` + `limit` (`poll_events`); there is no cursor in the catalog. No client-side "load everything."
- Tests: a mocked `keelClient` with recorded Keel responses; component tests for approvals (simulate → confirm → commit) and goods acceptance (per-line counts).
- Deploy as a static site (Railway static service or GitHub Pages). No server component in this repo.

## Build order

1. `keelClient.ts` + Settings page + Status page. Verify against live Keel with a read-only token. ✅
2. Events + Trace. These are the demo pages. ✅ shapes pinned against live responses
3. Ledger, Open Items, Inventory, Recon. ✅
4. Approvals (the only write pages), with simulate-then-commit and idempotency keys. ✅ shapes pinned against live simulates and one real commit
5. Receipts/explain_error, polish, deploy.

Stop and ask if any page seems to need logic that Keel does not expose; the answer is a new Keel query tool, not console code.

Both gaps that were open have since been closed by the kernel, and the workarounds are gone:

- **`get_current_period`** now names the current period against Keel's own `as_of`. `PeriodPicker` asks it instead of taking whatever `search_documents(FiscalPeriod, status: open, limit: 1)` happened to return first. Nothing reads the browser clock.
- **`list_document_types`** now returns `{type, identifier_field, number_prefix, date_field, order_by, party_field, filters}` per type. `loadDocumentTypes` reads it like any other query; the console no longer takes data from an error anywhere.

One gap is open:

- **The console cannot learn its own token's scopes.** Non-negotiable #2 asks the UI to disable what the token cannot do, but no query tool names the scopes a token holds — they appear only in a `FORBIDDEN` error's `details.granted`, and reading that would put the console back to taking data from an error. So `/approvals` offers every decision and lets the simulate be the gate: Keel's `would_commit` decides whether a commit is offered, and a refusal is shown verbatim. A `whoami` / `describe_token` query tool would let the buttons be disabled up front instead. Requested from the kernel.
