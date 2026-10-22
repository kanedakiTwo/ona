# User Memory

Typed long-term storage of everything the assistant has learned (or the user has told it) about the user. Read on every advisor skill call as a Spanish-language digest; written manually via `/profile/memoria` or inferred by the assistant via the `update_memory` skill.

> **Ficha del hogar (PRO-150, PRO-316):** the ficha is the one source of what we know about a person (D-064, D-110). Every write and delete here also writes the household's ficha, in the same transaction, with its origin, where it was said and its history row — see [Ficha del hogar](./household-profile.md). `user_memories` stays as the ficha's mirror while the menu generator reads it; since PRO-253 Mimo reads the household's ficha too, after this digest (see [Ficha del hogar → Who reads the ficha](./household-profile.md)).

## User Capabilities

- Users can **personalize Mimoia's nutritional philosophy** at `/profile/creencias` (each own principle is removed from its row's "···" sheet → "Eliminar principio"). The page ("Tu filosofía, no la de Mimoia") lists the 5 default principles ("Principios por defecto de Mimoia", read-only, informational; `ONA_PRINCIPLES` — since 2026-10-11 «Equilibrio en la cocina de la semana» replaces the old anti-inflammation one, PRO-09, and since 2026-10-13 «Comida de verdad, poco ultraprocesado» replaces the one about glucose and «resistencia insulínica», PRO-67; none mentions inflammation, insulin, glucose or diseases, guarded by `tests/weekBalance.test.ts` and `tests/principiosMimo.test.ts`) and a user-controlled list of custom principles. Each custom principle is a short Spanish sentence (3-280 chars). The advisor's system prompt carries them with an explicit override flag — "RESPÉTALOS aunque entren en conflicto con tus principios de cocina por defecto" — so a "creo en el ayuno intermitente" beats any Mimoia default that suggests otherwise. Add via the page or via voice ("recuerda que sigo dieta cetogénica") through the `update_memory` skill
- Users can run a **voice onboarding** at `/onboarding/voz` — a guided spoken conversation with Mimo that walks through every memory key in order (edad, hogar, restricciones, gustos, equipo, tiempo disponible, presupuesto, cocinas preferidas, nivel, horarios, notas libres). It is the same loop as Mimo's voice (D-023): record (waits up to 15 s for an answer) → `POST /stt` → `POST /assistant/:userId/chat` with `mode: 'onboarding'` → read aloud (`POST /tts`, browser voice as fallback) → listen again. The assistant calls `update_memory` after each answer; a progress checklist shows what's been captured. If nobody answers, the loop pauses until the user taps again. When the assistant says the closing line "Listo, ya te conozco." the page redirects to `/menu` after ~1.5 s. Users who prefer typing can edit `/profile/memoria` by hand
- Users can see every fact the assistant remembers about them at `/profile/memoria` — **«Editar mis datos uno a uno»** since PRO-318: Perfil no longer has a «Memoria» card; «Tu ficha» (`/profile/ficha`, [Ficha del hogar](./household-profile.md)) shows the same facts with the rest of the household's, and links here, discreetly, from the reader's own part for the typed editors it doesn't have yet (the page and its route stay as they were) — grouped by category (Perfil físico, Hogar, Restricciones y gustos, Cocina, Rutina, Otras notas), with a source badge per row (**Tú** ink para datos manuales, **Asistente** terracota para inferidos, **Onboarding** neutral). Each stored fact has a "···" sheet with "Editar <dato>" (inline editor in the row) and "Olvidar <dato>" (with a confirm); empty keys (and empty lists) show "Añadir". In list editors (restricciones, disgustos, equipo, notas, creencias, hábitos) «Guardar» also keeps the text still typed in the box, so an entry isn't lost when the user skips the «+» (e2e `profile-memory-save-draft.spec.ts`)
- Users can ask the assistant to remember any preference mid-conversation: "recuerda que no me gusta el cilantro", "tengo freidora de aire", "los lunes no cocino más de 20 minutos", "preferimos cocina mediterránea". The advisor calls the `update_memory` skill and persists the fact with `source: 'inferred'` and confidence 0.8 (or 1.0 if the user is emphatic — "APUNTA…")
- Users can delete any single fact from the memory page with a confirm dialog (full inline edit lands in the next PR; in the meantime the user can ask the assistant to overwrite a value)
- **«Afina tu menú»** (PRO-146, [taste.md](./taste.md)) writes here too: an ingredient picked in «¿Qué es lo que no?» → `dislikes`; the free text «¿Es otra cosa? Cuéntamelo» is read like `update_memory` (Claude Haiku, plain rules without it): «no tengo horno» → `equipment` without it (the usual kit minus it when there was no list), home habits → `prep_habits`, the rest → `notes`. Confidence 1, a `manual` fact keeps its source. `/profile/memoria` also lists every rated recipe («Afina tu menú» section) to change or forget
- The assistant injects the memory into every system prompt — so a request like "recomiéndame algo para cenar" automatically filters out recipes whose ingredients hit the user's `dislikes` or `restrictions`, and prefers recipes that fit the user's `equipment` and `time_available` for that weekday

