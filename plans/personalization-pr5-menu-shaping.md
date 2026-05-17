# Menu Shaping Quick Wins Implementation Plan

## Summary

Four orthogonal, zero-dependency menu-level controls that let the user shape one week without touching their profile preferences or the matcher. Each adds a tiny piece of state to `menus.days` / `menus` (no new tables) and a small UI affordance on the existing meal cards.

1. **Veto receta esta semana** — mark a recipe as "no la quiero esta semana"; the matcher / regenerator stops suggesting it for the rest of the week.
2. **Comer sobras** — duplicate slot N's recipe into slot N+1 (typically dinner→tomorrow's lunch) with a "sobras" badge; ingredients aggregate normally so the shopping list doesn't double-count.
3. **Día sin cocinar** — empty every slot on a day with one confirm; matcher won't refill on regenerate (per-day flag in the menu jsonb).
4. **Pin meal type to a day** — fix a tag-based slot ("martes cena cremas", "viernes cena pizza"); regeneration MUST pick a recipe matching the tag. Tag taxonomy is a small fixed list.

All four ship in one PR because they touch the same `EditorialMealCard` + `menu.days` JSONB and the same matcher. None depends on household scoping (PR 1) or user memory (PR 2), so this can ship in parallel to either.

## Tasks

- [ ] Tag taxonomy in `@ona/shared`
  + Export `MEAL_TYPE_TAGS` const: `['cremas', 'legumbres', 'pizza', 'asiatico', 'mediterraneo', 'ensalada', 'parrilla', 'batch-cooking', 'pasta', 'arroz']`. Spanish-aware, no accents on keys (UI labels carry the accents)
  + Export `MealTypeTag` type union from the const
  + Export `MEAL_TYPE_TAG_LABELS` record from the key → Spanish display string ("cremas" → "Cremas", "asiatico" → "Asiático", etc.)
  + Rebuild the package and import everywhere — these are the canonical names the matcher will look up in `recipe.tags`
  + Document in [`specs/recipes.md`](../specs/recipes.md): when a system recipe carries one of these tags, the matcher treats it as eligible for the matching `pinnedType` slot
- [ ] Extend `MealSlot` shape (`packages/shared/src/types/menu.ts`)
  + Add `pinnedType?: MealTypeTag | null` — when set, the matcher must pick a recipe whose `tags` contains this value. The user picks the type once and regeneration / random / leftover replacement all respect it.
  + Add `kind?: 'planned' | 'leftover' | null` — `'leftover'` marks a slot cloned from a previous day's dinner; UI shows a "sobras" badge and excludes the recipe from re-pick. Default (or null) = `'planned'`.
  + Add `leftoverOf?: { day: number; meal: string } | null` — back-reference to the source slot for the leftover. Lets the UI render a "← sobras del lunes cena" link.
- [ ] Extend `Menu` shape (`packages/shared/src/types/menu.ts`)
  + Add `bannedRecipeIds?: string[]` — per-week veto list; recipes in this set are excluded from the matcher's pool for THIS menu only.
  + Add `skippedDays?: number[]` — array of day indices the user marked "sin cocinar"; matcher skips these on regenerate (no slots get refilled).
  + Rebuild `@ona/shared`
- [ ] Backend: `POST /menu/:menuId/ban` — add a recipe to the week's veto list
  + Body `{ recipeId }`; appends if not present; idempotent
  + Returns the updated menu
  + 404 if menu not found; 400 if recipeId malformed
- [ ] Backend: `DELETE /menu/:menuId/ban/:recipeId` — remove from the veto list
  + Returns the updated menu
- [ ] Backend: extend the matcher in `apps/api/src/services/recipeMatcher.ts`
  + `findRecipeForSlot` accepts a new `bannedRecipeIds?: Set<string>` arg
  + Filters those out at the top of the candidate pool, before the season/restriction filters
  + Pure function — unit test it directly with a fixture menu
- [ ] Backend: wire the matcher's new arg into every caller
  + `menuGenerator.ts` — passes `new Set(menu.bannedRecipeIds ?? [])` on regenerate
  + `menus.ts:PUT /menu/:menuId/day/:day/meal/:meal` (the Aleatorio path) — same
  + `menus.ts:POST /menu/:menuId/day/:day/meal/:meal` (the Añadir path) — same
