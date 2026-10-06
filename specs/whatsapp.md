# WhatsApp

Talk to the ONA assistant from WhatsApp. WhatsApp is another way to reach the same assistant as `/advisor`, with the same skills, user memory and monthly € budget, through Meta's WhatsApp Cloud API. v1 is limited to Miguel's household through `WHATSAPP_ALLOWED_EMAILS` and Meta's test number, which accepts at most 5 verified recipients.

## User Capabilities

- Users can connect their WhatsApp from `/profile` → chapter "08 · Ona en WhatsApp" → "Conectar WhatsApp". This mints a one-time code, shown as "Vincular ONA: 4F7K2A", and an "Abrir WhatsApp" `wa.me` link with that message prefilled. When the user sends it from their phone, the account is linked; the card polls every 3 s and flips to "WhatsApp conectado".
- Linked users see their masked number (`+34 ••• ••• 222`), an "Abrir chat con Ona" link, an "Avisos por WhatsApp" toggle and "Desconectar", which asks for confirmation first.
- Linked users can text the assistant anything they'd type in `/advisor`: what's on today's menu, swap a meal, the shopping list, mark items bought, nutrition questions, create recipes, etc. Replies are short WhatsApp-style messages. When something is visual, the reply ends with a deep link into the app: `Ver menú: …/menu`, `Ver lista de la compra: …/shopping`, `Ver receta: …/recipes/:id`, `Modo cocina: …/recipes/:id/cook`.
- Yes/no and short-choice questions arrive as native WhatsApp reply buttons (max 3). Tapping one is the same as typing its label.
- Conversation context carries across messages: the server rebuilds the last 20 messages from the last 12 h, so "y el jueves?" works after "¿qué ceno el miércoles?".
- An unlinked number that writes to ONA gets one "conecta tu WhatsApp desde la app" message per 24 h. A message that looks like a code but isn't valid gets "Ese código no es válido o ha caducado".
- Users can send **voice notes**: they are transcribed with OpenAI (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, language `es`) and handled exactly like typed text; the transcript is what lands in history. A failed or empty transcription gets "No he podido entender el audio…"; without `OPENAI_API_KEY` the reply is "Ahora mismo no puedo escuchar audios. ¿Me lo escribes?".
- Users can **share a recipe link** (YouTube or a recipe article), bare or with text ("guárdame esta"): the assistant calls `import_recipe_from_url`, saves it to their recipes and replies with `Ver receta: …/recipes/:id`, offering to put it on the menu. Links that aren't recipes, or pages the extractor can't read, get an honest "no he podido leerla" answer.
- Users can **send a photo of a recipe** (cookbook page, handwritten card, screenshot). It is extracted with the existing photo extractor and **saved directly** (soft lint, tags `auto-extracted`/`from-photo`; caption kept as context in history). Reply: "He guardado *<nombre>* en tus recetas" + link, plus a "revisa los ingredientes" nudge when some weren't matched to the catalogue. Photos with no recipe get "No he encontrado ninguna receta en esa foto…". History records `[Foto de una receta: <caption>]`, so "ponla el jueves para cenar" works next.
- One message can trigger several actions ("genérame el menú y dime qué ceno hoy") — the engine runs up to 4 tool rounds per turn (see [Advisor](./advisor.md)).
- Sending a sticker, location or other unsupported type gets a polite "todavía no entiendo ese tipo de mensaje".

## Linking

- The code has 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I) and always contains at least one digit, so an ordinary 6-letter word is never mistaken for a code. It expires after 10 minutes and works once. Generating a new code invalidates the user's previous unused one.
- Sending a valid code links `phone ↔ user` one-to-one:
  - If the phone was linked to another account, the link moves to the new owner.
  - If the user had another phone linked, the old phone is replaced.
  - Messages the phone sent before linking are assigned to the new owner.
- Phones are stored as Meta's `wa_id`: digits only, with the country code.

## Message handling

1. `POST /whatsapp/webhook` verifies `X-Hub-Signature-256`, an HMAC-SHA256 of the **raw** body keyed with `WHATSAPP_APP_SECRET`. That's why the router is mounted before `express.json()`. A bad or missing signature gets **401**.
2. Every message is inserted into `whatsapp_messages` with `ON CONFLICT (wamid) DO NOTHING`, so Meta's retries are deduplicated. The webhook answers **200** right away; the assistant runs after the response.
3. Messages are processed **in order per phone**, using an in-process promise chain (Railway runs one API instance).
4. Each message is marked read with a "typing…" indicator (best effort).
5. Gates, in order:
   - A message older than 2 h (a late Meta retry) is dropped silently.
   - An unlinked phone goes to the linking flow.
   - A suspended account is refused.
   - An account not in `WHATSAPP_ALLOWED_EMAILS` is refused.
   - Once the monthly budget is spent, the user gets the same copy as the web's 429. No model call is made.
