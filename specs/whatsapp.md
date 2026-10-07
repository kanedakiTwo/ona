# WhatsApp

Talk to the ONA assistant from WhatsApp. WhatsApp is another way to reach the same assistant as `/advisor`, with the same skills, user memory and monthly € budget, through Meta's WhatsApp Cloud API. v1 is limited to Miguel's household through `WHATSAPP_ALLOWED_EMAILS` and Meta's test number, which accepts at most 5 verified recipients.

## User Capabilities

- **WhatsApp-first:** anyone can just write to ONA's number. An unlinked number gets "Hola, soy ONA… conecta tu cuenta: <web>/whatsapp/conectar · Entra (o crea tu cuenta) y te daré un código para enviarme desde este chat", at most once an hour per number. The page asks to log in or register (with `?next=` back). Then it mints a one-time code and shows "Último paso: envía este mensaje a Ona desde tu WhatsApp" with an "Enviar desde WhatsApp" `wa.me` button (message prefilled), polling until linked → "¡Listo!" + "Volver a WhatsApp". The link carries **no token**: the phone that gets linked is always the one that sends the code, so forwarding the link to someone else can't attach a phone to the wrong account. A first version used a phone-bound token and a "¿Conectar este número?" confirm page; the 2026-10-06 review showed a forwarded link plus a spoofed profile name could hijack an account, so it was replaced before shipping.
- Users can also connect from `/profile` → chapter "08 · Ona en WhatsApp" → "Conectar WhatsApp". This mints a one-time code, shown as "Vincular ONA: 4F7K2A", and an "Abrir WhatsApp" `wa.me` link with that message prefilled. When the user sends it from their phone, the account is linked; the card polls every 3 s and flips to "WhatsApp conectado".
- Linked users see their masked number (`+34 ••• ••• 222`), an "Abrir chat con Ona" link, an "Avisos por WhatsApp" toggle (see Proactive messages) and "Desconectar", which asks for confirmation first.
- Linked users can text the assistant anything they'd type in `/advisor`: what's on today's menu, swap a meal, the shopping list, mark items bought, nutrition questions, create recipes, etc. Replies are short WhatsApp-style messages. When something is visual, the reply ends with a deep link into the app: `Ver menú: …/menu`, `Ver lista de la compra: …/shopping`, `Ver receta: …/recipes/:id`, `Modo cocina: …/recipes/:id/cook`.
- **Decisive by design.** Several requests in one message ("el jueves pon filete, el sábado cenamos fuera, apunta leche") all get done in that turn. The reply is short: "Hecho:" plus one line per change, with no unrequested advice and no closing question unless one is really needed. Reversible changes need no confirmation; only destructive or bulk ones (delete a recipe, replace an existing week) are confirmed. A missing recipe gets the closest catalogue match, and the reply says which. Explicit requests beat stored dislikes. Anything the app can do is a skill; see [Advisor](./advisor.md) → UI-parity skills.
- Yes/no and short-choice questions arrive as native WhatsApp reply buttons (max 3). Tapping one is the same as typing its label.
- **"Me pongo con ello" acks:** a turn never sits silent for long.
  - When the assistant starts a slow skill, the user gets a specific note right away: "Vale, preparo el menú. Dame unos segundos…" for `generate_weekly_menu`, and similar ones for `import_recipe_from_url`, `recipe_variation` and `create_recipe`.
  - A recipe photo gets "Recibida la foto. Voy a leer la receta…" immediately.
  - Anything else still silent after 8 s gets "Un momento, me pongo con ello…".
  - At most one ack per turn, always before the answer and never after it (`createAcker` + `ChatOptions.onToolStart`). Acks are stored as outbound `kind='ack'` and kept out of chat history.
  - Added after the first real use (2026-10-06), when "genera menú para la semana" took 25 s with no feedback.
