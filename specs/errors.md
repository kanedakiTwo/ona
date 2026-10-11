# Error tracking (in-house)

Every error a user hits in the web app, and every 5xx the API answers, is recorded in Mimoia's own Postgres — no Sentry, no third party (decision Miguel 2026-10-07). The Mimoia HQ agents (Customer Success, Producto) read it through a read-only admin endpoint and summarise it in the daily brief.

## Why this exists

Before this, a broken screen or a failing endpoint was only visible if a user complained or someone tailed Railway logs. A hosted tracker costs money and ships user data to another processor; Mimoia's scale (one instance, a private beta) fits a small grouped table.

## User Capabilities

- A user whose screen fails to render sees **"Algo se ha torcido"** (route error boundary, inside the normal app chrome) with **Reintentar** (re-render) and **Ir al inicio**, instead of a blank page. If the root layout itself fails, a full-page fallback with **Recargar** replaces it. Both say an automatic notice reaches the team; the user does nothing.
- Uncaught errors and unhandled promise rejections anywhere in the web app are reported silently.
- An admin (JWT) or an agent holding the read-only metrics token reads error groups at `GET /admin/errors`; the weekly `GET /admin/metrics` carries a small `errors` summary ([metrics.md](./metrics.md)).
- An admin (JWT only) marks a group resolved with `POST /admin/errors/:id/resolve` (audited as `app_error.resolve`). A new occurrence reopens it.

## What is recorded

**Client** (`kind = client`), from `apps/web/src/lib/errorReporter.ts`: `window` `error` and `unhandledrejection` listeners (installed once from the root layout) and the App Router boundaries `app/error.tsx` / `app/global-error.tsx`. Ignored as noise: `ResizeObserver loop…`, opaque `Script error.`, errors from browser extensions, `AbortError`.

**Server** (`kind = server`), from `middleware/errorCapture.ts`:
- any response with status ≥ 500. Most handlers catch their error, `console.error` it and answer 500, so each request runs in an AsyncLocalStorage context and the patched `console.error` keeps the last Error (or text) logged while serving it: that becomes the message and stack. With nothing logged: `HTTP <status>: <response "error" text>`;
- errors handed to `next(err)` or thrown synchronously (error middleware mounted just before `errorHandler`; the response is not changed). Errors carrying a 4xx status (malformed JSON, missing static file) are the client's fault and are skipped;
- unhandled promise rejections (`process.on('unhandledRejection')`, installed only if nothing else listens).
- Server rows carry the **route pattern** (`GET /recipes/:id`), never the raw URL; with no matched route, ids/numbers/tokens in the path become `:id` / `:n` / `:token`.

**Grouping**: one `app_errors` row per fingerprint = sha256(kind, normalised message, top stack frame). The message is scrubbed (below) and ids, hex ids and numbers become `<uuid>` / `<hex>` / `<n>`; the frame loses origin, `:line:col` and build hashes, so a group survives deploys. Server errors without a stack use the route as the "frame", so they group per route. Each occurrence: `count + 1`, `last_seen = now`, samples (stack, path, release, browser family, last user) refreshed, `resolved_at` cleared.

Row: `fingerprint` (unique), `kind`, `message` (normalised, ≤ 500 chars), `sample_stack` (≤ 4 KB), `sample_path` (page path or route, no query string), `release`, `user_agent_family`, `last_user_id` (FK users, `ON DELETE SET NULL`), `count`, `first_seen`, `last_seen`, `resolved_at`.

## Privacy

- **Scrubbed before storage** (message, stack and path; `services/appErrors.ts` `scrub`): emails → `<email>`; phone numbers (9–15 digits, `+34 600 111 222`, WhatsApp ids) → `<phone>`; IPv4 → `<ip>`; JWTs → `<jwt>`; `Bearer …` → `Bearer <redacted>`; query strings and fragments with values (`?token=…`, `#access_token=…`) removed; Drizzle `params: …` (bound SQL values) → `params: <redacted>`; long hex runs (invite/reset tokens) and mixed-case key-like strings → `<token>`. Dashed UUIDs are kept in samples (recipe ids help debugging) but normalised away in the message.
- The browser drops the query string and hash from the path **before sending**; the API strips them again.
- **Never stored**: request bodies, IP addresses (the per-IP limiter keys on the IP in memory only), the full user agent (only "Chrome · Android"-style family).
- Attribution: a logged-in report sets `last_user_id`; deleting the account nulls it ([privacy.md](./privacy.md)). The data never leaves Mimoia's database on Railway; `/privacidad` lists it under "Datos técnicos".

## Limits

| Where | Limit | Over it |
|---|---|---|
| Browser | same error from the same place once per page load; ≤ 10 reports per page load | not sent |
| `POST /client-errors` body | 8 KB (any content type; read before the global JSON parser) | 413 `ERROR_REPORT_TOO_LARGE` |
| Payload | `clientErrorReportSchema` (`@ona/shared`): `kind: 'client'`, `message` 1–4000, `stack` ≤ 8000, `path` ≤ 2048, `release` ≤ 100 | 400 `INVALID_ERROR_REPORT` |
| Per IP | 30 reports / min (in-memory, per process) | 204, not recorded |
| Per fingerprint | 5 direct writes / min | counted in memory, flushed as one `count + n` UPDATE every minute |
| Per kind (global) | 60 upserts / min | known groups coalesced; new groups dropped |
| Pending flush map | 500 groups | dropped |

The browser reporter is **off in development** unless `NEXT_PUBLIC_ERROR_REPORTING=true` (or the Playwright hook `window.__ONA_ERROR_REPORTING__`); `NEXT_PUBLIC_ERROR_REPORTING=false` switches it off in production.

