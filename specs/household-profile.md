# Ficha del hogar

Everything Mimoia knows about a household, with a section per person (D-064, PRO-150). It is the base the rest of the «ficha viva» builds on: the daily signal collector (PRO-151), the nightly refiner (PRO-152), «Tu ficha» in the app and Mimo / the menu reading it (PRO-153, PRO-139). **Today only the data model and the copy from `user_memories` exist**: nothing in the app shows the ficha yet, there is no REST route, and Mimo keeps reading [User Memory](./user-memory.md) until PRO-153.

## User Capabilities

- None visible yet. A user's existing memory facts (what they told Mimo, what came from sign-up and what Mimo deduced) are already copied into their household's ficha, with where each one came from, so the ficha starts with what Mimoia knows today

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

  Days are `lunes`…`domingo`; meals `breakfast` · `lunch` · `snack` · `dinner`.
- **People without an account** (`household_persons`): `alias` and `age_band` (`0-2` · `3-5` · `6-12` · `13-17` · `adulto`). **A minor's name is never stored**: the schema has no name field (`.strict()`), and a minor's alias must be one of `MINOR_ALIASES` («la pequeña», «el mayor», «hija»…), optionally with a number («hija 2»). An adult (the grandmother) may have any alias up to 40 characters
- **Portrait** (`household_profiles`): one per household, `portrait` text of at most 250 words (`PORTRAIT_MAX_WORDS`, checked in the Zod schema), `version`, `model`, `generated_at`. No health and no judgements (constitution §6)
- **Pending questions** (`profile_questions`): what the AI suspects but doesn't know («¿seguís sin horno?»), with subject, `fact_type`, `origin`, `status` (`pending` · `asked` · `answered` · `dismissed`), `asked_at`, `resolved_at`
- **History** (`profile_changes`): `action` (`fact_added`, `fact_updated`, `fact_retired`, `portrait_updated`, `person_added`/`updated`/`removed`, `question_added`/`resolved`), `fact_id`, `fact_type`, `before`, `after`, `reason`, `origin`, `actor_user_id`, date

## Constraints

- **Health rules are today's** (PRO-21, LEG-03): health types are the same keys as the memory's (`physical.*`, `restrictions`; `HEALTH_PROFILE_FACT_TYPES`). Writing one needs the health consent and never comes from WhatsApp (`canWriteProfileFact`). A health fact is about a person, never the whole household, and is never deduced by the nightly or weekly refiner (`origin` `ai_nightly`/`ai_weekly` is rejected for health types)
- **Withdrawing the health consent** also deletes that person's health facts in the ficha and their history rows (`services/healthConsent.ts`); deleting the account deletes the facts about that person (cascade)
- **Visibility per fact** (Miguel, 2026-10-16): a health fact about a member with an account is read only by that member; the rest of the ficha by every adult member (`owner`, `member`); `child` members read nothing; the menu generator and Mimo (`{ kind: 'system' }`) read everything so they can respect it. `visibleProfileFacts(facts, viewer)` is the filter the future API must apply
- **Copy from `user_memories`** (`applyProfileFromMemories`, after `db:migrate` on every boot): each memory row → one fact in the user's primary household (else the first one they joined; users with none are skipped and counted). Origin: `manual` → `user`, `onboarding` → `onboarding`, `inferred` → `ai_realtime`; same confidence; one evidence item (`signal: user_memories`). `household.adults`, `household.kids_2_to_10`, `equipment` and `weekly_budget_eur` are about the household; every other key is about the user. Each copy writes a `fact_added` history row. Idempotent: `source_memory_id` is unique and a copied memory is skipped
- Known limitation: a memory written **after** its copy is not re-copied (new memories are). Until PRO-153 `user_memories` is still the source Mimo reads and writes; the ficha copy can go stale for edited keys
- Migration `0057_household_profile` only adds tables

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
- [apps/api/src/tests/profileFromMemories.smoke.ts](../apps/api/src/tests/profileFromMemories.smoke.ts) — copy against Postgres (twice), history, consent withdrawal, cascade
