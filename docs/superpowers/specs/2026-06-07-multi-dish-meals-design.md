# ONA — Multi-dish meal slots + free-text dishes

Date: 2026-06-07
Status: Approved by Miguel, ready for implementation plan

## Why

Today an ONA meal slot points to one recipe. Miguel cooks meals with 2-3 dishes (entrante + segundo + postre) and sometimes wants to flag a day with a free-text note ("comemos en casa de Paqui", "pan con tomate") that doesn't deserve its own recipe row. Both needs share the same shape change — meal slots stop being "one recipe" and become "an ordered list of dishes, each a recipe or a note".

## Scope

In scope:
- `recipes.course` enum field + LLM-assisted backfill of the existing catalogue.
- New `MealSlot` shape: `{servings?, dishes: Dish[]}` where each `Dish` is either a `RecipeDish` or a `NoteDish`.
- Per-meal-type dish count config in the user's plantilla (`mealDishCounts: {meal: 1|2|3}`).
- Course-aware auto-generator: matcher restricts candidates by course based on the dish count.
- 4 new dish-level API routes + adjustments to existing slot-level routes.
- Aggregator changes: shopping list + advisor nutrition iterate `dishes[]` and skip notes.
- UI: hybrid meal-card render (single-dish keeps the editorial hero; multi-dish stacks dish rows), bottom sheet "Añadir plato", plantilla dish-count selector, Vista Semana "+N más" badge, per-dish DnD reorder within a slot.
- Migration `0029_recipes_course` + `0030_menus_dishes` (data rewrite).

Out of scope (deferred to follow-ups):
- Per-dish lock (lock stays at slot level).
- Per-dish DnD across slots (move-slot moves the whole slot).
- Voice / advisor skills for the new dish APIs.
- "Pair-with X" matcher hint (suggest a complement for a chosen dish).
- Per-day override of dish count (today `mealDishCounts` is per meal-type, not per day-meal).
- Vista Semana as a multi-dish editor (it remains an overview).
- E2E fixes for the new flows (next PR after this ships).

## Decisions, with the trade-offs Miguel weighed

1. **Dishes are an ordered array, no semantic label per dish.** Multi-dish is `[entrante, principal, postre]` by convention via course tags, but each dish lives in a flat `Dish[]` — position implies presentation order, not a hardcoded role. Reorder via drag; UI doesn't label rows "primer plato".
2. **Plantilla configures dish count per meal-type (1/2/3), not per day-meal.** Default 1. Convention: `1` → `course ∈ {main, null}`; `2` → `[starter, main]`; `3` → `[starter, main, dessert]`. Manual override always lets the user add or remove dishes regardless of the configured count.
3. **Course tags backfilled via LLM, used by the matcher at runtime via a SQL filter.** Same pattern as `prep-requirements:populate`. The runtime matcher never calls the LLM. `course` is nullable — a recipe without a course is treated as versatile and is the default candidate for `N=1` slots.
4. **`N=1` excludes starters and desserts from auto-pick.** Otherwise a "Crema de calabacín" tagged `starter` could land as the standalone dish for lunch — wrong. Manual override (Elegir from catalog) bypasses the restriction.
5. **Notes are a kind of dish, not a separate slot field.** Same `dishes[]` array; each entry is `{kind:'recipe'|'note'}`. Mixed slots are allowed (recipe + note). Notes are skipped by shopping aggregator and advisor nutrition.
6. **Lock + DnD stay at slot level in MVP.** Locking the slot freezes all its dishes; DnD between slots moves all dishes. Per-dish lock and per-dish cross-slot DnD are explicit follow-ups.
7. **One-time data migration to new shape, not backwards-compat reads.** Migration `0030` rewrites every `menus.days[i][meal]` from `{recipeId, …}` to `{dishes: [{kind:'recipe', recipeId, …}]}`. The server post-migration assumes only the new shape — simpler than dual-mode parsing.
8. **Two PRs in sequence.** PR A: course backfill (independent, ~200-300 lines). PR B: multi-dish + notes (the bulk, ~1500-2000 lines). PR A can ship and sit on prod with no behavioural change before PR B lands.

## Data model

### `recipes.course` (new)

```sql
-- 0029_recipes_course.sql
ALTER TABLE "recipes" ADD COLUMN IF NOT EXISTS "course" text;
-- CHECK constraint enforced at application layer via Zod (closed enum).
```

