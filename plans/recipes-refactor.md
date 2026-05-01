# Recipes Refactor Implementation Plan

## Summary

Rebuild the recipe data model so recipes are actually cookable: explicit `servings`, real unit enum, sectioned ingredients, rich steps with timing/temperature/ingredient refs, difficulty, equipment, allergens, notes, cached per-serving nutrition, public-vs-internal tag separation. Reseed the catalog through an LLM-assisted regeneration pipeline gated by a lint validator. Ripple the new model into the recipe detail UI (with a diner scaler), the shopping list (unit-aware, aisle-grouped), the menu generator (real nutrition), and a new fullscreen cooking mode. Migrations are destructive (no production data to preserve).

## Tasks

- [ ] Update `packages/shared` types and zod schemas to express the new recipe model
  + Touches [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts) and any sibling schema files
  + Add `Unit` enum (`g | ml | u | cda | cdita | pizca | al_gusto`), `Difficulty` enum (`easy | medium | hard`), `RecipeIngredient` (with `section`, `optional`, `note`, `displayOrder`, `unit`), `RecipeStep` (`index`, `text`, `durationMin?`, `temperature?`, `technique?`, `ingredientRefs[]`), `Recipe` with `servings`, `prepTime`, `cookTime`, `activeTime`, `totalTime` (read-only on client), `difficulty`, `equipment[]`, `allergens[]`, `notes`, `tips`, `substitutions`, `storage`, `yield`, `nutritionPerServing`, `internalTags[]`
  + Re-export from `packages/shared/src/index.ts`
  + Done when: `pnpm -w typecheck` passes for the shared package and consuming apps fail in expected places (compile errors that the next tasks will fix)
  + See spec: ([spec: Recipe Model](../specs/recipes.md#recipe-model))

- [ ] Extend the Drizzle schema and generate a destructive migration
  + Edit [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts):
    - `ingredients`: add `fdcId integer | null`, `aisle text | null`, `density real | null` (g/ml), `unitWeight real | null` (g/u), `allergenTags text[] default []`, `salt real default 0`
    - `recipes`: add `servings integer notNull`, `cookTime integer | null`, `activeTime integer | null`, `totalTime integer | null`, `difficulty text default 'medium'`, `equipment text[] default []`, `allergens text[] default []`, `notes text | null`, `tips text | null`, `substitutions text | null`, `storage text | null`, `yieldText text | null`, `nutritionPerServing jsonb default '{}'`, `internalTags text[] default []`. Drop `steps text[]` (moves to its own table).
    - `recipeIngredients`: add `section text | null`, `optional boolean default false`, `note text | null`, `displayOrder integer notNull default 0`. Tighten `unit` to a CHECK against the new enum. Drop the `uq_recipe_ingredient` unique index (sectioned recipes can list the same ingredient twice in different sections).
    - New `recipeSteps`: `id`, `recipeId fk`, `index integer notNull`, `text text notNull`, `durationMin integer | null`, `temperature integer | null`, `technique text | null`, `ingredientRefs uuid[] default []`. Index on `recipeId`.
  + Run `pnpm --filter @ona/api db:generate` to produce the migration; commit it. Run `pnpm --filter @ona/api db:migrate` against a dev DB to verify it applies cleanly on a wiped database
  + Done when: migration applies on a fresh DB and `drizzle-kit push` reports no diff
  + See specs: ([spec: Recipe Model](../specs/recipes.md#recipe-model)) ([spec: Data Sources](../specs/nutrition.md#data-sources))

- [ ] Build the recipe lint validator as the single source of truth
  + Create [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) and [apps/api/src/services/recipeLint.ranges.ts](../apps/api/src/services/recipeLint.ranges.ts)
  + Implement all blocking rules: required fields, step-text completeness via fuzzy ingredient matching (stemming + Levenshtein, Spanish), no orphan ingredients, quantity sanity per ingredient (with a starter ranges table for common staples), step-ref resolution, time-sum consistency, public-tag hygiene (no meal/season/difficulty/internalTag leakage)
  + Implement warnings: missing `fdcId`, missing `density` for `ml` quantities, kcal/serving outside [150, 1500], time hint in step.text without `durationMin`, no equipment
  + Return shape: `{ ok: boolean; errors: LintIssue[]; warnings: LintIssue[] }` where `LintIssue` carries `code`, `message`, `path`
  + Add a small unit test suite under [apps/api/src/tests/recipeLint.test.ts](../apps/api/src/tests/recipeLint.test.ts) covering each rule with positive and negative cases
  + Done when: validator runs in < 50 ms for a 30-ingredient recipe and tests pass via `pnpm --filter @ona/api test`
  + See spec: ([spec: Lint Rules](../specs/recipe-quality.md#lint-rules))

- [ ] Build the recipe scaler service with culinary rounding
  + Create [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts)
  + Implement `scaleRecipe(recipe, targetServings)`: multiplies each ingredient by `target / recipe.servings`, applies rounding bands (1 g, 5 g, 25 g, 50 g, 100 g, 250 g, 500 g, 1 kg depending on magnitude), rounds `u` to whole numbers and emits a `note` when the rounded value differs from the exact one (e.g. "1.5 huevos → 2"), leaves `pizca` and `al_gusto` untouched
  + Pure function, deterministic, no DB
  + Add unit tests under [apps/api/src/tests/recipeScaler.test.ts](../apps/api/src/tests/recipeScaler.test.ts)
  + Done when: tests pass; manual call `scaleRecipe(albondigas, 4)` on the canonical seed produces sensible quantities
  + See spec: ([spec: Quantity Scaling](../specs/recipes.md#quantity-scaling))

- [ ] Build the USDA FoodData Central client with on-disk cache
  + Create [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts)
  + Read `USDA_FDC_API_KEY` from env (add to [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) and to `.env.example`)
  + `fetchByFdcId(fdcId)` returns the canonical per-100 g profile (kcal, protein, carbs, fat, fiber, salt). Cache responses to `apps/api/.cache/usda/<fdcId>.json` and short-circuit on cache hits
  + Implement basic rate-limit handling: exponential backoff on 429, hard fail after 5 retries
  + Optional `searchByName(query)` to assist curators when picking `fdcId`s; returns top 5 candidates
  + Done when: a script call `tsx -e "import('./apps/api/src/services/nutrition/usdaClient.ts').then(m => m.fetchByFdcId(173410))"` returns nutrition for "Onion, raw" and creates a cached file
  + See spec: ([spec: Data Sources](../specs/nutrition.md#data-sources))

- [ ] Build nutrition aggregation and allergen mapping
  + Create [apps/api/src/services/nutrition/aggregate.ts](../apps/api/src/services/nutrition/aggregate.ts) and [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts)
  + `aggregateNutrition(recipe, ingredientsCatalog)`: converts each `RecipeIngredient` to grams using `density` / `unitWeight` (rules from spec), multiplies by per-100 g values from the catalog, sums totals, divides by `servings`, returns `{ kcal, protein_g, carbs_g, fat_g, fiber_g, salt_g }`. Skips unmapped ingredients silently and reports them via the lint warning channel
  + `allergenUnion(recipe, ingredientsCatalog)`: union of `ingredient.allergenTags` across all ingredients (including `optional`)
  + Helper `inferAllergenTagsFromName(name)` exposes the staple-collapse rules (`trigo`/`cebada`/`centeno`/`avena` → `gluten`, etc.) so the curator script can pre-fill new ingredients
  + Add tests under [apps/api/src/tests/nutritionAggregate.test.ts](../apps/api/src/tests/nutritionAggregate.test.ts)
  + Done when: aggregation on a fixture recipe produces values within ±2 % of a hand-computed reference
  + See specs: ([spec: Recipe Aggregation](../specs/nutrition.md#recipe-aggregation)) ([spec: Allergens](../specs/nutrition.md#allergens))

- [ ] Wire ingredient catalog upgrade and run a one-shot USDA seed
  + Create [apps/api/src/seed/usda.ts](../apps/api/src/seed/usda.ts): loads the current `ingredients` rows, prompts the curator (CLI) for an `fdcId` per ingredient (with `searchByName` suggestions), persists `fdcId`/`density`/`unitWeight`/`aisle`/`allergenTags` and per-100 g nutrition columns
  + Provide a `--non-interactive` mode that consumes a YAML/JSON file of pre-decided mappings under [apps/api/src/seed/data/ingredient-fdc-map.yaml](../apps/api/src/seed/data/ingredient-fdc-map.yaml) so re-runs are deterministic
  + Run the script once against the dev DB to populate the existing ingredient catalog
  + Done when: `SELECT COUNT(*) FROM ingredients WHERE fdc_id IS NULL` returns 0 (or a reviewed shortlist of intentional exceptions) and `density`/`unitWeight` are set for every ingredient that takes `ml`/`u` units in the regenerated recipes
  + See spec: ([spec: Data Sources](../specs/nutrition.md#data-sources))

- [ ] Build the LLM-driven recipe regeneration script
  + Create [apps/api/scripts/regenerateRecipes.ts](../apps/api/scripts/regenerateRecipes.ts)
  + Reads each recipe from the existing seed (`apps/api/src/seed/recipes.ts`) and from the live DB if present
  + Sends a structured prompt to Claude (Anthropic SDK, already a dep) including: original name, original ingredient list, original step strings, the new schema definition (auto-extracted from the zod schemas), the lint rules (textual summary), and the catalog of valid ingredient names with their default units. Use prompt caching on the schema + lint sections (they don't change between calls)
  + Output a JSON object per recipe to `apps/api/scripts/output/regen.jsonl`
  + Pipe each output through the lint validator from task #3; failures are written to `regen-failed.jsonl` with `errors`/`warnings`; passes go to `regen-passed.jsonl`
  + Use Claude 4.7 by default (`claude-opus-4-7`); make the model overridable via `--model` flag
  + Done when: the script runs end-to-end on the 79 seed recipes; `regen-passed.jsonl` and `regen-failed.jsonl` both exist and totals add up to 79
  + See spec: ([spec: LLM Regeneration Pipeline](../specs/recipe-quality.md#llm-regeneration-pipeline))

- [ ] Build the apply script that ingests reviewed regenerated recipes
  + Create [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts)
  + Reads `regen-passed.jsonl`, runs lint again as a final guardrail, opens a transaction per recipe, deletes the existing rows for that recipe id (recipe + recipe_ingredients + recipe_steps), inserts the new rows, computes and stores `nutritionPerServing` and `allergens` via the aggregator from task #6
  + Supports `--dry-run` mode (lint + log, no writes) and `--ids=<csv>` to limit scope
  + Done when: a dry run on `regen-passed.jsonl` reports zero lint failures, and a real run produces 79 recipes with non-empty `nutritionPerServing` and `allergens`
  + See spec: ([spec: LLM Regeneration Pipeline](../specs/recipe-quality.md#llm-regeneration-pipeline))

- [ ] **Curator checkpoint:** human review of `regen-passed.jsonl`
  + Reviewer reads each entry, fixes wording, gramajes, and missing details by hand, re-runs lint, then triggers the apply script
  + No code change; this is a hand-curation pass that gates the actual seed replacement
  + Done when: the reviewer signs off and `applyRegeneratedRecipes.ts` has populated the dev DB with the corrected catalog

- [ ] Update recipe API routes to use the new model end-to-end
  + Edit [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts):
    - `GET /recipes` returns the lightweight card shape including `nutritionPerServing.kcal`, `allergens`, `difficulty`, `totalTime` (derived). Drop any `compartida`/`internalTags` from the public payload.
    - `GET /recipes/:id` accepts `?servings=N`. When provided and different from `recipe.servings`, run `recipeScaler` server-side and include `scaledFrom: recipe.servings` in the response. Always join `recipe_steps` and `recipe_ingredients` into the response, ordered correctly.
    - `POST /recipes` and `PUT /recipes/:id`: validate body via shared zod schema, run `recipeLint`, on `errors` return `422 { errors, warnings }`, on success persist + recompute `nutritionPerServing` and `allergens` via aggregator + recompute `totalTime` (sum of `step.durationMin` if all steps have it, else `prepTime + cookTime`)
  + Edit [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) to emit the new shape and to pipe through `recipeLint` before persisting; on lint failure, return the issues to the client so the user can correct them
  + Done when: `curl /recipes/<id>?servings=4` returns scaled quantities; `PUT` with a known-bad body returns `422` with the relevant lint codes; `nutritionPerServing` is non-empty on the returned object
  + See specs: ([spec: API Endpoints](../specs/recipes.md#api-endpoints)) ([spec: Quantity Scaling](../specs/recipes.md#quantity-scaling)) ([spec: Lint Rules](../specs/recipe-quality.md#lint-rules))

- [ ] Build the `ServingsScaler` component and wire it into the recipe detail page
  + Create [apps/web/src/components/recipes/ServingsScaler.tsx](../apps/web/src/components/recipes/ServingsScaler.tsx): –/+ control bound to a local state, defaulting to the user's `householdSize` (parsed from the profile values `solo`/`pair`/`family-no-kids`/`family-with-kids` → 1/2/3/4) or to `recipe.servings` if no household is set. Emits the chosen value to the parent
  + Edit [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx):
    - Remove hardcoded `"2 personas"` and `"Para 2"`; both reflect the live scaler value
    - Refetch `/recipes/:id?servings=N` whenever the scaler changes (or do client-side scaling if SSR is preferred — pick one and document it via shared util `scaleRecipeClient` mirroring `recipeScaler.ts`)
    - Render ingredients grouped by `section` if any ingredient has one set; otherwise render flat
    - Render `step.text` with `temperature`/`technique` pills above and inline `ingredientRefs` chips next to it
    - Render new sections: `Equipo` (equipment), `Alérgenos` (badges), `Nutrición por ración` (kcal + macros), `Notas` / `Trucos` / `Sustituciones` / `Conservación` when present
    - Use `totalTime` and `activeTime` in the meta row when present
  + Done when: the recipe detail page for a regenerated recipe shows correct grouped ingredients, scales when the scaler changes, displays nutrition + allergens, and renders rich steps. Verified by opening `http://localhost:3000/recipes/<id>` for at least 5 different recipes (with and without sections)
  + See specs: ([spec: User Capabilities](../specs/recipes.md#user-capabilities)) ([spec: Display Constraints](../specs/recipes.md#display-constraints)) ([spec: Quantity Scaling](../specs/recipes.md#quantity-scaling))

- [ ] Sweep the frontend for `prepTime`, label, and mojibake bugs
  + In [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) line ~302, change `{recipe.prepTime && (...)}` to `{recipe.prepTime ? (...) : null}` (or `recipe.prepTime > 0`); same fix in [apps/web/src/components/recipes/RecipeCard.tsx](../apps/web/src/components/recipes/RecipeCard.tsx) and any other place where `prepTime` is rendered conditionally with `&&`
  + Audit [apps/web/src/components/menu/MealPhotoCard.tsx](../apps/web/src/components/menu/MealPhotoCard.tsx) and [apps/web/src/components/menu/WeekStrip.tsx](../apps/web/src/components/menu/WeekStrip.tsx) for the same pattern; fix
  + Centralize `MEAL_LABELS`, `SEASON_LABELS`, and `DIFFICULTY_LABELS` in [apps/web/src/lib/labels.ts](../apps/web/src/lib/labels.ts) (new); replace inline maps in `recipes/page.tsx`, `recipes/[id]/page.tsx`, `RecipeCard.tsx`, and the menu components with the shared map
  + Replace mojibake fallbacks: `Otono` → `Otoño`, `Anadir` → `Añadir`, `Preparacion` → `Preparación`, `Albondigas` → `Albóndigas`, `compartida` filtered out (handled below). Verify globals.css loads a font with full Latin coverage; if any layout still strips accents, fix at the source
  + Done when: catalog and menu surfaces show no `0` next to the clock icon for `prepTime: 0`, no English meal label leaks (`lunch`, `dinner`), all Spanish accented characters render correctly
  + See specs: ([spec: Display Constraints](../specs/recipes.md#display-constraints)) ([spec: Tag Visibility](../specs/recipes.md#tag-visibility))

- [ ] Filter `internalTags` out of every public surface and remove duplicate tags
  + Add a `publicTags(recipe)` helper in [apps/web/src/lib/recipeView.ts](../apps/web/src/lib/recipeView.ts) (new) that returns `recipe.tags` filtered against meal labels, season labels, difficulty, and `recipe.internalTags`
  + Use it in `RecipeCard`, `EditorialRecipeCard`, recipe detail header, and any other place where tags are rendered
  + Done when: no recipe card or detail page shows `compartida`, `lunch`, `dinner`, `easy`, etc. as a "tag"; only intentional descriptors (`vegetariana`, `eventos`, `picante`…) survive
  + See spec: ([spec: Tag Visibility](../specs/recipes.md#tag-visibility))

- [ ] Refactor the shopping list aggregator for unit-aware aggregation
  + Edit [apps/api/src/services/shoppingList.ts](../apps/api/src/services/shoppingList.ts):
    - Per recipe, scale quantities by `householdSize / recipe.servings`
    - Skip ingredients with `unit ∈ {pizca, al_gusto}` and skip `optional` ingredients (provide a `includeOptional: false` knob)
    - Aggregate by `ingredientId`. Same unit → sum. Compatible units (`g`↔`ml`, `g`↔`u`, `cda`↔`g`/`ml`) → convert via `density` / `unitWeight` (15 g per `cda` if no density, 5 g per `cdita`); pick the canonical display unit per ingredient (whole units when sensible: huevos, limones; otherwise grams)
    - Round to friendly bands (kg above 1 kg, 50 g bands above 250 g, 25 g below)
    - Group items by `aisle` (fallback `otros`)
  + Add `POST /shopping-list/:listId/regenerate` to [apps/api/src/routes/shopping.ts](../apps/api/src/routes/shopping.ts): wipes the existing list and rebuilds from the menu (uses the aggregator)
  + Done when: a generated list for a sample 7-day menu contains correct totals (e.g. cebolla in grams, huevos in units), grouped under `produce` / `proteinas` / `lacteos` / `despensa`, with no duplicate lines for the same ingredient
  + See specs: ([spec: Aggregation](../specs/shopping.md#aggregation)) ([spec: Item Model](../specs/shopping.md#item-model))

- [ ] Update the shopping list UI for aisle grouping, real units, and regenerate
  + Edit [apps/web/src/components/shopping/ShoppingList.tsx](../apps/web/src/components/shopping/ShoppingList.tsx) to render items grouped by `aisle` with section headers; show the new units (`u`, `cda`) verbatim, no fallback to `g`
  + Edit [apps/web/src/app/shopping/page.tsx](../apps/web/src/app/shopping/page.tsx) to expose a "Regenerar lista" action wired to `POST /shopping-list/:listId/regenerate`
  + Update [apps/web/src/hooks/useShopping.ts](../apps/web/src/hooks/useShopping.ts) with the new mutation
  + Update the export-to-clipboard formatter to preserve aisle headers
  + Done when: `/shopping` shows aisle-grouped items, "Regenerar lista" wipes & rebuilds, and the clipboard export reads with aisle headings
  + See spec: ([spec: User Capabilities](../specs/shopping.md#user-capabilities))

- [ ] Update the menu generator and recipe matcher to use cached real nutrition
  + Edit [apps/api/src/services/menuGenerator.ts](../apps/api/src/services/menuGenerator.ts): score candidates using `recipe.nutritionPerServing` × `householdSize / recipe.servings`. Recipes whose `nutritionPerServing` is empty (unmapped) get a fitness penalty so the algorithm prefers fully mapped recipes. Drop any duplicate computation from [apps/api/src/services/nutrientCalculator.ts](../apps/api/src/services/nutrientCalculator.ts) where now obsoleted by the cached field
  + Edit [apps/api/src/services/recipeMatcher.ts](../apps/api/src/services/recipeMatcher.ts) only if the matcher needs to expose the nutrition profile to the generator
  + Done when: `POST /menu/generate` returns a 7-day menu where the sum of `nutritionPerServing × scale` across slots is within ±10 % of the user's calorie target, verified manually for two profiles
  + See spec: ([spec: Generation Algorithm](../specs/menus.md#generation-algorithm))

- [ ] Build the cooking mode route, shell, and supporting hooks
  + Create [apps/web/src/app/recipes/[id]/cook/page.tsx](../apps/web/src/app/recipes/[id]/cook/page.tsx)
  + Create [apps/web/src/components/cooking/](../apps/web/src/components/cooking/) with `CookingShell`, `StepCard`, `StepTimer`, `IngredientChip`, `ChecklistPanel`
  + Create [apps/web/src/hooks/useWakeLock.ts](../apps/web/src/hooks/useWakeLock.ts) (acquires `screen` lock on mount, releases on unmount, tolerates failure) and [apps/web/src/hooks/useStepTimers.ts](../apps/web/src/hooks/useStepTimers.ts) (timestamp-based, supports concurrent timers, vibrates + chimes on fire)
  + Add a "Empezar a cocinar" CTA on the recipe detail that links to `/recipes/<id>/cook?servings=N`
  + Inside cooking mode, mirror the diner scaler from the detail; quantities re-render live; checked ingredients persist across re-scales
  + Implement swipe between steps (pointer events; respects landscape and one-hand reach); arrow buttons as fallback
  + Render `step.temperature` and `step.technique` as pills; inline `ingredientRefs` as chips with the live-scaled quantity (split equally across step references)
  + Done when: opening `/recipes/<id>/cook` from the detail brings up the fullscreen flow, a step with `durationMin` shows a working timer, the screen stays awake while the tab is foreground, and exiting returns to the detail with no recipe mutations
  + See specs: ([spec: User Capabilities](../specs/cooking-mode.md#user-capabilities)) ([spec: Timers](../specs/cooking-mode.md#timers)) ([spec: Wake Lock](../specs/cooking-mode.md#wake-lock))

- [ ] Verify implementation
  + Run `pnpm --filter @ona/api db:migrate` against a wiped DB and confirm the migration applies
  + Run `pnpm --filter @ona/api test` and confirm `recipeLint`, `recipeScaler`, and `nutritionAggregate` test suites all pass
  + Run the regeneration + apply scripts on a dev DB; confirm `SELECT COUNT(*) FROM recipes` matches the curated catalog and that every recipe has non-empty `nutritionPerServing` and `allergens`
  + Start the API (`pnpm --filter @ona/api dev`, port 8000) and the web app (`pnpm --filter @ona/web dev`, port 3000)
  + Login and visit `/recipes`: confirm cards render correctly, no "0" leak next to the clock icon, no English meal labels, no `compartida` tag in public chips
  + Open three recipes (one with sections, one with all step durations, one with optional ingredients) and verify: ingredients group by section, the ServingsScaler changes quantities live, the rich steps show temperature/technique/inline ingredient chips, the nutrition card shows kcal + macros, allergen badges render
  + Click "Empezar a cocinar" on a recipe with timed steps; confirm fullscreen entry, step timer fires with vibration + chime, swipe advances steps, ingredient checklist persists across scaler changes, and exit returns to detail
  + Submit a deliberately broken recipe through `POST /recipes` (missing ingredient referenced in a step) and confirm the server returns `422` with the lint code; submit a valid one and confirm `nutritionPerServing` is populated in the response
  + Generate a menu via `/menu`, then open `/shopping` and confirm: items grouped by aisle, units include `u` for whole-unit ingredients, "Regenerar lista" rebuilds correctly, clipboard export preserves aisle headers
  + Generate a fresh menu and verify the sum of cached `nutritionPerServing × scale` falls within ±10 % of the user's target kcal for the week
