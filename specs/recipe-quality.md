# Recipe Quality

Lint validator that protects recipe data integrity, plus the LLM-assisted regeneration pipeline used to rebuild the seed catalog and to support photo-extracted recipes.

## Why This Exists

The previous seed contained recipes that referenced ingredients in their steps that were not present in the ingredient list (e.g. *Falafel* mentioned guisantes; the list had none) and gramajes calibrated for ≈ 5–6 diners while the UI claimed "Para 2". A user following these recipes literally cannot cook them. The lint validator and the regeneration pipeline together prevent that class of bug from recurring.

## User Capabilities

- Authors of user-created recipes see a clear error if their recipe fails any blocking lint rule on save
- Authors see non-blocking warnings (nutrition gaps, suspiciously high/low values) in a side panel, but can save anyway
- Curators can run a one-off regeneration script that rebuilds the system catalog from scratch and only persists recipes that pass the lint
- Curators can review the LLM-generated JSON for each recipe before it is committed to the seed (no automatic apply)

## Lint Rules

### Blocking (recipe save fails)

1. **Required fields present** — `name`, `servings >= 1`, at least 1 ingredient, at least 1 step
2. **Step text completeness** — every distinct ingredient name mentioned by text in `step.text` must either:
   - Exist in the recipe's `RecipeIngredient` set, or
   - Be linked through `step.ingredientRefs`
   - Detection uses fuzzy matching against the ingredient catalog (handles plurals and inflections in Spanish)
3. **No orphan ingredients** — every `RecipeIngredient` must be either listed prominently in `step.text` or referenced by at least one step's `ingredientRefs` (catches dead entries)
4. **Quantity sanity** — for every ingredient, `quantity / servings` must fall inside a per-ingredient sensible range (e.g. ternera: 80–250 g/serving). Out-of-range quantities block save with a clear message; the user can override with a `force: true` flag for special cases (e.g. roasts)
5. **Step references resolve** — every id in `step.ingredientRefs` must exist in the recipe's `RecipeIngredient` set
6. **Time consistency** — if `prepTime`, `cookTime`, and step durations are all set, the sum of `step.durationMin` must not exceed `prepTime + cookTime` by more than 20 % (catches typos)
7. **Public tag hygiene** — no tag in the public `tags` array equals a meal name, season, difficulty, or any value in `internalTags`

### Warnings (saved, surfaced to curator)

- An ingredient has no `fdcId` mapping → nutrition will be incomplete
- An ingredient unit is `ml` but the catalog ingredient has no `density` → conversion to grams skipped
- Computed `kcal/servings` falls outside [150, 1500] → suspect quantity error
- Step lacks `durationMin` while `step.text` contains a time hint ("30 minutos", "media hora") → suggest extracting it
- Recipe has no `equipment` set → curator may want to add at least one tool

## LLM Regeneration Pipeline

The script `apps/api/scripts/regenerateRecipes.ts` is run manually by a curator:

1. Loads each existing recipe (from the old seed or current DB)
2. Sends a structured prompt to Claude with: the original name, the original ingredient list, the original step strings, the new schema definition, and the lint rules
3. Receives a JSON document conforming to the new recipe shape — including `servings`, sectioned `ingredients`, rich `steps` with `durationMin`/`temperature`/`ingredientRefs`, `equipment`, `notes`/`tips`, and inferred `difficulty`
4. Runs the lint validator on the JSON; recipes that fail lint are dumped to `regen-failed.jsonl` with the failures attached
5. Recipes that pass lint are written to `regen-passed.jsonl` for human review
6. A second script `applyRegeneratedRecipes.ts` reads `regen-passed.jsonl` after curator review and writes the rows into `recipes`, `recipe_ingredients`, `recipe_steps`

The same prompt + lint loop is reused (with a different entry point) for the photo extractor (`POST /recipes/extract-from-image`); user-submitted photo recipes go through lint before persistence.

## Quantity Sanity Ranges

Per-ingredient range tables live next to the lint validator. Initial coverage focuses on staples (proteins, grains, oils, common vegetables). Ingredients without a range fall back to a global ceiling of `2000 g/serving` (a soft cap that catches obvious typos like 10 kg of flour). Curators add new ranges as needed.

## Constraints

- The lint validator is the **same code** for: API saves, seed regeneration, and photo extraction. There is no second implementation
- Lint runs synchronously inside the recipe save endpoint; the validator must complete in < 50 ms for a typical recipe
- Regeneration is never automatic. A curator reviews `regen-passed.jsonl` before applying
- The regeneration script does not call USDA — nutrition is recomputed downstream once the ingredient mappings are in place (see [Nutrition](./nutrition.md))
- Fuzzy ingredient name matching uses a deterministic local algorithm (stemming + Levenshtein) — no LLM call inside the validator

## Related specs

- [Recipes](./recipes.md) — the data shape lint protects
- [Nutrition](./nutrition.md) — emits warnings about ingredient nutrition gaps
- [Advisor](./advisor.md) — the photo-extraction skill goes through the same lint

## Source

- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — validator (new)
- [apps/api/src/services/recipeLint.ranges.ts](../apps/api/src/services/recipeLint.ranges.ts) — per-ingredient sanity ranges (new)
- [apps/api/scripts/regenerateRecipes.ts](../apps/api/scripts/regenerateRecipes.ts) — LLM regeneration entry point (new)
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — write reviewed JSONL into DB (new)
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) — calls lint before persisting
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — final lint-validated catalog
