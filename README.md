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

## Built so far — step 1

| Piece | Notes |
|---|---|
| `src/lib/keelClient.ts` | The only module that calls `fetch`. `query` / `simulate` / `commit`, plus `GET /healthz`. Normalizes every failure into `KeelApiError` carrying `code`, `message`, `request_id`. |
| `src/lib/session.ts` | Token + base-URL override in `sessionStorage`, with a `clearSession`. |
| `/settings` | Base URL, masked token entry, clear session. |
| `/` Status | `GET /healthz` and `get_system_status`: env badge, migration head, key id, event seq, policy version, token subject and scopes. |

Steps 2–5 (events, trace, ledger, open items, inventory, recon, approvals, receipts) are not built yet.

## Deploy notes

Routing is history-based, so the static host needs an SPA fallback (rewrite unknown paths to
`/index.html`). Wire this up in step 5 along with the deploy target.
