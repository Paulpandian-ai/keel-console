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

## Built so far — steps 1–2

| Piece | Notes |
|---|---|
| `src/lib/keelClient.ts` | The only module that calls `fetch`. `query` / `simulate` / `commit`, plus `GET /healthz`. Normalizes every failure into `KeelApiError` carrying `code`, `message`, `request_id`. |
| `src/lib/session.ts` | Token + base-URL override in `sessionStorage`, with a `clearSession`. |
| `/settings` | Base URL, masked token entry, clear session. |
| `/` Status | `GET /healthz`, plus the reads a console token actually holds: `get_trial_balance` (balanced, totals), `get_reconciliation` × gr_ir/ap/ar/inventory, `list_pending_approvals` (count), `get_period` (close readiness) for a period picked from `search_documents(FiscalPeriod)`. |
| `src/lib/sse.ts` | SSE decoder. `EventSource` cannot send an `Authorization` header, so the stream is read with `fetch`. |
| `src/lib/keelFields.ts` | The one place that reads Keel payload keys. Every key is now pinned against a live response — see below. |
| `/events` | Live feed over `/events/stream`, falling back to polling `poll_events` every 5s. Filter by type and document; click through to trace. |
| `src/pages/pages.test.tsx` | Status, Events and Trace rendered against the recorded payloads with a mocked `keelClient` (jsdom + Testing Library, the harness step 4's approval tests will reuse). |
| `/trace` | `trace_document` rendered as a vertical timeline: each node with its status, total, signed receipts (`tool`, `actor`, `signed_at`) and `event_seqs`. Browse by document type via `search_documents`. |

Steps 3–5 (ledger, open items, inventory, recon, approvals, receipts) are not built yet.

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
  summed, netted or compared.

`get_system_status` is deliberately **not** used. It requires `admin:status`, and a console token
carries no admin scope, so Keel answers `FORBIDDEN / token lacks scope 'admin:status'`. The
console has no privileged path: it reads what its token allows and shows Keel's refusal verbatim
when it does not.

Two facts Keel does not expose, worked around and worth a tool:

- **No "current period."** The Status period selector lists periods from
  `search_documents(FiscalPeriod)` and starts on whatever `status: open, limit: 1` returns first.
  Because the seed creates all 36 periods in the same instant, Keel's "newest first" ordering
  makes that `2025-01`, not the live period.
- **No document-type list.** `search_documents` requires a `type` but nothing returns the legal
  values, so `loadDocumentTypes` reads them from that tool's own `VALIDATION_ERROR.details.known`
  — once, lazily, cached. It is the only place the console takes data from an error.

Useful for the next step: `list_capabilities` returns all 65 tools with signature and scope, and
`describe_tool(name)` returns one tool's JSON Schema.

## Deploy notes

Routing is history-based, so the static host needs an SPA fallback (rewrite unknown paths to
`/index.html`). Wire this up in step 5 along with the deploy target.
