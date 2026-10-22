# Telegram

Talk to **Mimo** from Telegram: the same assistant as in the app and on WhatsApp, with the same skills, memory, monthly € budget and health rule, through a Telegram bot (PRO-313).

**Status (2026-10-23): piece 1 only, switched off and offered to nobody.** The channel exists in the API but stays off until `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `TELEGRAM_BOT_USERNAME` are set on `ona-api` (none is set anywhere today). There is **no button in the web**: «Conectar Telegram» in the profile waits for Legal's OK (LEG-35), and so do `kb/sobre-mimoia.md` and `/privacidad`, which don't mention Telegram yet. The **avisos** (menú de hoy, compra, descongelar) are **not** sent by Telegram: they keep going only through the main channel until piece 3.

## User Capabilities

- **Connect (once the profile button exists).** The signed-in user asks for a link (`POST /telegram/link-code`) and opens `https://t.me/<bot>?start=<code>`. Telegram opens the chat with the bot; pressing «Iniciar» sends `/start <code>` from that chat, which proves both the app session (it minted the code) and the chat. A bot can't write first, so this is the only way in.
- **First message on connecting** (Miguel's text, word for word):
  «Hola, soy Mimo, de Mimoia. Soy una inteligencia artificial y te ayudo con el menú de la semana, la lista de la compra y lo que tengas en la despensa.
  Ya estamos conectados con tu cuenta. Pídeme lo que quieras, por ejemplo: «hazme el menú de la semana» o «¿qué ceno hoy con lo que tengo?».
  Los avisos (menú de hoy, compra, descongelar) te llegan por aquí si los tienes activados en tu perfil.»
  A plain `/start` (or an old code) from a chat that is already connected gets the same message.
- **Anyone else** (a chat that isn't connected, or a bad, used or expired code) gets, every time: «Hola, soy Mimo, de Mimoia, una inteligencia artificial. Para hablar conmigo aquí, conecta Telegram desde tu perfil en mimoia.com.» Mimo is never called and nothing is spent.
- **Talking to Mimo.** A connected chat writes text and Mimo answers like on WhatsApp: changes to the menu, the list, the pantry, recipes, questions about cooking. After generating the week (or reading the shopping list) the reply carries the same text digest WhatsApp falls back to (no week picture yet). `[[opciones: Sí | No]]` turns into a one-time reply keyboard: a tap sends the option back as a normal message. `*negrita*` shows as bold. While Mimo works, the chat shows «escribiendo…».
- **Only text for now.** Voice notes, photos, stickers and files get «Por aquí, de momento, solo leo mensajes de texto. ¿Me lo escribes?».
- **HUMANO** (and the same words as on WhatsApp: «hablar con una persona», «soporte»…) gets how to reach the team. BAJA and ALTA are not control words here: the avisos are changed in the profile.
- **Disconnect:** `DELETE /telegram/link` (no button yet) removes the link and its stored conversation.

## Health data

- **Nothing about health is ever stored from Telegram**, exactly like WhatsApp (LEG-03 / PRO-24), until Legal says otherwise. A Telegram turn runs the engine in WhatsApp mode on purpose: the skills see `channel: 'whatsapp'`, so `update_profile`, `update_memory`, the ficha tools, the fridge reader and the app API header drop allergies, intolerances, restrictions and physical data and answer with the web profile link. Restrictions saved from the web are still respected.
- Only the wording changes: the prompt says «Canal Telegram» and «Por Telegram nunca guardas datos de salud», and tells Mimo that a tool line saying «por WhatsApp» applies here too and must be told as «por aquí» / «por Telegram» (`forTelegram`, `TELEGRAM_CHANNEL_NOTE` in `systemPrompt.ts`). The shop-order links still open the user's WhatsApp, as they do everywhere.

## Message handling

1. `POST /telegram/webhook`: **404** while the channel is off; **401** unless `X-Telegram-Bot-Api-Secret-Token` equals `TELEGRAM_WEBHOOK_SECRET` (compared in constant time); otherwise a fast **200** and the turn runs after it, one at a time per chat in arrival order.
2. Only messages from a person in a **private chat** count: groups, channels, other bots, edited messages and button callbacks are dropped. Messages older than 2 hours (a webhook backlog) are dropped, like on WhatsApp.
3. A connected chat's `update_id` is claimed before anything else: a retried or older update is dropped.
4. Gates in this order, before any paid work: paused account (trial over, PRO-135: only the notice to choose a plan), the monthly € budget of the assistant and the monthly spend cap (same `checkBudget` as WhatsApp: «Has alcanzado tu límite mensual…»).
5. Mimo sees the last 12 h of this chat (at most 40 entries kept, with the ⟦hecho: …⟧ line of each turn's tools), built by WhatsApp's `buildChatHistory`.
6. Errors: «Vaya, algo ha fallado. Inténtalo de nuevo en un momento.»

Not on Telegram (piece 1): the WhatsApp-first sign-up (a Telegram turn never runs the first steps), the end-of-reply offers (invite the family, another household, the leftovers question), recipe import from photos, voice notes, the week picture, the daily conversation reviewer and its flags, and every aviso.

## Data model

- `telegram_links`: `user_id` (unique) ↔ `chat_id` (unique, text), `linked_at`, `last_inbound_at`, `last_update_id`, `history` (jsonb, last 12 h / 40 entries of the conversation: direction, kind, text, status, time and the turn's trimmed tool trace). One chat per account and one account per chat: a code from another account moves the chat there; a new chat replaces the account's previous one; the history starts empty. Deleting the account or unlinking deletes it.
- `telegram_link_codes`: one-time codes (`code` 32 url-safe characters, 24 random bytes; `expires_at` = 10 minutes; `used_at`). A new code invalidates the user's previous unused one. Migration `0093_telegram_channel.sql` (only `CREATE TABLE` and an index).
- Costs: each turn is one `cost_events` row with feature `telegram_chat` (cost channel `telegram`), and counts against the same monthly € budget as the web chat and WhatsApp.

## API

- `POST /telegram/webhook` (public, secret header): see above.
- `POST /telegram/link-code` (auth): **201** `{ expiresAt, url }` with `url = https://t.me/<TELEGRAM_BOT_USERNAME>?start=<code>`. **404** `TELEGRAM_DISABLED` while off (before auth: the route doesn't exist for anyone).
- `DELETE /telegram/link` (auth): **204**, also with the channel off.

## Configuration (`ona-api`)

All optional; without any of the three the channel is off.

- `TELEGRAM_BOT_TOKEN`: the bot's token from @BotFather.
- `TELEGRAM_WEBHOOK_SECRET`: 1–256 characters `[A-Za-z0-9_-]`, given to Telegram as `secret_token`.
- `TELEGRAM_BOT_USERNAME`: the bot's username, without `@`.
- Register the webhook once: `curl -s "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" -d url=https://<api>/telegram/webhook -d secret_token=$TELEGRAM_WEBHOOK_SECRET -d 'allowed_updates=["message"]'`.

## Constraints

- Off and unoffered until Miguel switches it on and Legal (LEG-35) gives the OK for the profile button; nothing user-facing mentions Telegram yet.
- Health data: never stored from here (see above). Ficha and menu-edit records made from a Telegram turn are labelled as WhatsApp (they share the channel on purpose); the cost ledger is the only place that tells them apart.
- Piece 3 (avisos by Telegram) and piece 2 (the profile button) are not built.

## Related specs

- [WhatsApp](./whatsapp.md): the channel this one reuses (engine mode, history, rendering, budget, health rule).
- [Advisor](./advisor.md): the engine and skills.
- [Metrics](./metrics.md): `telegram_chat` in the cost ledger.

## Source

- [apps/api/src/routes/telegram.ts](../apps/api/src/routes/telegram.ts): webhook, link code, unlink.
- [apps/api/src/services/telegram/](../apps/api/src/services/telegram/):
  - `config.ts` (on/off), `secret.ts` (webhook secret), `updateParser.ts` (Update → message), `linking.ts` (code, `t.me` link), `copy.ts` (texts);
  - `inbound.ts` (the turn: linking, gates, engine, reply), `format.ts` (WhatsApp-shaped reply → Telegram HTML + reply keyboard), `history.ts` (stored conversation), `store.ts` (DB), `client.ts` (Bot API), `wiring.ts` (real deps, WhatsApp's budget and digest).
- `forTelegram` / `TELEGRAM_CHANNEL_NOTE` / `ChatSurface` in [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts); `surface` in `ChatOptions` ([engine.ts](../apps/api/src/services/assistant/engine.ts)).
- `telegramLinks`, `telegramLinkCodes` in [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts); [0093_telegram_channel.sql](../apps/api/src/db/migrations/0093_telegram_channel.sql).
- Tests: [apps/api/src/tests/telegram.test.ts](../apps/api/src/tests/telegram.test.ts).