6. Text and button replies go through `chat(userId, text, history, db, { mode: 'whatsapp' })`. The system prompt's WhatsApp mode allows `*negrita*` and dash lists, forbids "pulsa/abajo" screen language, sends cooking timers and steps to the app's cooking mode, and asks the model to end short-choice questions with `[[opciones: Sí | No]]`. The renderer turns that line into reply buttons; with more than 3 options, they are folded back into the text.
7. Replies are cut to WhatsApp's 4096-character limit, splitting on paragraph boundaries first.
8. Each reply is stored as an outbound row (`kind='reply'`). The inbound row becomes `processed`, with its final text.
9. If anything fails, the user gets "Vaya, algo ha fallado…" and the inbound row becomes `failed` with the error.

## Data model

- `whatsapp_links(user_id UNIQUE, phone UNIQUE, profile_name, notify, linked_at, last_inbound_at)`. `last_inbound_at` marks the start of Meta's 24 h customer-service window.
- `whatsapp_link_codes(code PK, user_id, expires_at, used_at)`.
- `whatsapp_messages(wamid UNIQUE NULL, phone, user_id, direction in|out, kind, body, status, error_message)`.
  - Inbound statuses: `received` / `processed` / `failed` / `ignored`.
  - Outbound statuses: `sent` / `failed`.
  - Outbound kinds `system` (budget, linked, errors) and `link` (how to connect) are left out of chat history.
- Migration `0030_whatsapp.sql`, which only creates new tables and is idempotent.

## API

- `GET /whatsapp/webhook` (public): Meta's verification handshake. It echoes `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`; otherwise **403**.
- `POST /whatsapp/webhook` (public, signed): **503** when the channel isn't configured.
- `GET /whatsapp/status` (auth): `{ available, linked, phone, notify, chatLink }`. `available` = configured AND email allowed. The profile chapter is hidden unless `available || linked`, so a user can always disconnect.
- `POST /whatsapp/link-code` (auth): `{ code, expiresAt, message, waLink }`. **403** `WHATSAPP_UNAVAILABLE` when not available.
- `PATCH /whatsapp/link` (auth) `{ notify: boolean }`: **404** when not linked.
- `DELETE /whatsapp/link` (auth): **204**.

## Configuration (`ona-api`)

- Required: `WHATSAPP_ACCESS_TOKEN` (permanent System User token with `whatsapp_business_messaging`), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- Recommended: `WHATSAPP_DISPLAY_NUMBER` (the sender's number as digits, for `wa.me` links), `WHATSAPP_ALLOWED_EMAILS` (comma-separated ONA emails; empty means everyone), `WEB_PUBLIC_URL` (base for deep links; defaults to the Railway web URL).
- Optional: `WHATSAPP_GRAPH_VERSION` (default `v26.0`) and `WHATSAPP_GRAPH_BASE_URL`, which local E2E points at a mock server.
- Meta dashboard webhook: `https://ona-api-production.up.railway.app/whatsapp/webhook`, subscribed to the `messages` field.

## Constraints

- No WhatsApp groups and no sign-up from WhatsApp; you need an ONA account first.
- Meta's test number can only message the up-to-5 recipients verified in the Meta dashboard. Opening the channel to all users needs a real number plus business verification.
- In-process queue: if the API restarts mid-turn, that message stays `received` and gets no answer.
- The model sees text only: photos are never shown to the chat model, they go straight to recipe import (a photo of the fridge is not understood yet). Cooking-mode hints (`set_timer`, `cooking_step`) have no effect on WhatsApp; the reply points to the app instead.

## Related specs

- [Advisor](./advisor.md): the assistant engine, skills and monthly budget that WhatsApp reuses.
- [Auth](./auth.md): accounts, suspension.

## Source

- [apps/api/src/routes/whatsapp.ts](../apps/api/src/routes/whatsapp.ts): webhook router (raw body) + authed endpoints.
- [apps/api/src/services/whatsapp/](../apps/api/src/services/whatsapp/)
  - `inbound.ts`: orchestrator + per-phone queue.
  - `wiring.ts`: real dependencies.
  - `store.ts`: DB.
  - `client.ts`: Graph API.
  - `webhookParser.ts`, `signature.ts`, `linking.ts`, `history.ts`, `format.ts`, `render.ts`, `config.ts`.
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts): `mode: 'whatsapp'`.
- [apps/api/src/services/assistant/engine.ts](../apps/api/src/services/assistant/engine.ts): `ChatOptions.mode`.
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts): `whatsappLinks`, `whatsappLinkCodes`, `whatsappMessages`; [migration 0030](../apps/api/src/db/migrations/0030_whatsapp.sql).
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts): `WHATSAPP_*`, `WEB_PUBLIC_URL`.
- [apps/web/src/components/profile/WhatsAppCard.tsx](../apps/web/src/components/profile/WhatsAppCard.tsx), [apps/web/src/hooks/useWhatsApp.ts](../apps/web/src/hooks/useWhatsApp.ts), [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) (chapter 08).
- Tests: `apps/api/src/tests/whatsappWebhook.test.ts`, `whatsappFormat.test.ts`, `whatsappInbound.test.ts`; `apps/web/e2e/whatsapp-link.spec.ts`.
