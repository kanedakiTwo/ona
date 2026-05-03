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

## Manual search

Curators can override the automatic es→en translation. The `/ingredients/suggest` endpoint accepts an optional `query` parameter that is forwarded to USDA verbatim, and the auto-create + remap modals expose a "Búsqueda manual" input on top of the candidate list. Typing in that input replaces the auto-generated query and re-fetches against USDA after a 300 ms debounce. The selected query is reflected back to the user as "Buscando: '<query>'" so they always see what's being asked.

This closes the case where the small inline dictionary produces a poor English keyword (e.g. `lacón` → `lacon` because it isn't in the dictionary).

## Translation

USDA descriptions are English-only ("Pork sausage, fresh, cooked"). To make them comparable to Spanish names ("chorizo asturiano"), each candidate is augmented with a `descriptionEs` field holding a Spanish translation. The translator:

- Uses Claude Haiku 4.5 (cheap, fast)
- Batches up to 5 descriptions per call to keep token overhead low
- Caches every English→Spanish pair in-memory and on disk under `apps/api/.cache/translations/usda/<sha1>.json` — first request is slow (~300 ms), subsequent requests are immediate
- Falls back to `null` (no translation) when `ANTHROPIC_API_KEY` is missing or the API call fails — the UI then shows the raw English

The UI shows the Spanish translation prominently with the English description as small italic fine-print below.

## BEDCA fallback

When USDA returns 0 candidates, the suggestion service falls back to BEDCA — the Spanish-government nutrition database. BEDCA covers regional/hispanic foods USDA doesn't (fabes de la granja, chorizo asturiano, morcilla, lacón, tocino, caldo de pescado, bacalao desalado).

The BEDCA client (`apps/api/src/services/nutrition/bedcaClient.ts`):

- Posts XML payloads to `http://www.bedca.net/bdpub/procquery.php` (search + per-id fetch)
- Parses with regex-based scrapers (no `cheerio` dependency)
- Caches responses on disk under `apps/api/.cache/bedca/{search,food}/`
- Is best-effort: on any timeout / network error / parse failure, returns `[]` so the curator workflow falls through to "Estimar con ONA" rather than crashing

BEDCA candidates are returned in the same `AutoCreateCandidate` shape as USDA, with `dataType: 'BEDCA'`, `fdcId: null`, and `bedcaId: '<id>'`. The UI renders them with a blue "BEDCA" badge.

## Manual estimation

Last-resort path: when both USDA and BEDCA miss, the curator clicks "Estimar con ONA". This calls Claude Opus with a constrained prompt asking for per-100 g values only as JSON. The response is validated against `nutritionPerServingSchema` and rejected if `kcal` is out of band (< 0 or > 900) so a hallucinated value can't slip through.

Two endpoints back this:

- `POST /ingredients/:id/estimate-nutrition` (auth) — for ingredients that already exist (curator dashboard re-map flow). Writes the values directly to the row and returns the updated ingredient.
- `POST /ingredients/estimate-nutrition` (auth) — preview-only, no DB write, body `{ name }`. Used by the auto-create modal where the row doesn't yet exist; the curator confirms in the modal and the values flow into `/ingredients/auto-create` via the new `nutrition` field.

Both endpoints return 503 when `ANTHROPIC_API_KEY` is unset.

## API

### `GET /ingredients/suggest?name=<name>&query=<en?>` (auth)

Returns:
```ts
{
  normalizedName: string         // lowercase + accent-stripped
  queryUsed: string              // the English string actually sent to USDA
  candidates: Array<{
    fdcId: number | null         // null for BEDCA candidates
    bedcaId: string | null       // null for USDA candidates
    description: string          // English (USDA) or Spanish (BEDCA) source description
    descriptionEs: string | null // Spanish translation (USDA) or mirror of `description` (BEDCA)
    dataType: 'Foundation' | 'SR Legacy' | 'Survey (FNDDS)' | 'BEDCA'
    per100g: { kcal, proteinG, carbsG, fatG, fiberG, saltG }
  }>
  suggestedAisle: 'produce' | 'proteinas' | 'lacteos' | 'panaderia' | 'despensa' | 'congelados' | 'otros'
  suggestedAllergens: string[]   // via inferAllergenTagsFromName
}
```

Behaviour:
- Without `query`: the Spanish `name` runs through the inline es→en dictionary and a fallback to the raw Spanish word.
- With `query`: the value is sent to USDA verbatim — the dictionary is bypassed.
- USDA candidates rank Foundation > SR Legacy > FNDDS. Branded entries are filtered out.
- If USDA returns 0 candidates, BEDCA is queried as a fallback.
- USDA candidate descriptions are translated to Spanish via Claude Haiku (batched + cached); BEDCA descriptions are already Spanish.

### `POST /ingredients/auto-create` (auth)

Body: `{ name, fdcId?, bedcaId?, nutrition?, aisle?, density?, unitWeight? }`

Source priority (only one branch runs):
- `fdcId` provided: fetches USDA per-100 g and persists with `fdc_id` set.
- `bedcaId` provided: fetches BEDCA per-100 g and persists with `fdc_id: null` (BEDCA-sourced rows are flagged by `fdc_id IS NULL` plus non-zero nutrition).
- `nutrition` provided: persists those values directly with `fdc_id: null` (manual / estimated path).
- None provided: stub row, `fdc_id: null`, all nutrition `0`.

Fuzzy dedupe (Levenshtein ≤ 2) runs in all cases. `aisle` defaults from the body or is inferred from the Spanish name; `allergenTags` is always inferred via `inferAllergenTagsFromName`.

Returns `{ ingredient: <new row> }` (or `{ ingredient: <existing>, dedupedFrom }` on dedupe hit).

### `POST /ingredients/estimate-nutrition` (auth)

Body: `{ name }`. Asks Claude for per-100 g values, validates, returns `{ nutrition, source: 'estimated' }` without touching the DB. Used by the create modal.

### `POST /ingredients/:id/estimate-nutrition` (auth)

Body: `{ name? }` (defaults to the row's `name`). Asks Claude for per-100 g values, validates, writes them to the existing row, returns `{ ingredient, source: 'estimated' }`. Used by the curator re-map modal.

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
- The endpoint requires auth; only authenticated users (and their server-side flows) can extend the catalog. Admin review of new entries lives in the [Admin Dashboard](./admin-dashboard.md) — a row with `fdcId: null` shows up there as a manual nutrition gap.

## Related specs

- [Recipes](./recipes.md) — the form that exposes auto-create
- [Nutrition](./nutrition.md) — same USDA client and per-100 g shape
- [Recipe Quality](./recipe-quality.md) — the lint validator the auto-create flow protects against
- [Admin Dashboard](./admin-dashboard.md) — surfaces ingredients with `fdcId: null` for follow-up review

## Source

- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — `suggestIngredient`, es→en dictionary, fuzzy dedupe, aisle inference, BEDCA fallback orchestration
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /suggest`, `POST /auto-create`, `POST /estimate-nutrition`, `POST /:id/estimate-nutrition`
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts) — underlying USDA fetcher
- [apps/api/src/services/nutrition/bedcaClient.ts](../apps/api/src/services/nutrition/bedcaClient.ts) — Spanish-government nutrition DB scraper, on-disk cached
- [apps/api/src/services/nutrition/usdaTranslator.ts](../apps/api/src/services/nutrition/usdaTranslator.ts) — batched Claude Haiku translator with disk + memory cache
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — `inferAllergenTagsFromName`
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) — auto-creates unknown extracted ingredients
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — `--auto-create-missing` flag
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — picker + modal (manual search, translations, BEDCA, estimate button)
- [apps/web/src/components/recipes/IngredientCandidateCard.tsx](../apps/web/src/components/recipes/IngredientCandidateCard.tsx) — shared candidate card for both modals
- [apps/web/src/app/curator/sections/RemapModal.tsx](../apps/web/src/app/curator/sections/RemapModal.tsx) — re-map modal mirroring the auto-create UX
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient`, `useEstimateNutrition`, `useEstimateNutritionPreview`
