# Ficha del hogar

Everything Mimoia knows about a household, with a section per person (D-064, PRO-150). It is the base the rest of the «ficha viva» builds on: the daily signal collector (PRO-151), the nightly refiner (PRO-152), «Tu ficha» in the app and Mimo / the menu reading it (PRO-153, PRO-139). **Today the data model, the copy from `user_memories`, the daily signal collector (PRO-151) and the nightly refiner (PRO-152) exist, in the shadow**: the refiner writes the ficha and its history every night, but nothing in the app shows it yet, and Mimo and the menu keep reading [User Memory](./user-memory.md) until PRO-153 / PRO-139. The one exception is **how the household cooks** (PRO-217, below): asked in the sign-up, shown and changed in Perfil and by Mimo.

## User Capabilities

- **«¿Cómo cocináis en casa?»** (PRO-217, D-069): «Cocino cada día» · «Cocino unos días y aprovecho para otros» · «Batch cooking: cocino una o dos veces y dejo hecha la semana» · «Improviso: decido cada día». Asked in the web sign-up right after how often they cook ([Auth](./auth.md)); on `/profile` the card «Cómo cocináis» (`profile-cooking-style`) shows the answer (or «Sin contestar») and changes it with one tap, no «Guardar cambios»; Mimo changes it when the household says so («ahora hacemos batch los domingos», tool `set_cooking_style`, web chat, voice and WhatsApp) and reads it in its context. Only collected and shown: the menu uses it with PRO-219
- Nothing else of the ficha is visible yet. Every night, a household that used Mimoia that day gets its ficha refined from what happened (see «Nightly refiner»), but nobody reads it yet
- A user's existing memory facts (what they told Mimo, what came from sign-up and what Mimo deduced) are already copied into their household's ficha, with where each one came from, so the ficha starts with what Mimoia knows today

## Model

