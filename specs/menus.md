# Menus

Weekly meal plan generation and management.

## User Capabilities

- Users can generate a weekly menu (Monday–Sunday) for the current week or any future week with one click. A week with no dishes (new or emptied) shows a "Tu semana está *en blanco*" card with **"Generar mi menú"** above its empty slots; otherwise **Regenerar semana**
- **Layout "D · Luz y foto"** (2026-10-08). The header is compact: eyebrow "Semana del 5 al 11 de octubre", h1 "Hoy, *jueves*" (or "Mañana, *viernes*" / "*Viernes* 9" for another day), and one **"···"** that opens the **week sheet**. There is no greeting, "Nº", or progress bar. Week actions live in that sheet; every per-meal action lives behind the meal's own "···" (the **meal sheet**). Nothing is lost: each action below says where it lives
- Users can move between weeks with **‹ ›** beside the week range in the page header ("Semana anterior" / "Semana siguiente", mobile and desktop, since 2026-10-10), or from the week sheet (‹ › around "Esta semana" / "Próxima semana" / "Semana pasada" / "En N semanas" / "Hace N semanas", plus "Volver a esta semana"), or by editing `?week=YYYY-MM-DD`. On another week a "<label> · volver a hoy" link sits under the h1. The selected day resets to today (current week) or Monday
- Past weeks are read-only. Meals stay visible (with "Empezar a cocinar"), but the "···" buttons, Regenerar, Vaciar and Generar are hidden. A past week without a menu reads "Sin menú esta semana. Esta semana ya pasó. Vuelve a la actual para planificar."
- **Vista día** (mobile default) shows one day. A day strip (L M X J V S D + date; selected = ink pill, today in terracotta, "sin cocinar" days struck through) switches the day. The day's **featured meal** (the first one, chronologically, that holds a recipe) is a full-bleed photo with an overlapping caption card: eyebrow "Comida · 28 min · 3 raciones", the title (links to the recipe), an ink pill **"Empezar a cocinar"** (→ `/recipes/:id/cook?servings=N`) and "···". The other meals are rows (photo, eyebrow "Cena · 25 min", title → recipe, "···"). An empty slot is one quiet **"Añadir plato"** card (opens AddDishSheet) + "···". Below the meals: **"Añadir comida"** and **"Saltar día"**. If the featured recipe has no photo (or it fails to load) the hero drops the image area: the caption is a normal card at the top with the meal's small icon on a bone square, and the name appears once. Other photo-less recipes get a bone block with the small meal icon, never a grey placeholder or a second copy of the name
- **Vista semana** (mobile; toggled from the week sheet, persisted in `localStorage.ona.menu.view`) is a vertical stack of day sections (`WeekGridView`). Each has a sticky header (tap = that day in Vista día), rows with thumbnail, meal eyebrow, `shortRecipeName` title and time chip, and on mount it scrolls today into view. **Drag-and-drop**: drop a row on another to swap the two slots via `POST /menu/:menuId/move-slot` (`pointerWithin`; drops outside rows are no-ops). Each row's portalled "..." menu offers Elegir receta, Aleatorio, Añadir plato, Bloquear/Desbloquear, Vetar receta and Quitar slot. Notes edit inline. Skipped days show "Reactivar"
- **Meal sheet** (single-recipe slot): Ver receta, **Elegir otra receta** (`RecipePickerSheet`, full catalogue with "Mimoia"/"tuya" badges and name search; pins via `PUT /menu/:menuId/day/:day/meal/:meal` `{ recipeId }`; 0 results offers **"Crear receta «<query>»"** → `/recipes/new?name=<query>`), **Cambiar al azar** (matcher), **Añadir plato** (AddDishSheet), **Tipo de comida**, **Fijar/Desfijar**, **Vetar esta receta**, **Marcar como cocinada** (cook log with menu/day/meal context), the **Comensales** stepper and **Quitar <comida>**. Multi-dish and note slots show a "Platos" list instead (drag to reorder, "Cambiar" per dish, quitar, edit notes) plus Añadir plato, Fijar, Comensales and Quitar. Empty slots get Añadir plato, Fijar, Comensales and Quitar. While a slot is locked ("Fijada" chip), every change except Desfijar is disabled. Regenerations and lock toggles are queued offline; offline replay of a manual pick loses its `recipeId` (the server auto-picks)
- Users can shape a single week without touching their preferences. **Quitar <comida>** removes the slot (`DELETE /menu/:menuId/day/:day/meal/:meal`), and the day's **"Añadir comida"** opens a sheet listing the meals the day lacks (`POST …/meal/:meal`). Both apply to **this menu only**: the profile's `mealTemplate` is untouched, so next week follows the original preferences
- Users can override the diner count for one slot with the meal sheet's **Comensales** −/+ stepper ("Solo hoy · Quitar"). It is persisted as the slot's `servings` (`PATCH /menu/:menuId/day/:day/meal/:meal` `{ servings: number | null }`; `null` clears). `sumDinersByRecipe` in `shoppingList.ts` sums per-slot diners, so repeated recipes with different overrides scale independently. The caption's "N raciones" and the cook link use the override, else the household size
- Users can **veto** a recipe for the rest of the week: **Vetar esta receta** → confirm. It goes into `menu.banned_recipe_ids`, and the matcher excludes it from every later Aleatorio / Elegir-without-recipe / Añadir / whole-week regenerate. A collapsible "Vetadas esta semana" panel under the day lists each veto with "Levantar veto". Vetoes carry over when `POST /menu/generate` re-runs for the same week
- Users can mark a whole day **"sin cocinar"** with **"Saltar día"** (confirm). This empties every non-locked slot and persists the index on `menu.skipped_days`; whole-week regenerate skips the day. The day then shows "Día marcado sin cocinar." + **"Reactivar día"**, which only clears the flag (slots are re-added by hand or Aleatorio). Skipped days carry over across regenerates
- Users can **fix a meal type** with **Tipo de comida** → a sheet of 10 tags (Cremas, Legumbres, Pizza, Asiático, Mediterráneo, Ensalada, Parrilla, Batch cooking, Pasta, Arroz). Aleatorio / Elegir-without-recipe then only pick recipes whose `tags` include it (`PATCH … { pinnedType: MEAL_TYPE_TAGS | null }`). The pin survives recipe swaps and "Quitar pin" clears it. An empty intersection returns 404 with a Spanish hint
- **Note dishes** ("comemos fuera", "+ pan") are edited inline: in the meal sheet's "Platos" list (Vista día / desktop) and in Vista semana rows. Enter / blur persists via `PATCH /menu/:menuId/day/:day/meal/:meal/dish/:position` `{ text }`, and Esc reverts
- Users can mark a slot as a **leftover** from a previous slot via `POST /menu/:menuId/day/:targetDay/leftover`, body `{ sourceDay, sourceMeal, targetMeal }`. The target slot is cloned with `kind: 'leftover'` and a `leftoverOf` back-reference; the shopping-list aggregator handles the repeated `recipeId` via `sumDinersByRecipe` so quantities collapse onto the source row without double-counting. The meal shows a terracotta "Sobras de [día] [comida]" chip and its sheet hides Elegir / Cambiar al azar / Tipo / Vetar, since the leftover is tied to its source. *UI affordance to trigger the endpoint from the card itself is deferred to a follow-up — the endpoint is available for the assistant via the voice skill.*
- Users can regenerate the whole week from the week sheet / desktop header (**Regenerar semana**). It re-runs the algorithm and keeps locked slots. **Vaciar semana** (week sheet, confirm) keeps them too
- Users can share the week as text with a link (**Compartir** in the week sheet in both views; desktop: **Compartir semana**) via `menuShareText`
- Users can view past menus via `/menu/history` (**Historial** in the week sheet): one paper card per saved menu ("Semana del 5 al 11 de octubre", creation date, up to four `RecipeCover` thumbnails of its recipes — photos first, "+N" when there are more; `lib/menuHistory.ts`), linking to `/menu?week=<weekStart>`. Thumbnails reuse the per-week menu query of `/menu` (one `GET /menu/:userId/:weekStart` per distinct week)
- Users can tap a meal photo or title to open the recipe detail
- Users can opt in to local meal-time notifications (breakfast / lunch / snack / dinner times configured in the profile's "Recordatorios" card) — the app fires a reminder at the chosen times — see [PWA](./pwa.md)

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

1. Loads user profile (sex, age, weight, height, activity level), restrictions, and favorites. The meal template defaults to **lunch + dinner** every day (breakfast is opt-in from the profile's plantilla). Onboarding answers count too (`onboardingPreferences.ts`): recipes sharing a word with a *favourite dish* get the favourites' 2× weight, and priority **Rapidez** or cooking **Poco** caps Mon–Fri prep time at 30 min (unless `time_available` memory says otherwise). Priority *Ahorro*/*Variedad* and cooking *3-4 veces* don't change the generator yet
2. Loads every recipe the user can see — system catalogue + their own + their household's (never another user's private recipes, see [Recipes → Recipe visibility](./recipes.md)) — with ingredient names and cached `nutritionPerServing`
3. Calculates a target calorie count using BMR × activity × number of meal slots
4. Detects current season
5. Runs up to **200 iterations**, each time:
   - Builds a candidate menu by picking a random matching recipe per slot (skipping locked slots)
   - Scores each candidate using **real per-serving nutrition** from `recipe.nutritionPerServing` × the user's `householdSize / recipe.servings` ratio
   - Fitness (lower is better, in percentage points) = ½ × calorie deviation + macro deviations (carbs/fat/protein vs `TARGET_MACROS`) + **ONA's opinion** (`metabolicScore.ts`, kb/10 mandamientos: insulin and inflammation over calories): 3 × 100 × (1 − metabolic quality) + 0.5 × 100 × (1 − plant variety). Quality = mean per-recipe score from ingredient names (+ plants, oily fish, olive oil, fermented; − refined carbs/sugar, processed meats and seed oils). Variety = distinct plants / 20 per week. **Seasonality is read from the ingredients too** (Spanish calendar, `SEASONAL`): in-season produce +0.1, out-of-season −0.15 (±0.3 cap). The season tags are unreliable (26 of 56 prod recipes are tagged all four seasons). Measured on the local catalogue: menu quality from −0.08 to +0.14 on average, at a cost of ~3 macro points (2026-10-07)
   - Keeps the best (lowest fitness) menu seen so far; stops early if fitness drops below `OPTIMAL_FITNESS`

Recipes whose `nutritionPerServing` is not yet cached (e.g. unmapped ingredients) fall back to the legacy ingredient-name heuristic and are deprioritized when better-data alternatives exist.

For each meal slot, the matcher (`recipeMatcher.ts`) filters recipes by:
- Recipe's `meals[]` includes the target meal type
- Recipe's `seasons[]` includes current season (or is empty = always-available)
- Recipe ID is not already used elsewhere in the menu (no repeats within the week)
- The recipe doesn't break the user's **restrictions** (allergies, diets, free text) or **dislikes** — see *Restrictions & allergies* below

### Restrictions & allergies

`services/dietaryRestrictions.ts` compiles each entry once per call. Restrictions come from the profile (`users.restrictions`) **and** long-term memory (`user_memories.restrictions`, e.g. "soy celíaco" told to the assistant), merged by `mergeRestrictions`.
- **Allergies** ("sin gluten", "sin lactosa"/"sin lácteos", "huevo", "frutos secos" (also excludes peanuts), "cacahuetes", "marisco" (crustaceans + molluscs), "pescado", "soja", "apio", "mostaza", "sésamo", "sulfitos"…, with prefixes like "alergia a…", "intolerante a…" stripped) map to EU allergen tags. A recipe is out if the tag appears in its `allergens` union, in any ingredient's catalogue `allergen_tags`, or in the name-based inference (`inferAllergenTagsFromName`, conservative).
- **Diets**: "vegetariano" (no meat or fish/seafood, by curated whole-word ingredient terms + fish tags), "vegano" (also no dairy, egg, honey, gelatine), "pescetariano", "sin carne", "sin cerdo", "halal".
- **Anything else** ("cilantro", "picante") and every **dislike** are whole-word, accent/case-insensitive, plural-tolerant ingredient terms ("cebolla" excludes "cebolla morada" and "cebollas", not "cebollino").
- Before 2026-10-07 this was an exact ingredient-name match, so allergies and diets filtered nothing.
- Every path that picks recipes on ONA's own initiative applies it: weekly generation, "Aleatorio" slot regenerations, add-course, and the assistant's random swap and `suggest_recipes`. Those paths all load through `services/matchableRecipes.ts`. An explicitly named recipe (assistant `swap_meal` by name) that breaks an allergy/diet is **not placed**: the tool returns the conflict and the model must get the user's confirmation (`confirmRestriction: true`). Dislikes still yield to explicit requests.
- The onboarding and profile chips share one list, `RESTRICTION_PRESETS` (`@ona/shared`), and a test checks that every preset compiles to a real rule.

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
- Locked slots (with vetoes and "sin cocinar" days) carry into every new row for the week: `POST /menu/generate` (regenerate and "Vaciar semana") and the assistant's `generate_weekly_menu`, via `services/menuWeek.ts`. Before 2026-10-07 regenerate wrote `locked: {}` and the locked dishes were lost. Their recipes go into `usedRecipeIds` first, so the rest of the menu doesn't repeat them
- **No accidental wipes**: `empty: true` over a week that has dishes → **409 `MENU_NOT_EMPTY`** unless `force: true`. Only the confirmed "Vaciar semana" sends `force`. The /menu page auto-creates an empty week only on a real 404 (`ApiError.status`). A failed GET (500, offline) shows "No hemos podido cargar tu menú" + "Reintentar" and never writes. Covered by `menuWeekRoute.smoke.ts` + `e2e/menu-load-failure.spec.ts`

## Menu Logs

Every generated menu also creates a `menu_logs` row with:
- Total calories for the week
- Aggregated nutrient profile (vitamins, minerals, etc.)
- Used to update `user_nutrient_balance` (running balance for the advisor)

## Desktop layouts (lg+)

At `lg+` (≥1024 px) `/menu` always renders `MenuDesktop`; the Día/Semana preference only applies below `lg`.
- **Header row**: eyebrow + "Hoy, *jueves 8*" on the left; **Compartir semana**, **Regenerar semana** and the week "···" on the right.
- **Hero row** (`1.75fr / 1fr`): the selected day's featured meal as a 420 px photo card with the caption card and "Empezar a cocinar" (no photo → the same compact icon card as mobile, so the row is shorter). On the right sit the day's other meals (the first as a 222 px photo card, each with "···"), a preview of the next day ("Mañana, viernes": thumbnail + "Comida: …"), and "Añadir comida" / "Saltar día".
- **"La semana"**: 7 columns. Each has the day label (click = show that day in the hero row; today in terracotta; the selected column is tinted), a 118 px photo tile of the featured meal with its full name in Fraunces (no ellipsis), and the other meals as text lines ("Cena: …"; empty → "+ añadir"). Skipped days show "Sin cocinar" + "Reactivar".
- **Drag-and-drop**: every tile and line is a drop target and, when it holds a recipe, a drag source (mouse or keyboard Space). A drop swaps the two slots via `POST /menu/:menuId/move-slot`, the same contract as Vista semana. Each tile and line has a "···" for the same meal sheet; it shows on hover/focus with a hover-capable pointer and is always visible on touch. Covered by `e2e/menu-redesign.spec.ts`.

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
- [apps/api/src/services/metabolicScore.ts](../apps/api/src/services/metabolicScore.ts) — per-recipe metabolic profile + weekly quality/variety for the fitness
- [apps/api/src/services/menuWeek.ts](../apps/api/src/services/menuWeek.ts) — what a week's regeneration carries over (locks, vetoes, skipped days) + `menuHasDishes`
- [apps/api/src/services/dietaryRestrictions.ts](../apps/api/src/services/dietaryRestrictions.ts) — restrictions/dislikes → allergen tags + ingredient terms
- [apps/api/src/services/matchableRecipes.ts](../apps/api/src/services/matchableRecipes.ts) — the one recipe loader for every matcher path (visibility, fit maps, frequency, allergens)
- [packages/shared/src/constants/restrictions.ts](../packages/shared/src/constants/restrictions.ts) — `RESTRICTION_PRESETS`
- [apps/api/src/services/recipeMatcher.ts](../apps/api/src/services/recipeMatcher.ts) — slot matcher
- [apps/api/src/services/calorieCalculator.ts](../apps/api/src/services/calorieCalculator.ts)
- [apps/api/src/services/nutrientCalculator.ts](../apps/api/src/services/nutrientCalculator.ts)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx)
- [apps/web/src/components/menu/WeekStrip.tsx](../apps/web/src/components/menu/WeekStrip.tsx) — day strip
- [apps/web/src/components/menu/DayMeals.tsx](../apps/web/src/components/menu/DayMeals.tsx) — hero, rows, empty card, day footer · [MealOptions.tsx](../apps/web/src/components/menu/MealOptions.tsx) — meal sheet · [WeekActionsSheet.tsx](../apps/web/src/components/menu/WeekActionsSheet.tsx) · [MenuDesktop.tsx](../apps/web/src/components/menu/MenuDesktop.tsx) · [WeekGridView.tsx](../apps/web/src/components/menu/WeekGridView.tsx) — mobile Vista semana
- [apps/web/src/lib/menuDay.ts](../apps/web/src/lib/menuDay.ts) — featured meal, headings, eyebrows (tested in `apps/api/src/tests/menuDayView.test.ts`)
- [apps/web/src/hooks/useMenu.ts](../apps/web/src/hooks/useMenu.ts) — `useGenerateMenu`, `useRegenerateMeal`, `useLockMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useUpdateSlotServings`
- [packages/shared/src/types/menu.ts](../packages/shared/src/types/menu.ts)