## Schema

`user_memories` table — one row per `(user_id, key)`:

- `id` uuid pk
- `user_id` uuid FK users (cascade on delete)
- `key` text — one of `MEMORY_KEYS` (see registry below). Unique with `user_id`
- `value` jsonb — validated against the per-key Zod schema in `@ona/shared`
- `source` text enum `'onboarding' | 'manual' | 'inferred'`
- `confidence` real 0..1 — onboarding/manual default 1.0; inferred default 0.8
- `created_at`, `updated_at` timestamptz

## Key registry

Stable forever — never rename, only add. Adding a key is a one-line change in `packages/shared/src/types/userMemory.ts` plus a Zod schema entry. The registry today:

| Key | Value shape | Notes |
|---|---|---|
| `physical.sex` | `'male'\|'female'\|'other'` | |
| `physical.age` | int 2..120 | |
| `physical.height_cm` | int 50..250 | |
| `physical.weight_kg` | number 15..300 | |
| `physical.activity_level` | `'none'\|'light'\|'moderate'\|'high'` | |
| `household.adults` | int 1..20 | mirrors `users.adults` both ways (see Constraints) |
| `household.kids_2_to_10` | int 0..20 | mirrors `users.kids_2_to_10` both ways (see Constraints) |
| `restrictions` | `string[]` | non-empty strings; e.g. `['sin gluten', 'sin lactosa']` |
| `dislikes` | `string[]` | e.g. `['cilantro', 'hígado']` |
| `equipment` | `string[]` | e.g. `['horno', 'freidora de aire', 'olla express']` |
| `time_available` | `{ [weekday-spanish]: minutes 0..480 \| { mode: 'total'\|'activo', minutes 0..480 } }` | weekdays: lunes, martes, miercoles, jueves, viernes, sabado, domingo. A number = minutes in total; `activo` = minutes of work (the rest can cook by itself). Missing day / 0 = no limit; `{}` = «Sin prisa» from the onboarding. The memory page shows «lunes: 20 min de trabajo» and the editor keeps each day's mode (PRO-138) |
| `weekly_budget_eur` | number 0..5000 | |
| `cuisine_bias` | `{ [cuisine]: 0..100 }` | slider per cuisine — only values ≥70 surface in the digest |
| `cooking_skill` | `'easy'\|'medium'\|'advanced'` | |
| `meal_times` | `{ [breakfast\|lunch\|snack\|dinner]: 'HH:MM' }` | 24h regex-enforced |
| `notes` | `string[]` | free-form facts ("mi hija no come pescado") |
| `nutrition_principles` | `string[]` (3..280 chars each) | user-authored beliefs that override Mimoia's defaults. e.g. `['Ayuno intermitente 16/8', 'Sin azúcar refinado']`. The digest tags them as "RESPÉTALOS aunque entren en conflicto con tus principios de cocina por defecto" so the model doesn't try to correct the user against their own beliefs |
| `prep_habits` | `string[]` (3..280 chars each) | recurring prep-time habits. e.g. `['Siempre congelo el pescado', 'Pongo las legumbres en remojo la noche antes', 'Saco la carne 30 min antes para que tempere']`. The notification scheduler (see [Notifications](./notifications.md)) reads this together with `ingredients.prep_requirements` to decide when to fire a heads-up push ("saca los boquerones del congelador en 2 días"). The advisor's `update_memory` skill writes here whenever it picks up a habit in conversation. **The sign-up asks it once** (PRO-221): «¿Congeláis la carne o el pescado cuando compráis?» — «Sí, casi siempre» saves «Congelo la carne y el pescado», «A veces» saves «A veces congelo la carne y el pescado» (the thaw alert then says «Si lo tienes congelado, sácalo hoy.»), «No» saves nothing (source `onboarding`, other habits kept). `/profile/memoria` shows the same question under the groups (`memory-freeze`): a tap replaces every freezing habit with the answer's sentence («No» removes them), so the alert does what it shows; Mimo changes it with `update_memory`. Known limitation: a change applies to the alerts of menus generated afterwards (alerts already queued for this week stay) |
| `region` | ISO 3166-2:ES code of the comunidad autónoma (`AN`, `AR`, `AS`, `IB`, `CN`, `CB`, `CM`, `CL`, `CT`, `EX`, `GA`, `MD`, `MC`, `NC`, `PV`, `RI`, `VC`, `CE`, `ML`) | PRO-226: its national and regional holidays count as weekend in the menu (see [Menus → Festivos](./menus.md)). The memory page shows the name («Comunidad de Madrid») with a picker under «Hogar»; the digest says «Comunidad autónoma: …». Household-level in the ficha |

