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
- Helper rules collapse common ingredients (e.g. "trigo", "harina de trigo", "cebada", "centeno", "avena" → `gluten`; "leche", "queso", "mantequilla", "nata" → `lactosa`; also cheeses by their own name — gouda, emmental, brie, camembert, cheddar, edam, gorgonzola, roquefort, ricotta, burrata, provolone, pecorino, grana padano, manchego… —, kéfir, ghee, suero de leche, caseína and bechamel, PRO-332; not «kéfir de agua» nor «pisto manchego»). Gluten is prudent (PRO-61): any flour/pasta/noodle/dough unless it names arroz, maíz, garbanzo, almendra, trigo sarraceno or mandioca; soy sauce/tamari unless «sin gluten», and oyster sauce, Shaoxing wine, teriyaki and hoisin (usually made with wheat; teriyaki and hoisin are also `soja`); «sin gluten» never counts. «Mayonesa» → `huevo`; Worcestershire → `pescado` + `gluten`; dashi and katsuobushi → `pescado`; shichimi → `sesamo`. Shellfish beyond the usual ones (2026-10-21, new ingredients of the books and Yaya batches that came in untagged): chirlas, navajas, zamburiñas, coquinas, bígaros, caracoles → `moluscos`; galeras, carabineros, nécoras, centollos, percebes, buey de mar → `crustaceos` (both also `marisco`)
- Broths carry celery (PRO-363, 2026-10-24, after «caldo de ave», «caldo de carne» and «caldo de jamón» of the books batch came in without it): a «caldo», «fondo» or «concentrado» that names carne, ave, pollo, gallina, jamón, cocido, ternera, verduras, vegetal, pescado, marisco or huesos → `apio`, prudent because bought broths almost always have it; not when the name says «sin apio» (which also cancels the plain «apio» word), not «huesos para caldo» (the bones, not the broth), not fumet or dashi (no broth word), not «fondos de alcachofa» nor «tomate concentrado» (no base). «Pasas» and «uvas pasas» (whole word) → `sulfitos`. The seed catalogue's broths carry `apio` (`nutritionAllergens.test.ts` fails if one doesn't)
- On every boot (after `db:migrate`) `applyNameAllergenTags` (`allergenBackfill.ts`) adds to the stored tags what the newer name rules say, and to the stored union of the recipes that use those ingredients: `lactosa` to the PRO-332 cheese/dairy names, `apio` to broths and `sulfitos` to raisins (PRO-363). Only those names and those tags; **additive only**, a stored tag is never removed; idempotent
- Cured meats whose gluten depends on the brand (chorizo, morcilla, butifarras, salchichas, foie, jamón de york) carry **no** `gluten` tag (PRO-196, Miguel 2026-10-18: Cocina's prudence tag was removed by migration `0072_embutidos_sin_gluten.sql`, which also drops `gluten` from the stored union of the recipes that use them unless another ingredient still has it). A coeliac household is told instead to buy them «sin gluten» (see [Shopping](./shopping.md) and [Recipes](./recipes.md)). The «Sobras del cocido» keep the tag
- Name matching is accent- and case-insensitive and goes by **whole words** with their plural (PRO-193, PRO-160 for peanut): «panceta» is not «pan», «manitas de cerdo» is not «maní», «panela» is not bread. Compounds are listed explicitly as a word or a word stem («panko», «empanad…», «apionabo», «salmonete», «ques…», «natill…», «sardin…», «vinagret…»), so they are still caught. Phrases that name something else are removed first: «pasta de tomate/curry/sésamo» is not pasta (sésamo still counts as `sesamo`), «leche de coco/almendra/avena/soja/arroz» is not milk (almendra and avena keep `frutos_secos` / `gluten`), «nuez moscada» is not a nut. «Nueces» now counts as `frutos_secos`
- The name inference is used by the ficha (`effectiveAllergens`), by the menu's allergy filter (`dietaryRestrictions.ts`, on top of the catalogue tags), and to pre-fill tags when an ingredient is created (auto-create, `POST /ingredients`, recipe extraction, seed and catalogue scripts). A tag already stored in the catalogue is never removed by these rules
- The recipe ficha shows `effectiveAllergens` (stored union + name inference, additive, computed on read), so a stale stored union is corrected without touching the database
- A recipe's `allergens` is the union of all its ingredients' `allergenTags`, including `optional` ingredients (so the badge is conservative)

### What a compound ingredient contains (PRO-198)

A compound ingredient (leftovers, stocks, the dish «cocido», generic cured meats, patés) can hide what it's made of: «Sobras del cocido madrileño» names no pork. `ingredients.contains_tags` says it (`CONTAINS_TAGS` in `services/compoundIngredients.ts`: `cerdo`, `ternera`, `pollo`, `cordero`, `carne`, `alcohol`, the EU allergen tags, and `vegetal` = reviewed, nothing animal). The diet and allergy filter reads them (see [Menus → Restrictions & allergies](./menus.md)).
- On every boot (after `db:migrate`) `applyCompoundIngredientTags` labels the obvious compounds while they still have no tag: «Sobras del cocido (madrileño)» → cerdo, ternera, pollo, gluten; «Caldo de cocido» → cerdo, ternera, pollo; «Caldo de pollo/gallina» → pollo; «Caldo de pescado», «Fumet» → pescado; «Caldo de verduras» → vegetal; generic «Embutido(s)», «Salchicha(s)», «Salchichas frescas», «Foie gras de untar» → cerdo (prudent, PRO-61). A label set by Cocina is never overwritten
- The rest is labelled by Cocina, without Miguel: `scripts/auditCompoundIngredients.ts` (`DATABASE_URL=…`, `--fixture=…`, `--json`) and `GET /admin/ingredient-gaps` → `compoundWithoutTags` list the compounds with no tag («sobras de…», «caldo», «fondo de», «fumet», «cocido», «embutido», «fiambre», «salchicha», «paté», «foie», «relleno», «cubito»); `PATCH /ingredients/:id` takes `containsTags`

## Recipe Aggregation

`nutritionPerServing` is computed when a recipe is saved (create, update, or seed):

1. For each `RecipeIngredient`, convert `quantity` to grams using:
   - `g` → grams as-is
   - `ml` → grams using `ingredient.density` (g/ml); if density is missing, the ingredient is skipped and a warning is recorded
   - `u` → grams using `ingredient.unitWeight` (g/unidad, e.g. 1 huevo ≈ 50 g)
   - `cda` → 15 g equivalent if `ingredient.density` is missing; else `15 ml × density`
   - `cdita` → 5 g equivalent
   - `pizca` and `al_gusto` are treated as 0 g (negligible)
2. Multiply each ingredient's grams (× `edible_fraction` for bone-in cuts, see Edible weight) by its per-100 g nutrient values from the `ingredients` row
   - **Frying and confit fat** count only what the food absorbs: a fat (aceite, manteca, mantequilla… or ≥ 80 g fat/100 g) whose line note starts with «para freír» / «para la fritura» counts 15 %, «para confitar» 25 %. The recipe keeps the real amount the cook needs in the pan («500 ml, para freír; se recupera casi todo»). A mixed note («40 ml para el pisto y el resto para freír») doesn't qualify: split it into two lines (`cookingMedium.ts`)
3. Sum across all ingredients to get totals
4. Divide by `recipe.servings` to get the per-serving values
5. Cache the result in `recipe.nutritionPerServing`

Optional ingredients are included by default; recipes can mark them `optional: true` for display but they still count toward the cached nutrition (the user knows the worst case).

## Incomplete nutrition

A skipped line (step 1: `u` without `unitWeight`, `ml` without `density`, no catalogue row) used to vanish silently, so the recipe showed a low figure that looked right («Salmón a la plancha con calabacín», 54 kcal). Since PRO-176:

- `aggregateNutrition` returns `incomplete: true` when some skipped line is **not negligible**. Negligible: salt, water, spices and seasoning herbs (pimienta, pimentón, comino, laurel, perejil…, `negligible.ts`) and any line whose note says «al gusto». `pizca` / `al_gusto` units count 0 g and are never skipped
- Saving a recipe stores it in `recipes.nutrition_incomplete` (migration 0066). The cached figures are still stored (the menu generator keeps using them), but the ficha shows none: «Aún no podemos calcular la nutrición de esta receta» (see [Recipes](./recipes.md))
- On every API boot, after `db:migrate`, `applyNutritionCompleteness` recomputes **only the mark** of every recipe from today's catalogue (a unit weight added by Cocina clears it); figures are not touched — `scripts/recomputeRecipeNutrition.ts` does that, and also writes the mark
- The fix for a marked recipe is data: give the ingredient a `unitWeight` / `density` (the catalogue audit lists them, Constraints below), or write the line in grams

## Edible weight

Recipes give meat as bought, with bone («1.350 g de gallina», «5 manitas de cerdo», «1,1 kg de chuletón»), while the per-100 g values are of the edible part. Since PRO-194 `ingredients.edible_fraction` (0–1, default 1, migration 0067) holds the share that is eaten, and both the aggregator (step 2) and the catalogue audit ([Menus](./menus.md) → Catalogue quality gate) multiply the line's grams by it, whatever its unit:

- Values (`nutrition/edibleFraction.ts`): USDA SR Legacy refuse of the closest raw entry, rounded — pollo entero 0.68, gallina 0.70, muslo 0.70, contramuslo 0.80, alitas 0.54 — and estimates [E] for Spanish cuts without an exact entry, for Cocina to review: alas de pavo 0.60, costillas 0.70, chuletón 0.85, chuletas 0.80, chuletillas 0.70, manitas/pies de cerdo 0.50, rabo 0.50, osobuco/ossobuco 0.80, codillo 0.70, paletilla/pierna 0.75, cuello de cordero/cabrito/cerdo/ternera 0.60, conejo entero 0.73, codorniz/codornices 0.65, perdiz/perdices 0.65 (until 2026-10-21 the rule missed «codorniz» in the singular and «ossobuco»)
- Only names that are the bone-in cut get one: «deshuesado», «sin hueso», «filete», «picado», «carne de…», stocks, tins and «pechuga» never do; nor does «conejo» alone, whose unit weight Cocina already set as the meat (700 g)
- Whole fish and shellfish in their shell (PRO-281), as the catalogue writes them («mejillones», «dorada»): mejillones 0.25; almejas, chirlas, berberechos 0.15; dorada 0.55; lubina 0.67 — from the Ministerio de Agricultura product sheets (Moreiras et al. tables, 2013; PRO-337, Cocina 2026-10-22; the URL of each sheet is next to its rule in `edibleFraction.ts`) [V]; gambas, langostinos, cigalas 0.48 (BEDCA 0.47) and besugo, «pescado entero» 0.50 are Cocina's [I]. USDA SR Legacy lists these raw entries with 0 % refuse, so it is not the source. A row the boot step set with the first PRO-281 values (mejillones 0.28, almejas/berberechos 0.18, dorada/lubina 0.50) moves to the new one at the next boot (`isSupersededRuleValue`); a value set by hand never changes. Never when the name says it is already the edible part: «limpio», «lomo», «filete», «pelado», «sin concha», «sin cáscara», «carne de…», tins, «en escabeche», «al natural»
- Stock bones count 0 (PRO-282): «huesos para caldo», «hueso de jamón», «hueso de rodilla», «hueso de caña…», espinazo, carcasa, cartílago, raspas, «espinas de pescado» — only names that *start* with the bone, checked before the «caldo» exclusion, so «caldo de huesos» is never touched. What the stock draws from the bone is not counted (a little low, on purpose). A fraction of 0 is a real value: the aggregator and the audit read 0 as nothing eaten (only a missing, negative or > 1 value reads as 1)
- A line whose note says it is already the edible part — «peladas», «sin concha», «sin cáscara», «sin espinas», «sin hueso», «en lomos», «filetes», «solo la carne» — counts its whole weight even if its ingredient has a fraction (`lineEdibleShare`: «Arroz tres delicias» asks for «gambas, peladas»). «limpios» doesn't: a cleaned mussel or a gutted sea bream keeps its shell or its bones. The catalogue audit reads the note too
- Effect on the catalogue audit (2026-10-22, staging catalogue): with the edible weight, «Mejillones a la marinera», «Mejillones en escabeche», «Fideos caldosos con mejillones», «Espaguetis con almejas», «Ensalada marisquera» and «Dorada a la marsellesa» fall under the 80 g main-protein minimum and leave the menus until Cocina raises the quantity (e.g. 1,5 kg of mussels for 4)
- On every boot, after `db:migrate`, `applyEdibleFractions` sets the rule's value on matching ingredients still at 1 (a hand-set value ≠ 1 is never changed) and recomputes `nutritionPerServing` + the «incompleta» mark of every recipe (system and user) that uses one of them — the equivalent of `recomputeRecipeNutrition --scope=all --execute`, limited to those recipes. Idempotent: the next boot finds nothing to do. `scripts/recomputeRecipeNutrition.ts` also uses the fraction
- A new ingredient (auto-create, imports) starts at 1; the next boot gives it its value if its name matches a rule

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
- Values come from USDA through `fdcId` when there is a reliable match. Spanish products with no USDA equivalent (chorizo, morcilla, lacón…) and rows the USDA auto-create got wrong carry BEDCA or typical-label values set by Cocina; a wrong value is fixed in place and the row is left out of `seed/data/ingredient-fdc-map.yaml`, so a USDA re-seed doesn't bring it back (2026-10-17: Cocina corrected 149 rows; 52 mappings came out of the map)
- An ingredient at 0 kcal (other than agua and sal), or used in `u` without `unitWeight` / in `ml` without `density`, under-counts every recipe that uses it: the catalogue audit flags them
- Allergen tags are authoritative for badges and filters but are advisory, not legal — the UI shows a small disclaimer
- Recomputation on save is synchronous; large recipes (> 30 ingredients) must still complete inside one HTTP request

## Related specs

- [Recipes](./recipes.md) — defines `nutritionPerServing` and `allergens` cached fields
- [Recipe Quality](./recipe-quality.md) — lint warnings for missing nutrition data
- [Menus](./menus.md) — generator uses real per-serving nutrition to balance the week
- [Shopping](./shopping.md) — uses `density` and `unitWeight` from the same ingredient catalog for unit-aware aggregation

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `ingredients` (per-100 g nutrition columns + density/unitWeight/edibleFraction/aisle/allergenTags/containsTags)
- [apps/api/src/services/compoundIngredients.ts](../apps/api/src/services/compoundIngredients.ts) — what compound ingredients contain: allowed tags, known labels and their boot step, audit
- [apps/api/scripts/auditCompoundIngredients.ts](../apps/api/scripts/auditCompoundIngredients.ts) — read-only list of compound ingredients with no contains tag, for Cocina
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts) — USDA FDC API client with on-disk cache
- [apps/api/src/services/nutrition/aggregate.ts](../apps/api/src/services/nutrition/aggregate.ts) — recipe-level aggregation
- [apps/api/src/services/nutrition/negligible.ts](../apps/api/src/services/nutrition/negligible.ts) — salt, water, spices, «al gusto»: lines whose skip doesn't make a recipe incomplete
- [apps/api/src/services/nutrition/edibleFraction.ts](../apps/api/src/services/nutrition/edibleFraction.ts) — edible share of bone-in cuts and its boot step
- [apps/api/src/services/nutritionCompleteness.ts](../apps/api/src/services/nutritionCompleteness.ts) — boot recompute of `recipes.nutrition_incomplete`
- [apps/api/src/services/nutrition/cookingMedium.ts](../apps/api/src/services/nutrition/cookingMedium.ts) — frying/confit fat: absorbed share for nutrition and the lint
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — allergen union and mapping helpers
- [apps/api/src/services/nutrition/index.ts](../apps/api/src/services/nutrition/index.ts) — public surface re-exports
- [apps/api/src/seed/usda.ts](../apps/api/src/seed/usda.ts) — one-time population script: reads `ingredient-fdc-map.yaml`, fetches per-100 g nutrition from USDA, writes to the catalog
- [apps/api/scripts/expandIngredientCatalog.ts](../apps/api/scripts/expandIngredientCatalog.ts) — curator-driven catalog expansion: queries USDA for ~100 common Spanish kitchen staples and writes a draft YAML for review before merging into the main map
- [packages/shared/src/types/nutrition.ts](../packages/shared/src/types/nutrition.ts)
