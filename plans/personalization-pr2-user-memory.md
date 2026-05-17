# User Memory Foundation Implementation Plan

## Summary

Replace the ad-hoc fields currently scattered across `users` + `userSettings.template.preferences` + the assistant's runtime context with a single typed `user_memories` table. Every fact the user tells the agent (or the agent extracts) lands here with provenance (manual / voice-onboarding / inferred) and an updated_at. The advisor reads memory at every skill call and injects it into the system prompt; the frontend renders a `/profile/memoria` page where the user can audit and edit each fact manually.

Without this PR there's no place to store the data that voice onboarding will extract (Track A) and the advisor keeps re-asking the same questions because it has no persistent profile beyond the `users` row. Ship in parallel with PR 1.

## Tasks

- [ ] Define the memory schema in `@ona/shared`
  + `MemoryKey` enum with stable codes — never rename, only add:
    - `physical.sex`, `physical.age`, `physical.weight_kg`, `physical.height_cm`, `physical.activity_level`
    - `household.adults`, `household.kids_2_to_10` (mirrors current `users` columns — keep in sync via the API layer, not duplicated storage)
    - `restrictions` (array of strings)
    - `dislikes` (array — "cilantro", "champiñones")
    - `equipment` (array — "horno", "induccion", "freidora_aire", "olla_express", "thermomix", "microondas", "vitroceramica", "gas", "parrilla", "robot_cocina", "deshidratadora")
    - `time_available_by_weekday` (object: `{ lunes: 30, martes: 60, … }` in minutes)
    - `weekly_budget_eur` (number)
    - `cuisine_bias` (object: `{ mediterranea: 80, asiatica: 60, mexicana: 40, … }` 0–100)
    - `cooking_skill` (enum easy|medium|advanced)
    - `meal_times` (object: `{ breakfast: '08:00', lunch: '14:00', … }`)
    - `notes` (array of free-form facts — "los niños no comen pescado azul", "compramos en mercadona los viernes")
  + Per key: type schema (zod), default, free-form label for the editor, category (Físico / Hogar / Cocina / Compra / Gustos / Notas)
  + Export `MEMORY_KEY_SPEC` map so the editor and the API share the same source of truth
- [ ] DB schema + migration
  + `user_memories` table: id, user_id (FK), key (text, indexed), value (jsonb), source enum 'manual'|'voice_onboarding'|'voice_chat'|'inferred', confidence (real, default 1.0), created_at, updated_at; unique (user_id, key)
  + Migration is additive — no backfill needed (memory starts empty for everyone; existing user fields keep working as fallbacks)
  + Index on (user_id, key)
- [ ] Backend service: `memoryService.ts`
  + `getMemory(userId): Promise<UserMemory>` — returns the merged shape (key → value) with defaults filled from spec
  + `setMemoryFact(userId, key, value, source)` — validates against `MEMORY_KEY_SPEC[key].schema`, upserts row, sets updated_at
  + `deleteMemoryFact(userId, key)` — drops the row (the API key falls back to the default in `getMemory`)
  + `getMemoryAsPromptContext(userId): Promise<string>` — formats the memory as a compact bullet list for system-prompt injection (skipping keys at default)
  + Single source of truth: every endpoint that reads preferences uses this service, not the `users` row directly (for fields that exist in both, this service is canonical)
- [ ] API routes (`apps/api/src/routes/memory.ts`)
  + `GET /memory` (auth) — returns `{ facts: { [key]: { value, source, updatedAt } }, schema: MEMORY_KEY_SPEC }`
  + `PATCH /memory` (auth) body `{ facts: { [key]: value } }` — bulk upsert with source='manual'; per-key validation
  + `DELETE /memory/:key` (auth) — drop one fact
  + `POST /memory/import-from-profile` (auth) — one-off helper that copies the current `users` profile fields into memory at source='manual' (for migrating existing users without re-onboarding); idempotent
- [ ] Advisor integration: every assistant skill call reads memory
  + Modify `services/assistant/buildSystemPrompt.ts` to prepend `getMemoryAsPromptContext(userId)` so the LLM always knows the user's facts
  + Skills that filter / score recipes (matcher, advisor `suggest_recipes`, `nutrition_advice`) read memory for `dislikes`, `equipment`, `time_available_by_weekday`, `cuisine_bias` and use those to bias results
  + Document this contract in `specs/advisor.md` so future skills know they can rely on memory
- [ ] Menu matcher integration
  + `findRecipeForSlot` accepts optional `dislikes` + `equipmentOwned` + `maxPrepMinutes` filters
  + `generateMenu` looks up memory once per call, passes the filters down
  + Recipes whose `equipment[]` contains an item the user doesn't own are dropped from the candidate pool
  + Recipes referencing a disliked ingredient by name are dropped
  + Recipes with `prepTime > maxPrepMinutes` for that weekday are dropped
- [ ] Frontend: `useMemory()` hook + `/profile/memoria` page
  + `useMemory()` — TanStack Query `["memory"]`, returns facts + schema; mutation hooks `useSetMemoryFact`, `useDeleteMemoryFact`
  + `/profile/memoria` page grouped by category (Físico / Hogar / Cocina / Compra / Gustos / Notas), each fact rendered as an inline editor matching its type:
    - text → input
    - number → number input
    - enum → segmented control
    - array of strings → tag-style chips with add/remove
    - object map (cuisine_bias, time_available_by_weekday) → row per key with slider / time picker
    - notes (array of free-form) → list of textarea items with add/remove
  + Each fact shows its source badge ("manual" / "voz" / "inferido por la IA") and the last updated date — the user knows where each fact came from
  + Page bottom: "Importar desde mi perfil actual" button (calls /memory/import-from-profile) so existing users start with their profile data already in memory
- [ ] Spec updates
  + New spec `specs/user-memory.md` — schema, source enum, advisor integration contract, editor flow
  + Edit `specs/advisor.md` — add a "Memory" subsection: every skill reads memory implicitly; mutator skills like `update_household` also write to memory
  + Edit `specs/menus.md` — document the new matcher filters (dislikes / equipment / maxPrepMinutes) and where they come from
  + Add `user-memory.md` row to `specs/index.md`
- [ ] Tests
  + Unit: `setMemoryFact` rejects values that fail the per-key schema (e.g. cooking_skill='wizard' → 400)
  + Unit: `getMemory` returns defaults for missing keys
  + Unit: `getMemoryAsPromptContext` skips keys at default value (don't waste tokens)
  + Unit: matcher correctly drops recipes for missing equipment / disliked ingredient / over-time-budget
  + Integration: PATCH /memory with a fact, GET /memory returns it with source='manual'
  + Playwright: /profile/memoria renders, user adds "cilantro" to dislikes, regenerates menu, no cilantro recipe appears
- [ ] Verify implementation
  + Backend: `POST /memory/import-from-profile` for an existing user copies their `users` profile into memory rows
  + Backend: regenerate a menu — the advisor system prompt (logged or captured in a test fixture) contains the user's memory facts
  + Backend: a memory PATCH with `dislikes: ['lentejas']` and a subsequent menu regen produces a menu without any lenteja recipe in the candidate pool (verify by inspecting the generated menu)
  + Frontend: open `/profile/memoria`, add "freidora_aire" to equipment, save, reload — fact persists with source 'manual'
  + Frontend: dark mode + light mode both render the editor legibly (pending PR 17 for dark mode itself)
  + Production rehearsal: migration is additive; no user data is affected; rolling deploy is safe
