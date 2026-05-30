# Menus

Weekly meal plan generation and management.

## User Capabilities

- Users can generate a weekly menu (Monday–Sunday) for the current week or any future week with one click
- Users can navigate forward/back between weeks with arrow buttons in the menu header (or by editing `?week=YYYY-MM-DD` in the URL); a "Hoy" button jumps back to the current week. The header label shows "Esta semana", "Próxima semana", "Dentro de N semanas", or "Hace N semanas" plus the date range. The selected day resets to today (current week) or Monday (any other week) when the user changes week
- Past weeks are read-only: meal cards stay visible (to review what was planned) but the "Generar mi menú", "Regenerar semana", "Aleatorio", "Elegir", and "Fijar" controls are hidden. The empty state on a past week reads "Sin menú esta semana. Esta semana ya pasó. Vuelve a la actual para planificar." with no Generar button
- Users can navigate between days of the week using a horizontal day strip (WeekStrip)
- Users can switch between **"Vista día"** and **"Vista semana"** via a toggle in the menu header. "Vista día" is the default (the existing day-by-day photo-card layout). "Vista semana" renders a compact 4-rows × 7-cols grid (meals × days) with one thumbnail per slot — on mobile portrait the cell is a 1:1 thumbnail with no title (option C); on `md+` viewports / landscape the cell stretches to ~140 px with a two-line title underneath (option D). Tapping any cell flips back to "Vista día" with that day selected so the user can edit. The choice is persisted in `localStorage.ona.menu.view`
- Users can see the day's meals as photo cards (breakfast / lunch / dinner) with the recipe image
- Users can regenerate a single meal slot two ways from the meal card: **"Aleatorio"** runs the matcher (random recipe matching the slot's season + restrictions), and **"Elegir"** opens a recipe picker sheet (`RecipePickerSheet`) listing the full catalog (system + user-owned recipes, distinguished by an "ONA"/"tuya" badge) with name search; picking one pins it via `PUT /menu/:menuId/day/:day/meal/:meal` with body `{ recipeId }`. The picker does NOT filter by meal type (the user's choice — any recipe can go in any slot). If the search returns 0 results, the empty state offers a **"Crear receta «<query>»"** button that bounces to `/recipes/new?name=<query>` with the typed term prefilled in the name field — so the user can author the missing recipe without losing what they were already typing. Both paths are queued offline and replay on reconnect; manual picks lose their `recipeId` on offline replay (the server falls back to auto-pick)
- Users can shape a single week without touching their weekly preferences: each meal card carries a **"Quitar"** button that removes the slot (`DELETE /menu/:menuId/day/:day/meal/:meal`), and the day view shows a **"+ Añadir <comida>"** row underneath that creates any slot the day is missing (`POST /menu/:menuId/day/:day/meal/:meal`). Both operations are scoped to **this menu only** — the profile's saved `mealTemplate` stays untouched, so regenerating the next week respects the original preferences again
- Users can override the diner count for one specific slot via a "Comensales −/+/Quitar" stepper on the meal card. The override is persisted on the slot as `servings: number` (`PATCH /menu/:menuId/day/:day/meal/:meal`, body `{ servings: number | null }`); `null` clears it. The shopping-list aggregator (`sumDinersByRecipe` in `shoppingList.ts`) sums per-slot diners across the week so two occurrences of the same recipe with different overrides scale independently. A "solo hoy" pill on the stepper makes the override visible at a glance
- Users can **veto** a recipe for the rest of the week from any meal card: tap the **"Vetar"** chip → confirm; the recipe is added to `menu.banned_recipe_ids` and the matcher excludes it from every subsequent Aleatorio / Elegir-without-recipe / Añadir / whole-week regenerate. A collapsible "Vetadas esta semana" panel under the day view lists every vetoed recipe with a "Levantar veto" button per row. Vetoes carry over when the user re-runs `POST /menu/generate` for the same week so the matcher honours them next regeneration too
- Users can mark a whole day as **"sin cocinar"** from the day toolbar's **"Saltar día"** button. Empties every non-locked slot in that day and persists the day index on `menu.skipped_days`; whole-week regenerate skips the day next time. The empty state shows a CalendarX icon + **"Reactivar día"** which only clears the flag — the user has to re-add slots manually (or run Aleatorio) so a forgotten reactivation doesn't silently refill what the user intentionally cleared. Skipped days carry over across regenerates like vetoes
- Users can **fix a meal type** to a slot via the **"Tipo"** chip → bottom-sheet picker with 10 tags (Cremas, Legumbres, Pizza, Asiático, Mediterráneo, Ensalada, Parrilla, Batch cooking, Pasta, Arroz). Once pinned, Aleatorio / Elegir-without-recipe restrict the candidate pool to recipes whose `tags` includes the pinned tag (`PATCH … body { pinnedType: MEAL_TYPE_TAGS | null }`). The pin persists across recipe swaps; tap the chip again (or the active tag) to clear. When the intersection is empty the API returns 404 with a Spanish hint pointing the user to change/clear the pin
- Users can mark a slot as a **leftover** from a previous slot via `POST /menu/:menuId/day/:targetDay/leftover`, body `{ sourceDay, sourceMeal, targetMeal }`. The target slot is cloned with `kind: 'leftover'` and a `leftoverOf` back-reference; the shopping-list aggregator handles the repeated `recipeId` via `sumDinersByRecipe` so quantities collapse onto the source row without double-counting. The card renders a terracotta "Sobras de [día] [comida]" pill and hides Aleatorio / Elegir / Tipo / Vetar since the leftover is tied to its source. *UI affordance to trigger the endpoint from the card itself is deferred to a follow-up — the endpoint is available for the assistant via the voice skill.*
- Users can lock individual meal slots to prevent them from being changed during regeneration; the lock toggle is queued offline as well
- Users can regenerate the whole week (re-runs the algorithm; locked slots are preserved)
- Users can view past menus via `/menu/history`
- Users can tap a meal photo to open the recipe detail
- The menu page shows progress: "X de 7 dias con menu" and a percentage bar
- Users can opt in to local meal-time notifications (breakfast / lunch / snack / dinner times configured in profile `Capítulo 05`) — the app fires a reminder at the chosen times — see [PWA](./pwa.md)