Values: `'starter' | 'main' | 'dessert' | null`. Stored as text for forward-compat; validation in `@ona/shared` Zod schema.

Labels (Spanish UI):
```ts
const COURSE_LABELS = { starter: 'Entrante', main: 'Principal', dessert: 'Postre' } as const
```

### `MealSlot` + `Dish` (new shapes in `@ona/shared`)

```ts
export interface MealSlot {
  servings?: number | null    // slot-level diner override (existing)
  dishes: Dish[]              // ordered, length ≥ 1 except transient empty after delete-last-dish
}

export type Dish = RecipeDish | NoteDish

export interface RecipeDish {
  kind: 'recipe'
  recipeId: string
  recipeName?: string
  course?: 'starter' | 'main' | 'dessert' | null   // hydrated from recipes.course
  pinnedType?: string | null                       // moved from slot → dish (per-dish meal-type pin)
  variant?: 'planned' | 'leftover'                 // was slot.kind in legacy shape
  leftoverOf?: { day: number; meal: string; dishPosition: number } | null
  imageUrl?: string | null                         // hydrated, not persisted in JSONB
  prepTime?: number | null
  totalTime?: number | null
}

export interface NoteDish {
  kind: 'note'
  text: string                // ≤120 chars, trimmed
}
```

### Migration `0030_menus_dishes`

One-shot data migration (Drizzle SQL + helper script). For each menu row, for each day index, for each meal key:

```ts
const legacy = day[meal]
if (!legacy) continue
if (Array.isArray(legacy.dishes)) continue   // already migrated, idempotent

const recipeDish: RecipeDish = {
  kind: 'recipe',
  recipeId: legacy.recipeId,
  recipeName: legacy.recipeName,
  pinnedType: legacy.pinnedType ?? null,
  variant: legacy.kind === 'leftover' ? 'leftover' : 'planned',
  leftoverOf: legacy.leftoverOf
    ? { ...legacy.leftoverOf, dishPosition: 0 }
    : null,
}

day[meal] = {
  servings: legacy.servings ?? null,
  dishes: [recipeDish],
}
```

Idempotent (skips rows already migrated). PWA outbox writes pre-PR-B that arrive post-PR-B are rejected with code `MENU_SHAPE_LEGACY` → client drops.

## Plantilla + auto-generator

### `userSettings.mealDishCounts` (new)

```ts
{ breakfast?: 1|2|3, lunch?: 1|2|3, dinner?: 1|2|3, snack?: 1|2|3 }
```

Default 1 for all (matches current behaviour). Per meal-type (not per day-meal). UI lives in `/profile/sections` above the existing day × meal grid, as a 4-row "Platos por comida" section with segmented controls.

### Auto-generator changes (`generateMenu` in `services/menu/*`)

For each `(day, meal)` slot:
1. Read `dishCount = userSettings.mealDishCounts[meal] ?? 1`.
2. If `dishCount === 1`: call existing matcher with extra SQL clause `(course = 'main' OR course IS NULL)` — parens are load-bearing since this composes with the matcher's other `WHERE` clauses (season, banned, restrictions) via `AND`. Produce `dishes: [{kind:'recipe', recipeId, …}]`.
3. If `dishCount === 2`: matcher twice, with `course = 'starter'` then `course = 'main'`. Produce `dishes: [starterDish, mainDish]`.
4. If `dishCount === 3`: matcher three times — `starter`, `main`, `dessert`. Produce `[starter, main, dessert]`.
5. **Fallback**: if a matcher call returns no candidates for a course, skip that dish and accumulate a warning `no_<course>_available_<meal>_<dayLabel>`. Return all warnings in the menu generation response so the UI can show a toast.

Existing matcher rules (season, banned, restrictions, pinnedType) compose on top. The course filter is an additional `WHERE` clause.

## API surface

### Existing routes — minimal changes

