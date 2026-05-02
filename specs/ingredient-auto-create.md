# Ingredient Auto-Create

USDA-backed flow for adding missing ingredients to the catalog without leaving the recipe creation flow.

## Why this exists

Before this system, the ingredient catalog was effectively closed: a user trying to add "alcaparras" or any ingredient not pre-seeded couldn't save the recipe. The lint validator would fail with `STEP_INGREDIENT_NOT_LISTED`, and the FK on `recipe_ingredients.ingredientId` wouldn't resolve. Auto-create closes that gap by querying USDA FoodData Central, showing the user the best candidates, and persisting a fully-mapped ingredient row in one tap.

The same plumbing is reused by:
- The photo extractor (`POST /recipes/extract-from-image`) — unknown ingredients in the extracted recipe trigger auto-create internally so the recipe doesn't fail lint.
- The apply script (`applyRegeneratedRecipes.ts --auto-create-missing`) — keeps regenerated recipes from being dropped just because an ingredient isn't yet in the catalog.

## User Capabilities

- Users typing in the ingredient picker on `/recipes/new` see the existing catalog filtered as they type (debounced search against `GET /ingredients?search=`)
- When the search returns 0 results AND the user has typed ≥ 2 chars, a "Crear nuevo ingrediente '<nombre>'" option appears
- Clicking it opens a modal that shows up to 5 USDA candidates: each card shows the USDA description, the data type (Foundation / SR Legacy / FNDDS — Branded entries are filtered out), and the per-100 g nutrition (kcal + macros)
- The user picks one ("Crear con USDA") or "Crear sin nutrición" if no candidate is right
- The new ingredient row is persisted, slotted into the recipe form's ingredient list, and the modal closes
- If the typed name fuzzy-matches an existing catalog ingredient (Levenshtein ≤ 2 against normalized names), the dedupe path returns the existing row instead of creating a duplicate; the modal indicates "Ya existe '<existing name>' — usaremos esa"

## API

### `GET /ingredients/suggest?name=<query>` (auth)

Returns:
```ts
{
  normalizedName: string         // lowercase + accent-stripped
  candidates: Array<{
    fdcId: number
    description: string
    dataType: 'Foundation' | 'SR Legacy' | 'Survey (FNDDS)'  // Branded excluded
    per100g: { kcal, proteinG, carbsG, fatG, fiberG, saltG }
  }>
  suggestedAisle: 'produce' | 'proteinas' | 'lacteos' | 'panaderia' | 'despensa' | 'congelados' | 'otros'
  suggestedAllergens: string[]   // via inferAllergenTagsFromName
}
```

Implementation: translates the Spanish query to an English keyword set via a small inline dictionary (and falls back to the raw Spanish word for unknown items — USDA tolerates partial matches), then calls `usdaClient.searchByName` and `fetchByFdcId` for each candidate. Foundation/SR Legacy entries rank first.

### `POST /ingredients/auto-create` (auth)

Body: `{ name: string, fdcId?: number, aisle?: Aisle, density?: number | null, unitWeight?: number | null }`

Behaviour:
- If `name` fuzzy-matches an existing ingredient, returns `{ ingredient: <existing>, dedupedFrom: <input name> }` and does NOT create.
- Otherwise inserts a new `ingredients` row:
  - With `fdcId` provided: fetches USDA per-100 g, populates `calories/protein/carbs/fat/fiber/salt`
  - Without `fdcId`: stores `fdcId: null`, all nutrition `0`, `density`/`unitWeight` from the body or `null`
  - In both cases: `aisle` from body or inferred from the Spanish name; `allergenTags` via `inferAllergenTagsFromName`

Returns `{ ingredient: <new row> }`.

## Photo Extractor Integration

`POST /recipes/extract-from-image` flow:
1. Anthropic SDK extracts ingredients with raw names
2. For each name, try to resolve against the catalog (case-insensitive + fuzzy)
3. For unmatched names, call `suggestIngredient` and auto-pick the top Foundation/SR Legacy candidate; if none, persist with `fdcId: null` (warning recorded)
4. Recipe goes through `recipePersistence` (lint → nutrition → allergens → write) using the now-resolved ingredient ids

USDA fetches are sequential to stay within the rate budget. Each extracted recipe takes a few extra seconds when many ingredients are new, but the result is a saveable recipe instead of a 422.

## Apply Script Integration

`applyRegeneratedRecipes.ts` gets a new flag `--auto-create-missing` (default `true`). When enabled:
- Before the per-recipe lint pass, the script scans `ingredientId`s that don't resolve in the catalog
- For non-UUID values (i.e. raw names emitted by the regen LLM in legacy outputs), the script calls `suggestIngredient` and persists the new ingredient
- The regenerated recipe is then linted and applied normally
- With `--auto-create-missing=false`, the script falls back to today's behaviour: dump to `regen-skipped.jsonl` for manual review

## Constraints

- The es→en translation dictionary lives next to `ingredientAutoCreate.ts`; extending it is a one-line PR. For dishes USDA doesn't recognise, the user always has the "Crear sin nutrición" escape hatch.
- Branded USDA entries are excluded server-side. The product team chose Foundation/SR Legacy/FNDDS to avoid serving-size confusion; Branded entries store nutrition per arbitrary serving and would corrupt aggregations.
- Fuzzy dedupe uses normalized form (lowercase + diacritic-stripped) and Levenshtein ≤ 2. "salmon" matches "salmón" (distance 0 after normalization); "atun" matches "atún". This is conservative — false positives are corrected by the curator dashboard later.
- The endpoint requires auth; only authenticated users (and their server-side flows) can extend the catalog. Curator review of new entries lives in the [Curator Dashboard](./curator-dashboard.md) (when implemented) — a row with `fdcId: null` shows up there as a manual nutrition gap.

## Related specs

- [Recipes](./recipes.md) — the form that exposes auto-create
- [Nutrition](./nutrition.md) — same USDA client and per-100 g shape
- [Recipe Quality](./recipe-quality.md) — the lint validator the auto-create flow protects against
- [Curator Dashboard](./curator-dashboard.md) — surfaces ingredients with `fdcId: null` for follow-up review

## Source

- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — `suggestIngredient`, es→en dictionary, fuzzy dedupe, aisle inference
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /suggest`, `POST /auto-create`
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts) — underlying USDA fetcher
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — `inferAllergenTagsFromName`
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) — auto-creates unknown extracted ingredients
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — `--auto-create-missing` flag
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — picker + modal
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient`