## Menu Structure

A menu is stored per-user per-week:
- `weekStart` is the Monday of the week (`YYYY-MM-DD`)
- `days` is a 7-element array; each day is `{ breakfast?, lunch?, dinner?, snack? }`
- Each filled slot is `{ recipeId, recipeName, servings?, pinnedType?, kind?, leftoverOf?, imageUrl? }` — `imageUrl` is **not** persisted in the JSONB; the API resolves it per request from the joined `recipes.image_url` so a regenerate-image takes effect on the very next response. `servings` is the optional per-slot diner override; `pinnedType` is one of MEAL_TYPE_TAGS (`'cremas' | 'legumbres' | 'pizza' | 'asiatico' | 'mediterraneo' | 'ensalada' | 'parrilla' | 'batch-cooking' | 'pasta' | 'arroz'`) that constrains the matcher's candidate pool; `kind: 'leftover'` plus `leftoverOf: { day, meal }` marks a slot cloned from another via the leftover endpoint.
- `locked` is a nested object: `{ "<dayIndex>": { "<meal>": true } }`
- `bannedRecipeIds` is a string-array of recipe ids the user vetoed this week; the matcher excludes them across every regeneration call. Carries over when the user re-runs `POST /menu/generate` for the same week.
- `skippedDays` is an integer-array (0-6) of day indices the user marked "sin cocinar"; whole-week regenerate leaves these days empty (no slots get inserted).

## Generation Algorithm

The generator (`menuGenerator.ts`) uses iterative optimization:

1. Loads user profile (sex, age, weight, height, activity level), restrictions, and favorites
2. Loads all recipes with their ingredient names and cached `nutritionPerServing`
3. Calculates a target calorie count using BMR × activity × number of meal slots
4. Detects current season
5. Runs up to **200 iterations**, each time:
   - Builds a candidate menu by picking a random matching recipe per slot (skipping locked slots)
   - Scores each candidate using **real per-serving nutrition** from `recipe.nutritionPerServing` × the user's `householdSize / recipe.servings` ratio
   - Fitness = calorie deviation + macro percentage deviations (carbs/fat/protein vs `TARGET_MACROS`)
   - Keeps the best (lowest fitness) menu seen so far
   - Stops early if fitness drops below `OPTIMAL_FITNESS`

Recipes whose `nutritionPerServing` is not yet cached (e.g. unmapped ingredients) fall back to the legacy ingredient-name heuristic and are deprioritized when better-data alternatives exist.

For each meal slot, the matcher (`recipeMatcher.ts`) filters recipes by:
- Recipe's `meals[]` includes the target meal type
- Recipe's `seasons[]` includes current season (or is empty = always-available)
- Recipe ID is not already used elsewhere in the menu (no repeats within the week)
- No ingredient name matches a user restriction (case-insensitive)

Then picks one at random from the pool. **Favorites get double weight** — they appear twice in the random pool.

## Single-Meal Regeneration

`PUT /menu/:menuId/day/:day/meal/:meal` replaces one slot:
- Refuses if that slot is locked (returns 400)
- Excludes recipes already used in the rest of the week from the candidate pool
- Applies the same restriction/season/favorites logic
- Returns 404 if no matching recipe is available

## Manual Slot Shaping (per-week overrides)

The user can adapt one week without editing the saved `mealTemplate`:

