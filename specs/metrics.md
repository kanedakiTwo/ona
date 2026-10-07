# Business Metrics & Cost Ledger

One JSON endpoint that tells the "Dirección" and Finance agents (and Miguel) how many households use ONA each week, how many "resolve" their week, how they retain, and what each active household really costs in paid AI/messaging providers. Built on an append-only **cost ledger** (one row per paid provider call) and a small **activity log** for shopping-list use.

## Why this exists

ONA is pre-launch and will be run as a one-person company with AI agents. Pricing needs the real cost per active household per week, and the morning brief needs activation/retention numbers. Before this, only per-user counters existed (advisor € budget, image quota, an in-memory voice-minutes cap), none per call, none per household.

## User Capabilities

- An admin (JWT, see [Roles](./roles.md)) or an agent holding the read-only token can call `GET /admin/metrics?weeks=8` and get JSON for the last N ISO weeks (1–52, default 8; Europe/Madrid clock, current week flagged `partial`).
- The token is sent as header `x-metrics-token` and must equal the env var `METRICS_READ_TOKEN` (constant-time compare). It opens this endpoint and the read-only `GET /admin/errors` ([Error tracking](./errors.md)) only — every other `/admin/*` route still needs an admin JWT. With the env var unset, token access is off (always 401 `METRICS_TOKEN_DISABLED`); a wrong token is 401 `METRICS_TOKEN_INVALID`, with no fallback to JWT.
- `includeInternal=1` also counts admin and suspended accounts (useful pre-launch, when almost every user is internal).
- Response:
  - `weekly[]`: `week` (Monday), `isoWeek` (`2026-W41`), `partial`, `activeHouseholds`, `resolvedWeekHouseholds`, `newHouseholds`, `costEur { total, byProvider, byFeature }`, `internalCostEur`, `costPerActiveHouseholdEur`.
  - `cohorts[]`: households by signup week with `size` and `retention { w1..w4 }`.
  - `totals`: distinct `activeHouseholds`, `activeHouseholdWeeks`, `newHouseholds`, `resolvedHouseholdWeeks`, `costEur`, `internalCostEur`, `costPerActiveHouseholdWeekEur`, `costEvents`, `unpricedCostEvents`.
  - `errors`: `{ windowDays: 7, newGroups, activeGroups, openGroups, events }` from the in-house error tracker over the last 7 days (rolling, by `last_seen`; not per ISO week): error groups first seen / seen / seen and unresolved, and Σ `count` of the groups seen (cumulative, so an upper bound of the window's events). Detail per group: `GET /admin/errors` ([errors.md](./errors.md)).
  - `definitions` (the rules below, in plain language) and `dataSince { costLedger, activityLog }` — the first ledger/activity row, so earlier weeks aren't misread as "free" or "unresolved".
- Code that needs a user's spend (e.g. budget limits) calls `getUserMonthlySpendEur(userId, now?)` in `services/costLedger.ts`: estimated EUR billed to that user so far this calendar month (Europe/Madrid), all paid features.

## Definitions

- **Household**: the primary household of at least one counted user. Activity is attributed to the row's own `household_id` when it has one, else to the user's current primary household.
- **Excluded accounts**: `role = admin` and suspended users (current status). Their spend is reported apart as `internalCostEur`. There is no demo-account flag in the schema.
- **Active household (week)**: at least one of — generated a menu, logged a cooked meal, used the shopping list, created a recipe, sent a WhatsApp message to ONA, spoke in voice mode, or triggered a paid AI feature (chat, voice, recipe import/extraction, image). Opening a screen is not tracked. ONA-initiated WhatsApp templates don't count.
- **Resolved week**: the household has a menu whose `week_start` is that week AND used the shopping list (checked an item, toggled in-stock, or added an item — from the web or through the assistant/voice) during that week **or the Saturday/Sunday right before it** (people shop at the weekend for the menu starting Monday; ONA's shopping reminder fires Saturday). Opening the list does not count: the `shopping_lists` row is rewritten on every read, including by the WhatsApp shopping reminder.
- **New household**: created (at registration) that week. **Cohort retention wK**: share of the signup cohort active in week signup+K; `null` until that week starts; the current week is partial.
- **Cost**: ledger cost of counted users plus system jobs (no user, e.g. the daily conversation reviewer). `costPerActiveHouseholdEur` = week cost / active households (`null` with none active); `costPerActiveHouseholdWeekEur` = window cost / Σ weekly active households.

## Cost ledger (`cost_events`)

Every paid provider call writes one row — user (nullable), household (user's primary at record time), feature, provider, model, units (tokens / audio tokens / minutes / messages / images), estimated `cost_micros` (micro-euros; `NULL` when the model isn't priced — counted in `unpricedCostEvents`, never dropped). Recording is fire-and-forget: it never slows or fails the user's request; errors are logged.

| Feature | Provider / model | Billed to |
|---|---|---|
| `assistant_chat` (web chat turn, all tool rounds) | Anthropic Haiku 4.5 | user |
| `whatsapp_chat` | Anthropic Haiku 4.5 | user (WhatsApp turn) |
| `voice_note_transcription` (WhatsApp voice notes) | OpenAI `OPENAI_TRANSCRIBE_MODEL` | user |
| `voice_realtime` (voice mode, client-reported minutes) | OpenAI `OPENAI_REALTIME_MODEL` | user |
| `recipe_extract_photo` (web photo, WhatsApp photo) | Anthropic Sonnet 5.5 | user |
| `recipe_extract_url` (web URL import, `import_recipe_from_url`) | Anthropic Sonnet 5.5 | user |
| `ingredient_match` (extraction disambiguation) | Anthropic Sonnet 5.5 | user |
| `unit_fallback` (odd units → grams/ml) | Anthropic Haiku 4.5 | user |
| `usda_translation` (ingredient auto-create) | Anthropic Haiku 4.5 | user |
| `ingredient_nutrition_estimate` ("Estimar con ONA") | Anthropic Opus 4.6 | user |
| `recipe_image` (regenerate image) | AIKIT Imagen-fal | user (seed script: system) |
| `whatsapp_review` (daily conversation reviewer) | Anthropic Opus 5.5 | system |

Attribution: every authed request runs in a per-request context carrying the user, so deep calls (matcher, unit fallback, translator) are billed without threading ids. Multipart routes (photo extraction) re-enter it after the upload parser. Each WhatsApp inbound turn runs in its own context that the budget check fills in once the phone resolves to a user. Schedulers and scripts have no context → system.

Not costs, so not recorded: WhatsApp free-form ("service") replies inside the 24 h window, the Realtime ephemeral-key mint, USDA / BEDCA lookups, YouTube/article fetches.

## Prices

All rates live in `config/pricing.ts` (source + date in comments), in the provider's currency; USD is converted with `ADVISOR_EUR_PER_USD` (the same knob the advisor budget uses, default 0.92). The advisor's € budget prices Haiku from the same table, so budget and ledger never disagree. `COST_PRICE_OVERRIDES` (JSON, e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`) corrects or adds a price without a code change; malformed values are ignored with a warning.

Marked UNVERIFIED (estimates, override when known): Realtime voice blended **$0.10 / session-minute** (token rates verified; the per-minute blend is derived), WhatsApp Spain utility template **€0.0166** (matches third-party rate cards; Meta's official CSV not checked) and marketing **€0.0585**, AIKIT image **$0.04**.

## Activity log (`activity_events`)

Append-only `(user, household, kind, created_at)` for actions no other table timestamps durably: `shopping_check`, `shopping_stock`, `shopping_add`. Written by an app-level middleware when the matching shopping-list route answers 2xx, and by the assistant/voice tool runners when `check_shopping_item` / `mark_in_stock` succeed. Never blocks the request.

## Constraints

- Queries aggregate in SQL to distinct (household, week|day) pairs and per-week cost sums; the rules above run as pure, unit-tested functions.
- The token is mounted on `GET /admin/metrics` and `GET /admin/errors` only, and both routers are mounted before the catch-all `router.use(authMiddleware)` routers (else token-only calls would be 401'd first).
- Unit tests never write to the database (ledger/activity inserts are skipped under vitest).

## Known limitations

- **History starts at deploy.** No backfill: weeks before `dataSince` under-report cost and resolved weeks (the old per-user advisor counter has no per-call history).
- **WhatsApp template sends are not yet in the ledger.** They are only sent outside the 24 h window when `WHATSAPP_TEMPLATE_NAME` is set (not set in prod today, so the real cost is €0). The fix is one line in `services/whatsapp/outbound.ts` `sendProactive` after `sendTemplate`: `recordCost({ feature: 'whatsapp_template', provider: 'meta_whatsapp', model: 'utility_template', units: { messages: 1 }, userId: link.userId })` (price already in the table; the activity query already excludes this feature).
- Realtime voice cost trusts the client-reported minutes (`POST /realtime/:userId/usage`); a crashed tab reports nothing.
- One-off catalog scripts with their own Claude clients (`regenerateRecipes`, `populatePrepRequirements`, `populateRecipeCourses`, `measure-tokens`) are not recorded.
- Households are resolved through the user's *current* primary household; a user who switches household moves their past activity with them.

## Related specs

- [Advisor](./advisor.md) — per-user monthly € budget (`checkAdvisorBudget` / `recordAdvisorUsage` also feed the ledger)
- [WhatsApp](./whatsapp.md) — chat, voice notes, photos, reviewer, templates
- [Voice Mode](./voice-mode.md) — realtime sessions and the minutes report
- [Shopping](./shopping.md) — the list whose use defines a resolved week
- [Error tracking](./errors.md) — the `errors` block and `GET /admin/errors`
- [Admin Dashboard](./admin-dashboard.md) · [Roles](./roles.md)

## Source

- [apps/api/src/routes/metrics.ts](../apps/api/src/routes/metrics.ts) — `GET /admin/metrics`
- [apps/api/src/middleware/metricsAuth.ts](../apps/api/src/middleware/metricsAuth.ts) — admin JWT or `x-metrics-token`
- [apps/api/src/services/businessMetrics.ts](../apps/api/src/services/businessMetrics.ts) — SQL loader + pure week/cohort/cost rules + `DEFINITIONS`
- [apps/api/src/services/appErrors.ts](../apps/api/src/services/appErrors.ts) — `loadErrorSummary` (the `errors` block)
- [apps/api/src/services/costLedger.ts](../apps/api/src/services/costLedger.ts) — `recordCost`, attribution context, `getUserMonthlySpendEur`
- [apps/api/src/config/pricing.ts](../apps/api/src/config/pricing.ts) — price table + `COST_PRICE_OVERRIDES`
- [apps/api/src/services/activityEvents.ts](../apps/api/src/services/activityEvents.ts) — shopping-use log + middleware
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`costEvents`, `activityEvents`), [apps/api/src/db/migrations/0033_cost_ledger.sql](../apps/api/src/db/migrations/0033_cost_ledger.sql)
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `METRICS_READ_TOKEN`, `COST_PRICE_OVERRIDES`, `ADVISOR_EUR_PER_USD`
- Recording call sites: `services/advisorBudget.ts`, `services/providers/anthropic.ts`, `services/ingredientMatcherLLM.ts`, `services/llmUnitFallback.ts`, `services/nutrition/usdaTranslator.ts`, `services/stt.ts`, `services/recipeImageGenerator.ts`, `services/whatsapp/reviewer.ts`, `routes/ingredients.ts`, `routes/realtime.ts`; attribution in `middleware/auth.ts`, `routes/recipes.ts` (photo extraction), `routes/whatsapp.ts`; skill activity in `services/assistant/engine.ts`, `services/realtime/tools.ts`
- Tests: `apps/api/src/tests/businessMetrics.test.ts`, `costPricing.test.ts`, `costLedger.test.ts`, `metricsAuth.test.ts`, `activityEvents.test.ts`
