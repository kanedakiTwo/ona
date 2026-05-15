# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## User Capabilities

- Users can browse the recipe catalog as a 2-column grid of photo cards. Each card carries an ownership badge: **"ONA"** (system catalog, `authorId = null`) or **"Tuya"** (`authorId = user.id`). Recipes owned by other users render unlabelled. A segmented control above the search bar filters the grid by scope: **Todas** (default), **Mis recetas**, **Catálogo ONA**. The choice persists in `localStorage.ona.recipes.scope`
- Users can copy a system (or another user's) recipe into their own catalog with the **"Añadir a mis recetas"** button on the recipe detail (visible only when `recipe.authorId !== user.id`). The copy is independent — editing it doesn't affect the original — and inherits ingredients, steps, times, nutrition cache and image. The new row gets `internalTags: ['copied-from-catalog']` and `sourceType: 'manual'`
- Users can search recipes by name (case-insensitive substring match)
- Users can filter recipes by meal type (breakfast/lunch/dinner/snack), season, and max prep time
- Users can open a recipe detail view with hero photo, name, meta, ingredients (grouped), preparation steps, equipment, allergens, nutrition per serving, and notes/tips
- Users can change the number of diners on the detail view; ingredient quantities scale on the fly
- Users can favorite/unfavorite a recipe (toggle via heart button); the toggle is queued offline and replays on reconnect — see [PWA](./pwa.md)
- Users can create their own recipes (form at `/recipes/new`)
- Authors can edit their own recipes via `/recipes/[id]/edit` (a "Editar receta" link appears under the Cook-mode CTA on the detail page; hidden for system recipes and recipes owned by another user). The edit form supports name, servings, prep/cook times, difficulty, meals, seasons, tags, full ingredient list, full step list, notes and tips. Voice users can edit metadata fields (name, prepTime, cookTime, difficulty, notes, tips) via the `edit_recipe` skill and ask "abre el editor" to navigate to the form for ingredient/step changes
- Authors can delete their own recipes (not system recipes)
- Users can extract a recipe from a photo (image upload → AI extraction)
- Users can import a recipe from a URL — either a YouTube video or a web article — via `/recipes/new`. The server fetches the page, tries `schema.org/Recipe` JSON-LD first, falls back to Mozilla Readability + Claude for articles, and uses video description + caption transcript for YouTube. The LLM also classifies whether the content is actually a recipe; non-recipes return a clear Spanish error. The persisted recipe carries `sourceUrl` and `sourceType` so the origin can be displayed and re-extracted later
- Users can auto-create a missing ingredient from the `/recipes/new` form: if an ingredient name doesn't exist in the catalog, a "Crear nuevo ingrediente" option in the picker opens a modal showing USDA FoodData Central candidates (Foundation/SR Legacy first, Branded filtered out) plus per-100 g nutrition; the user picks one or "Crear sin nutrición". The new row is persisted with full nutrition + inferred allergens and slotted into the recipe form. Same plumbing is reused by the photo extractor and `apply:recipes --auto-create-missing` to avoid skipping recipes whose ingredients are merely absent from the catalog.
- Users can share a recipe via the native share sheet (Web Share API) from a Share2 button in the detail hero — see [PWA](./pwa.md)
- Users can start "Cooking mode" from the detail view ("Empezar a cocinar"); while active, a Wake Lock keeps the screen awake and a "Pantalla activa" badge appears (released on tap or navigation) — see [PWA](./pwa.md) and [Cooking Mode](./cooking-mode.md)

## Recipe Sources

**System / Shared recipes** (`authorId = null`):
- Tagged internally with `compartida` (not shown publicly — see *Tag Visibility* below)
- Curated through the regeneration script (see [Recipe Quality](./recipe-quality.md)); each recipe must pass the lint validator before being seeded
- Read-only for users (cannot edit or delete)
- Cards show the **"ONA"** badge in the catalog grid

**User-created recipes** (`authorId = user.id`):
- Editable and deletable by the author
- Created via `/recipes/new`, AI extraction from photo, AI extraction from URL, or by copying from the ONA catalog (`POST /recipes/:id/copy`)
- Must pass the same lint rules on save
- Cards show the **"Tuya"** badge in the catalog grid

**Copied recipes**: when the user taps "Añadir a mis recetas" on a system recipe (or any recipe they don't own), the server clones the row and all child rows (`recipe_ingredients`, `recipe_steps`) with new UUIDs, remaps `step.ingredientRefs` from old → new ingredient row ids, sets `authorId = req.userId`, drops the source's `compartida` / `auto-extracted` / `from-url` internal tags and adds `copied-from-catalog`, sets `sourceType = 'manual'`, and returns the new recipe. The user is then the author of an independent copy.

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
- `nutritionPerServing` — cached object: `{ kcal, proteinG, carbsG, fatG, fiberG, saltG }`. Computed when the recipe is saved
- `tags` — public-facing string array, normalized (no internal labels, no `meal`/`difficulty` duplicates)
- `internalTags` — string array hidden from public UI (e.g. `compartida`, `auto-extracted`, `from-url`)
- `sourceUrl` — origin URL when imported from an article / YouTube video (null otherwise)
- `sourceType` — provenance enum: `manual | image | article | youtube` (null for legacy seeded rows)
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
- `POST /recipes/extract-from-image` (auth) — AI recipe extraction; returns the `ExtractedRecipe` draft (ingredients matched against catalog + warnings) so the user can review and adjust it on `/recipes/new` before saving. The draft is **not** persisted server-side — the user submits the normal `POST /recipes` from the form, which runs the lint validator. Defensive JSON parse tolerates ```json…``` fenced responses from the model
- `POST /recipes/:id/copy` (auth) — clone a recipe into the caller's catalog. Refuses with 409 if the user already owns the source. Returns the new recipe
- `POST /recipes/extract-from-url` (auth) — body `{ url }`. Detects YouTube vs article by hostname. Articles try `schema.org/Recipe` JSON-LD, then fall back to Mozilla Readability + Claude. YouTube combines title + description + caption transcript and feeds it to Claude. Unlike `/extract-from-image`, this endpoint persists the recipe directly and returns `{ recipe, warnings }` (the frontend then redirects to the detail page). Returns 422 with `{ isRecipe: false, reason }` when the LLM decides the URL doesn't describe a cookable recipe, and 422 with a Spanish message when a YouTube video has neither captions nor a usable description
- `POST /recipes/:id/regenerate-image` (auth, author only) — generate a new editorial-style hero photo via AiKit Imagen-fal. Builds the prompt from `recipe.name` + top 4 ingredients (by `displayOrder`) + a meal-aware framing hint + a fixed cream/wood/warm-light cookbook style suffix; calls `POST cms.aikit.es/api/free-form-tools/image-generation/generate-imagen-fal` with `Authorization: Bearer aik_…`; pipes the PNG through sharp (1200 px wide, JPEG q85 + mozjpeg) and writes to `${IMAGE_STORAGE_DIR}/<recipeId>.jpg`; updates `recipes.image_url` to `${IMAGE_PUBLIC_URL_BASE}/<recipeId>.jpg`. Per-user monthly quota (`IMAGE_GEN_MONTHLY_LIMIT`, default 20) tracked atomically on `users.image_gen_count` + `users.image_gen_month_key`: a single conditional UPDATE bumps the counter only if the user is under the cap and the month matches; mismatched month → reset to 1; cap reached → 429 with `{ quota: { used, limit, monthKey } }` and no AiKit call. Failed generations refund the slot. System recipes (authorId null) and other-user recipes return 403; missing `AIKIT_API_KEY` returns 503. Frontend (`useRegenerateRecipeImage`) renders a "Regenerar imagen" button on the author-side detail page and an "Imagen" section in `/recipes/[id]/edit`; both show a "(X/20 este mes)" counter and append `?v=<updatedAt>` to the hero src to bust the long-cached browser image after each regen

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)
- v1 of the URL importer cannot process YouTube videos that lack both captions and a recipe-bearing description (no Whisper / yt-dlp / Gemini fallback yet)

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
- [apps/api/src/services/recipeUrlExtractor.ts](../apps/api/src/services/recipeUrlExtractor.ts) — URL extraction orchestrator (article + YouTube)
- [apps/api/src/services/sources/article.ts](../apps/api/src/services/sources/article.ts) — JSON-LD parser + Readability fallback
- [apps/api/src/services/sources/youtube.ts](../apps/api/src/services/sources/youtube.ts) — video id parser, transcript fetch, prompt composer
- [apps/api/src/services/sources/sourceType.ts](../apps/api/src/services/sources/sourceType.ts) — URL → 'youtube' | 'article'
- [apps/web/src/components/recipes/UrlRecipeImport.tsx](../apps/web/src/components/recipes/UrlRecipeImport.tsx) — URL input UI in `/recipes/new`
- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — lint validator (new)
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — USDA-backed auto-create + Levenshtein dedupe (new)
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /ingredients/suggest`, `POST /ingredients/auto-create`
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — open ingredient picker + auto-create modal (new)
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient` (new)
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — regenerated catalog
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/api/src/services/recipeImageGenerator.ts](../apps/api/src/services/recipeImageGenerator.ts) — shared prompt builder + AiKit Imagen-fal client + sharp pipeline. Used by both the bulk script and the `regenerate-image` endpoint
- [apps/api/scripts/generateRecipeImages.ts](../apps/api/scripts/generateRecipeImages.ts) — bulk hero-image regenerator for the seed (writes slug-keyed JPGs to `apps/web/public/images/recipes/`); flags `--dry-run`, `--only=<slug,…>`, `--include-user`, `--concurrency=N`, `--aspect=4:3|1:1|3:4`, `--skip-existing`, `--no-db`
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts) — `useRegenerateRecipeImage(recipeId, userId)` mutation
- [apps/web/src/hooks/useUser.ts](../apps/web/src/hooks/useUser.ts) — `useUser(id)` returns the live `imageGenQuota` for the regenerate counters
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx)
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [apps/web/src/components/recipes/ServingsScaler.tsx](../apps/web/src/components/recipes/ServingsScaler.tsx) — diner +/- control (new)
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