- `POST /menu/:menuId/day/:day/meal/:meal` (auth) — add a slot the template didn't include. Optional body `{ recipeId }`; if absent the matcher picks one. Returns **409** when the slot already exists (use PUT to replace it instead), **404** when the matcher can't find a recipe, **201** + the updated menu otherwise.
- `DELETE /menu/:menuId/day/:day/meal/:meal` (auth) — drop the slot for this week. Refuses with **400** when the slot is locked, **404** when the slot doesn't exist. The user's `mealTemplate` is **not** mutated, so next week starts fresh.
- `PATCH /menu/:menuId/day/:day/meal/:meal` (auth) — partial update for slot metadata. v1 only honours `{ servings: number | null }`: a positive integer (1–24) sets a per-slot diner-count override, `null` clears it. The override is consumed by the shopping-list aggregator and ignored by the recipe matcher. Returns **400** on out-of-range servings, **404** when the slot is empty.

The recipe matcher and the per-week locks are unaffected by manual shaping.

## Lock Behavior

`PUT /menu/:menuId/day/:day/meal/:meal/lock` toggles `locked[day][meal]`:
- Locked slots are preserved across whole-week regenerations
- Their recipes are added to `usedRecipeIds` first, so the rest of the menu doesn't repeat them

## Menu Logs

Every generated menu also creates a `menu_logs` row with:
- Total calories for the week
- Aggregated nutrient profile (vitamins, minerals, etc.)
- Used to update `user_nutrient_balance` (running balance for the advisor)

## Constraints

- Menu generation is open (`POST /menu/generate` does NOT require auth — known quirk)
- All other menu routes require auth
- The default template assigns breakfast + lunch + dinner to every day (no snack)
- A user's `userSettings.template` can override per-day meal slots **and the diner count for each slot**. The profile UI persists the override as `{ mealTemplate: { [día]: { [comida]: number } } }` — Spanish day + meal names, integer >= 1 = "this many comensales for that slot", absence = slot off. The menu generator runs `normalizeMealTemplate` (on/off projection) and `extractMealDiners` (per-slot counts) on every load to coerce that shape — or the legacy `string[]` shape from before 2026-05-30, or the legacy `DayTemplate[]` — into the canonical 7-day array of `{ breakfast?, lunch?, dinner?, snack? }` plus a parallel 7-day map of `{ breakfast?: n, lunch?: n, ... }`. The generator seeds each newly built slot's `servings` from that map, so the shopping list and recipe-detail "Para X" scale to the configured comensales without further user action. Empty `mealTemplate` falls back to the default template; unknown day/meal keys are dropped silently; per-slot overrides on the menu card still win over the template default
- If no menu exists for the requested week, `GET /menu/:userId/:weekId` returns 404
- The shopping page redirects users to `/menu` if no menu exists for the current week
- **Household scope (PR 1B):** menus carry both `user_id` and `household_id`. Inserts always populate both; reads filter by `household_id` when the env flag `SHARED_HOUSEHOLD_SCOPE=true` (default ON in dev/test, OFF in prod). When the flag is on, every member of a shared household reads the same menus. See [Household](./household.md)

## Related specs

- [Recipes](./recipes.md) — what gets selected for slots; `recipe.servings` drives per-recipe scaling
- [Shopping](./shopping.md) — auto-generated from a menu's days
- [Nutrition](./nutrition.md) — provides the cached per-serving nutrition the algorithm now scores against
- [Auth](./auth.md) — user profile drives calorie targets and restrictions
- [Advisor](./advisor.md) — assistant skills can generate, regenerate, and read menus
- [PWA](./pwa.md) — meal regeneration and slot-lock toggles are wrapped by the offline queue; meal-time notifications are scheduled client-side from saved meal-time preferences

## Source

- [apps/api/src/routes/menus.ts](../apps/api/src/routes/menus.ts)
- [apps/api/src/services/menuGenerator.ts](../apps/api/src/services/menuGenerator.ts) — core algorithm
- [apps/api/src/services/recipeMatcher.ts](../apps/api/src/services/recipeMatcher.ts) — slot matcher
- [apps/api/src/services/calorieCalculator.ts](../apps/api/src/services/calorieCalculator.ts)
- [apps/api/src/services/nutrientCalculator.ts](../apps/api/src/services/nutrientCalculator.ts)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx)
- [apps/web/src/components/menu/WeekStrip.tsx](../apps/web/src/components/menu/WeekStrip.tsx)
- [apps/web/src/components/menu/MealPhotoCard.tsx](../apps/web/src/components/menu/MealPhotoCard.tsx)
- [apps/web/src/hooks/useMenu.ts](../apps/web/src/hooks/useMenu.ts) — `useGenerateMenu`, `useRegenerateMeal`, `useLockMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useUpdateSlotServings`
- [packages/shared/src/types/menu.ts](../packages/shared/src/types/menu.ts)
