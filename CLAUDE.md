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
- Success responses are `{ok, mode, request_id, tool, result}` — the tool's payload is `result`, which `keelClient.query` unwraps. `simulate` and `commit` hand back the whole envelope, because the commit's idempotency key is built from the simulate's `request_id`.
- Errors are `{ok:false, mode, request_id, error:{code, message, details?, retry_advice}}`. Show `error.code`, `error.message` and `retry_advice` verbatim, plus `request_id` so it can be pasted into `explain_error`. `details` varies by code — `required_scope` on FORBIDDEN, `{errors, expected_fields, required_fields}` on VALIDATION_ERROR, `{type, ref}` on a missing document. An unknown *tool* answers NOT_FOUND with no `request_id` at all.
- `list_capabilities` returns all 65 tools with their signature and required scope, and `describe_tool(name)` returns one tool's JSON Schema. Read those before guessing a payload.

## Pages

| Route | Keel tools | Notes |
|---|---|---|
| `/` Status | `GET /healthz`, `get_trial_balance`, `get_reconciliation`, `list_pending_approvals`, `get_period`, `search_documents(FiscalPeriod)` | env badge, version, key id, event seq, policy version; books balanced + totals; the four reconciliations; approvals waiting; close readiness for a chosen period. **Not `get_system_status`** — it needs `admin:status`, which a console token has no business holding |
| `/events` | SSE stream, `poll_events` | live feed, filter by type and document, click → trace |
| `/ledger` | `get_trial_balance`, `explain_balance`, `get_ledger_entries` | period selector (all periods by default); account row expands into `by_source_type` from `explain_balance` plus the entries themselves, paged by `limit` alone. `get_account_balance` is unused — `explain_balance.balance` is the same figures |
| `/open-items` | `list_open_items(kind, party?, overdue_only?)` | AP and AR tabs, party filter, overdue toggle — overdue is Keel's judgement against its own `as_of`, never a date comparison here. Row shape is still unrecorded (the seed has no unpaid invoices), so rows render as the columns Keel sends |
| `/inventory` | `get_inventory(sku?)`, `get_reconciliation(inventory)` | account 1300 vs sub-ledger first, then on-hand × standard cost per SKU with Keel's own `value_cents` and `total_value_cents`; SKU links to its trace |
| `/approvals` | `list_pending_approvals`, `approve_purchase_order`, `reject_approval`, `accept_goods`, `reject_goods` | the human inbox; goods acceptance shows expected quantities from the request and editable accepted/damaged counts per line |
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
4. Approvals (the only write pages), with simulate-then-commit and idempotency keys.
5. Receipts/explain_error, polish, deploy.

Stop and ask if any page seems to need logic that Keel does not expose; the answer is a new Keel query tool, not console code.

Two such gaps are open, both requested from the kernel, both worked around in one marked place:

- **No "current period."** `PeriodPicker` lists FiscalPeriod documents and starts on whatever `search_documents(FiscalPeriod, status: open, limit: 1)` returns first. Nothing reads the browser clock.
- **No document-type list.** `loadDocumentTypes` reads them from `search_documents`' own `VALIDATION_ERROR.details.known` — the only place Keel names them. It is the sole place the console takes data from an error, and it carries a TODO for `list_document_types`.
