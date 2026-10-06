# WhatsApp

Talk to the ONA assistant from WhatsApp. WhatsApp is another way to reach the same assistant as `/advisor`, with the same skills, user memory and monthly € budget, through Meta's WhatsApp Cloud API. v1 is limited to Miguel's household through `WHATSAPP_ALLOWED_EMAILS` and Meta's test number, which accepts at most 5 verified recipients.

## User Capabilities

- **WhatsApp-first:** anyone can just write to ONA's number. An unlinked number gets "Hola, soy ONA… conecta tu cuenta: <web>/whatsapp/conectar · Entra (o crea tu cuenta) y te daré un código para enviarme desde este chat", at most once an hour per number. The page asks to log in or register (with `?next=` back). Then it mints a one-time code and shows "Último paso: envía este mensaje a Ona desde tu WhatsApp" with an "Enviar desde WhatsApp" `wa.me` button (message prefilled), polling until linked → "¡Listo!" + "Volver a WhatsApp". The link carries **no token**: the phone that gets linked is always the one that sends the code, so forwarding the link to someone else can't attach a phone to the wrong account. A first version used a phone-bound token and a "¿Conectar este número?" confirm page; the 2026-10-06 review showed a forwarded link plus a spoofed profile name could hijack an account, so it was replaced before shipping.
- Users can also connect from `/profile` → chapter "08 · Ona en WhatsApp" → "Conectar WhatsApp". This mints a one-time code, shown as "Vincular ONA: 4F7K2A", and an "Abrir WhatsApp" `wa.me` link with that message prefilled. When the user sends it from their phone, the account is linked; the card polls every 3 s and flips to "WhatsApp conectado".
- Linked users see their masked number (`+34 ••• ••• 222`), an "Abrir chat con Ona" link, an "Avisos por WhatsApp" toggle (see Proactive messages) and "Desconectar", which asks for confirmation first.
- Linked users can text the assistant anything they'd type in `/advisor`: what's on today's menu, swap a meal, the shopping list, mark items bought, nutrition questions, create recipes, etc. Replies are short WhatsApp-style messages. When something is visual, the reply ends with a deep link into the app: `Ver menú: …/menu`, `Ver lista de la compra: …/shopping`, `Ver receta: …/recipes/:id`, `Modo cocina: …/recipes/:id/cook`.
- Yes/no and short-choice questions arrive as native WhatsApp reply buttons (max 3). Tapping one is the same as typing its label.
- Conversation context carries across messages: the server rebuilds the last 20 messages from the last 12 h, so "y el jueves?" works after "¿qué ceno el miércoles?". History is filtered by phone **and** user, so a phone that moves to another account never carries the previous owner's chat into the new one.
- A message from an unlinked number that looks like a profile code but isn't valid gets "Ese código no es válido o ha caducado".
- Users can send **voice notes**: they are transcribed with OpenAI (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-mini-transcribe`, language `es`) and handled exactly like typed text; the transcript is what lands in history. A failed or empty transcription gets "No he podido entender el audio…"; without `OPENAI_API_KEY` the reply is "Ahora mismo no puedo escuchar audios. ¿Me lo escribes?".
- Users can **share a recipe link** (YouTube or a recipe article), bare or with text ("guárdame esta"): the assistant calls `import_recipe_from_url`, saves it to their recipes and replies with `Ver receta: …/recipes/:id`, offering to put it on the menu. Links that aren't recipes, or pages the extractor can't read, get an honest "no he podido leerla" answer.
- Users can **send a photo of a recipe** (cookbook page, handwritten card, screenshot). It is extracted with the existing photo extractor and **saved directly** (soft lint, tags `auto-extracted`/`from-photo`; caption kept as context in history). Reply: "He guardado *<nombre>* en tus recetas" + link, plus a "revisa los ingredientes" nudge when some weren't matched to the catalogue. Photos with no recipe get "No he encontrado ninguna receta en esa foto…". History records `[Foto de una receta: <caption>]`, so "ponla el jueves para cenar" works next.
- One message can trigger several actions ("genérame el menú y dime qué ceno hoy") — the engine runs up to 4 tool rounds per turn (see [Advisor](./advisor.md)).
- Sending a sticker, location or other unsupported type gets a polite "todavía no entiendo ese tipo de mensaje".

## Proactive messages ("Avisos por WhatsApp")

When the toggle is on (default after linking), ONA writes first:

- **Daily brief** at the user's breakfast time (`user_memories.meal_times.breakfast`, default 09:00 Europe/Madrid), for a 90-minute window. It lists today's lunch and dinner from **this week's** menu ("Buenos días. Hoy toca: - Comida: … - Cena: … ¿Quieres cambiar algo?" plus a menu link). If the day is empty, nothing is sent. At most one brief per 20 h.
- **Sunday nudge**, Sunday 18:00–21:59 Madrid, only when next week has no menu: "Domingo de planificar: ¿te preparo el menú de la semana que viene?" with buttons [Sí, prepáralo] [Ahora no]. At most one every 3 days. The nudge is stored in history, so tapping "Sí, prepáralo" makes the assistant call `generate_weekly_menu` with `nextWeek: true`.
- **Prep alerts** from `notification_schedule` ("Acuérdate: Merluza — sácalo del congelador 24 h antes" plus a link) go out over Web Push **and** WhatsApp. A row becomes `sent` when either channel delivers (`combineDelivery`). With no push subscription and no linked WhatsApp, the old `push-not-configured` failure is kept.

Delivery follows Meta's 24 h customer-service window, measured from `last_inbound_at` with a 30-min safety margin:
- **Inside the window:** free-form messages with buttons.
- **Outside the window:** the approved template `WHATSAPP_TEMPLATE_NAME` (language `WHATSAPP_TEMPLATE_LANG`, default `es`), whose single `{{1}}` body variable carries the message flattened to one line. Buttons are folded in as "Responde: Sí / No.", because Meta rejects newlines in template parameters.
- **Outside the window with no template:** skipped silently and retried on the next tick while the time window is still open.

Everything runs inside the existing 5-minute `notificationScheduler` tick (`runProactiveTick`). It's a no-op when WhatsApp isn't configured.

## Linking

- The code has 6 characters from `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (no 0/O/1/I) and always contains at least one digit, so an ordinary 6-letter word is never mistaken for a code. It expires after 10 minutes and works once. Generating a new code invalidates the user's previous unused one.
- Sending a valid code links `phone ↔ user` one-to-one:
  - If the phone was linked to another account, the link moves to the new owner.
  - If the user had another phone linked, the old phone is replaced.
  - Messages the phone sent before linking are assigned to the new owner.
- Phones are stored as Meta's `wa_id`: digits only, with the country code.

## Message handling

1. `POST /whatsapp/webhook` verifies `X-Hub-Signature-256`, an HMAC-SHA256 of the **raw** body keyed with `WHATSAPP_APP_SECRET`. That's why the router is mounted before `express.json()`. A bad or missing signature gets **401**.
2. Every message is inserted into `whatsapp_messages` with `ON CONFLICT (wamid) DO NOTHING`, so Meta's retries are deduplicated. Each new message is queued **right after its insert**. If one insert fails, the response is **500**: Meta retries the batch, the already-stored messages dedupe, and they are already queued. Otherwise **200**. The assistant runs after the response.
3. Messages are processed **in order per phone**, using an in-process promise chain (Railway runs one API instance).
4. Each message is marked read with a "typing…" indicator (best effort).
5. Gates, in order:
   - A message older than 2 h (a late Meta retry) is dropped silently.
   - An unlinked phone goes to the linking flow.
   - A suspended account is refused.
   - An account not in `WHATSAPP_ALLOWED_EMAILS` is refused.
   - Once the monthly budget is spent, the user gets the same copy as the web's 429. This check runs **before any paid work**: no transcription, no photo extraction, no model call.
6. Text and button replies go through `chat(userId, text, history, db, { mode: 'whatsapp' })`. The system prompt's WhatsApp mode allows `*negrita*` and dash lists, forbids "pulsa/abajo" screen language, sends cooking timers and steps to the app's cooking mode, and asks the model to end short-choice questions with `[[opciones: Sí | No]]`. The renderer turns that line into reply buttons; with more than 3 options, they are folded back into the text.
7. Replies are cut to WhatsApp's 4096-character limit, splitting on paragraph boundaries first.
8. Each reply is stored as an outbound row (`kind='reply'`). The inbound row becomes `processed`, with its final text.
9. If anything fails, the user gets "Vaya, algo ha fallado…" and the inbound row becomes `failed` with the error.

## Data model

- `whatsapp_links(user_id UNIQUE, phone UNIQUE, profile_name, notify, linked_at, last_inbound_at)`. `last_inbound_at` marks the start of Meta's 24 h customer-service window.
- `whatsapp_link_codes(code PK, user_id, expires_at, used_at)`: used by both the profile card and `/whatsapp/conectar`.
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
- Optional: `WHATSAPP_TEMPLATE_NAME` + `WHATSAPP_TEMPLATE_LANG` (proactive messages outside the 24 h window; template body must have one `{{1}}` and not start or end with it, e.g. "Aviso de ONA: {{1}} Respóndeme por aquí si quieres cambiar algo."), `WHATSAPP_GRAPH_VERSION` (default `v26.0`) and `WHATSAPP_GRAPH_BASE_URL`, which local E2E points at a mock server.
- Meta dashboard webhook: `https://ona-api-production.up.railway.app/whatsapp/webhook`, subscribed to the `messages` field.
- **Two Meta gotchas, both hit while setting it up on 2026-10-06.** Either one means silence: no inbound rows at all and nothing in the logs.
  1. **Webhook saved without fields.** Saving the URL in the dashboard doesn't subscribe any field. Check with `GET /{app-id}/subscriptions` (app token `app_id|app_secret`): `fields` must include `messages`. Fix: `POST /{app-id}/subscriptions` with `object=whatsapp_business_account&fields=messages&callback_url=…&verify_token=…`.
  2. **App not subscribed to the WABA.** The test WhatsApp Business Account comes subscribed only to Meta's internal "WA DevX Webhook Events" app. Check with `GET /{waba-id}/subscribed_apps`; fix with `POST /{waba-id}/subscribed_apps`, using a token that can see the WABA. The System User needs the WhatsApp account assigned as an asset, not just the app.
  Moving to a real number needs both again for the new WABA.

## Constraints

- No WhatsApp groups. Signing up happens on the web (the connect link offers "Crear cuenta"), not inside the chat.
- Meta's test number can only message the up-to-5 recipients verified in the Meta dashboard. Opening the channel to all users needs a real number plus business verification.
- In-process queue: if the API restarts mid-turn, that message stays `received` and gets no answer (no sweeper; messages older than 2 h are dropped as stale anyway).
- Photo extraction cost is gated by the monthly budget but not added to it; only chat turns are metered.
- "Today" and "this week" use the Europe/Madrid clock (`services/madridTime.ts`), for the assistant's `get_todays_menu` / `generate_weekly_menu` and for the daily brief.
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
- [apps/web/src/app/whatsapp/conectar/page.tsx](../apps/web/src/app/whatsapp/conectar/page.tsx) (WhatsApp-first: login/register → send the code from WhatsApp), [apps/web/src/lib/safeNext.ts](../apps/web/src/lib/safeNext.ts) (`?next=` for login/register),
- [apps/web/src/components/profile/WhatsAppCard.tsx](../apps/web/src/components/profile/WhatsAppCard.tsx), [apps/web/src/hooks/useWhatsApp.ts](../apps/web/src/hooks/useWhatsApp.ts), [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) (chapter 08).
- Tests: `apps/api/src/tests/whatsappWebhook.test.ts`, `whatsappFormat.test.ts`, `whatsappInbound.test.ts`, `whatsappProactive.test.ts`; `apps/web/e2e/whatsapp-link.spec.ts`, `apps/web/e2e/whatsapp-connect.spec.ts`.