| Route | Change |
|---|---|
| `POST /menu/generate` | Honours `mealDishCounts`; returns `warnings: string[]`. |
| `POST /menu/:menuId/regenerate-meal` | Regenerates **only the recipe dishes** of the slot, honouring the slot's current recipe-dish count and course progression. **Notes in the slot are preserved in place** (regenerate is not "wipe and refill"; it's "re-pick the recipes among the dishes"). |
| `DELETE /menu/:menuId/day/:day/meal/:meal` | Unchanged — deletes whole slot. |
| `POST /menu/:menuId/move-slot` | Unchanged — whole slot moves. |
| `PATCH /menu/:menuId/day/:day/meal/:meal/lock` | Unchanged — slot-level lock. |
| `PATCH /menu/:menuId/day/:day/meal/:meal` | Body shrinks: `servings` only. `pinnedType` moves to dish-level. |
| `POST /menu/:menuId/ban` | Unchanged. Body `{recipeId}` already targets the recipe directly — the UI passes the chosen dish's recipeId so multi-dish needs no new param. |
| `POST /menu/:menuId/day/:day/leftover` | Clones only the recipe dishes of the source slot (notes skipped). |

### New dish-level routes

All gated by the existing `:menuId` param middleware (IDOR guards from PR #7).

| Route | Body | Behaviour |
|---|---|---|
| `POST /menu/:menuId/day/:day/meal/:meal/dish` | `{kind:'recipe', recipeId, course?, pinnedType?}` or `{kind:'note', text}` | Appends dish to `dishes[]`. Returns `{position}`. |
| `DELETE /menu/:menuId/day/:day/meal/:meal/dish/:position` | — | Removes dish; subsequent positions decrement. Empty `dishes[]` is allowed — the slot remains and the UI renders it as a `+ Añadir plato` placeholder, identical to a never-populated slot. |
| `PATCH /menu/:menuId/day/:day/meal/:meal/dish/:position` | `{text?, pinnedType?, newPosition?, course?}` | Edit note text, change per-dish pin, reorder (newPosition), or override course manually. **`course` here is a per-instance override on `RecipeDish.course`** — it does NOT write back to `recipes.course`, so the catalogue isn't mutated by menu-level edits. Returns the updated dish. |
| `POST /menu/:menuId/day/:day/meal/:meal/dish/:position/regenerate` | — | Aleatorio on one dish; respects its `course`. 400 if dish is a note. |

## Shopping list + nutrition

`apps/api/src/services/shoppingList.ts`: iterate `slot.dishes`, filter `dish.kind === 'recipe'`, then unchanged.

```ts
for (const dish of slot.dishes) {
  if (dish.kind !== 'recipe') continue
  // existing per-recipe ingredient extraction + scaling
}
```

`sumDinersByRecipe` already handles repeated recipeIds; multi-dish slots with duplicate recipe references aggregate cleanly. Leftover detection moves from `slot.kind === 'leftover'` to `dish.variant === 'leftover'` — same semantics, different field.

Advisor summary / nutrition aggregation (`services/advisor/summary.ts`): same pattern. Notes contribute zero calories — a slot that's only a note ("comemos en casa de Paqui") logs as 0 nutritional value for that day, which matches user intent.

## UI

### Meal card (Vista Día)

Conditional render:
- **1 dish**: full editorial hero card — photo, name, comensales, action chips. Visually identical to today's `EditorialMealCard`.
- **2+ dishes**: card becomes a container with an eyebrow header (`COMIDA · LUNES · PARA 2`) plus a vertical stack of compact dish-rows (thumbnail 56px + name + per-dish actions). Notes render as icon + italic text, no thumbnail.

`+ Añadir plato` button below the dish list opens a bottom sheet:
1. **Aleatorio** — auto-pick respecting the next missing course (or any `main/null` if dish count = 1).
2. **Elegir del catálogo** — existing `RecipePickerSheet`; recipe rows show a small course chip (E/M/P) to help decide.
3. **Añadir nota** — textarea (max 120 chars, counter visible).

Per-dish actions menu (`...` button on each dish-row):
- Aleatorio (`POST /dish/:pos/regenerate`)
- Quitar (`DELETE /dish/:pos`)
- Tipo de plato (per-dish pinnedType picker)
- Vetar receta (recipe dishes only — `POST /ban?dishPosition=N`)
- Editar texto (notes only — opens textarea)

DnD reorder inside a slot via `@dnd-kit/sortable` (grip handle on the left). Calls `PATCH /dish/:pos {newPosition}`.

### Vista Semana (grid 7-col)

Each cell shows the photo of the **first** dish (`dishes[0]`) as today's hero. If `dishes.length > 1`, a small badge under the recipe name: `+1 más` or `+2 más` (`text-[10px] uppercase tracking-[0.15em] text-[#7A7066]`). Clicking the cell still navigates to the first dish's recipe; multi-dish editing happens in Vista Día. Vista Semana stays an overview, not an editor.

### `/profile/sections`

New "Platos por comida" section above the day × meal grid:

```
Desayuno   [1] · 2 · 3
Comida      1 · [2] · 3
Cena       [1] · 2 · 3
Merienda   [1] · 2 · 3
```

Default `1` for all. Change applies to subsequent menu generations only; existing menus are untouched.

### `/recipes/new` and `/recipes/[id]/edit`

A dropdown **"Tipo de plato"** below Dificultad: `Sin clasificar (auto) · Entrante · Principal · Postre`. Default `Sin clasificar` (`null`). Persists to `recipes.course`. The LLM backfill fills the existing catalog before this PR ships; the form keeps it editable per recipe.

## Migration plan

### PR A — Course backfill (preparatorio, ~200-300 lines)

1. `0029_recipes_course.sql` (ADD COLUMN `course text`).
2. `@ona/shared`: `Course` type, `COURSE_LABELS`, validator.
3. `recipes` Drizzle schema: add `course` column.
4. `apps/api/scripts/populateCourse.ts` + `pnpm --filter @ona/api course:populate`. Batch of 50 recipes per Claude call (same pattern as `prep-requirements:populate`).
5. Form dropdown in `/recipes/new` and `/recipes/[id]/edit`.
6. `specs/recipes.md` updated.
7. Ship independently. Adds metadata only; behavior unchanged.

### PR B — Multi-dish + notes (the bulk, ~1500-2000 lines)

1. `0030_menus_dishes.sql` (data migration script).
2. `@ona/shared`: new `MealSlot` + `Dish` types.
3. API: new dish-level routes + adjustments to existing slot routes.
4. Auto-generator: course-aware matcher + dish count from plantilla + fallback warnings.
5. Shopping aggregator + advisor summary: iterate `dishes[]`.
6. UI:
   - Hybrid meal card render in `EditorialMealCard`.
   - `+ Añadir plato` bottom sheet.
   - `mealDishCounts` controls in `/profile/sections`.
   - Vista Semana `+N más` badge.
   - Per-dish DnD reorder.
7. Specs: `menus.md`, `shopping.md`, `advisor.md`.

## Testing strategy

- **Unit (vitest)**:
  - `dishes.ts` helpers — add/remove/reorder/normalize.
  - Shopping aggregator — mixed slots (recipe + note), note-only slots.
  - Advisor nutrition aggregator — same coverage.
  - Course-aware matcher — N=1 excludes starter/dessert; N=2/3 fills correct courses; fallback warnings.
- **Route smoke (Postgres + API)**: 4 new dish routes (happy + 400/403/404), `POST /menu/generate` honors `mealDishCounts`.
- **Migration smoke**: `0030` applied twice no error; data preserved (`servings`, `pinnedType`, `kind`, `leftoverOf`).
- **E2E (Playwright)**: out of scope (next PR). The current red tests on master come from the responsive migration; they're addressed after this feature ships.

## Spec gate

- `specs/recipes.md` — `course` field + form dropdown + LLM backfill (PR A).
- `specs/menus.md` — slot shape change, dish-level routes, plantilla dish-count, auto-gen rules, warnings (PR B).
- `specs/shopping.md` — note semantics (skipped from aggregation) (PR B).
- `specs/advisor.md` — only if nutrition aggregator gets a dedicated "notes excluded" doc line (PR B).

## Open follow-ups (not blocking implementation)

- Per-dish lock — useful when only one dish in a multi-dish slot should freeze.
- Per-dish DnD across slots (`PATCH .../dish/:pos {newSlot: {day, meal, position}}`).
- Advisor skills `add_dish`, `add_note`, `regenerate_dish` for voice control.
- Pair-with-X matcher hint when manually picking the first dish of a multi-dish slot.
- Per-day override of dish count for special days (`mealDishCounts: {monday: {lunch: 3}, …}`).
- Vista Semana as a multi-dish editor (drag dishes between days).
- E2E fixes for the new flows + the pre-existing red tests from the responsive migration.