- Conversation context carries across messages: the server rebuilds the last 20 messages from the last 12 h, so "y el jueves?" works after "¿qué ceno el miércoles?". History is filtered by phone **and** user, so a phone that moves to another account never carries the previous owner's chat into the new one. Assistant replies count even if their delivery failed: the actions behind them ran, and a request left "unanswered" would be redone by the decisive model.
- A message from an unlinked number that looks like a profile code but isn't valid gets "Ese código no es válido o ha caducado".
- Users can send **voice notes**: they are transcribed with OpenAI (`OPENAI_TRANSCRIBE_MODEL`, default `gpt-4o-transcribe` (the mini model mis-heard short Spanish notes as Galician), language `es`, plus a Spanish cooking-vocabulary `prompt`) and handled exactly like typed text; the transcript is what lands in history. A failed or empty transcription gets "No he podido entender el audio…"; without `OPENAI_API_KEY` the reply is "Ahora mismo no puedo escuchar audios. ¿Me lo escribes?".
- Users can **share a recipe link** (YouTube or a recipe article), bare or with text ("guárdame esta"): the assistant calls `import_recipe_from_url`, saves it to their recipes and replies with `Ver receta: …/recipes/:id`, offering to put it on the menu. Links that aren't recipes, or pages the extractor can't read, get an honest "no he podido leerla" answer.
- Users can **send a photo of a recipe** (cookbook page, handwritten card, screenshot). It is extracted with the existing photo extractor and **saved directly** (soft lint, tags `auto-extracted`/`from-photo`; caption kept as context in history). Reply: "He guardado *<nombre>* en tus recetas" + link, plus a "revisa los ingredientes" nudge when some weren't matched to the catalogue. Photos with no recipe get "No he encontrado ninguna receta en esa foto…". History records `[Foto de una receta: <caption>]`, so "ponla el jueves para cenar" works next.
- One message can trigger several actions ("genérame el menú y dime qué ceno hoy") — the engine runs up to 4 tool rounds per turn (see [Advisor](./advisor.md)).
- Sending a sticker, location or other unsupported type gets a polite "todavía no entiendo ese tipo de mensaje".
- **"Hazme la compra"** → one short link per shop (`<WEB_PUBLIC_URL>/c/<token>`) that opens the user's own WhatsApp chat with that shop and the order already written; the user sends it. Forwarding (or pasting) the shop's answer back to ONA gets a line-by-line check and reply buttons to approve, then a second link with the confirmation. ONA's number never writes to a shop. See [Compra en mis tiendas](./shop-orders.md). These `/c/` links are the only URLs the model may write in a reply.

## Proactive messages ("Avisos por WhatsApp")

When the master toggle is on (default after linking), ONA writes first. All times are Europe/Madrid. Breakfast and dinner times come from `user_memories.meal_times`, defaulting to 09:00 and 21:00.

| Kind (`prefs` key) | When | Message |
|---|---|---|
| `daily_brief` | breakfast time, for 90 min | "Buenos días. Hoy toca: - Comida: … - Cena: … ¿Quieres cambiar algo?" + menu link; skipped if the day is empty |
| `cooking_reminder` | only if today's dinner takes ≥ 40 min (`recipes.total_time`, else prep+cook): around dinner time − total − 10 min | "Si quieres cenar a las 20:00, toca empezar con *Carrilleras* (unos 90 min)." |
| `dinner_checkin` | 2–3 h after dinner time, if dinner has a recipe and nothing was cooked-logged today | "¿Hiciste hoy la cena (*X*)? Así lo apunto." [Sí, la hice] [No]. "Sí, la hice" → the assistant calls `log_cooked` (cook log + pantry decrement) |
| `shopping_reminder` | Saturday 10:00–12:59, if the current list has ≥ 3 unchecked items | "¿Toca compra? Te faltan N cosas: …" + list link |
| `weekly_nudge` | Sunday 18:00–21:59, if next week has no menu | "Domingo de planificar: ¿te preparo el menú de la semana que viene?" [Sí, prepáralo] [Ahora no] → `generate_weekly_menu(nextWeek: true)` |
| `prep_alerts` | from `notification_schedule` | "Acuérdate: Merluza — sácalo del congelador…" (also sent by Web Push; the row is `sent` if either channel delivers) |