One ficha per **household** (the menu is the household's), with facts about the household as a whole, about a member with an account, or about a person without one.

- **Facts** (`profile_facts`): household, subject (none = the household; `subject_user_id` = a member; `subject_person_id` = a person without an account; never both), `type`, `value` (jsonb, validated per type), `origin` (`user` · `onboarding` · `ai_realtime` · `ai_nightly` · `ai_weekly`), `confidence` 0–1, `evidence` `[{ signal, date AAAA-MM-DD, summary }]`, `valid_until` (temporary situations), `status` (`active` · `retired`), `source_memory_id` (the `user_memories` row it was copied from)
- **Fact types**: every `user_memories` key, with the same value schema (`MEMORY_VALUE_SCHEMAS`), plus:

| Type | Value | Example |
|---|---|---|
| `fixed_dish` | `{ dish, days?, meal? }` | pizza los viernes por la noche |
| `skipped_meal` | `{ days, meal, reason? }` | el fin de semana no se cocina |
| `dish_frequency` | `{ dish, minWeeks, maxWeeks }` (1–52, min ≤ max) | coliflor gratinada cada 6–10 semanas |
| `affinity` | `{ kind: ingredient\|style, target, score −2..+2 }` | le encanta la cuchara (+2) |
| `effort` | `{ days, meal, activeMinutes, totalMinutes }` (active ≤ total) | entre semana, 15 min de trabajo aunque cueza 3 h |
| `temporary_situation` | `{ description }` + the fact's `valid_until` | sin horno hasta el 2-nov |
| `shopping` | `{ places?, days?, note? }` | frutería del barrio los sábados |
| `batch_cooking` | `{ batches, days?, lunchboxes? }` | cocina por tandas el domingo, con táperes |
| `novelty` | `{ score −2..+2 }` | prefiere la rutina (−2) |
| `cooking_style` | `{ style: daily\|cook_and_reuse\|batch\|improvise }` | «Batch cooking: cocino una o dos veces y dejo hecha la semana» (PRO-217) |

  Days are `lunes`…`domingo`; meals `breakfast` · `lunch` · `snack` · `dinner`.
- **People without an account** (`household_persons`): `alias` and `age_band` (`0-2` · `3-5` · `6-12` · `13-17` · `adulto`). **A minor's name is never stored**: the schema has no name field (`.strict()`), and a minor's alias must be one of `MINOR_ALIASES` («la pequeña», «el mayor», «hija»…), optionally with a number («hija 2»). An adult (the grandmother) may have any alias up to 40 characters
- **Portrait** (`household_profiles`): one per household, `portrait` text of at most 250 words (`PORTRAIT_MAX_WORDS`, checked in the Zod schema), `version`, `model`, `generated_at`. No health and no judgements (constitution §6)
- **Pending questions** (`profile_questions`): what the AI suspects but doesn't know («¿seguís sin horno?»), with subject, `fact_type`, `origin`, `status` (`pending` · `asked` · `answered` · `dismissed`), `asked_at`, `resolved_at`
- **History** (`profile_changes`): `action` (`fact_added`, `fact_updated`, `fact_retired`, `portrait_updated`, `person_added`/`updated`/`removed`, `question_added`/`resolved`), `fact_id`, `fact_type`, `before`, `after`, `reason`, `origin`, `actor_user_id`, date

## Constraints

- **Health rules are today's** (PRO-21, LEG-03): health types are the same keys as the memory's (`physical.*`, `restrictions`; `HEALTH_PROFILE_FACT_TYPES`). Writing one needs the health consent and never comes from WhatsApp (`canWriteProfileFact`). A health fact is about a person, never the whole household, and is never deduced by the nightly or weekly refiner (`origin` `ai_nightly`/`ai_weekly` is rejected for health types)
- **Withdrawing the health consent** also deletes that person's health facts in the ficha and their history rows (`services/healthConsent.ts`); deleting the account deletes the facts about that person (cascade)
- **Visibility per fact** (Miguel, 2026-10-16): a health fact about a member with an account is read only by that member; the rest of the ficha by every adult member (`owner`, `member`); `child` members read nothing; the menu generator and Mimo (`{ kind: 'system' }`) read everything so they can respect it. `visibleProfileFacts(facts, viewer)` is the filter the future API must apply
- **Copy from `user_memories`** (`applyProfileFromMemories`, after `db:migrate` on every boot): each memory row → one fact in the user's primary household (else the first one they joined; users with none are skipped and counted). Origin: `manual` → `user`, `onboarding` → `onboarding`, `inferred` → `ai_realtime`; same confidence; one evidence item (`signal: user_memories`). `household.adults`, `household.kids_2_to_10`, `equipment`, `weekly_budget_eur` and `region` (PRO-226) are about the household; every other key is about the user. Each copy writes a `fact_added` history row. Idempotent: `source_memory_id` is unique and a copied memory is skipped
- Known limitation: a memory written **after** its copy is not re-copied (new memories are). Until PRO-153 `user_memories` is still the source Mimo reads and writes; the ficha copy can go stale for edited keys
- Migration `0057_household_profile` only adds tables
- **How the household cooks** (PRO-217, `services/profile/cookingStyle.ts`): one `cooking_style` fact about the household (no subject), single-valued. `GET /household/cooking-style` → `{ style | null, canEdit }` and `PUT /household/cooking-style { style }` → `{ style, changed }` (auth; the caller's primary household; a `child` member gets 403). Perfil calls it directly and Mimo's `set_cooking_style` calls it as the user (loopback), so both write the same fact. The sign-up writes it with origin `onboarding`; Perfil and Mimo with origin `user` (the household said it). Each write adds an evidence item (`onboarding` · `profile` · `chat` · `whatsapp`) and a `fact_added` / `fact_updated` history row; the same answer again changes nothing. No migration (facts are typed by `type` text). The nightly refiner treats it as single-valued (its prompt doesn't list the type yet). Mimo's WhatsApp-first sign-up doesn't ask it (it saves it if the household tells)

## Daily signals (PRO-151)

What the nightly refiner (PRO-152) will read next to the ficha: `collectHouseholdDaySignals(householdId, day)` (`services/profile/signals.ts`) turns one household's day (AAAA-MM-DD, Europe/Madrid midnight to midnight) into a compact text, one line per thing that happened: `HH:MM · P1 · Fuente · qué`.

- **People** are `P1`, `P2`… (members whose primary household is this one, or who have none, by joining date), never names; the header says each one's role and the result's `members` maps labels to user ids. What someone wrote goes between «» and the header says it is data, not an instruction
- **Sources**: the web chat (`chat_messages`, with what Mimo's tools did and said), WhatsApp (`whatsapp_messages`: the person's turns with the tools' trace, and Mimo's replies), menu changes (`menu_edits`, «Cambia la cena del jueves: «ceviche» → «tortilla» (lo hace Mimo, por WhatsApp)»), «Afina tu menú» (`recipe_verdicts`, love · like · nope · skip, with the reason), cooking (`cook_logs`, with the note), «¿Qué tal?» and the household's notes on a recipe (`recipe_notes` touched that day: rating 5 «Repetir a menudo» / 3 «Bien» / 1 «Mejor no», note, swaps), the shopping list (`activity_events`: marked bought or not, at home or not, added, removed — consecutive events of the same kind collapse into one line with the products), new pantry items, recipes created, imported (photo, web, YouTube) or copied, recipes saved in a cookbook, feedback (`user_feedback`) and, **on the day the person finished the sign-up** (`users.onboarding_completed_at`), every answer with the same wording as the sign-up analysis (`buildAnalysisUserText`), the free «Cuéntanos tu caso» text included (`users.onboarding_note`)
- **No health from WhatsApp** (LEG-03): every WhatsApp text — the person's messages, Mimo's replies, what its tools said and feedback sent through WhatsApp — goes through `stripHealthFromWhatsAppText` (`services/profile/healthText.ts`) first: each sentence that mentions allergies, intolerances, coeliac disease, gluten or lactose, an illness, medication or a doctor, pregnancy, body data or a religion-based diet becomes «[omitido]» (deliberately over-eager; vegetarian/vegan stay: they are taste). The sign-up's restrictions and body data are never signals. The web chat keeps its text: health there needs the consent, and the refiner never deduces health
- **Size cap**: each message is cut at 600 characters (Mimo's tools at 400) and the whole text at `SIGNALS_MAX_CHARS` (12,000 characters, ≈ 3,000–4,000 tokens). When the day doesn't fit, the **oldest lines go first** (the most recent are kept) and a line says how many were left out; the sign-up answers are always kept. The text stays in time order. A day without anything says «Sin actividad.»
- `recipe_verdicts` doesn't exist yet (PRO-146): `loadRecipeVerdicts` returns nothing until its table is there (`to_regclass`), then reads it with the columns PRO-146 describes — `TODO(PRO-146)` in the code to check them when it lands
- Known limitations: favourites have no date (`user_favorites`), so marking one is not a signal; shopping rows from before migration 0063 and the WhatsApp/voice skills other than «marcar» and «en casa» carry no product name; the sign-up answers of accounts that finished it before 0063 have no date, so they never come in as a day's signals (they are already in the ficha through `user_memories`)
- Migration `0063_activity_item_onboarding_note` adds `activity_events.item` / `toggled_on` and `users.onboarding_completed_at` / `onboarding_note` (only adds columns)

## Nightly refiner (PRO-152)

`services/profile/refiner.ts`, from the scheduler tick (`notificationScheduler`, like the conversation reviewer). **In the shadow**: it writes `profile_facts`, `household_profiles`, `profile_questions` and `profile_changes` (origin `ai_nightly`); nothing reads them yet.

- **When**: from 03:00 Madrid (`REFINER_HOUR`), once per day, for the day that just ended (`profile_refiner_runs`, unique per day and kind; claimed before calling Anthropic so a second tick or process never sends it twice). Results are collected on the following ticks (every 5 min) once the batch has ended. Without `ANTHROPIC_API_KEY` it doesn't run
- **Which households**: with activity that day (`collectHouseholdDaySignals` returns at least one signal) **and** with an active plan, in trial (`trialing`, `active`) or **in the beta** (before `LAUNCH_DATE`) — never a `paused` subscription nor a suspended owner — **and** whose owner is under the monthly AI cap (`spendCapStatus`, `USER_MONTHLY_SPEND_CAP_EUR`; if used up, the ficha waits). Plan, pause and cap are checked before reading the day. The run records how many were left out and why (`skipped`: `no_activity`, `paused`, `not_subscribed`, `suspended`, `spend_cap`, `no_members`)
- **The call**: one request per household in one **Message Batch** (Anthropic Batches API, half price, results within 24 h): Claude Sonnet 5.5 (`REFINER_MODEL`) with adaptive thinking at effort `medium`, `max_tokens` 16 000, the rules as a cached system prompt, and as user text the ficha between `<ficha>` and the day's signals between `<senales>`. The model sees short references only — facts `F1…`, members `P1…` (as in the signals), people without an account `X1…` — and the household row of the run stores what each reference meant (`profile_refinements.refs`), so the answer is read against the ficha as it was sent
- **The answer** is a closed JSON format (structured outputs, `REFINER_OUTPUT_SCHEMA`, checked again with Zod) with **only changes**: facts to `add` / `update` / `retire` (subject, type, value as JSON, confidence, evidence, valid until, reason, and a question in case it contradicts the user), a new portrait (or empty) and pending questions. A refusal, a cut answer or a broken format writes nothing
- **Rules in code** (`planRefinement`, never trusting the model):
  - **No deduced health**: a change on a health type, or whose value, reason, question or evidence mentions health (`HEALTH_TEXT_PATTERNS`: «diabético», «celíaca», «embarazada», «alergia»…), is discarded; the same for the portrait and questions. It is recorded in `profile_refinements.discarded` as `{ reason: 'health', op, type }` only — the content is never stored — and logged
  - **What the user said wins**: an update or retirement of a fact with origin `user` (also an `add` of a single-valued type that already has a user fact for that subject) becomes a pending question (the model's, or «¿Sigue siendo así lo que nos contaste (tipo)?»)
  - **At most 10 changes a night** (`REFINER_MAX_CHANGES`; facts, portrait and questions, in the model's order); the rest is recorded as `over_limit`
  - **Only its own ficha**: unknown references (`unknown_fact`, `unknown_subject`), values that fail the type's schema or lack evidence (`invalid`), no-op updates and repeated questions (`no_change`, `duplicate_question`) are discarded and recorded. A second fact of a single-valued type (every memory key, `shopping`, `batch_cooking`, `novelty`) becomes an update of the first; `fixed_dish`, `skipped_meal`, `dish_frequency`, `affinity`, `effort` and `temporary_situation` may have several
  - What people wrote is data between marks; the prompt says so, and the rules above hold whatever the text asks
- **Writing**: one transaction per household; each change adds a `profile_changes` row (`fact_added` / `fact_updated` with before and after / `fact_retired` / `question_added` / `portrait_updated`). An updated fact takes origin `ai_nightly` and keeps its earlier evidence (last 20). Valid-until dates are the end of that Madrid day. The portrait row's `version` goes up by one
- **Cost**: each succeeded result goes to `cost_events` with feature `ficha`, the household explicit and the owner as user (so it counts for their monthly cap), at **half** the Sonnet 5.5 list price (`BATCH_PRICE_FACTOR`, applied in the service: `config/pricing.ts` has no batch rate)
- **Records**: `profile_refiner_runs` (day, batch id, status `empty` · `submitted` · `ended` · `failed`, how many were sent and left out) and `profile_refinements` (per household: `pending` · `applied` · `failed`, changes written, discarded, error). Migration `0064_profile_refiner` (only adds tables)
- Known limitations: only the nightly run exists — the real-time run (sign-up, «Afina tu menú») and the weekly consolidation are still to build; nobody reads the ficha (PRO-153, PRO-139); there is no undo yet (the history has before/after for it); the batch is not cancelled if a household is deleted meanwhile (its row cascades and the result is ignored)

## Related specs

- [User Memory](./user-memory.md) — the per-user facts copied into the ficha
- [Household](./household.md) — the household and its members (roles)
- [Privacy](./privacy.md) — health-data consent and what withdrawing deletes

## Source

- [packages/shared/src/types/householdProfile.ts](../packages/shared/src/types/householdProfile.ts) — types, Zod schemas, minors' aliases, health and visibility rules, memory → fact mapping constants
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `household_persons`, `profile_facts`, `household_profiles`, `profile_questions`, `profile_changes`
- [apps/api/src/db/migrations/0057_household_profile.sql](../apps/api/src/db/migrations/0057_household_profile.sql)
- [apps/api/src/services/profileFromMemories.ts](../apps/api/src/services/profileFromMemories.ts) — idempotent copy from `user_memories`, run from `db/migrate.ts`
- [apps/api/src/services/healthConsent.ts](../apps/api/src/services/healthConsent.ts) — withdrawal deletes health facts
- [apps/api/src/tests/householdProfile.test.ts](../apps/api/src/tests/householdProfile.test.ts) — schema, minors, health, visibility, mapping
- [packages/shared/src/types/cookingStyle.ts](../packages/shared/src/types/cookingStyle.ts) — the question, the four answers, the route path (PRO-217)
- [apps/api/src/services/profile/cookingStyle.ts](../apps/api/src/services/profile/cookingStyle.ts) — read and write the `cooking_style` fact with its history
- [apps/api/src/routes/householdHabits.ts](../apps/api/src/routes/householdHabits.ts) — `GET`/`PUT /household/cooking-style`
- [apps/api/src/services/assistant/householdHabitsSkills.ts](../apps/api/src/services/assistant/householdHabitsSkills.ts) — Mimo's `set_cooking_style`
- [apps/web/src/components/profile/CookingStyleCard.tsx](../apps/web/src/components/profile/CookingStyleCard.tsx) — «Cómo cocináis» on `/profile` (`hooks/useCookingStyle.ts`)
- [apps/api/src/tests/cookingStyle.test.ts](../apps/api/src/tests/cookingStyle.test.ts), [apps/api/src/tests/cookingStyleRoute.smoke.ts](../apps/api/src/tests/cookingStyleRoute.smoke.ts) — answers, schemas, Mimo and Perfil through the same route; sign-up, Perfil and Mimo on the same fact against Postgres
- [apps/web/e2e/onboarding-cooking-style.spec.ts](../apps/web/e2e/onboarding-cooking-style.spec.ts) — the sign-up question and the Perfil card at 390×844
- [apps/api/src/tests/profileFromMemories.smoke.ts](../apps/api/src/tests/profileFromMemories.smoke.ts) — copy against Postgres (twice), history, consent withdrawal, cascade
- [apps/api/src/services/profile/signals.ts](../apps/api/src/services/profile/signals.ts) — daily signals: builders per source, formatter with the size cap, Postgres loader
- [apps/api/src/services/profile/healthText.ts](../apps/api/src/services/profile/healthText.ts) — health sentences out of WhatsApp text (`HEALTH_TEXT_PATTERNS`, reused by the refiner)
- [apps/api/src/services/activityEvents.ts](../apps/api/src/services/activityEvents.ts) — shopping events with the product (`setActivityDetail`)
- [apps/api/src/db/migrations/0063_activity_item_onboarding_note.sql](../apps/api/src/db/migrations/0063_activity_item_onboarding_note.sql)
- [apps/api/src/tests/profileSignals.test.ts](../apps/api/src/tests/profileSignals.test.ts) — a synthetic day in order and without WhatsApp health, the size cap, the health filter
- [apps/api/src/tests/profileSignals.smoke.ts](../apps/api/src/tests/profileSignals.smoke.ts) — every source read from Postgres, sign-up note and shopping product names saved by the real routes
- [apps/api/src/services/profile/refiner.ts](../apps/api/src/services/profile/refiner.ts) — nightly refiner: eligibility, prompt and batch request, closed format, rules (`planRefinement`), writing, cost, scheduler entry (`runProfileRefinerIfDue`)
- [apps/api/src/services/notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts) — calls the refiner on every tick
- [apps/api/src/services/costLedger.ts](../apps/api/src/services/costLedger.ts) — `householdId` and `priceFactor` on a cost event
- [apps/api/src/db/migrations/0064_profile_refiner.sql](../apps/api/src/db/migrations/0064_profile_refiner.sql)
- [apps/api/src/tests/profileRefiner.test.ts](../apps/api/src/tests/profileRefiner.test.ts) — simulated model: «sin horno» → fact with evidence, deduced health discarded and recorded, the user's fact becomes a question, more than 10 changes cut, households without activity / paused / over the cap left out, cost at the batch price
- [apps/api/src/tests/profileRefiner.smoke.ts](../apps/api/src/tests/profileRefiner.smoke.ts) — one night end to end against Postgres with a simulated batch