- [ ] Backend: `POST /menu/:menuId/day/:day/leftover` — clone the previous-day dinner into today's lunch
  + Body `{ sourceDay: number; sourceMeal: string; targetMeal: string }`
  + Validates: source slot exists, target slot is empty, source isn't already a leftover (no chaining leftovers — keep it simple)
  + Writes `{ recipeId: source.recipeId, recipeName: source.recipeName, kind: 'leftover', leftoverOf: { day: sourceDay, meal: sourceMeal } }`
  + Shopping aggregator already handles repeated `recipeId` via `sumDinersByRecipe` (PR-shipped before this); confirm with a test that the same recipe in two slots ends up summed in the shopping list
  + Returns updated menu
- [ ] Backend: `POST /menu/:menuId/day/:day/skip` — mark a whole day as "sin cocinar"
  + Empties every non-locked slot in that day
  + Appends the day index to `menus.skippedDays` if not already there
  + Returns updated menu
- [ ] Backend: `DELETE /menu/:menuId/day/:day/skip` — undo the skip
  + Removes the day from `skippedDays`; does NOT refill the slots automatically (the user can regenerate or add slots manually)
- [ ] Backend: extend `menuGenerator.ts` to honour `skippedDays`
  + When iterating days in the matcher loop, days listed in `skippedDays` are kept empty (no slot inserts)
  + Regenerating the whole week preserves the skip — the user has to explicitly un-skip
- [ ] Backend: extend the regenerate-slot path to honour `pinnedType`
  + When a slot's `pinnedType` is set, the matcher's candidate pool is the intersection of the season/restriction filters AND `recipe.tags.includes(pinnedType)`
  + If the intersection is empty, return 404 with a helpful Spanish message: "No hay recetas etiquetadas como '<tag>' que encajen con esta cena. Cambia la etiqueta o quita el pin."
- [ ] Backend: `PATCH /menu/:menuId/day/:day/meal/:meal` extension
  + Already handles `{ servings: number | null }` from the per-slot diner override PR
  + Now also accepts `{ pinnedType: MealTypeTag | null }` to set / clear the pin
  + Validate against `MEAL_TYPE_TAGS`; reject unknown
- [ ] Frontend hook: `useBanRecipe(menuId)` in `apps/web/src/hooks/useMenu.ts`
  + `mutate(recipeId)` posts to `/menu/:menuId/ban`
  + Optimistic update on the cached menu (add to `bannedRecipeIds`)
  + Pair it with `useUnbanRecipe(menuId)` for the undo
- [ ] Frontend hook: `useMarkLeftover(menuId)` — POST `/menu/:menuId/day/:day/leftover`
- [ ] Frontend hook: `useSkipDay(menuId)` + `useUnskipDay(menuId)` — toggle skipped state
- [ ] Frontend hook: `useSetSlotPinnedType(menuId)` — PATCH with `{ pinnedType }`; reuse the existing PATCH hook by extending its body type
- [ ] Frontend: extend `EditorialMealCard` action chip row
  + New "Vetar" chip (Ban icon) — confirm dialog "¿Vetar esta receta del resto de la semana?" → calls `useBanRecipe`. Sits next to "Quitar".
  + New "Sobras" chip on the slot card of *yesterday's dinner* (or any non-leftover slot) — opens a small inline picker "Comer sobras como…" → choose tomorrow's `lunch` or `dinner` → calls `useMarkLeftover`.
  + Leftover slots show a small "← sobras del [día] [cena/comida]" caption under the recipe name + a different border treatment (dashed?) to make them visually distinct.
  + The action chips on a leftover slot are limited to "Quitar" + "Comensales" stepper (no "Aleatorio" / "Elegir" — that would break the leftover semantic).
- [ ] Frontend: extend the day toolbar with "Saltar día"
  + Button "Saltar día" at the top of the day view (next to the day name) — opens confirm "¿Marcar [día] como 'sin cocinar'?"
  + When skipped, the day view replaces the meal cards with a single empty-state card: "Día sin cocinar. [Reactivar día →]"
  + Reactivar = `useUnskipDay`; user adds slots manually after that via the existing "+ Añadir comida" row
