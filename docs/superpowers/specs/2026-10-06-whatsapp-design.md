# WhatsApp channel for ONA — design

**Date:** 2026-10-06 · **Status:** approved (Miguel: "a) para mí · vamos con todo")

## Goal

Let a linked ONA user do everything the in-app assistant can do — from WhatsApp:
text chat, voice notes, share a recipe link or photo to import it, and receive
proactive messages (prep alerts, Sunday "¿te preparo el menú?").

WhatsApp is **a new transport for the existing assistant**, not a new feature
set. `services/assistant/engine.ts → chat(userId, message, history, db)` is
already transport-agnostic and carries the 30 skills, user memory and the
monthly € budget. Everything below is adapter code around it.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Audience v1 | Miguel + household | Meta test number allows 5 verified recipients, no business verification |
| Provider | Meta WhatsApp Cloud API, direct | No middleman fee; Twilio still needs Meta approval; unofficial libs break ToS |
| Identity | phone ↔ user via one-time code sent from WhatsApp | Proves possession of both the app session and the phone |
| Gate | `WHATSAPP_ALLOWED_EMAILS` (empty = everyone) | Makes "v1 para mí" explicit without code changes later |
| History | server-side (`whatsapp_messages`) | Web keeps history in the client; WhatsApp has no client |
| Out of scope v1 | groups, sign-up via WhatsApp, voice replies (TTS), photo → anything but recipe import | YAGNI |

## Architecture

```
WhatsApp ─► Meta Cloud API ─► POST /whatsapp/webhook  (public, mounted BEFORE express.json)
                                 ├ verify X-Hub-Signature-256 (HMAC-SHA256, app secret, raw body)
                                 ├ parse → InboundMessage[]  (statuses ignored)
                                 ├ insert whatsapp_messages ON CONFLICT (wamid) DO NOTHING  → dedupe Meta retries
                                 ├ 200 immediately
                                 └ async: per-phone serial queue → processInbound()

processInbound(msg, deps)          (deps injected → unit-testable)
  ├ mark read + typing indicator (best effort)
  ├ resolve link by phone
  │   └ none → link code in text? → link : reply "vincula desde la app" (max 1×/24 h per number)
  ├ user suspended / not allowed → short reply, stop
  ├ budget exceeded → Spanish 429 copy, stop
  ├ text        → chat()
  ├ audio       → download media → OpenAI transcription → chat()
  ├ image       → download media → extractRecipeFromImage → saveExtractedRecipe (soft lint) → summary + link
  ├ interactive → button title as text → chat()
  └ chat result → renderReply() → send (text / interactive buttons) → store outbound row
```

### Units (all under `apps/api/src/services/whatsapp/`)

- `config.ts` — `isWhatsAppConfigured()`, `isUserAllowed(email)`.
- `signature.ts` — `verifySignature(rawBody, header, secret)` (timing-safe).
- `webhookParser.ts` — pure: Meta payload → `InboundMessage[]`.
- `client.ts` — Graph API: `sendText`, `sendButtons`, `sendTemplate`, `markRead`, `downloadMedia`. Base URL overridable (`WHATSAPP_GRAPH_BASE_URL`) for local mocks.
- `format.ts` — pure: markdown → WhatsApp (`**x**`→`*x*`, strip `#`), split at 4096, parse trailing `[[opciones: A | B | C]]` → reply buttons (≤3, title ≤20 chars).
- `render.ts` — pure: `AssistantResponse` → outbound messages; appends app links by `uiHint` (`menu`→/menu, `shopping_list`→/shopping, `recipe` with `recipeId`→/recipes/:id, `cooking_navigate`→/recipes/:id/cook).
- `history.ts` — pure: rows → `ChatMessage[]` (last 20 within 12 h, merge consecutive same-role, prepend a synthetic user turn when ONA spoke first).
- `linking.ts` — code gen (6 chars, no 0/O/1/I, 10-min TTL) + `extractLinkCode(text)` + store ops.
- `store.ts` — DB ops for links / messages.
- `inbound.ts` — `processInbound(msg, deps)` orchestrator + per-phone queue.
- `outbound.ts` — `sendProactive(userId, text, kind)`: free-form inside the 24 h window, template (`WHATSAPP_TEMPLATE_NAME`) outside, skip if neither.
- `services/stt.ts` — OpenAI `audio/transcriptions` (`gpt-4o-mini-transcribe`).
- `services/recipeImport.ts` — `saveExtractedRecipe(extracted, { authorId, internalTags })` extracted from the URL route so the route, the new `import_recipe_from_url` skill and the WhatsApp photo path share one persist.