## Endpoints

- `POST /client-errors` — public. Body: JSON (sent as `text/plain` so a beacon needs no CORS preflight). Anonymous visitors send with `navigator.sendBeacon`; logged-in users with a `keepalive` fetch carrying `Authorization` (a beacon can't send headers), falling back to the beacon. A valid token attributes the report (`optionalAuthMiddleware`); an invalid token or a failed lookup records it anonymously. Always 204 for a valid report; recording is fire-and-forget.
- `GET /admin/errors?days=7&includeResolved=0[&kind=client|server][&limit=100]` — admin JWT **or** `x-metrics-token: $METRICS_READ_TOKEN` (`metricsAuth`; no header → admin JWT path). `days` 1–90, `limit` 1–500. Returns `{ generatedAt, days, includeResolved, kind, totals { groups, newGroups, clientGroups, serverGroups, events }, groups[] { id, kind, message, path, release, userAgentFamily, lastUserId, count, firstSeen, lastSeen, resolvedAt, sampleStack }, definitions }`, groups ordered by `lastSeen` desc. Window = groups whose `lastSeen` is in the last `days` days; `newGroups` = first seen in it; `events` = Σ `count` of those groups (cumulative — an upper bound for the window).
- `POST /admin/errors/:id/resolve` — admin JWT only (the metrics token can't mutate). 400 bad id, 404 unknown, 200 `{ id, resolvedAt }`; audit row in the same transaction.

## How the agents read it

`curl -H "x-metrics-token: $METRICS_READ_TOKEN" "$API/admin/errors?days=1"` each morning: new groups (`firstSeen` in the window) first, then the biggest `count`s; `kind`, `path` and `release` say where and since which deploy; `lastUserId` lets Customer Success reach out. `definitions` in the payload restates these rules.

## Constraints

- Recording never blocks or fails a request: synchronous call, background write, every error swallowed and logged as a warning.
- Mount order (`apps/api/src/index.ts`): `observeServerErrors` right after CORS; the client-errors router before `express.json()`; the admin errors router next to the metrics router, before the catch-all `router.use(authMiddleware)` routers; `captureServerErrors` just before `errorHandler`.
- Unit tests never write to the database (the sink is a no-op under vitest; tests inject a fake one).
- Migration `0036_app_errors.sql` is idempotent (`IF NOT EXISTS`).

## Known limitations

- `count` is cumulative; there is no per-day event history, so "events in the window" is an upper bound.
- Limiters and coalesced counts are in memory, per process: a restart loses at most a minute of coalesced counts.
- `release`: API = `RAILWAY_GIT_COMMIT_SHA`, else `RAILWAY_DEPLOYMENT_ID`; web = `NEXT_PUBLIC_RELEASE`, else the same Railway vars if present at build time. `railway up` deploys have no commit SHA.
- With the `unhandledRejection` listener installed, the API logs and keeps serving instead of crashing; the request that caused it times out.
- `errorHandler` answers 500 even to errors carrying a 4xx status (malformed JSON body, missing image under `/images/recipes`); those are not recorded as server errors. Pre-existing behaviour, unchanged.
- Not captured: React recoverable/hydration errors (console only), service-worker errors, errors inside the cross-origin wake-word/voice SDKs that surface as `Script error.`.
- No admin UI yet: read through the API.

## Related specs

- [Business metrics](./metrics.md) — `errors` block, `metricsAuth`, `METRICS_READ_TOKEN`
- [Privacy](./privacy.md) — what `/privacidad` promises; account deletion nulls `last_user_id`
- [Admin audit log](./admin-audit-log.md) — `app_error.resolve`
- [Design system](./design-system.md) — the boundaries use the editorial tokens

## Source

- [apps/api/src/services/appErrors.ts](../apps/api/src/services/appErrors.ts) — `scrub`, `normalizeMessage`, `topStackFrame`, `fingerprint`, `userAgentFamily`, `ErrorWriteThrottle`, `recordAppError`, `loadAppErrors`, `loadErrorSummary`, `resolveAppError`
- [apps/api/src/routes/appErrors.ts](../apps/api/src/routes/appErrors.ts) — `POST /client-errors`, `GET /admin/errors`, `POST /admin/errors/:id/resolve`
- [apps/api/src/middleware/errorCapture.ts](../apps/api/src/middleware/errorCapture.ts) — 5xx observer, error middleware, console capture, `unhandledRejection`
- [apps/api/src/index.ts](../apps/api/src/index.ts) — mount order
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`appErrors`), [apps/api/src/db/migrations/0036_app_errors.sql](../apps/api/src/db/migrations/0036_app_errors.sql)
- [packages/shared/src/types/clientErrors.ts](../packages/shared/src/types/clientErrors.ts) — `clientErrorReportSchema`, `buildClientErrorReport`, dedupe key, noise filter
- [apps/web/src/lib/errorReporter.ts](../apps/web/src/lib/errorReporter.ts), [apps/web/src/app/error.tsx](../apps/web/src/app/error.tsx), [apps/web/src/app/global-error.tsx](../apps/web/src/app/global-error.tsx), [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) (install), [apps/web/next.config.ts](../apps/web/next.config.ts) (`NEXT_PUBLIC_RELEASE`)
- Tests: `apps/api/src/tests/appErrors.test.ts`, `appErrorsRoute.test.ts`, `errorCapture.test.ts`, `clientErrorReport.test.ts` (contract), `apps/web/e2e/error-reporting.spec.ts`
