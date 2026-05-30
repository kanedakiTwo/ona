# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## User Capabilities

- **Anyone, no account needed**, can browse the public ONA catalogue at `/recipes-ona` and open any recipe detail at `/recipes-ona/[id]`. The public page only ever lists system recipes (`authorId IS NULL`) — even when a logged-in browser visits, the page forces an anonymous fetch via `apiPublic` so the catalogue is always the curated ONA set. The detail view shows ingredients, steps, nutrition and allergens but no favourite / copy / edit / cook-mode actions; a "Crear cuenta gratis" CTA appears at the bottom of both pages.
- Logged-in users browse the catalog at `/recipes` as a 2-column grid of photo cards. Each card carries an ownership badge: **"ONA"** (system catalog, `authorId = null`) or **"Tuya"** (`authorId = user.id`). Recipes owned by other users render unlabelled. A segmented control above the search bar filters the grid by scope: **Todas** (default), **Mis recetas**, **Catálogo ONA**. The choice persists in `localStorage.ona.recipes.scope`
- Users can copy a system (or another user's) recipe into their own catalog with the **"Añadir a mis recetas"** button on the recipe detail (visible only when `recipe.authorId !== user.id`). The copy is independent — editing it doesn't affect the original — and inherits ingredients, steps, times, nutrition cache and image. The new row gets `internalTags: ['copied-from-catalog']` and `sourceType: 'manual'`
- Users can search recipes by name (case-insensitive substring match)
- Users can filter recipes by meal type (breakfast/lunch/dinner/snack), season, and max prep time
- Users can open a recipe detail view with hero photo, name, meta, ingredients (grouped), preparation steps, equipment, allergens, nutrition per serving, and notes/tips
- Users can change the number of diners on the detail view; ingredient quantities scale on the fly
- Users can favorite/unfavorite a recipe (toggle via heart button); the toggle is queued offline and replays on reconnect — see [PWA](./pwa.md)
- Users can create their own recipes (form at `/recipes/new`)
- Authors can edit their own recipes via `/recipes/[id]/edit` (a "Editar receta" link appears under the Cook-mode CTA on the detail page; hidden for non-author non-admin viewers). The edit form supports name, servings, prep/cook times, difficulty, meals, seasons, tags, full ingredient list, full step list, notes and tips. Voice users can edit metadata fields (name, prepTime, cookTime, difficulty, notes, tips) via the `edit_recipe` skill and ask "abre el editor" to navigate to the form for ingredient/step changes
- **Admins can edit and delete any recipe** — system catalogue rows (`authorId IS NULL`) included — so the curation workflow lives in the same form as authoring. The "Editar receta" link surfaces on the detail page whenever `user.role === 'admin'`; a small "Admin" badge is shown next to it when the admin is editing someone else's recipe (or a system one). PUT/DELETE on the API short-circuit the author check when `req.user.role === 'admin'`, and the persisted row preserves the original `authorId` (admin edits on a system recipe stay system; admin edits on another user's recipe stay under that user). The "Añadir a mis recetas" copy affordance is hidden for admins (they have direct edit access instead)
- Authors can delete their own recipes (not system recipes; admins can delete any)
- Users can extract a recipe from a photo (image upload → AI extraction)
- Users can import a recipe from a URL — either a YouTube video or a web article — via `/recipes/new`. The server fetches the page, tries `schema.org/Recipe` JSON-LD first, falls back to Mozilla Readability + Claude for articles, and uses video description + caption transcript for YouTube. The LLM also classifies whether the content is actually a recipe; non-recipes return a clear Spanish error. The persisted recipe carries `sourceUrl` and `sourceType` so the origin can be displayed and re-extracted later
- Users can auto-create a missing ingredient from the `/recipes/new` form: if an ingredient name doesn't exist in the catalog, a "Crear nuevo ingrediente" option in the picker opens a modal showing USDA FoodData Central candidates (Foundation/SR Legacy first, Branded filtered out) plus per-100 g nutrition; the user picks one or "Crear sin nutrición". The new row is persisted with full nutrition + inferred allergens and slotted into the recipe form. Same plumbing is reused by the photo extractor and `apply:recipes --auto-create-missing` to avoid skipping recipes whose ingredients are merely absent from the catalog.
- Users can share a recipe via the native share sheet (Web Share API) from a Share2 button in the detail hero — see [PWA](./pwa.md)
- Users can start "Cooking mode" from the detail view ("Empezar a cocinar" — there are two entry points: an inline CTA at the top of the Preparación section and the full CTA card below). Both navigate to `/recipes/[id]/cook?servings=N`, which holds the screen-wake Wake Lock for the duration of the cook session — see [PWA](./pwa.md) and [Cooking Mode](./cooking-mode.md)
- Users can apply **structured ingredient overrides** to any recipe (ONA, theirs, or another user's) from the detail view. Toggling "Editar" on the Ingredientes section unlocks three actions per row — quitar, modificar cantidad/unidad/nota, and a "+ Añadir ingrediente" at the bottom of the section. In read-mode the recipe renders with the overrides baked in: removed rows are struck-through and faded, modified rows show the original quantity struck-through alongside the new value in terracotta, added rows live in a forest-green block underneath the original list. Overrides are per-household (one row per `(household, recipe)` in `recipe_notes.ingredient_overrides`), persist across navigation, and apply every time the household sees the recipe. The **shopping-list aggregator consumes these overrides** before scaling: removed lines drop out of the basket entirely, modified lines use the override's quantity/unit, and added lines (when the free-form `label` resolves against the ingredient catalog) get added to the basket. Adds whose name doesn't match the catalog stay visible on the recipe but are skipped by the shopping list. The recipe matcher itself still scores against the original ingredient list, so a "sin cebolla" override doesn't change which recipes ONA picks for the menu — it only changes what ends up in your basket and on the recipe view

## Recipe Sources

**System / Shared recipes** (`authorId = null`):
- Tagged internally with `compartida` (not shown publicly — see *Tag Visibility* below)
- Curated through the regeneration script (see [Recipe Quality](./recipe-quality.md)); each recipe must pass the lint validator before being seeded
- Read-only for users (cannot edit or delete)
- Cards show the **"ONA"** badge in the catalog grid

**Seed pipeline (how the system catalog is populated)**:
1. `apps/api/src/seed/recipes.ts` declares 79 recipe shells (name + meta). About 16 carry full `ingredients` / `steps` inline; the other 63 are intentional placeholders (`ingredients: []`, `steps: []`) that get filled in by a second pass.
2. `pnpm --filter @ona/api db:seed` inserts/updates ingredients from `seed/ingredients.ts`, then iterates `seedRecipes`. A recipe is **skipped** when none of its ingredient names resolve in the live `ingredients` table — so the placeholders silently no-op on first seed.
3. `apps/api/scripts/handAuthoredRecipes.ts` carries the full hand-authored bodies (name + qty + unit + steps + step-ingredient refs) for those 63 plus a handful of extras. It resolves names against the *current* prod catalog, refuses recipes whose ingredients are missing, and appends the resolved JSONL to `apps/api/scripts/output/regen-passed.jsonl`.
4. `pnpm --filter @ona/api apply:recipes [--soft-lint] [--auto-create-missing] [--dry-run]` reads that JSONL, runs `lintRecipe`, and inserts/updates by case-insensitive name match. `--soft-lint` downgrades `STEP_INGREDIENT_NOT_LISTED` / `ORPHAN_INGREDIENT` errors to warnings (one-off recovery escape hatch — do **not** rely on it in steady state, lint errors should be fixed upstream in the authoring data). `--auto-create-missing` (default true) inserts new ingredient rows via USDA when the JSONL references unknown names (not unknown UUIDs — those can't be recovered).
5. A real `image_url` for each recipe is either committed under `apps/web/public/images/recipes/<slug>.jpg` (seed assets) or generated on demand via `POST /recipes/:id/regenerate-image` for user copies.

**One-off prod maintenance scripts** (all default to dry-run, take `--execute` to commit):
- `scripts/dedupSystemRecipes.ts` — collapse duplicate system rows by name, rewriting `menus.days[].recipeId` to the canonical id before deleting.
- `scripts/linkSeedRecipeImages.ts` — for any system recipe with `image_url IS NULL`, attach `/images/recipes/<slug>.{jpg,jpeg,png,webp}` if a file already exists on disk (avoids re-paying AiKit for already-generated photos).
- `scripts/fillSeedCatalogGap.ts` — compute the names referenced by `seedRecipes` that are not yet in `ingredients`, try USDA for nutrition, insert (stub when USDA fails). Run before `db:seed` if the catalog is short.
- `scripts/bulkInsertIngredients.ts` — insert stub ingredients (zero nutrition + name-inferred allergens) from a newline-separated stdin list. Used to unblock `handAuthoredRecipes` when the catalog is missing 30+ names at once. Backfill nutrition afterwards with `pnpm seed:usda`.
- `scripts/recomputeRecipeNutrition.ts` — re-aggregate `recipes.nutrition_per_serving` and `recipes.allergens` from the live `ingredients` + `recipe_ingredients` data. Run after `seed:usda` (or after any catalog edit that changes nutrition) so the cached recipe nutrition isn't stale. Default scope is system recipes only; `--scope=all` includes user recipes.
- `scripts/insertMappedIngredients.ts` — read `ingredient-fdc-map.yaml`, insert a stub row for every mapping not yet present in the `ingredients` table, then run `seed:usda` to enrich with real USDA nutrition. This is the "yaml is source of truth → propagate to DB" idempotent step the seed pipeline was missing.

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
- `optional` — boolean. Editable from the recipe edit form (and the `/recipes/new` creation form) via an `opc` pill toggle next to each ingredient row. When true, the recipe detail renders an "opcional" badge inline and the shopping-list aggregator skips the row when scaling
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

## Ingredient prep requirements

Each `ingredients` row carries an optional `prep_requirements` JSONB column with the shape `{ method: PrepMethod, notes?: string }` where `PrepMethod` is a closed enum: `thaw_24h | thaw_48h | soak_overnight | soak_30min | temper_30min | marinate_2h | marinate_overnight | dough_rise_overnight`. The values encode the typical lead time so the scheduler doesn't need separate config — `PREP_METHOD_HOURS_BEFORE` in `@ona/shared` maps each value to a fixed number of hours.

Population is offline via the LLM script:

  1. `pnpm --filter @ona/api prep-requirements:populate` — loads every ingredient, asks Claude in batches of 50 (one ~$0.02 call per batch), writes JSONL to `apps/api/scripts/output/prep-requirements.jsonl`. Defaults to `null` whenever the LLM is unsure so the catalogue never gets noisy.
  2. Human review of the JSONL.
  3. `pnpm --filter @ona/api prep-requirements:apply` — re-reads the same file and `UPDATE`s the matching rows.

Idempotent: re-running populate overwrites the JSONL; re-running apply overwrites the DB. The scheduler ([Notifications](./notifications.md) / PR-D) reads this column together with `user_memories.prep_habits` to decide which alerts fire for which user when a recipe lands in their menu.

## Ingredient Resolution

Both the photo extractor (`POST /recipes/extract-from-image`) and the URL extractor (`POST /recipes/extract-from-url`) call the shared `matchIngredients()` helper in `apps/api/src/services/recipeExtractor.ts` to bind every extracted ingredient name to a catalogue row id. The cascade has three stages, each is the previous one's fallback:

1. **Token-set match** (`apps/api/src/services/ingredientTokenMatch.ts`, pure / no DB).
   - Tokenise both names lowercase, drop Spanish stop-words (`de`, `del`, `la`, `el`, `las`, `los`, `al`, `en`, `con`, `a`, `y`).
   - **exact**: token sets are equal — "aceite de oliva" ↔ "aceite de oliva".
   - **noise-stripped**: catalogue tokens are a subset of user tokens AND every extra user token is in a curated list of *cooking-state modifiers* (picada, rallado, fresco, maduro, ecológico, asado, …). "cebolla picada" ↦ "cebolla". The list deliberately covers only state, never part-of-animal / variety / regional adjectives.
   - **user-generic**: user tokens are a strict subset of catalogue tokens (user typed less specific than what the catalogue holds). "sal" matched against catalogue "sal marina". When several catalogue entries qualify, the shortest one wins.
   - **NEVER** does a substring fallback that lets the user's input lose semantic content. "pechuga de pollo" does **not** collapse to "pollo"; "jamón ibérico" does **not** collapse to "jamón"; "aceite de girasol" does **not** collapse to "aceite". Anything the user typed beyond the noise list is preserved → cascade falls through.

2. **LLM disambiguation** (`apps/api/src/services/ingredientMatcherLLM.ts`).
   - Single batched call per import: sends every leftover name + the full catalogue + the recipe title to `claude-sonnet-4-20250514`, gets back `{matches: [{extracted_name, ingredient_id | null}]}`. One round-trip, not one-per-ingredient.
   - System prompt explicitly forbids part-of-animal collapses (the very trap the token matcher refuses) but encourages genuine alias resolution: "chuletón" ↦ "chuleta de vaca", "pimentón dulce de la vera" ↦ "pimentón dulce", "cebolleta" ↦ "cebolla tierna" when present.
   - Failure modes (no API key, network error, malformed JSON) degrade silently to an empty verdict map — the caller still tries stage 3. An import is never blocked on the LLM step.

3. **USDA auto-create** (`apps/api/src/services/ingredientAutoCreate.ts`).
   - Same Foundation/SR-Legacy lookup as the manual ingredient picker, with Spanish↦English translation. Persists a new `ingredients` row with full per-100 g nutrition + inferred allergens.
   - Net effect over time: the first user to import "pechuga de pollo" pays the USDA round-trip; everyone after them hits stage 1 directly.

## API Endpoints

- `GET /recipes?search=&meal=&season=&maxTime=&perPage=&page=` — list with filters; returns the lightweight card shape. **Optional auth:** with a valid Bearer token the response is the full catalogue (system + every recipe the API exposes today); without a token only system recipes (`authorId IS NULL`) are returned, so the same endpoint backs the public `/recipes-ona` page anonymously and the app `/recipes` page authenticated.
- `GET /recipes/:id?servings=N` — single recipe; if `servings` is provided and differs from `recipe.servings`, quantities are scaled server-side and a `scaledFrom` field is included. Anonymous callers can only fetch system recipes; requesting a user-authored recipe without a token returns 404 (same shape as "not found" to avoid leaking which IDs exist privately).
- `POST /recipes` (auth) — create user recipe; runs lint validator
- `PUT /recipes/:id` (auth, author only) — update; runs lint validator and recomputes `nutritionPerServing` and `allergens`
- `DELETE /recipes/:id` (auth, author only)
- `GET /user/:id/recipes` (auth) — user's own + favorited recipes
- `POST /user/:id/recipes/:recipeId/favorite` (auth) — toggle favorite. **PR 1B:** each user toggles their own `user_favorites` row, but `GET /user/:id/recipes` returns the household-wide union of favorites when `SHARED_HOUSEHOLD_SCOPE` is on. See [Household](./household.md)
- `POST /recipes/extract-from-image` (auth) — AI recipe extraction; returns the `ExtractedRecipe` draft (ingredients matched against catalog + warnings) so the user can review and adjust it on `/recipes/new` before saving. The draft is **not** persisted server-side — the user submits the normal `POST /recipes` from the form, which runs the lint validator. Defensive JSON parse tolerates ```json…``` fenced responses from the model
- `POST /recipes/:id/copy` (auth) — clone a recipe into the caller's catalog. Refuses with 409 if the user already owns the source. Returns the new recipe
- `POST /recipes/extract-from-url` (auth) — body `{ url, asSystem?: boolean }`. Detects YouTube vs article by hostname. Articles try `schema.org/Recipe` JSON-LD, then fall back to Mozilla Readability + Claude. YouTube combines title + description + caption transcript and feeds it to Claude. Unlike `/extract-from-image`, this endpoint persists the recipe directly and returns `{ recipe, warnings }` (the frontend then redirects to the detail page). Returns 422 with `{ isRecipe: false, reason }` when the LLM decides the URL doesn't describe a cookable recipe, and 422 with a Spanish message when a YouTube video has neither captions nor a usable description. **Cover image is captured automatically**: articles read `schema.org/Recipe.image` (string · `{url}` · array) when JSON-LD is present, otherwise scrape `og:image` / `og:image:secure_url` / `twitter:image` / `<link rel="image_src">` from the page head; YouTube derives `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (guaranteed for every video). The captured URL is persisted directly into `recipes.image_url` — no download / cache hop — so source-side hot-link protection is the only failure mode; users can swap it with the "Regenerar imagen" endpoint later. **`asSystem: true` is admin-only** (returns 403 `NOT_ADMIN` for non-admins): persists the recipe with `authorId = null` and `internalTags = ['compartida', 'auto-extracted', 'from-url']` so it shows up under "Catálogo ONA" on `/recipes` and on the public `/recipes-ona` page. The `UrlRecipeImport` component on `/recipes/new` surfaces an "Añadir al catálogo ONA" checkbox only when `user.role === 'admin'`
- `POST /recipes/:id/regenerate-image` (auth, author only) — generate a new editorial-style hero photo via AiKit Imagen-fal. Builds the prompt from `recipe.name` + top 4 ingredients (by `displayOrder`) + a meal-aware framing hint + a fixed cream/wood/warm-light cookbook style suffix; calls `POST cms.aikit.es/api/free-form-tools/image-generation/generate-imagen-fal` with `Authorization: Bearer aik_…`; pipes the PNG through sharp (1200 px wide, JPEG q85 + mozjpeg) and writes to `${IMAGE_STORAGE_DIR}/<recipeId>.jpg`; updates `recipes.image_url` to `${IMAGE_PUBLIC_URL_BASE}/<recipeId>.jpg`. Per-user monthly quota (`IMAGE_GEN_MONTHLY_LIMIT`, default 20) tracked atomically on `users.image_gen_count` + `users.image_gen_month_key`: a single conditional UPDATE bumps the counter only if the user is under the cap and the month matches; mismatched month → reset to 1; cap reached → 429 with `{ quota: { used, limit, monthKey } }` and no AiKit call. Failed generations refund the slot. System recipes (authorId null) and other-user recipes return 403; missing `AIKIT_API_KEY` returns 503. Frontend (`useRegenerateRecipeImage`) renders a "Regenerar imagen" button on the author-side detail page and an "Imagen" section in `/recipes/[id]/edit`; both show a "(X/20 este mes)" counter and append `?v=<updatedAt>` to the hero src to bust the long-cached browser image after each regen

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)
- v1 of the URL importer cannot process YouTube videos that lack both captions and a recipe-bearing description (no Whisper / yt-dlp / Gemini fallback yet)
- Structured **ingredient overrides** (`recipe_notes.ingredient_overrides`) flow through to the shopping list and the recipe detail, but the *menu generator/matcher* still scores recipes against their original ingredient list. So a household that "removes cebolla" from every recipe will still see the same recipes get selected by the planner — they just won't see cebolla on the recipe detail or in the basket

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
- [apps/api/scripts/tagRecipesByType.ts](../apps/api/scripts/tagRecipesByType.ts) — deterministic backfill that adds the `MEAL_TYPE_TAGS` taxonomy (`cremas | legumbres | pizza | asiatico | mediterraneo | ensalada | parrilla | batch-cooking | pasta | arroz`) onto system recipes by name + ingredient heuristics. Runs dry-run by default; `--execute` commits. Idempotent — re-running on already-tagged rows is a no-op. The matcher's `pinnedType` predicate reads these tags so the "Fijar tipo" menu UX has something to filter against.
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — USDA-backed auto-create + Levenshtein dedupe (new)
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /ingredients/suggest`, `POST /ingredients/auto-create`
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — open ingredient picker + auto-create modal (new). Accepts a `defaultText` prop so unmatched extractor output (photo / URL) is prefilled into the input instead of falling back to the empty placeholder, letting the user confirm via "Crear nuevo" or refine the search.
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient` (new)
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — regenerated catalog
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/api/src/services/recipeImageGenerator.ts](../apps/api/src/services/recipeImageGenerator.ts) — shared prompt builder + AiKit Imagen-fal client + sharp pipeline. Used by both the bulk script and the `regenerate-image` endpoint
- [apps/api/scripts/generateRecipeImages.ts](../apps/api/scripts/generateRecipeImages.ts) — bulk hero-image regenerator for the seed (writes slug-keyed JPGs to `apps/web/public/images/recipes/`); flags `--dry-run`, `--only=<slug,…>`, `--include-user`, `--concurrency=N`, `--aspect=4:3|1:1|3:4`, `--skip-existing`, `--no-db`
- [apps/api/scripts/handAuthoredRecipes.ts](../apps/api/scripts/handAuthoredRecipes.ts) — hand-authored bodies for the seed placeholders; appends to `output/regen-passed.jsonl`
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — JSONL → DB applier with lint + auto-create + `--soft-lint` escape hatch
- [apps/api/scripts/dedupSystemRecipes.ts](../apps/api/scripts/dedupSystemRecipes.ts), [linkSeedRecipeImages.ts](../apps/api/scripts/linkSeedRecipeImages.ts), [fillSeedCatalogGap.ts](../apps/api/scripts/fillSeedCatalogGap.ts), [bulkInsertIngredients.ts](../apps/api/scripts/bulkInsertIngredients.ts), [recomputeRecipeNutrition.ts](../apps/api/scripts/recomputeRecipeNutrition.ts), [insertMappedIngredients.ts](../apps/api/scripts/insertMappedIngredients.ts) — one-off prod maintenance scripts
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts) — `useRegenerateRecipeImage(recipeId, userId)` mutation
- [apps/web/src/hooks/useUser.ts](../apps/web/src/hooks/useUser.ts) — `useUser(id)` returns the live `imageGenQuota` for the regenerate counters
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx)
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [apps/web/src/components/recipes/ServingsScaler.tsx](../apps/web/src/components/recipes/ServingsScaler.tsx) — diner +/- control (new)
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