- **Cooldowns:** 20 h per kind; 3 days for the Sunday nudge and the shopping reminder. They are stored as outbound rows, so the 5-minute scheduler tick is idempotent. Proactive messages land in chat history, so a short reply ("sí") makes sense to the assistant.
- **Switches:**
  - **Master:** `whatsapp_links.notify`, the profile toggle. **Opt-in**: a new link starts with `notify = false`, and right after "¡Listo!" ONA asks "¿Quieres que también te escriba yo?…" with [Sí, avísame] [No, gracias] (outbound kind `optin_prompt`). Links made before 2026-10-07 kept their setting.
  - **BAJA / ALTA** (see *Control words*) flip the master switch from the chat.
  - **Per kind:** `whatsapp_links.prefs` (missing key = on), migration `0031_whatsapp_prefs.sql`.
  - Users change them **by chat** via the `set_whatsapp_notifications` skill, e.g. "no me mandes el resumen de la mañana ni el recordatorio de la compra". `PATCH /whatsapp/link` accepts `{ notify?, prefs? }`, and `GET /whatsapp/status` returns `prefs`.
- Everything runs inside the existing 5-minute `notificationScheduler` tick (`runProactiveTick`). It's a no-op when WhatsApp isn't configured, and DB work only happens while one of the time windows is open.

Delivery follows Meta's 24 h customer-service window, measured from `last_inbound_at` with a 30-min safety margin:
- **Inside the window:** free-form messages with buttons.
- **Outside the window:** the approved template `WHATSAPP_TEMPLATE_NAME` (language `WHATSAPP_TEMPLATE_LANG`, default `es`), whose single `{{1}}` body variable carries the message flattened to one line. Buttons are folded in as "Responde: Sí / No.", because Meta rejects newlines in template parameters.
- **Outside the window with no template:** skipped silently and retried on the next tick while the time window is still open.

## Conversation reviewer agent

Every day after 07:00 Madrid, the scheduler tick runs `runDailyReviewIfDue` (`services/whatsapp/reviewer.ts`) once for **yesterday's** WhatsApp conversations:
- **Objective signals** (`computeStats`): turns, failed turns, slow turns (> 20 s), engine corrective rounds, frustration cues ("eso no", "ya te he dicho"…), replies ending in a question, proactive sends, send failures.
- **Transcripts** (`buildTranscripts`): one per user, Madrid times, with the engine trace per turn. Each inbound turn stores `whatsapp_messages.meta = { tools, corrections, ms }`. Older turns read "sin registro" and are not judged on tools.
- **LLM review:** `claude-opus-5-5`, effort `high`, JSON-schema output, against the product rules: decisive, truthful, transparent about substitutions, brief "Hecho:", explicit request beats stored data, fast, useful proactivity, transcription quality. Each finding has severity (alta/media/baja), category, the turn, what happened, what was expected and a concrete suggested fix (prompt, skill, or missing capability). It never touches user data.
- **Output:** a row in `assistant_reviews` (one per Madrid day; `ok` / `empty` / `failed`), shown at `GET /admin/assistant-reviews` (admin), plus a WhatsApp summary (outbound `kind='review'`, excluded from the recipient's chat history) sent to `WHATSAPP_REVIEW_EMAILS` (else `ADMIN_EMAILS`) when they have a linked phone.
- **On-demand runs:** `POST /admin/assistant-reviews/run { day?, notify? }`.
- **Cost:** one Opus call per day with conversations; about 20 s.

Migration `0032_assistant_reviews.sql` (new table + nullable `meta` column; idempotent).

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
   - **Control words** run first, before every other gate, and never reach the model (`commands.ts`, whole-message match only, so "para la cena pon lentejas" is a request). **BAJA / STOP / PARAR / "no quiero más avisos"** → `notify = false` + "Hecho: no te enviaré más avisos…". A late (stale), suspended, not-allowed or over-budget sender is honoured too. An unlinked number that wrote BAJA never gets the connect hint again until ALTA. **ALTA / "Sí, avísame"** → `notify = true`. **HUMANO / "hablar con una persona"** → how to reach the team (`SUPPORT_EMAIL`; unset → "la persona de ONA que te invitó a la beta"). "No, gracias" is handled here only when it answers the opt-in question; otherwise it goes to the model.
   - A message older than 2 h (a late Meta retry) is dropped silently.
   - An unlinked phone goes to the linking flow.
   - A suspended account is refused (the copy includes the human contact).
   - An account not in `WHATSAPP_ALLOWED_EMAILS` is refused.
   - Once the monthly budget is spent, the user gets the same copy as the web's 429. This check runs **before any paid work**: no transcription, no photo extraction, no model call.
6. Text and button replies go through `chat(userId, text, history, db, { mode: 'whatsapp' })`. **Food only:** for anything that isn't about food (menu, recipes, cooking, shopping list, pantry, nutrition, the user's ONA settings) the model answers exactly `WHATSAPP_OFF_TOPIC_REPLY` ("Solo te puedo ayudar con tu comida: menú, recetas, lista de la compra, despensa y nutrición. ¿Te ayudo con algo de eso?"). A mixed message gets the food part done and the rest omitted. The sentence avoids "no puedo…" so the engine's refusal guard doesn't fire. The system prompt's WhatsApp mode allows `*negrita*` and dash lists, forbids "pulsa/abajo" screen language, sends cooking timers and steps to the app's cooking mode, and asks the model to end short-choice questions with `[[opciones: Sí | No]]`. The renderer turns that line into reply buttons; with more than 3 options, they are folded back into the text.
7. Replies are cut to WhatsApp's 4096-character limit, splitting on paragraph boundaries first.
8. Each reply is stored as an outbound row (`kind='reply'`). The inbound row becomes `processed`, with its final text.
9. If anything fails, the user gets "Vaya, algo ha fallado…" and the inbound row becomes `failed` with the error.

