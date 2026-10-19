# Business Metrics & Cost Ledger

One JSON endpoint (plus the product-analytics `GET /admin/usage`) that tells the "Dirección" and Finance agents (and Miguel) how many households use Mimoia each week, how many "resolve" their week, how they retain, and what each active household really costs in paid AI/messaging providers. Built on an append-only **cost ledger** (one row per paid provider call) and a small **activity log** for shopping-list use.

## Why this exists

Mimoia is pre-launch and will be run as a one-person company with AI agents. Pricing needs the real cost per active household per week, and the morning brief needs activation/retention numbers. Before this, only per-user counters existed (advisor € budget, image quota, a voice-minutes cap since retired), none per call, none per household.

## User Capabilities

- An admin (JWT, see [Roles](./roles.md)) or an agent holding the read-only token can call `GET /admin/metrics?weeks=8` and get JSON for the last N ISO weeks (1–52, default 8; Europe/Madrid clock, current week flagged `partial`).
- The token is sent as header `x-metrics-token` and must equal the env var `METRICS_READ_TOKEN` (constant-time compare). It opens nine read-only GETs: this endpoint, `GET /admin/usage` (below), `GET /admin/errors` ([Error tracking](./errors.md)), `GET /admin/waitlist` ([Waitlist](./waitlist.md)), `GET /admin/price-survey` ([Billing](./billing.md)), `GET /admin/feedback` ([Feedback](./feedback.md), without identity), `GET /admin/assistant-reviews/flags` ([WhatsApp](./whatsapp.md)), `GET /admin/catalog-wishes` ([Catalog import](./catalog-import.md)) and `GET /admin/extension-gaps` (below, [Shop orders](./shop-orders.md)) — every other `/admin/*` route still needs an admin JWT. With the env var unset, token access is off (always 401 `METRICS_TOKEN_DISABLED`); a wrong token is 401 `METRICS_TOKEN_INVALID`, with no fallback to JWT; any method other than GET/HEAD with the token is 405 `METRICS_TOKEN_READ_ONLY`.
- `includeInternal=1` also counts admin and suspended accounts (useful pre-launch, when almost every user is internal).
- Response:
  - `weekly[]`: `week` (Monday), `isoWeek` (`2026-W41`), `partial`, `activeHouseholds`, `resolvedWeekHouseholds`, `newHouseholds`, `costEur { total, byProvider, byFeature }`, `internalCostEur`, `costPerActiveHouseholdEur`, `installedAppHouseholds` and `pushEnabledHouseholds` (each `{ android, ios, desktop, total }`, see «App instalada y avisos» below).
  - `cohorts[]`: households by signup week with `size` and `retention { w1..w4 }`.
  - `campaigns[]` (PRO-27): signups in the window grouped by the **campaign invitation link** their first user registered with (`campaign: null` = no link): `signups`, `activated` / `activationRate` (active in the signup week), `week3Eligible`, `week3Active`, `week3Rate` (active in signup week + 3, over the signups whose week 3 has started). This is how Miguel's circle («familia», «amigos-padel») is read apart from strangers.
  - `totals`: distinct `activeHouseholds`, `activeHouseholdWeeks`, `newHouseholds`, `resolvedHouseholdWeeks`, `costEur`, `internalCostEur`, `costPerActiveHouseholdWeekEur`, `costEvents`, `unpricedCostEvents`.
  - `errors`: `{ windowDays: 7, newGroups, activeGroups, openGroups, events }` from the in-house error tracker over the last 7 days (rolling, by `last_seen`; not per ISO week): error groups first seen / seen / seen and unresolved, and Σ `count` of the groups seen (cumulative, so an upper bound of the window's events). Detail per group: `GET /admin/errors` ([errors.md](./errors.md)).
  - `waitlist`: `{ entries, waiting, invited, joined, unsubscribed, last7Days, referredSignups, newsletterOptIns }` — all time, from `waitlist_entries` (`last7Days` = signups in the last 7 × 24 h; `referredSignups` / `newsletterOptIns` count active entries only). Segments, sources and the suggested next batch: `GET /admin/waitlist` ([waitlist.md](./waitlist.md)).
  - `definitions` (the rules below, in plain language) and `dataSince { costLedger, activityLog }` — the first ledger/activity row, so earlier weeks aren't misread as "free" or "unresolved".
- Code that needs a user's spend (e.g. budget limits) calls `getUserMonthlySpendEur(userId, now?)` in `services/costLedger.ts`: estimated EUR billed to that user so far this calendar month (Europe/Madrid), all paid features.

## Definitions

- **Household**: the primary household of at least one counted user. Activity is attributed to the row's own `household_id` when it has one, else to the user's current primary household.
- **Excluded accounts**: `role = admin` and suspended users (current status). Their spend is reported apart as `internalCostEur`. There is no demo-account flag in the schema.
- **Active household (week)**: at least one of — generated a menu, logged a cooked meal, used the shopping list, created a recipe, sent a WhatsApp message to Mimo, or triggered a paid AI feature (chat with Mimo, typed or spoken; voice transcription or read-aloud; recipe import/extraction; image). Old Realtime voice sessions (`voice_transcripts`, no longer written since 2026-10-09) still count for past weeks. Opening a screen is not tracked. Mimoia-initiated WhatsApp templates don't count.
- **Resolved week**: the household has a menu whose `week_start` is that week AND used the shopping list (checked an item, toggled in-stock, or added an item — from the web or through the assistant/voice) during that week **or the Saturday/Sunday right before it** (people shop at the weekend for the menu starting Monday; Mimoia's shopping reminder fires Saturday). Opening the list does not count: the `shopping_lists` row is rewritten on every read, including by the WhatsApp shopping reminder.
- **New household**: created (at registration) that week. **Cohort retention wK**: share of the signup cohort active in week signup+K; `null` until that week starts; the current week is partial.
- **Cost**: ledger cost of counted users plus system jobs (no user, e.g. the daily conversation reviewer). `costPerActiveHouseholdEur` = week cost / active households (`null` with none active); `costPerActiveHouseholdWeekEur` = window cost / Σ weekly active households.

## Cost ledger (`cost_events`)

Every paid provider call writes one row — user (nullable), household (user's primary at record time), feature, provider, model, units (tokens / audio tokens / minutes / messages / images / characters), estimated `cost_micros` (micro-euros; `NULL` when the model isn't priced — counted in `unpricedCostEvents`, never dropped). Recording is fire-and-forget: it never slows or fails the user's request; errors are logged.

| Feature | Provider / model | Billed to |
|---|---|---|
| `assistant_chat` (web chat turn, all tool rounds) | Anthropic Sonnet 5.5 (`ASSISTANT_MODEL`, since 2026-10-12; Haiku 4.5 before) | user |
| `whatsapp_chat` | Anthropic Sonnet 5.5 (same model as the web chat) | user (WhatsApp turn) |
| `voice_note_transcription` (WhatsApp voice notes) | OpenAI `OPENAI_TRANSCRIBE_MODEL` | user |
| `mimo_voice_transcription` (Mimo's voice in the app, `POST /stt`) | OpenAI `OPENAI_TRANSCRIBE_MODEL` | user |
| `chat_tts` (Mimo's replies read aloud, `POST /tts`; units = characters, priced per 1,000 chars) | ElevenLabs `ELEVENLABS_MODEL` | user |
| `voice_realtime` (**historical**: OpenAI Realtime voice mode, client-reported minutes; retired 2026-10-09, old rows kept) | OpenAI `gpt-realtime*` | user |
| `recipe_extract_photo` (web photo, WhatsApp photo) | Anthropic Sonnet 5.5 | user |
| `recipe_extract_url` (web URL import, `import_recipe_from_url`) | Anthropic Sonnet 5.5 | user |
| `ingredient_match` (extraction disambiguation) | Anthropic Sonnet 5.5 | user |
| `unit_fallback` (odd units → grams/ml) | Anthropic Haiku 4.5 | user |
| `usda_translation` (ingredient auto-create) | Anthropic Haiku 4.5 | user |
| `ingredient_nutrition_estimate` ("Estimar con Mimoia") | Anthropic Opus 4.6 | user |
| `recipe_image` (regenerate image) | AIKIT Imagen-fal | user (seed script: system) |
| `whatsapp_review` (daily conversation reviewer) | Anthropic Opus 5.5 | system |
| `whatsapp_guided` (PRO-156: the writer of the messages Mimo sends by itself, ≈ $0.0025 each) | Anthropic Haiku 4.5 | user (counts against the monthly cap) |
| `whatsapp_template` (Mimoia-initiated template, outside the 24 h window) | Meta `utility_template` | user |
| `whatsapp_service` (each free-form message Mimo sends: replies, and proactive messages inside the 24 h window) | Meta `service_message` | user (`null` for a number not linked yet) |

Attribution: every authed request runs in a per-request context carrying the user, so deep calls (matcher, unit fallback, translator) are billed without threading ids. Multipart routes (photo extraction, `POST /stt`) re-enter it after the upload parser. Each WhatsApp inbound turn runs in its own context that the budget check fills in once the phone resolves to a user. Schedulers and scripts have no context → system.

WhatsApp service messages (since 2026-10-01 Meta bills them): one row per message sent, always. Meta gives each business number 1,000 free service messages a month, so the first 1,000 of the Madrid calendar month are recorded as `units.freeMessages = 1` (0 €) and the 1,001st onwards as `units.messages = 1` (€0.0166). The tier is counted over all `whatsapp_service` rows of the month (Mimoia has one number); if that count can't be read the message is recorded as priced. Neither templates nor service messages count as household activity (they're Mimoia's messages; the user's own inbound message already counts).

Not costs, so not recorded: USDA / BEDCA lookups, YouTube/article fetches.

## Prices

All rates live in `config/pricing.ts` (source + date in comments), in the provider's currency; USD is converted with `ADVISOR_EUR_PER_USD` (the same knob the advisor budget uses, default 0.92). The advisor's € budget prices the assistant's model (`ADVISOR_PRICE_MODEL` in `advisorBudget.ts`, kept in sync with `ASSISTANT_MODEL`) from the same table, so budget and ledger never disagree. Anthropic rates checked against the official page on 2026-10-16: Sonnet 5.5 and Opus 5.5 cache reads are 0.05× input (Sonnet 5.5 reads were recorded at double the real rate until then); Haiku 5.5 ($0.10 / $0.50) is in the table for model comparisons. `COST_PRICE_OVERRIDES` (JSON, e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`) corrects or adds a price without a code change; malformed values are ignored with a warning.

The `openai/gpt-realtime*` entries stay in the table so historical `voice_realtime` rows keep their price. ElevenLabs is priced per 1,000 characters by model (`elevenlabs/<model>`). Marked UNVERIFIED (estimates, override when known): Realtime voice blended **$0.10 / session-minute** (historical; token rates verified, the per-minute blend is derived), AIKIT image **$0.04**. Meta WhatsApp Spain is verified against Meta's EUR list rates effective 2026-10-01 (checked 2026-10-13): utility template and service message **€0.0166**, marketing **€0.0585**.

## Activity log (`activity_events`)

Append-only `(user, household, kind, created_at)` for actions no other table timestamps durably: `shopping_check`, `shopping_stock`, `shopping_add`. Written by an app-level middleware when the matching shopping-list route answers 2xx, and by the assistant tool runner when `check_shopping_item` / `mark_in_stock` succeed. Never blocks the request.

## Eventos de uso (`usage_events`, `GET /admin/usage`)

Analítica de producto en una tabla propia, sin terceros. Una fila por cada cosa que hace un usuario: `(created_at, household_id, user_id, name, channel, props)`. `channel` es `web` | `whatsapp` | `voice` (null = desconocido). `props` solo admite slugs, números y booleanos (máx. 8 claves, los filtra `trackEvent`): nunca texto libre, nombres, URLs ni teléfonos. Usuario y hogar son `SET NULL` al borrarse, así que una cuenta borrada deja solo recuentos anónimos. `trackEvent` nunca lanza error ni espera a la base de datos.

| Evento | Web (ruta, 2xx) | Mimo (herramienta ejecutada, canal de la conversación) |
|---|---|---|
| `signup_completed` (`props.access`: open/admin/campaign/waitlist/household) | `POST /register` | — |
| `onboarding_completed` | `POST /user/:id/onboarding` | `complete_onboarding` (cuenta también `menu_generated`) |
| `onboarding_whatsapp_chosen` (PRO-106) | `POST /whatsapp/link-code` con `{ from: "onboarding" }`: «Por WhatsApp» en la primera pantalla del alta (Perfil y `/whatsapp/conectar` no lo mandan, así que no cuentan) | — |
| `first_steps_completed` / `first_steps_skipped` | `POST /user/:id/first-steps` con `{ outcome }` (lo envía la guía; sin cuerpo no cuenta) | — |
| `menu_generated` | `POST /menu/generate` | `generate_weekly_menu` |
| `meal_swapped` (`props.target` meal/dish, `props.how` picked/auto) | `PUT /menu/:id/day/:d/meal/:m`, `POST …/dish/:p/regenerate` | `swap_meal` |
| `shopping_list_viewed` | `GET /shopping-list`, `GET /shopping-list/:menuId` | `get_shopping_list` |
| `shopping_item_checked` (solo al marcar, no al desmarcar) | `PUT /shopping-list/:l/item/:i/check` | `check_shopping_item` |
| `recipe_imported` (`props.source` url / photo / whatsapp_photo / whatsapp_url / social; `props.kind` article/youtube/instagram/tiktok) | `POST /recipes/extract-from-url`, `POST /recipes/extract-from-image` (el borrador, antes de guardar) | `import_recipe_from_url`; foto de WhatsApp guardada como receta (`inbound.ts`) |
| `recipe_created` (`props.withSource`) | `POST /recipes` | `create_recipe` |
| `cook_mode_started` | `POST /usage/cook-mode-started` (la página del modo cocina lo llama una vez al abrirse, sin datos, PRO-188) | `start_cooking_mode` |
| `meal_cooked` | `POST /cook-logs` | `log_cooked`; `mark_meal_eaten` con `eaten: true` («ya lo hemos comido», `via: 'eaten'`, PRO-188) |
| `mimo_message` (por `channel`; en WhatsApp `props.kind` text/voice_note/photo) | `POST /assistant/:id/chat` (`mode: voice` → voice) | cada turno de WhatsApp que llega a Mimo (`inbound.ts`) |
| `whatsapp_linked` | — | código de vinculación aceptado (`inbound.ts`) |
| `invite_shared` (PRO-165) | toque en «Invitar a otro hogar» (el botón llega con PRO-163; hasta entonces no hay eventos) | — |
| `app_opened_installed` (`props.device` android/ios/desktop; pasivo, ver abajo) | `POST /usage/app-opened` (la web, al abrirse instalada) | — |
| `shop_order_prepared` (`props.orders` desde Mimo) | `POST /shop-orders/prepare` | `prepare_shop_orders` con al menos un pedido |
| `carrefour_click` (`props.items` = líneas de la tarjeta del súper) | `POST /shop-orders/:id/carrefour-click` (botón «Hacer este pedido en Carrefour.es», PRO-84) | — |
| `basket_extension_sent` («Enviar a <cadena>»; `props`: `lineas`, `tabla`, `busqueda`, `fallidas` (fallidas + sin verificar), `ok`, `error` (`ninguno` si no hay), `bajoMinimo`; sin nombres) | `POST /shop-orders/:id/extension-result`, solo cuando el resultado se guarda: uno por envío (un POST reintentado o un `repetido` de un envío ya guardado no cuentan) | — |
| `basket_extension_undo` (`props.manual`: «Ya lo he quitado yo») | `POST /shop-orders/:id/extension-undo` (un 409 no cuenta) | — |

Sin dobles recuentos: las herramientas que llaman a la propia API REST (`appApi.ts`) y los procesos de sistema que leen la lista (recordatorio de la compra por WhatsApp, la lectura interna de `POST /shop-orders/prepare`) envían la cabecera `x-mimoia-internal`, que el middleware web ignora; el ejecutor de herramientas los registra con el canal de la conversación. Las herramientas que responden "no encontrado" (`data: null`) no cuentan. Los dos eventos de la extensión del navegador no son pasivos: hacen activo al hogar, como todos salvo `app_opened_installed`.

`GET /admin/extension-gaps?days=7` (JWT de admin o el token; `days` entero, acotado a 1–90, 7 por defecto; [Shop orders](./shop-orders.md)) → `{ days, gaps[] }`: lo que la extensión del navegador no tenía en su tabla en los envíos recibidos esos días, para hacerla crecer. Cada hueco: producto de la lista (`name`, `choice`, `search`), `estado` (`busqueda` = entró por búsqueda; `fallida`), producto elegido (`productoId`, `producto`), `motivo` (`no_encontrado`, `no_publicado`, `error` o null) y `veces`, de más a menos. Sin usuarios ni hogares.

`GET /admin/usage?days=28[&includeInternal=1]` (JWT de admin o el token; `days` 1–180; cuentas admin y suspendidas fuera salvo `includeInternal=1`; días de Europe/Madrid) devuelve solo recuentos:
- `generatedAt`, `windowDays`, `from`, `to`, `includeInternal`, `eventNames[]`, `channels[]`, `dataSince` (primer evento registrado: los días anteriores salen vacíos, no "sin uso").
- `daily[]`: `{ day, activeHouseholds, events { <nombre>: n }, byChannel { web, whatsapp, voice, unknown } }`, un elemento por día, también los días a cero.
- `weekly[]`: `{ week (lunes), isoWeek, partial, activeHouseholds, events }`.
- `funnel[]`, por semana ISO de alta: `{ week, isoWeek, signups, firstMenu, shoppingListViewed, cooked, week2Eligible, activeWeek2 }`. `firstMenu → shoppingListViewed → cooked` son pasos encadenados dentro de los 7 primeros días (día del alta … +6); `cooked` = `cook_mode_started` o `meal_cooked`. `activeWeek2` no está encadenado: algún evento en los días 7–13, sobre `week2Eligible` (altas cuyo día 7 ya ha llegado).
- `totals`: `{ events, byChannel, activeHouseholds, householdsByEvent }` de la ventana. `definitions` repite las reglas.
- `channelSplit[]` (PRO-106), por semana ISO: `{ week, isoWeek, webOnly, whatsappOnly, both, unknownOnly }` — hogares activos que solo usaron la app o la web (la voz cuenta como app), solo WhatsApp, o los dos; `unknownOnly` = activos solo por eventos sin canal (el alta, por ejemplo).
- `households` (PRO-106), el estado de **ahora**, no de la ventana: `{ households, withWhatsapp, withWhatsappNotify, withPush, withNotices, withTwoPlusMembers }` — hogares con al menos un miembro contado; con algún miembro con WhatsApp conectado; con los mensajes de Mimo por WhatsApp activados; con avisos push en algún navegador; con cualquiera de los dos avisos; con 2 o más miembros. Las cuentas admin y suspendidas no cuentan como miembros salvo `includeInternal=1`. Solo cifras: los ids se quedan en la consulta. Cuántos eligen «Por WhatsApp» en el alta: `totals.householdsByEvent.onboarding_whatsapp_chosen`.
- `referrals[]` (PRO-165, «Referidos»), por semana ISO y de todo el histórico (no de la ventana): `{ week, isoWeek, inviteShared, signupsWithInviter, week3Resolved, inviters }` — toques en «Invitar a otro hogar» esa semana; cuentas que se registraron esa semana con el código de otra (sin contar a quien entra en el hogar de quien invita); de ellas, hogares con **semana resuelta en su 3.ª semana** (menú generado y lista abierta entre los días 14 y 20 desde el alta); y número de códigos distintos detrás. Solo cifras: nunca correos ni códigos.
- `proactive` (PRO-156), por semana ISO de la ventana: `{ replyWindowHours, weekly[] { week, isoWeek, sent, replied, replyRate, guided, fallback, optouts, byKind { <tipo>: { sent, replied, replyRate, guided, fallback } } }, totals }` — mensajes que Mimo manda por su cuenta por WhatsApp (`daily_brief`, `cooking_reminder`, `dinner_checkin`, `shopping_reminder`, `weekly_nudge`, `alert`) entregados; cuántos tuvieron respuesta del mismo número en 6 h; cuántos se escribieron con su guía y cuántos salieron con el texto fijo (los anteriores a PRO-156 no cuentan en ninguno); y las bajas (BAJA) de cuentas conectadas. Solo cifras (`services/proactiveReport.ts`; test `whatsappGuided.test.ts`).
- **Premio pendiente** (PRO-165, D-059): cada hogar invitado que llega a su semana 3 resuelta deja una fila en `referral_rewards` (código de quien invitó, su cuenta si la tiene, la cuenta invitada, `status` `pendiente`; migración 0054), **una sola vez por pareja** (índice único). Lo crea el planificador como mucho una vez por hora (`recordPendingReferralRewardsIfDue`, `services/referralRewards.ts`). Todavía no se da nada: darlo es PRO-166. Tests: `referralRewards.test.ts`, `referralRewards.smoke.ts` (API y base de datos reales).

## App instalada y avisos (PRO-83)

- Al abrirse Mimoia como app instalada (`display-mode: standalone`, o `navigator.standalone` en iPhone) con sesión iniciada, la web llama a `POST /usage/app-opened` sin cuerpo, como mucho una vez al día por navegador (`localStorage`). La API deduce el dispositivo del navegador (android si dice Android; ios si dice iPhone/iPad/iPod; desktop el resto) y guarda solo esa palabra, en un único `app_opened_installed` por hogar y día de Madrid (aunque llegue tres veces). Responde 204 siempre; sin sesión, 401.
- `app_opened_installed` es **pasivo**: sale en los recuentos de `/admin/usage`, pero no hace «activo» a un hogar (ni en `activeHouseholds` ni en el embudo).
- `/admin/metrics` → `weekly[].installedAppHouseholds`: hogares que abrieron la app instalada esa semana, por dispositivo; `total` cuenta cada hogar una vez aunque use dos.
- `weekly[].pushEnabledHouseholds`: hogares con avisos activados al final de esa semana, de `push_subscriptions` (suscripción que sigue existiendo hoy y creada hasta ese domingo), por dispositivo deducido de su `user_agent`. Solo cifras: ni ids ni navegadores en la respuesta.

Conservación: el tick del planificador borra una vez al día los eventos de más de 180 días (`purgeOldUsageEventsIfDue`).

## Constraints

- Queries aggregate in SQL to distinct (household, week|day) pairs and per-week cost sums; the rules above run as pure, unit-tested functions.
- The token is mounted on the nine GETs above only: `GET /admin/metrics`, `GET /admin/usage`, `GET /admin/assistant-reviews/flags` and `GET /admin/extension-gaps` live in `routes/metrics.ts` (a unit test pins that list); `GET /admin/errors`, `GET /admin/waitlist`, `GET /admin/price-survey`, `GET /admin/feedback` and `GET /admin/catalog-wishes` in their own routers. Those routers are mounted before the catch-all `router.use(authMiddleware)` routers (else token-only calls would be 401'd first).
- Unit tests never write to the database (ledger/activity/usage inserts are skipped under vitest).

## Known limitations

- **Los eventos de uso empiezan cuando se despliega esto.** Sin relleno hacia atrás: el embudo solo conoce las altas registradas desde entonces. Desde el 2026-10-19 (PRO-188) «ha cocinado» cuenta todos los canales: abrir el modo cocina en la web (`cook_mode_started`), «Marcar como cocinada» (`meal_cooked`) y lo que se le dice a Mimo por WhatsApp o en el chat (`log_cooked`, `start_cooking_mode`, `mark_meal_eaten` con `eaten: true`); antes, el modo cocina de la web y «ya lo hemos comido» no contaban. Abrir una pantalla sin llamada a la API (detalle de receta, perfil) no se registra. Las conversaciones de Mimo en la web no se guardan: `mimo_message` las cuenta, pero no hay texto que revisar.
- **History starts at deploy.** No backfill: weeks before `dataSince` under-report cost and resolved weeks (the old per-user advisor counter has no per-call history).
- **WhatsApp service messages are counted when sent, not when delivered** (Meta bills delivered ones), and the free tier is counted on the Madrid calendar month and over all `whatsapp_service` rows, so a second number or a failed delivery would make the estimate slightly high. Two messages sent at the same instant can both see the same count at the 1,000 boundary.
- Historical `voice_realtime` rows (until 2026-10-09) trusted client-reported minutes (the retired `POST /realtime/:userId/usage`); a crashed tab reported nothing.
- One-off catalog scripts with their own Claude clients (`regenerateRecipes`, `populatePrepRequirements`, `populateRecipeCourses`, `measure-tokens`) are not recorded.
- **App instalada y avisos:** las aperturas empiezan cuando se despliega PRO-83 (semanas anteriores a 0). Desactivar los avisos borra la suscripción, así que las semanas pasadas de `pushEnabledHouseholds` son un mínimo. Un iPad con iPadOS se presenta como Mac y cuenta como desktop.
- Households are resolved through the user's *current* primary household; a user who switches household moves their past activity with them.

## Related specs

- [Advisor](./advisor.md) — per-user monthly € budget (`checkAdvisorBudget` / `recordAdvisorUsage` also feed the ledger)
- [WhatsApp](./whatsapp.md) — chat, voice notes, photos, reviewer, templates
- [Voice (Mimo)](./voice-mode.md) — `POST /stt` transcription and `POST /tts` read-aloud
- [Shopping](./shopping.md) — the list whose use defines a resolved week
- [Error tracking](./errors.md) — the `errors` block and `GET /admin/errors`
- [Waitlist](./waitlist.md) — the `waitlist` block and `GET /admin/waitlist`
- [Admin Dashboard](./admin-dashboard.md) · [Roles](./roles.md)

## Source

- [apps/api/src/routes/metrics.ts](../apps/api/src/routes/metrics.ts) — `GET /admin/metrics`, `GET /admin/usage`, `GET /admin/assistant-reviews/flags`, `GET /admin/extension-gaps` (`loadBasketGaps` en [services/basketExtension.ts](../apps/api/src/services/basketExtension.ts))
- [apps/api/src/services/usageEvents.ts](../apps/api/src/services/usageEvents.ts) — `trackEvent`, event catalogue, web middleware `trackUsageRoutes`, `recordSkillUsage`, `purgeOldUsageEventsIfDue`
- [apps/api/src/services/appInstalls.ts](../apps/api/src/services/appInstalls.ts) — dispositivo desde el navegador, `recordInstalledOpen` (uno por hogar y día), `loadInstallRows` + builders puros; [apps/api/src/routes/usage.ts](../apps/api/src/routes/usage.ts) — `POST /usage/app-opened`; [apps/web/src/lib/pwa/installedOpen.ts](../apps/web/src/lib/pwa/installedOpen.ts) (llamado desde `app/layout.tsx`)
- [apps/api/src/services/usageReport.ts](../apps/api/src/services/usageReport.ts) — `loadUsageReport` + pure daily/weekly/funnel builders; [apps/api/src/services/proactiveReport.ts](../apps/api/src/services/proactiveReport.ts) — the `proactive` block
- [apps/api/src/db/migrations/0045_usage_events.sql](../apps/api/src/db/migrations/0045_usage_events.sql) — `usage_events`; inline call sites: `routes/auth.ts` (signup), `routes/shopping.ts` (check), `services/whatsapp/inbound.ts`, `services/assistant/engine.ts`, `services/assistant/appApi.ts` (`x-mimoia-internal`), `services/notificationScheduler.ts` (purge), `apps/web/src/components/menu/FirstStepsGuide.tsx` (`outcome`)
- [apps/api/src/middleware/metricsAuth.ts](../apps/api/src/middleware/metricsAuth.ts) — admin JWT or `x-metrics-token`
- [apps/api/src/services/businessMetrics.ts](../apps/api/src/services/businessMetrics.ts) — SQL loader + pure week/cohort/cost rules + `DEFINITIONS`
- [apps/api/src/services/appErrors.ts](../apps/api/src/services/appErrors.ts) — `loadErrorSummary` (the `errors` block)
- [apps/api/src/services/waitlist.ts](../apps/api/src/services/waitlist.ts) — `loadWaitlistSummary` (the `waitlist` block)
- [apps/api/src/services/costLedger.ts](../apps/api/src/services/costLedger.ts) — `recordCost`, attribution context, `getUserMonthlySpendEur`
- [apps/api/src/config/pricing.ts](../apps/api/src/config/pricing.ts) — price table + `COST_PRICE_OVERRIDES`
- [apps/api/src/services/activityEvents.ts](../apps/api/src/services/activityEvents.ts) — shopping-use log + middleware
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`costEvents`, `activityEvents`), [apps/api/src/db/migrations/0033_cost_ledger.sql](../apps/api/src/db/migrations/0033_cost_ledger.sql)
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `METRICS_READ_TOKEN`, `COST_PRICE_OVERRIDES`, `ADVISOR_EUR_PER_USD`
- Recording call sites: `services/advisorBudget.ts`, `services/providers/anthropic.ts`, `services/ingredientMatcherLLM.ts`, `services/llmUnitFallback.ts`, `services/nutrition/usdaTranslator.ts`, `services/stt.ts`, `services/tts.ts`, `services/recipeImageGenerator.ts`, `services/whatsapp/reviewer.ts`, `services/whatsapp/guided.ts` (guided messages), `services/whatsapp/outbound.ts` (templates), `services/whatsapp/serviceCost.ts` (service messages, called from `outbound.ts` and `inbound.ts`), `routes/ingredients.ts`; attribution in `middleware/auth.ts`, `routes/recipes.ts` (photo extraction), `routes/stt.ts` (re-enters it after the audio upload), `routes/whatsapp.ts`; skill activity in `services/assistant/engine.ts`
- Tests: `apps/api/src/tests/businessMetrics.test.ts`, `costPricing.test.ts`, `costLedger.test.ts`, `metricsAuth.test.ts`, `basketExtensionRoute.test.ts` + `basketExtension.test.ts` (huecos, eventos de la extensión), `activityEvents.test.ts`, `usageEvents.test.ts`, `usageReport.test.ts`, `appInstalls.test.ts`, `appInstallsRoute.test.ts`, smoke `usageRoute.smoke.ts`; e2e `apps/web/e2e/first-steps.spec.ts` (the `outcome` body), `apps/web/e2e/installed-open.spec.ts`
