# User Memory

Typed long-term storage of everything the assistant has learned (or the user has told it) about the user. Read on every advisor skill call as a Spanish-language digest; written manually via `/profile/memoria` or inferred by the assistant via the `update_memory` skill.

## User Capabilities

- Users can **personalize ONA's nutritional philosophy** at `/profile/creencias`. The page lists ONA's 5 default principles (read-only, informational) and a user-controlled list of custom principles. Each custom principle is a short Spanish sentence (3-280 chars). The advisor's system prompt carries them with an explicit override flag — "RESPÉTALOS aunque entren en conflicto con tus 10 mandamientos por defecto" — so a "creo en el ayuno intermitente" beats any ONA default that suggests otherwise. Add via the page or via voice ("recuerda que sigo dieta cetogénica") through the `update_memory` skill
- Users can run a **voice onboarding** at `/onboarding/voz` — a guided Realtime conversation that walks through every memory key in order (edad, hogar, restricciones, gustos, equipo, tiempo disponible, presupuesto, cocinas preferidas, nivel, horarios, notas libres). The assistant calls `update_memory` after each answer; a progress checklist below the orb shows what's been captured. When the assistant emits the closing line "Listo, ya te conozco." the page auto-redirects to `/menu` after a 2 s grace period
- Users can see every fact the assistant remembers about them at `/profile/memoria` — grouped by category (Perfil físico, Hogar, Restricciones y gustos, Cocina, Rutina, Otras notas), with a source badge per row (**Tú** verde para datos manuales, **Asistente** terracota para inferidos, **Onboarding** neutral)
- Users can ask the assistant to remember any preference mid-conversation: "recuerda que no me gusta el cilantro", "tengo freidora de aire", "los lunes no cocino más de 20 minutos", "preferimos cocina mediterránea". The advisor calls the `update_memory` skill and persists the fact with `source: 'inferred'` and confidence 0.8 (or 1.0 if the user is emphatic — "APUNTA…")
- Users can delete any single fact from the memory page with a confirm dialog (full inline edit lands in the next PR; in the meantime the user can ask the assistant to overwrite a value)
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
| `household.adults` | int 1..20 | mirrors `users.adults`, kept in sync via the REST layer |
| `household.kids_2_to_10` | int 0..20 | mirrors `users.kids_2_to_10` |
| `restrictions` | `string[]` | non-empty strings; e.g. `['sin gluten', 'sin lactosa']` |
| `dislikes` | `string[]` | e.g. `['cilantro', 'hígado']` |
| `equipment` | `string[]` | e.g. `['horno', 'freidora de aire', 'olla express']` |
| `time_available` | `{ [weekday-spanish]: minutes 0..480 }` | weekdays: lunes, martes, miercoles, jueves, viernes, sabado, domingo |
| `weekly_budget_eur` | number 0..5000 | |
| `cuisine_bias` | `{ [cuisine]: 0..100 }` | slider per cuisine — only values ≥70 surface in the digest |
| `cooking_skill` | `'easy'\|'medium'\|'advanced'` | |
| `meal_times` | `{ [breakfast\|lunch\|snack\|dinner]: 'HH:MM' }` | 24h regex-enforced |
| `notes` | `string[]` | free-form facts ("mi hija no come pescado") |
| `nutrition_principles` | `string[]` (3..280 chars each) | user-authored beliefs that override ONA's defaults. e.g. `['Ayuno intermitente 16/8', 'Sin azúcar refinado']`. The digest tags them as "RESPÉTALOS aunque entren en conflicto con tus 10 mandamientos por defecto" so the model doesn't try to correct the user against their own beliefs |
| `prep_habits` | `string[]` (3..280 chars each) | recurring prep-time habits. e.g. `['Siempre congelo el pescado', 'Pongo las legumbres en remojo la noche antes', 'Saco la carne 30 min antes para que tempere']`. The notification scheduler (see [Notifications](./notifications.md)) reads this together with `ingredients.prep_requirements` to decide when to fire a heads-up push ("saca los boquerones del congelador en 2 días"). The advisor's `update_memory` skill writes here whenever it picks up a habit in conversation |

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

The `update_memory` skill (declared in `assistant/skills.ts`) takes a `facts: Array<{ key, value, confidence? }>` payload and routes it through `setMemoryBatch` with `source='inferred'`. Validation errors return a Spanish summary the model relays back to the user.

## Constraints

- The `user_memories` table is **truth**. `users.adults` / `users.kids_2_to_10` are still written for legacy reads, but new code reading the household composition should prefer the memory entries (PR 3 will deprecate the mirror)
- Inferred facts default to confidence 0.8. The `update_memory` skill writes 1.0 only when the user explicitly asks ("APUNTA", "GUÁRDATE", "no se te olvide")
- Manual writes (PATCH /memory) always set source='manual' and confidence 1.0 — they can override a previous inferred guess
- The digest sits at the bottom of the system prompt for prompt-cache locality — only changes when memory changes, so the upstream system text stays cache-hot
- Prompt budget: a maximally populated memory digest stays under ~500 tokens (contract test in `userMemoryContract.test.ts`)

## Related specs

- [Advisor](./advisor.md) — the assistant integration point that reads memory at every skill call
- [Auth](./auth.md) — `users.adults` / `users.kids_2_to_10` are mirrored here for backward compat
- [Menus](./menus.md) — future PR will pipe `dislikes` + `equipment` + `time_available` into the matcher's predicates

## Source

- [packages/shared/src/types/userMemory.ts](../packages/shared/src/types/userMemory.ts) — key registry + per-key Zod schemas + digest builder
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `user_memories` table
- [apps/api/src/services/userMemoryStore.ts](../apps/api/src/services/userMemoryStore.ts) — get / set / batch / delete + digest
- [apps/api/src/routes/memory.ts](../apps/api/src/routes/memory.ts) — REST surface
- [apps/api/src/services/assistant/contextLoader.ts](../apps/api/src/services/assistant/contextLoader.ts) — injection point
- [apps/api/src/services/assistant/skills.ts](../apps/api/src/services/assistant/skills.ts) — `update_memory` skill (look for `updateMemory`)
- [apps/api/src/tests/userMemoryContract.test.ts](../apps/api/src/tests/userMemoryContract.test.ts) — 19 contract tests
- [apps/web/src/hooks/useUserMemory.ts](../apps/web/src/hooks/useUserMemory.ts) — TanStack hooks
- [apps/web/src/app/profile/memoria/page.tsx](../apps/web/src/app/profile/memoria/page.tsx) — read-only viewer (full inline edit lands next)
- [apps/web/src/app/onboarding/voz/page.tsx](../apps/web/src/app/onboarding/voz/page.tsx) — voice-onboarding landing page; opens a Realtime session with `mode: 'onboarding'` and watches transcripts for the closing line
- [apps/web/src/app/profile/creencias/page.tsx](../apps/web/src/app/profile/creencias/page.tsx) — nutritional-beliefs editor; shows ONA defaults + lets the user add custom principles
- [apps/api/src/services/assistant/systemPrompt.ts](../apps/api/src/services/assistant/systemPrompt.ts) — `AssistantMode = 'text' | 'voice' | 'onboarding'`; the onboarding branch carries the 12-step conversation script
