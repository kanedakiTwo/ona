# Nutrition

Per-ingredient nutrition data, allergen tagging, and recipe-level nutrition aggregation.

## User Capabilities

- Users can see per-serving nutrition on every recipe detail page: kcal, protein, carbs, fat, fiber, salt (stored as `kcal`, `proteinG`, `carbsG`, `fatG`, `fiberG`, `saltG`)
- Users can see per-recipe-total nutrition (per-serving × `recipe.servings`)
- Users can see allergen badges on every recipe (e.g. "gluten", "lactosa", "frutos secos")
- Users can filter the recipe catalog by absence of allergens (e.g. "sin gluten")
- The advisor and menu generator have access to the same nutrition data and use it to balance weekly menus

## Data Sources

Nutrition data is sourced from **USDA FoodData Central (FDC)**, populated once at seed time:

- Each row in the `ingredients` catalog has an `fdcId` mapping it to a USDA Foundation/SR Legacy entry
- A seed script fetches the per-100 g nutrient profile for each `fdcId` and writes it directly into the `ingredients` row. There is no separate `ingredient_nutrition` table — the columns `calories`, `protein`, `carbs`, `fat`, `fiber`, `salt` (plus `vitamins`, `minerals`, `aminoAcids`, `fatAcids`, `carbTypes` JSONBs) live on the catalog itself
- The script caches every fetched response on disk to respect USDA rate limits and to allow re-runs without re-querying
- Ingredients without a confident USDA match are flagged for manual review and excluded from auto-aggregation until mapped

## Allergens

Allergens are not provided by USDA. Each ingredient has an `allergenTags` string array maintained in our own catalog:

- Tags follow EU labelling categories: `gluten`, `lactosa`, `huevo`, `frutos_secos`, `cacahuetes`, `soja`, `pescado`, `marisco`, `crustaceos`, `moluscos`, `apio`, `mostaza`, `sesamo`, `altramuces`, `sulfitos`
- Helper rules collapse common ingredients (e.g. "trigo", "harina de trigo", "cebada", "centeno", "avena" → `gluten`; "leche", "queso", "mantequilla", "nata" → `lactosa`)
- A recipe's `allergens` is the union of all its ingredients' `allergenTags`, including `optional` ingredients (so the badge is conservative)

## Recipe Aggregation

`nutritionPerServing` is computed when a recipe is saved (create, update, or seed):

1. For each `RecipeIngredient`, convert `quantity` to grams using:
   - `g` → grams as-is
   - `ml` → grams using `ingredient.density` (g/ml); if density is missing, the ingredient is skipped and a warning is recorded
   - `u` → grams using `ingredient.unitWeight` (g/unidad, e.g. 1 huevo ≈ 50 g)
   - `cda` → 15 g equivalent if `ingredient.density` is missing; else `15 ml × density`
   - `cdita` → 5 g equivalent
   - `pizca` and `al_gusto` are treated as 0 g (negligible)
2. Multiply each ingredient's grams by its per-100 g nutrient values from the `ingredients` row
3. Sum across all ingredients to get totals
4. Divide by `recipe.servings` to get the per-serving values
5. Cache the result in `recipe.nutritionPerServing`

Optional ingredients are included by default; recipes can mark them `optional: true` for display but they still count toward the cached nutrition (the user knows the worst case).

## Lint Hooks

The recipe lint validator (see [Recipe Quality](./recipe-quality.md)) emits warnings — not errors — when:

- An ingredient lacks an `fdcId` mapping (nutrition will be incomplete)
- A unit conversion fails (no `density` for a ml-quantified ingredient)
- A computed per-serving value is suspiciously high or low (e.g. > 1500 kcal/serving for a non-special-occasion recipe)

Warnings are surfaced to the recipe author / curator but do not block saving.

## API

- Nutrition is read-only via the existing recipe endpoints; `recipe.nutritionPerServing` ships with `GET /recipes/:id`
- The catalog list endpoint includes only `kcal` per serving for compactness; full breakdown is in detail
- A `GET /ingredients/:id/nutrition` endpoint exposes per-100 g values for the advisor and ad-hoc tools (auth required)

## Constraints

- All nutrition values are stored as numbers in standard SI units (g, mg) per 100 g of ingredient; the API rounds for display (kcal → integer, macros → 1 decimal)
- USDA values are not edited manually; if a value is wrong, the fix is to re-map the `fdcId`
- Allergen tags are authoritative for badges and filters but are advisory, not legal — the UI shows a small disclaimer
- Recomputation on save is synchronous; large recipes (> 30 ingredients) must still complete inside one HTTP request

## Related specs

- [Recipes](./recipes.md) — defines `nutritionPerServing` and `allergens` cached fields
- [Recipe Quality](./recipe-quality.md) — lint warnings for missing nutrition data
- [Menus](./menus.md) — generator uses real per-serving nutrition to balance the week
- [Shopping](./shopping.md) — uses `density` and `unitWeight` from the same ingredient catalog for unit-aware aggregation

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `ingredients` (per-100 g nutrition columns + density/unitWeight/aisle/allergenTags)
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts) — USDA FDC API client with on-disk cache
- [apps/api/src/services/nutrition/aggregate.ts](../apps/api/src/services/nutrition/aggregate.ts) — recipe-level aggregation
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — allergen union and mapping helpers
- [apps/api/src/services/nutrition/index.ts](../apps/api/src/services/nutrition/index.ts) — public surface re-exports
- [apps/api/src/seed/usda.ts](../apps/api/src/seed/usda.ts) — one-time population script: reads `ingredient-fdc-map.yaml`, fetches per-100 g nutrition from USDA, writes to the catalog
- [apps/api/scripts/expandIngredientCatalog.ts](../apps/api/scripts/expandIngredientCatalog.ts) — curator-driven catalog expansion: queries USDA for ~100 common Spanish kitchen staples and writes a draft YAML for review before merging into the main map
- [packages/shared/src/types/nutrition.ts](../packages/shared/src/types/nutrition.ts)
