# Menus

Weekly meal plan generation and management.

## User Capabilities

- Users can generate a weekly menu (Monday–Sunday) for the current week with one click
- Users can navigate between days of the week using a horizontal day strip (WeekStrip)
- Users can see the day's meals as photo cards (breakfast / lunch / dinner) with the recipe image
- Users can regenerate a single meal slot (gives a different recipe matching the slot); the request is queued offline and replays on reconnect
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
- Each filled slot is `{ recipeId, recipeName }`
- `locked` is a nested object: `{ "<dayIndex>": { "<meal>": true } }`

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
- A user's `userSettings.template` can override per-day meal slots
- If no menu exists for the requested week, `GET /menu/:userId/:weekId` returns 404
- The shopping page redirects users to `/menu` if no menu exists for the current week

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
- [apps/web/src/hooks/useMenu.ts](../apps/web/src/hooks/useMenu.ts)
- [packages/shared/src/types/menu.ts](../packages/shared/src/types/menu.ts)