## API

All endpoints require auth.

- `GET /memory` — returns the user's full `UserMemory` blob (missing keys absent, no nulls)
- `PATCH /memory` — two body shapes:
  - `{ key, value, confidence? }` upserts a single fact (source='manual')
  - `{ facts: [{ key, value, confidence? }] }` batch-upserts in a transaction
  - 400 on unknown key, 422 on Zod failure with `{ error, key, reason }`
- `DELETE /memory/:key` — drops one fact, 204 on success

## Advisor integration

`contextLoader.ts` calls `buildMemoryDigest(userId)` after loading the menu + balance and appends the resulting Spanish text to the system prompt's "Datos del usuario:" block. Empty memory contributes nothing (no noise). The digest:

- Composes lines like `Perfil: 35 años, hombre, 178 cm, 76 kg, actividad moderate.`
- Lists dislikes / restrictions / equipment verbatim
- Surfaces only "liked" cuisines (slider ≥ 70) — finite prompt budget
- Flags weekdays with ≤30 min cooking windows
- Carries the long-form `notes` array verbatim

The `update_memory` skill (declared in `assistant/skills.ts`) takes a `facts: Array<{ key, value, confidence?, remove?, replace? }>` payload, merges it with what's stored (`mergeMemoryFacts`: lists are added to without duplicates, `remove` takes items out, `replace: true` rebuilds the list; a fact with `source: manual` is kept unless the user asked for the change, confidence 1) and routes it through `setMemoryBatch` with `source='inferred'`. Until 2026-10-12 a list was replaced whole, so a model that resent it without an old entry deleted it. Validation errors return a Spanish summary the model relays back to the user.