## Data model

- `whatsapp_links(user_id UNIQUE, phone UNIQUE, profile_name, notify, prefs jsonb, linked_at, last_inbound_at)`. `last_inbound_at` marks the start of Meta's 24 h customer-service window.
- `whatsapp_link_codes(code PK, user_id, expires_at, used_at)`: used by both the profile card and `/whatsapp/conectar`.
- `whatsapp_messages(wamid UNIQUE NULL, phone, user_id, direction in|out, kind, body, status, error_message)`.
  - Inbound statuses: `received` / `processed` / `failed` / `ignored`.
  - Outbound statuses: `sent` / `failed`.
  - Outbound kinds `system` (budget, linked, errors), `link` (how to connect) and `ack` ("me pongo con ello") are left out of chat history.
- Migration `0030_whatsapp.sql`, which only creates new tables and is idempotent.

## API

- `GET /whatsapp/webhook` (public): Meta's verification handshake. It echoes `hub.challenge` when `hub.verify_token` matches `WHATSAPP_VERIFY_TOKEN`; otherwise **403**.
- `POST /whatsapp/webhook` (public, signed): **503** when the channel isn't configured.
- `GET /whatsapp/status` (auth): `{ available, linked, phone, notify, prefs, chatLink }`. `available` = configured AND email allowed. The profile chapter is hidden unless `available || linked`, so a user can always disconnect.
- `POST /whatsapp/link-code` (auth): `{ code, expiresAt, message, waLink }`. **403** `WHATSAPP_UNAVAILABLE` when not available.
- `PATCH /whatsapp/link` (auth) `{ notify?: boolean, prefs?: { <kind>: boolean } }`: **404** when not linked.
- `DELETE /whatsapp/link` (auth): **204**.

## Configuration (`ona-api`)