### Engine changes (benefit web too)

- **Multi-tool loop**: up to 4 rounds; executes *every* `tool_use` block in a response (the current code answers only the first, which would 400 on parallel tool calls). Returns the last non-`text` skill's `uiHint`/`data`, falling back to the last skill.
- **Channel**: `chat(..., { mode })`; `buildSystemPrompt` gains `mode: 'whatsapp'` — WhatsApp formatting rules + the `[[opciones: …]]` convention.
- **New skill** `import_recipe_from_url` — "guárdame esta receta: <url>" works in web chat and WhatsApp.
- Client injection (`deps.client`) for tests.

### Data model — migration `0030_whatsapp.sql`

- `whatsapp_links(id, user_id UNIQUE → users cascade, phone UNIQUE, profile_name, notify bool default true, linked_at, last_inbound_at)`
- `whatsapp_link_codes(code PK, user_id → users cascade, expires_at, used_at, created_at)`
- `whatsapp_messages(id, wamid UNIQUE NULL, phone, user_id NULL → users cascade, direction 'in'|'out', kind, body, status, error_message, created_at)` + index `(phone, created_at)`.

Re-linking: a phone already linked to user A that sends user B's code moves to B; a user re-linking replaces their previous phone.

### HTTP surface

Public: `GET /whatsapp/webhook` (verify challenge), `POST /whatsapp/webhook`.
Authed (per-route `authMiddleware`): `GET /whatsapp/status`, `POST /whatsapp/link-code` → `{ code, expiresAt, waLink }`, `PATCH /whatsapp/link { notify }`, `DELETE /whatsapp/link`.
Webhook returns 503 when not configured; authed routes report `available: false`.

### Proactive messages

- `tickScheduler` delivers each due `notification_schedule` row over push **and** WhatsApp (if linked + `notify`). Row is `sent` when either channel succeeds — unchanged behaviour when WhatsApp isn't configured.
- Weekly nudge: Sundays ≥ 18:00 Europe/Madrid, linked + `notify` users with no menu for next Monday get "¿Te preparo el menú de la semana que viene?" with [Sí, prepáralo] [Ahora no]. Dedupe: one outbound `kind='weekly_nudge'` per user per 3 days. The reply lands in history so "Sí" → `generate_weekly_menu`.
- Outside the 24 h service window Meta requires an approved template. `WHATSAPP_TEMPLATE_NAME` (one utility template with a single `{{1}}` body variable) is optional; without it proactive messages only go out inside the window.

### Web

`/profile` → new chapter "08 · Ona en WhatsApp": hidden when unavailable; "Conectar WhatsApp" opens `wa.me/<number>?text=Vincular ONA: <code>`; linked state shows masked phone, "Avisos por WhatsApp" toggle, "Desconectar". Hook `useWhatsApp`.

## Error handling

Webhook never 5xx's on bad processing (Meta would retry forever): signature failure → 401, parse issues → 200 + log. Processing errors → Spanish fallback reply + `status='failed'` on the inbound row. Media/STT/extract failures → specific Spanish copy. Every Graph call is best-effort for read/typing; send failures are logged on the outbound row.

## Env vars (`ona-api`)

`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_DISPLAY_NUMBER`, `WHATSAPP_ALLOWED_EMAILS`, optional `WHATSAPP_TEMPLATE_NAME` / `WHATSAPP_TEMPLATE_LANG` (es), `WHATSAPP_GRAPH_VERSION` (v26.0), `WHATSAPP_GRAPH_BASE_URL`, `WEB_PUBLIC_URL`, `OPENAI_TRANSCRIBE_MODEL`.

## Testing

Unit (vitest): signature, parser, format/options, render, history, linking codes, engine loop (fake client), inbound orchestrator (fake deps: unlinked, link, text, budget, audio, image, button), delivery-status combiner, weekly-nudge clock. Local E2E: API + mock Graph server + signed webhook curls against local Postgres. Playwright: profile card with mocked API.

## Phases (one commit each)

1. Plumbing + linking + text chat + profile card.
2. Engine multi-tool loop + WhatsApp formatting/buttons + voice notes.
3. Recipe import (URL skill + photo) + shared `saveExtractedRecipe`.
4. Proactive delivery (scheduler channel + weekly nudge + template fallback).