- **Onboarding analysis (PRO-138, first step of PRO-91).** The web onboarding stores its weekday answer as `time_available` (source `onboarding`). Then, in the background, one Claude Opus 5.5 call (`services/onboardingMemoryAnalysis.ts`) reads all the answers and the optional «¿Algo más? Cuéntanos tu caso» text and writes what it finds through the same rules as `update_memory` (`mergeMemoryFacts` + `setMemoryBatch`, source `inferred` → label «Asistente»): days with another limit (merged over the onboarding answer), meal times, habits, dislikes, equipment, and `notes` for what has no field («Come fuera a mediodía entre semana»). Never health keys (`physical.*`, `restrictions`); a fact set by hand is kept. Billed to the user in `cost_events` (`onboarding_analysis`). No API key or a model error → nothing written, the onboarding goes on. **Who eats at home (PRO-242, 2026-10-19):** the same call can also change the weekly template's diners (`template_changes`: days, meal, how many people are away), like Mimo's `update_weekly_template`: «a mediodía mi hijo come en el instituto entre semana» in a household of 2 → Monday–Friday lunch with 1 diner, the rest unchanged (without a numeric plantilla it is seeded from the default — lunch + dinner every day at `householdToDiners` — so no meal is switched off; never below 0). The first `POST /menu/generate` after the sign-up **waits for the analysis at most 15 s** (`awaitOnboardingAnalysis`, `FIRST_MENU_WAIT_MS`; in-process registry, so a restart in between just doesn't wait) and, if it takes longer, generates as before. Tests: `onboardingMemoryAnalysis.test.ts` (model simulated)

## Constraints

- **Household counts, both ways** (2026-10-22: a tester told Mimo about her kids and /profile still said «0 niños»). Writing `household.adults` / `household.kids_2_to_10` (Mimo's `update_memory`, `PATCH /memory`, an edit in «Tu ficha») also sets `users.adults` / `users.kidsCount` in the same transaction (`syncHouseholdCounts`) — the counts the profile, the shopping list and the menu read. The other way, `PUT /user/:id` with `adults`/`kidsCount` and Mimo's `update_household` refresh those memory keys when the user has them (`alignHouseholdMemory`), so Mimo doesn't read the old count. /profile hydrates the counts from `GET /user/:id`, not from the copy kept in the browser.

- **Health keys need consent** (PRO-21): `physical.*` and `restrictions` are written only while the user's health-data consent is in force (`HEALTH_MEMORY_KEYS`, `isHealthMemoryKey` in `@ona/shared`). Otherwise `setMemoryFact`/`setMemoryBatch` throw `HealthConsentRequiredError` → `PATCH /memory` 403 `HEALTH_CONSENT_REQUIRED`, `update_memory` replies with the profile link. Withdrawing the consent deletes those rows (and the ficha’s copies, [Ficha del hogar](./household-profile.md)). See [Privacy](./privacy.md)
- The `user_memories` table is **truth**. `users.adults` / `users.kids_2_to_10` are still written for legacy reads, but new code reading the household composition should prefer the memory entries (PR 3 will deprecate the mirror)
- Inferred facts default to confidence 0.8. The `update_memory` skill writes 1.0 only when the user explicitly asks ("APUNTA", "GUÁRDATE", "no se te olvide")
- Manual writes (PATCH /memory) always set source='manual' and confidence 1.0 — they can override a previous inferred guess
- The digest sits at the bottom of the system prompt for prompt-cache locality — only changes when memory changes, so the upstream system text stays cache-hot
- Prompt budget: a maximally populated memory digest stays under ~500 tokens (contract test in `userMemoryContract.test.ts`)

## Related specs

- [Ficha del hogar](./household-profile.md) — the household profile these facts are copied into (PRO-150)
- [Advisor](./advisor.md) — the assistant integration point that reads memory at every skill call
- [Auth](./auth.md) — `users.adults` / `users.kids_2_to_10` are mirrored here for backward compat
- [Afina tu menú](./taste.md) — recipe verdicts and «¿Qué es lo que no?» writes to `dislikes` / `equipment` / `prep_habits` / `notes`
- [Menus](./menus.md) — future PR will pipe `dislikes` + `equipment` + `time_available` into the matcher's predicates

## Source

- [packages/shared/src/types/freezeHabit.ts](../packages/shared/src/types/freezeHabit.ts) — the freezing question, its sentences in `prep_habits`, when the thaw alert is conditional (PRO-221)
- [apps/web/src/components/profile/FreezeHabitQuestion.tsx](../apps/web/src/components/profile/FreezeHabitQuestion.tsx) — the question in «Lo que recuerdo de ti»
- Tests: `apps/api/src/tests/freezeHabit.test.ts`, `apps/api/src/tests/freezeHabit.smoke.ts` (Sí / No / A veces against a menu with merluza), `apps/web/e2e/onboarding-freeze.spec.ts`

- [packages/shared/src/types/userMemory.ts](../packages/shared/src/types/userMemory.ts) — key registry + per-key Zod schemas + digest builder
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `user_memories` table
- [apps/api/src/services/onboardingMemoryAnalysis.ts](../apps/api/src/services/onboardingMemoryAnalysis.ts) — the onboarding answers read into the memory (PRO-138) and the weekly template's diners, awaited by the first menu (PRO-242)
- [apps/api/src/services/userMemoryStore.ts](../apps/api/src/services/userMemoryStore.ts) — get / set / batch / delete + digest
- [apps/api/src/routes/memory.ts](../apps/api/src/routes/memory.ts) — REST surface
- [apps/api/src/services/assistant/contextLoader.ts](../apps/api/src/services/assistant/contextLoader.ts) — injection point
- [apps/api/src/services/assistant/skills.ts](../apps/api/src/services/assistant/skills.ts) — `update_memory` skill (look for `updateMemory`)
- [apps/api/src/tests/userMemoryContract.test.ts](../apps/api/src/tests/userMemoryContract.test.ts) — 19 contract tests
- [apps/web/src/hooks/useUserMemory.ts](../apps/web/src/hooks/useUserMemory.ts) — TanStack hooks (a write also refreshes «Tu ficha», `["ficha"]`)
- [apps/web/src/app/profile/memoria/page.tsx](../apps/web/src/app/profile/memoria/page.tsx) — «Editar mis datos uno a uno»: the typed editors per key, reached from «Tu ficha» (PRO-318)
- [apps/web/src/app/onboarding/voz/page.tsx](../apps/web/src/app/onboarding/voz/page.tsx) — voice-onboarding loop (record → `/stt` → chat `mode: 'onboarding'` → `/tts` → listen again); watches replies for the closing line
- [apps/web/src/app/profile/creencias/page.tsx](../apps/web/src/app/profile/creencias/page.tsx) — nutritional-beliefs editor; shows Mimoia defaults + lets the user add custom principles
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts) — `AssistantMode = 'text' | 'voice' | 'onboarding'`; the onboarding branch carries the 12-step conversation script

## Digest wording for dislikes

The digest renders dislikes as "Le disgustan (evitalos al proponer; si el usuario pide algo explicitamente, hazlo): …". They steer what the assistant *proposes*, but never veto an explicit request. In 2026-10, an onboarding-inferred "vacuno" dislike made the assistant refuse "pon filete de vaca el jueves".