- Required: `WHATSAPP_ACCESS_TOKEN` (permanent System User token with `whatsapp_business_messaging`), `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`.
- Recommended: `WHATSAPP_DISPLAY_NUMBER` (the sender's number as digits, for `wa.me` links), `WHATSAPP_ALLOWED_EMAILS` (comma-separated ONA emails; empty means everyone), `WEB_PUBLIC_URL` (base for deep links; defaults to the Railway web URL).
- `SUPPORT_EMAIL`: the human contact shown for HUMANO and in the suspended copy. Unset → "escribe a la persona de ONA que te invitó a la beta".
- Optional: `WHATSAPP_TEMPLATE_NAME` + `WHATSAPP_TEMPLATE_LANG` (proactive messages outside the 24 h window; template body must have one `{{1}}` and not start or end with it, e.g. "Aviso de ONA: {{1}} Respóndeme por aquí si quieres cambiar algo."), `WHATSAPP_GRAPH_VERSION` (default `v26.0`) and `WHATSAPP_GRAPH_BASE_URL`, which local E2E points at a mock server.
- Meta dashboard webhook: `https://ona-api-production.up.railway.app/whatsapp/webhook`, subscribed to the `messages` field.
- **Two Meta gotchas, both hit while setting it up on 2026-10-06.** Either one means silence: no inbound rows at all and nothing in the logs.
  1. **Webhook saved without fields.** Saving the URL in the dashboard doesn't subscribe any field. Check with `GET /{app-id}/subscriptions` (app token `app_id|app_secret`): `fields` must include `messages`. Fix: `POST /{app-id}/subscriptions` with `object=whatsapp_business_account&fields=messages&callback_url=…&verify_token=…`.
  2. **App not subscribed to the WABA.** The test WhatsApp Business Account comes subscribed only to Meta's internal "WA DevX Webhook Events" app. Check with `GET /{waba-id}/subscribed_apps`; fix with `POST /{waba-id}/subscribed_apps`, using a token that can see the WABA. The System User needs the WhatsApp account assigned as an asset, not just the app.
  Moving to a real number needs both again for the new WABA.

## Constraints

- **AI disclosure (EU AI Act art. 50):** both first messages Ona can send in a conversation — the unlinked "Hola, soy ONA…" hint and the "¡Listo!" after linking — include "Soy un asistente de inteligencia artificial (IA): puedo equivocarme y no sustituyo a un profesional sanitario." (`AI_DISCLOSURE_FIRST_PERSON` in `@ona/shared`). Pinned by `whatsappInbound.test.ts`.
- No WhatsApp groups. Signing up happens on the web (the connect link offers "Crear cuenta"), not inside the chat.
- Meta's test number can only message the up-to-5 recipients verified in the Meta dashboard. Opening the channel to all users needs a real number plus business verification.
- In-process queue: if the API restarts mid-turn, that message stays `received` and gets no answer (no sweeper; messages older than 2 h are dropped as stale anyway).
- Every turn checks the chat's € budget **and** the monthly cap on all paid AI work (`USER_MONTHLY_SPEND_CAP_EUR`, see [Advisor](./advisor.md)) before any paid step. Every paid call (including each template message, `meta_whatsapp/utility_template`) is recorded in the cost ledger ([Metrics](./metrics.md)).
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
  - `commands.ts`: BAJA / ALTA / HUMANO control words.
  - `webhookParser.ts`, `signature.ts`, `linking.ts`, `history.ts`, `format.ts`, `render.ts`, `config.ts`.
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts): `mode: 'whatsapp'`.
- [apps/api/src/services/assistant/engine.ts](../apps/api/src/services/assistant/engine.ts): `ChatOptions.mode`.
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts): `whatsappLinks`, `whatsappLinkCodes`, `whatsappMessages`; [migration 0030](../apps/api/src/db/migrations/0030_whatsapp.sql).
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts): `WHATSAPP_*`, `WEB_PUBLIC_URL`.
- [apps/web/src/app/whatsapp/conectar/page.tsx](../apps/web/src/app/whatsapp/conectar/page.tsx) (WhatsApp-first: login/register → send the code from WhatsApp), [apps/web/src/lib/safeNext.ts](../apps/web/src/lib/safeNext.ts) (`?next=` for login/register),
- [apps/web/src/components/profile/WhatsAppCard.tsx](../apps/web/src/components/profile/WhatsAppCard.tsx), [apps/web/src/hooks/useWhatsApp.ts](../apps/web/src/hooks/useWhatsApp.ts), [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) (chapter 08).
- Tests: `apps/api/src/tests/whatsappWebhook.test.ts`, `whatsappFormat.test.ts`, `whatsappInbound.test.ts` (incl. control words + opt-in), `whatsappScope.test.ts` (food-only), `whatsappProactive.test.ts`; `apps/web/e2e/whatsapp-link.spec.ts`, `apps/web/e2e/whatsapp-connect.spec.ts`.
