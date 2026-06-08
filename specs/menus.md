# Menus

Weekly meal plan generation and management.

## User Capabilities

- Users can generate a weekly menu (Monday–Sunday) for the current week or any future week with one click
- Users can navigate forward/back between weeks with arrow buttons in the menu header (or by editing `?week=YYYY-MM-DD` in the URL); a "Hoy" button jumps back to the current week. The header label shows "Esta semana", "Próxima semana", "Dentro de N semanas", or "Hace N semanas" plus the date range. The selected day resets to today (current week) or Monday (any other week) when the user changes week
- Past weeks are read-only: meal cards stay visible (to review what was planned) but the "Generar mi menú", "Regenerar semana", "Aleatorio", "Elegir", and "Fijar" controls are hidden. The empty state on a past week reads "Sin menú esta semana. Esta semana ya pasó. Vuelve a la actual para planificar." with no Generar button
- Users can navigate between days of the week using a horizontal day strip (WeekStrip). In "Vista día" the strip is **sticky at the top** while the rest of the day stack scrolls underneath; an IntersectionObserver keeps the strip's highlighted day in sync with the day section currently dominating the viewport, so the strip slides smoothly as the user scrolls between days. Tapping any day on the strip scroll-into-views that day's block (offset 72 px so the day title isn't covered by the strip). On mount the view auto-scrolls to today
- Users can switch between **"Vista día"** and **"Vista semana"** via a toggle in the menu header. "Vista día" is the default (the existing day-by-day photo-card layout). "Vista semana" renders a **vertical stack of day sections**; each section's sticky header (day + date + "Hoy" pill when applicable) stays pinned while you scroll through its rows. Meal types that have zero recipes across the whole week are hidden entirely. Each row shows the recipe thumbnail, a meal-icon eyebrow (sunrise / sun / sunset / moon), the `shortRecipeName`-trimmed title (drops "Cómo hacer…", "Receta de…", "Las N recetas que…" openers; truncates at 24 chars), and a time chip (`totalTime ?? prepTime`, hydrated from `recipes` on every menu response). On mount the view auto-scrolls today's section into view. Days the user marked "sin cocinar" render a muted block with an inline "Reactivar día" affordance. **Drag-and-drop**: every row is both a drop target and (when filled) a drag source — drop on another row swaps the two slots via `POST /menu/:menuId/move-slot`. Drops outside any row are no-ops (`pointerWithin` collision). Each filled row also exposes a **"..." quick-actions menu** with Aleatorio (regenerate slot) / Vetar receta / Quitar slot. The choice between vista día/semana persists in `localStorage.ona.menu.view`
- Users can see the day's meals as photo cards (breakfast / lunch / dinner) with the recipe image. In "Vista día" every day with at least one planned meal (or marked skipped) renders as a section in a continuous vertical stack — the user scrolls naturally from one day's meals into the next without paginating. Days that are completely empty drop out
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

## Multi-dish slots

Each `MealSlot` holds `{servings?, dishes: Dish[]}` where every `Dish` is either a `RecipeDish` (`{kind:'recipe', recipeId, recipeName?, course?, pinnedType?, variant?, leftoverOf?, imageUrl?, prepTime?, totalTime?}`) or a `NoteDish` (`{kind:'note', text}`). The list is ordered and the order is what the UI renders — there's no semantic role per position.

Per-meal-type dish count lives in `userSettings.template.mealDishCounts: { breakfast?: 1|2|3, lunch?: 1|2|3, dinner?: 1|2|3, snack?: 1|2|3 }`. Default 1. The generator maps:
- `1` → matcher restricted to `course IN ('main') OR course IS NULL` (single-plate convention; starters and desserts are auto-skipped).
- `2` → `[starter, main]`.
- `3` → `[starter, main, dessert]`.

When a course has no candidates, the generator emits a warning `no_<course>_available_<meal>_d<dayIndex>` in the `POST /menu/generate` response and produces fewer dishes for that slot. The UI can surface the warning list as a toast.

Notes are excluded from the matcher and added only via manual UI (`+ Añadir plato` → "Añadir nota") or `POST /menu/:menuId/day/:day/meal/:meal/dish` with `{kind:'note', text}`. Notes contribute zero to shopping list and nutrition aggregation.

### Dish-level routes

All under `/menu/:menuId/day/:day/meal/:meal/dish` and gated by the `:menuId` IDOR guard (400 non-UUID / 404 unknown / 403 foreign — see "Access control" below):

- `POST` — append a dish. Body discriminated by `kind`: `{kind:'recipe', recipeId, course?, pinnedType?}` or `{kind:'note', text}` (text ≤120 chars).
- `DELETE /:position` — remove. Subsequent positions decrement; empty `dishes[]` is allowed (slot remains, UI shows "+ Añadir plato" placeholder).
- `PATCH /:position` — `{text?, pinnedType?, newPosition?, course?}`. Precedence: if `newPosition` is present, it's the only operation (pure reorder); otherwise patches text/pinnedType/course. Fields that don't apply to the dish kind are silently ignored.
- `POST /:position/regenerate` — Aleatorio on one dish; respects its `course`. 400 on note dishes; 409 when no candidates match.

### Slot-level vs dish-level state

- **Slot-level** (unchanged surface): `servings`, `locked`, slot-DnD move (whole slot moves between (day, meal) via `POST /move-slot`).
- **Per-dish**: `course`, `pinnedType`, `variant: 'planned' | 'leftover'`, `leftoverOf.dishPosition`, in-slot reorder via `PATCH .../dish/:position {newPosition}`.

`POST /menu/:menuId/day/:day/meal/:meal/leftover` clones only the recipe dishes of the source slot (notes are skipped — they don't propagate as "leftovers").

`PUT /menu/:menuId/day/:day/meal/:meal` (regenerate-meal) re-picks **only the recipe dishes** of the slot, preserving each dish's `course` and any `NoteDish` entries at their positions.

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
- `POST /menu/:menuId/move-slot` (auth) — atomic move/swap of a slot to another day/meal. Body `{ fromDay, fromMeal, toDay, toMeal }`. Empty target → move (source slot becomes empty). Occupied target → swap. Locked source or target → **400**. Used by the drag-and-drop in "Vista semana" so the client doesn't sequence DELETE + POST and risk leaving the menu half-mutated.

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

## Desktop layouts (lg+)

**Vista Semana** is the default view at `lg+` (≥1024 px) when no preference is stored in `localStorage.ona.menu.view` — desktop users land on the 7-day overview without scrolling. Below `lg`, Vista Día remains the default. The user can switch manually at any breakpoint; the choice persists.

**Vista Semana**: 7-column grid, one column per day Mon-Sun. Each day section becomes its own card with `border` + `rounded-2xl`. Today's column keeps its soft terracotta tint. Sticky-header behaviour drops at `lg+` (each column is short enough that floating headers would overlap). DnD between any two cells works as before via `POST /menu/move-slot` — the droppable IDs are scoped per `{dayIndex, meal}`, so cross-column drops resolve correctly regardless of visual orientation. Each meal slot at `lg+` renders as an editorial tile: photo as 4:3 hero on top, time chip overlaid top-right, meal eyebrow + recipe name (Fraunces, line-clamped to 2) below.

**Vista Día**: at `lg+` the outer container widens to `max-w-[1200px]` and the horizontal day-strip hides via `lg:hidden` (since Vista Semana is the desktop default, the day-strip is rarely seen there; if the user opts back into Vista Día, the strip stays hidden to avoid duplicating the desktop-sidebar's role). The day stack itself remains structurally unchanged. A future polish PR may add a vertical day-strip + day-preview rail as a 3-column split — out of scope for this migration.

Below `lg`, both views keep their existing single-column / horizontal-strip layouts.

## Access control (IDOR guards)

Every menu route is scoped to the caller — a logged-in user can only read or
mutate their own menus (or, when `SHARED_HOUSEHOLD_SCOPE` is on, those of a
fellow household member). This closes a former gap where any authenticated
user could read/modify any menu by id.

- `POST /menu/generate` **requires auth** and the body `userId` must equal the
  authenticated user (`403` otherwise). It used to be open — anyone could
  overwrite any user's week by passing their id; that is no longer possible.
- `GET /menu/:userId/:weekId` and `GET /menu/:userId/history` resolve the read
  scope from the **token**, never the path param. Requesting another user's id
  returns `403` unless they share your household.
- Every `/menu/:menuId/...` mutation (regenerate, add/delete/move slot, lock,
  ban, leftover, skip, servings) passes through a `:menuId` param guard:
  `400` if the id isn't a UUID, `404` if no such menu, `403` if it belongs to
  another user/household. Owner-or-same-household access mirrors the shopping
  list rule (`canAccessRow` in `scopeResolver.ts`).

## Constraints

- All menu routes require auth (including `POST /menu/generate`, which also
  enforces that the body `userId` matches the token)
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
