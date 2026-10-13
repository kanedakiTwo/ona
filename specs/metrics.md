# Business Metrics & Cost Ledger

One JSON endpoint (plus the product-analytics `GET /admin/usage`) that tells the "Dirección" and Finance agents (and Miguel) how many households use Mimoia each week, how many "resolve" their week, how they retain, and what each active household really costs in paid AI/messaging providers. Built on an append-only **cost ledger** (one row per paid provider call) and a small **activity log** for shopping-list use.

## Why this exists

Mimoia is pre-launch and will be run as a one-person company with AI agents. Pricing needs the real cost per active household per week, and the morning brief needs activation/retention numbers. Before this, only per-user counters existed (advisor € budget, image quota, a voice-minutes cap since retired), none per call, none per household.

## User Capabilities

- An admin (JWT, see [Roles](./roles.md)) or an agent holding the read-only token can call `GET /admin/metrics?weeks=8` and get JSON for the last N ISO weeks (1–52, default 8; Europe/Madrid clock, current week flagged `partial`).
- The token is sent as header `x-metrics-token` and must equal the env var `METRICS_READ_TOKEN` (constant-time compare). It opens five read-only GETs: this endpoint, `GET /admin/usage` (below), `GET /admin/errors` ([Error tracking](./errors.md)), `GET /admin/waitlist` ([Waitlist](./waitlist.md)) and `GET /admin/assistant-reviews/flags` ([WhatsApp](./whatsapp.md)) — every other `/admin/*` route still needs an admin JWT. With the env var unset, token access is off (always 401 `METRICS_TOKEN_DISABLED`); a wrong token is 401 `METRICS_TOKEN_INVALID`, with no fallback to JWT; any method other than GET/HEAD with the token is 405 `METRICS_TOKEN_READ_ONLY`.
- `includeInternal=1` also counts admin and suspended accounts (useful pre-launch, when almost every user is internal).
- Response:
  - `weekly[]`: `week` (Monday), `isoWeek` (`2026-W41`), `partial`, `activeHouseholds`, `resolvedWeekHouseholds`, `newHouseholds`, `costEur { total, byProvider, byFeature }`, `internalCostEur`, `costPerActiveHouseholdEur`.
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
| `assistant_chat` (web chat turn, all tool rounds) | Anthropic Haiku 4.5 | user |
| `whatsapp_chat` | Anthropic Haiku 4.5 | user (WhatsApp turn) |
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

Attribution: every authed request runs in a per-request context carrying the user, so deep calls (matcher, unit fallback, translator) are billed without threading ids. Multipart routes (photo extraction, `POST /stt`) re-enter it after the upload parser. Each WhatsApp inbound turn runs in its own context that the budget check fills in once the phone resolves to a user. Schedulers and scripts have no context → system.

Not costs, so not recorded: WhatsApp free-form ("service") replies inside the 24 h window, USDA / BEDCA lookups, YouTube/article fetches.

## Prices

