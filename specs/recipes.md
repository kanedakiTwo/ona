# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## User Capabilities

- Users can browse the recipe catalog as a 2-column grid of photo cards
- Users can search recipes by name (case-insensitive substring match)
- Users can filter recipes by meal type (breakfast/lunch/dinner/snack), season, and max prep time
- Users can open a recipe detail view with hero photo, name, meta, ingredients (grouped), preparation steps, equipment, allergens, nutrition per serving, and notes/tips
- Users can change the number of diners on the detail view; ingredient quantities scale on the fly
- Users can favorite/unfavorite a recipe (toggle via heart button); the toggle is queued offline and replays on reconnect — see [PWA](./pwa.md)
- Users can create their own recipes (form at `/recipes/new`)
- Authors can edit and delete their own recipes (not system recipes)
- Users can extract a recipe from a photo (image upload → AI extraction)
- Users can share a recipe via the native share sheet (Web Share API) from a Share2 button in the detail hero — see [PWA](./pwa.md)
- Users can start "Cooking mode" from the detail view ("Empezar a cocinar"); while active, a Wake Lock keeps the screen awake and a "Pantalla activa" badge appears (released on tap or navigation) — see [PWA](./pwa.md) and [Cooking Mode](./cooking-mode.md)

## Recipe Sources

**System / Shared recipes** (`authorId = null`):
- Tagged internally with `compartida` (not shown publicly — see *Tag Visibility* below)
- Curated through the regeneration script (see [Recipe Quality](./recipe-quality.md)); each recipe must pass the lint validator before being seeded
- Read-only for users (cannot edit or delete)

**User-created recipes** (`authorId = user.id`):
- Editable and deletable by the author
- Created via `/recipes/new` or AI extraction from photo
- Must pass the same lint rules on save

## Recipe Model

Each recipe has:
- `name` — required, text
- `imageUrl` — optional
- `servings` — required, positive integer; the canonical number of diners the listed quantities cover
- `yield` — optional human-readable string (e.g. "12 albóndigas", "1 L de salsa")
- `prepTime`, `cookTime`, `activeTime` — minutes (integer, optional, editable)
- `totalTime` — minutes, derived by the API: sum of `step.durationMin` if all steps have it, else `prepTime + cookTime`
- `difficulty` — enum `easy | medium | hard`
- `meals` — array of `breakfast | lunch | dinner | snack`
- `seasons` — array of `spring | summer | autumn | winter` (empty = all seasons)
- `equipment` — string array of tools required (e.g. "horno", "procesador", "batidora")
- `allergens` — string array (auto-aggregated from ingredients on save; see [Nutrition](./nutrition.md))
- `notes`, `tips`, `substitutions`, `storage` — long-form text, optional
- `nutritionPerServing` — cached object: `{ kcal, protein_g, carbs_g, fat_g, fiber_g, salt_g }`. Computed when the recipe is saved
- `tags` — public-facing string array, normalized (no internal labels, no `meal`/`difficulty` duplicates)
- `internalTags` — string array hidden from public UI (e.g. `compartida`, `auto-extracted`)
- `authorId` — null for system, user id for user-created
- `ingredients` — list of recipe-ingredient rows (see below)
- `steps` — list of step rows (see below)

### RecipeIngredient

Each row:
- `ingredientId` — references the global ingredient catalog
- `ingredientName` — denormalized for display
- `section` — optional string for sub-grouping (e.g. "Para la masa", "Para la salsa"); `null` = ungrouped
- `quantity` — number
- `unit` — enum `g | ml | u | cda | cdita | pizca | al_gusto`
- `optional` — boolean
- `note` — optional inline note (e.g. "picada fina", "del día anterior")
- `displayOrder` — integer, controls UI ordering inside its section

### Step

Each row:
- `index` — integer, position in the recipe (0-based)
- `text` — required, the instruction sentence
- `durationMin` — optional integer, time the step itself takes
- `temperature` — optional integer °C (oven, pan, water bath…)
- `technique` — optional short label ("sofreír", "hornear", "marinar")
- `ingredientRefs` — array of `recipeIngredientId`s used in this step (used to render quantities inline and for cooking-mode highlighting)

## Tag Visibility

The catalog and detail view display only **public** tags. Filtering rules:
- Any tag in `internalTags` is excluded
- Tags that duplicate the `meal`, `season`, or `difficulty` fields are excluded (no more "compartida · easy · lunch" leaking)
- All tags are normalized to the user's display language (Spanish)

## Quantity Scaling

When the user changes the diner count from `recipe.servings` to `target`:
- Each ingredient `quantity` is multiplied by `target / recipe.servings`
- Counted units (`u`) round to the nearest whole; if the result is non-integer, the UI shows a small note (e.g. "1.5 huevos → redondea a 2")
- `pizca` and `al_gusto` never scale
- Mass and volume units round to a culinary-friendly precision (1 g, 5 g, 25 g, 50 g bands depending on magnitude)
- Step text references via `ingredientRefs` are recomputed at the same scale

## Display Constraints

- A `prepTime` of `0` (or any falsy value) is **not** rendered on cards or detail meta — instead, the field is omitted entirely (fixes the prior "0" leak)
- All meal/season labels go through `MEAL_LABELS` / `SEASON_LABELS` before render (no raw `lunch`/`dinner` in the UI)
- Spanish copy uses correct accents (Otoño, Año, Añadir, Preparación) — no mojibake fallbacks
- The detail view groups ingredients by `section` if any ingredient has one set; otherwise renders a flat list
- The "Para X" caption next to the ingredients title reflects the live scaler value, not a hardcoded number

## API Endpoints

- `GET /recipes?search=&meal=&season=&maxTime=&perPage=&page=` — list with filters; returns the lightweight card shape
- `GET /recipes/:id?servings=N` — single recipe; if `servings` is provided and differs from `recipe.servings`, quantities are scaled server-side and a `scaledFrom` field is included
- `POST /recipes` (auth) — create user recipe; runs lint validator
- `PUT /recipes/:id` (auth, author only) — update; runs lint validator and recomputes `nutritionPerServing` and `allergens`
- `DELETE /recipes/:id` (auth, author only)
- `GET /user/:id/recipes` (auth) — user's own + favorited recipes
- `POST /user/:id/recipes/:recipeId/favorite` (auth) — toggle favorite
- `POST /recipes/extract-from-image` (auth) — AI recipe extraction; output goes through the lint validator before being persisted

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)

## Related specs

- [Cooking Mode](./cooking-mode.md) — fullscreen step-by-step UX, uses `step.durationMin` and `step.ingredientRefs`
- [Nutrition](./nutrition.md) — how `nutritionPerServing` and `allergens` are computed
- [Recipe Quality](./recipe-quality.md) — lint validator and LLM-assisted regeneration of the seed
- [Menus](./menus.md) — recipes are selected for menu slots, scaled to household size
- [Shopping](./shopping.md) — ingredients aggregate into a unit-aware shopping list
- [Design System](./design-system.md) — RecipeCard and detail page styling
- [PWA](./pwa.md) — favorite-toggle offline queue, Web Share button on the detail page, Wake Lock cooking-mode badge

## Source

- [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts)
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts)
- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — lint validator (new)
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — regenerated catalog
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx)
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [apps/web/src/components/recipes/ServingsScaler.tsx](../apps/web/src/components/recipes/ServingsScaler.tsx) — diner +/- control (new)
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