- [ ] Frontend: "Pin meal type" UI on each slot
  + Tap-and-hold (or a small ⋯ menu) on a meal card → "Fijar tipo de comida" → opens a chip-picker sheet with `MEAL_TYPE_TAG_LABELS`
  + Pin selection persists; the chip shows a small tag pill next to the slot title ("Cena · Cremas")
  + "Quitar pin" option clears `pinnedType`
- [ ] Frontend: "Vetadas esta semana" panel
  + At the bottom of `/menu`, collapsible list of `menu.bannedRecipeIds` showing the recipe name + "Levantar veto" button for each
  + Empty when no vetoes — does not render
- [ ] Frontend: surface a non-blocking error toast when "Aleatorio" can't find a recipe matching `pinnedType`
  + Already returns 404 from the backend; the hook should surface a friendly Spanish toast: "No hay recetas etiquetadas como 'cremas' para esta cena. Cambia la etiqueta o quita el pin."
- [ ] Tag system recipes with the new taxonomy
  + Write a one-off script `apps/api/scripts/tagRecipesByType.ts` that:
    - Loads every system recipe (`authorId IS NULL`)
    - Heuristically assigns one or more tags from `MEAL_TYPE_TAGS` based on name + ingredients (e.g. "Crema de calabaza" → `cremas`; recipes with `arroz` as top ingredient → `arroz`; pizza in the name → `pizza`)
    - Dry-run by default; `--execute` to commit
  + Run against the local DB and inspect the diff
  + Commit the resulting tag changes via the same script run against prod after deploy
- [ ] Spec updates
  + Edit `specs/menus.md`:
    - User Capabilities — add bullets for veto / leftovers / skip day / pin type
    - Menu Structure — document the new fields on `MealSlot` and `Menu`
    - Generation Algorithm — note the matcher honours `bannedRecipeIds`, `pinnedType`, `skippedDays`
  + Edit `specs/recipes.md` — note that recipes carry tags from `MEAL_TYPE_TAGS` and the matcher uses them for pinned slots
- [ ] Tests
  + Unit: matcher `findRecipeForSlot` with a fixture pool — bannedRecipeIds filter; pinnedType filter; both at once; empty intersection returns null
  + Unit: `leftover` clone is rejected when target slot is non-empty; rejected when source is itself a leftover
  + Unit: `skipDay` empties non-locked slots and preserves locked ones
  + Unit: shopping aggregator (`sumDinersByRecipe`) treats a leftover slot the same as a regular slot (already covered, but add a regression test with a leftover fixture)
  + Integration: A bans recipe R → POST `/menu/:menuId/day/0/meal/lunch` (Aleatorio) → response never picks R for the rest of the week's regeneration
  + Playwright (mobile-chromium 390×844): tap "Vetar" on a meal card → confirm → reload → the vetoed recipe doesn't appear after Aleatorio
  + Playwright: tap "Sobras" on Monday dinner → pick "Comida del martes" → assert the Tuesday lunch card shows the same recipe with the "← sobras" caption
  + Playwright: "Saltar día" on Wednesday → assert the day's meal cards disappear and the empty state shows; tap "Reactivar día" → assert the empty state is replaced by the "+ Añadir comida" row (the matcher does NOT auto-refill)
  + Playwright: pin "cremas" on Friday dinner → tap "Aleatorio" → assert the new recipe has `cremas` in its tags (via the API response, not the UI)
- [ ] Verify implementation
  + Run the tagging script in dry-run; spot-check that "Crema de calabacín" gets `cremas`, "Paella de marisco" gets `arroz`, "Pizza margarita" gets `pizza`
  + Run with `--execute`; verify recipe rows reflect the new tags
  + In the browser: generate a fresh menu; veto one recipe; regenerate the week — vetoed recipe is gone from every slot
  + Mark Monday dinner as "Sobras → Martes comida"; reload — Tuesday lunch shows the leftover badge; open shopping list — ingredients sum (not duplicate)
  + Skip Friday; regenerate the week — Friday stays empty; reactivate Friday + use "+ Añadir comida" → slots come back
  + Pin "cremas" on a slot; press Aleatorio twice — both picks have the tag; remove the pin; press Aleatorio — picks are no longer constrained
  + Vetadas-esta-semana panel renders when there are vetoes and hides when empty
  + Spec-gate: `git diff specs/menus.md specs/recipes.md` shows the new capabilities documented