All rates live in `config/pricing.ts` (source + date in comments), in the provider's currency; USD is converted with `ADVISOR_EUR_PER_USD` (the same knob the advisor budget uses, default 0.92). The advisor's € budget prices Haiku from the same table, so budget and ledger never disagree. `COST_PRICE_OVERRIDES` (JSON, e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`) corrects or adds a price without a code change; malformed values are ignored with a warning.

The `openai/gpt-realtime*` entries stay in the table so historical `voice_realtime` rows keep their price. ElevenLabs is priced per 1,000 characters by model (`elevenlabs/<model>`). Marked UNVERIFIED (estimates, override when known): Realtime voice blended **$0.10 / session-minute** (historical; token rates verified, the per-minute blend is derived), WhatsApp Spain utility template **€0.0166** (matches third-party rate cards; Meta's official CSV not checked) and marketing **€0.0585**, AIKIT image **$0.04**.

## Activity log (`activity_events`)

Append-only `(user, household, kind, created_at)` for actions no other table timestamps durably: `shopping_check`, `shopping_stock`, `shopping_add`. Written by an app-level middleware when the matching shopping-list route answers 2xx, and by the assistant tool runner when `check_shopping_item` / `mark_in_stock` succeed. Never blocks the request.

## Eventos de uso (`usage_events`, `GET /admin/usage`)

Analítica de producto en una tabla propia, sin terceros. Una fila por cada cosa que hace un usuario: `(created_at, household_id, user_id, name, channel, props)`. `channel` es `web` | `whatsapp` | `voice` (null = desconocido). `props` solo admite slugs, números y booleanos (máx. 8 claves, los filtra `trackEvent`): nunca texto libre, nombres, URLs ni teléfonos. Usuario y hogar son `SET NULL` al borrarse, así que una cuenta borrada deja solo recuentos anónimos. `trackEvent` nunca lanza error ni espera a la base de datos.

| Evento | Web (ruta, 2xx) | Mimo (herramienta ejecutada, canal de la conversación) |
|---|---|---|
| `signup_completed` (`props.access`: open/admin/campaign/waitlist/household) | `POST /register` | — |
| `onboarding_completed` | `POST /user/:id/onboarding` | `complete_onboarding` (cuenta también `menu_generated`) |
| `first_steps_completed` / `first_steps_skipped` | `POST /user/:id/first-steps` con `{ outcome }` (lo envía la guía; sin cuerpo no cuenta) | — |
| `menu_generated` | `POST /menu/generate` | `generate_weekly_menu` |
| `meal_swapped` (`props.target` meal/dish, `props.how` picked/auto) | `PUT /menu/:id/day/:d/meal/:m`, `POST …/dish/:p/regenerate` | `swap_meal` |
| `shopping_list_viewed` | `GET /shopping-list`, `GET /shopping-list/:menuId` | `get_shopping_list` |
| `shopping_item_checked` (solo al marcar, no al desmarcar) | `PUT /shopping-list/:l/item/:i/check` | `check_shopping_item` |
| `recipe_imported` (`props.source` url / photo / whatsapp_photo / whatsapp_url / social; `props.kind` article/youtube/instagram/tiktok) | `POST /recipes/extract-from-url`, `POST /recipes/extract-from-image` (el borrador, antes de guardar) | `import_recipe_from_url`; foto de WhatsApp guardada como receta (`inbound.ts`) |
| `recipe_created` (`props.withSource`) | `POST /recipes` | `create_recipe` |
| `cook_mode_started` | — (el modo cocina de la web no llama al servidor) | `start_cooking_mode` |
| `meal_cooked` | `POST /cook-logs` | `log_cooked` |
| `mimo_message` (por `channel`; en WhatsApp `props.kind` text/voice_note/photo) | `POST /assistant/:id/chat` (`mode: voice` → voice) | cada turno de WhatsApp que llega a Mimo (`inbound.ts`) |
| `whatsapp_linked` | — | código de vinculación aceptado (`inbound.ts`) |
| `shop_order_prepared` (`props.orders` desde Mimo) | `POST /shop-orders/prepare` | `prepare_shop_orders` con al menos un pedido |

Sin dobles recuentos: las herramientas que llaman a la propia API REST (`appApi.ts`) y los procesos de sistema que leen la lista (recordatorio de la compra por WhatsApp, la lectura interna de `POST /shop-orders/prepare`) envían la cabecera `x-mimoia-internal`, que el middleware web ignora; el ejecutor de herramientas los registra con el canal de la conversación. Las herramientas que responden "no encontrado" (`data: null`) no cuentan.

`GET /admin/usage?days=28[&includeInternal=1]` (JWT de admin o el token; `days` 1–180; cuentas admin y suspendidas fuera salvo `includeInternal=1`; días de Europe/Madrid) devuelve solo recuentos:
- `generatedAt`, `windowDays`, `from`, `to`, `includeInternal`, `eventNames[]`, `channels[]`, `dataSince` (primer evento registrado: los días anteriores salen vacíos, no "sin uso").
- `daily[]`: `{ day, activeHouseholds, events { <nombre>: n }, byChannel { web, whatsapp, voice, unknown } }`, un elemento por día, también los días a cero.
- `weekly[]`: `{ week (lunes), isoWeek, partial, activeHouseholds, events }`.
- `funnel[]`, por semana ISO de alta: `{ week, isoWeek, signups, firstMenu, shoppingListViewed, cooked, week2Eligible, activeWeek2 }`. `firstMenu → shoppingListViewed → cooked` son pasos encadenados dentro de los 7 primeros días (día del alta … +6); `cooked` = `cook_mode_started` o `meal_cooked`. `activeWeek2` no está encadenado: algún evento en los días 7–13, sobre `week2Eligible` (altas cuyo día 7 ya ha llegado).
- `totals`: `{ events, byChannel, activeHouseholds, householdsByEvent }` de la ventana. `definitions` repite las reglas.

Conservación: el tick del planificador borra una vez al día los eventos de más de 180 días (`purgeOldUsageEventsIfDue`).

## Constraints

- Queries aggregate in SQL to distinct (household, week|day) pairs and per-week cost sums; the rules above run as pure, unit-tested functions.
- The token is mounted on `GET /admin/metrics`, `GET /admin/usage`, `GET /admin/assistant-reviews/flags` (all in `routes/metrics.ts`; a unit test pins that list), `GET /admin/errors` and `GET /admin/waitlist` only, and those routers are mounted before the catch-all `router.use(authMiddleware)` routers (else token-only calls would be 401'd first).
- Unit tests never write to the database (ledger/activity/usage inserts are skipped under vitest).

## Known limitations

- **Los eventos de uso empiezan cuando se despliega esto.** Sin relleno hacia atrás: el embudo solo conoce las altas registradas desde entonces. El modo cocina de la web («Empezar a cocinar») no llama al servidor, así que `cook_mode_started` solo llega desde Mimo; `meal_cooked` cubre la web. Abrir una pantalla sin llamada a la API (detalle de receta, perfil) no se registra. Las conversaciones de Mimo en la web no se guardan: `mimo_message` las cuenta, pero no hay texto que revisar.
- **History starts at deploy.** No backfill: weeks before `dataSince` under-report cost and resolved weeks (the old per-user advisor counter has no per-call history).
- **WhatsApp template sends are not yet in the ledger.** They are only sent outside the 24 h window when `WHATSAPP_TEMPLATE_NAME` is set (not set in prod today, so the real cost is €0). The fix is one line in `services/whatsapp/outbound.ts` `sendProactive` after `sendTemplate`: `recordCost({ feature: 'whatsapp_template', provider: 'meta_whatsapp', model: 'utility_template', units: { messages: 1 }, userId: link.userId })` (price already in the table; the activity query already excludes this feature).
- Historical `voice_realtime` rows (until 2026-10-09) trusted client-reported minutes (the retired `POST /realtime/:userId/usage`); a crashed tab reported nothing.
- One-off catalog scripts with their own Claude clients (`regenerateRecipes`, `populatePrepRequirements`, `populateRecipeCourses`, `measure-tokens`) are not recorded.
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

- [apps/api/src/routes/metrics.ts](../apps/api/src/routes/metrics.ts) — `GET /admin/metrics`, `GET /admin/usage`, `GET /admin/assistant-reviews/flags`
- [apps/api/src/services/usageEvents.ts](../apps/api/src/services/usageEvents.ts) — `trackEvent`, event catalogue, web middleware `trackUsageRoutes`, `recordSkillUsage`, `purgeOldUsageEventsIfDue`
- [apps/api/src/services/usageReport.ts](../apps/api/src/services/usageReport.ts) — `loadUsageReport` + pure daily/weekly/funnel builders
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
- Recording call sites: `services/advisorBudget.ts`, `services/providers/anthropic.ts`, `services/ingredientMatcherLLM.ts`, `services/llmUnitFallback.ts`, `services/nutrition/usdaTranslator.ts`, `services/stt.ts`, `services/tts.ts`, `services/recipeImageGenerator.ts`, `services/whatsapp/reviewer.ts`, `routes/ingredients.ts`; attribution in `middleware/auth.ts`, `routes/recipes.ts` (photo extraction), `routes/stt.ts` (re-enters it after the audio upload), `routes/whatsapp.ts`; skill activity in `services/assistant/engine.ts`
- Tests: `apps/api/src/tests/businessMetrics.test.ts`, `costPricing.test.ts`, `costLedger.test.ts`, `metricsAuth.test.ts`, `activityEvents.test.ts`, `usageEvents.test.ts`, `usageReport.test.ts`; e2e `apps/web/e2e/first-steps.spec.ts` (the `outcome` body)
