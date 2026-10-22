# Recipe Quality

Lint validator that protects recipe data integrity, plus the LLM-assisted regeneration pipeline used to rebuild the seed catalog and to support photo-extracted recipes.

## Why This Exists

The previous seed contained recipes that referenced ingredients in their steps that were not present in the ingredient list (e.g. *Falafel* mentioned guisantes; the list had none) and gramajes calibrated for ≈ 5–6 diners while the UI claimed "Para 2". A user following these recipes literally cannot cook them. The lint validator and the regeneration pipeline together prevent that class of bug from recurring.

## User Capabilities

- Authors of user-created recipes see a clear error if their recipe fails any blocking lint rule on save
- Authors see non-blocking warnings (nutrition gaps, suspiciously high/low values) in a side panel, but can save anyway
- Authors (and admins) see a **"Para hacer la compra"** card on the recipe detail (Ingredientes tab) and above the ingredient rows on the edit page whenever an ingredient can't go to the shopping list or a shop order as written; it disappears once fixed (Shoppability below)
- Curators can run a one-off regeneration script that rebuilds the system catalog from scratch and only persists recipes that pass the lint
- Curators can review the LLM-generated JSON for each recipe before it is committed to the seed (no automatic apply)

## Lint Rules

### Blocking (recipe save fails)

1. **Required fields present** — `name`, `servings >= 1`, at least 1 ingredient, at least 1 step
2. **Step text completeness** (`STEP_INGREDIENT_NOT_LISTED`) — every catalog ingredient a step names must either:
   - Exist in the recipe's `RecipeIngredient` set, or
   - Be linked through `step.ingredientRefs`, or
   - Be accounted for by the recipe's own names: same head noun («aceite de girasol» when «aceite de oliva» is listed), every significant word of it in the listed names («pollo» with «muslos de pollo» or «caldo de pollo», «cerdo» with «lomo de cerdo»), a part of something listed («zumo de limón», «dientes de ajo», «salsa de tomate» with «tomate triturado»), the words after «de» that qualify a listed ingredient («pato» in «magret de pato» with «magret» listed, «vino blanco» in «vinagre de vino blanco» with «vinagre de vino»; the import matches a line to a broader catalogue row and the step keeps the line's full name), or a generic name with a listed member («pasta» with «espaguetis», «pescado» with «merluza», «cebolla» with «cebolleta»)
   - **Water and salt never need listing** (`agua`, `sal`, «agua caliente», «sal gruesa»…); a bought product does («agua de azahar»). Collective words («las verduras», «la fruta», «las especias», «el marisco») never count
   - Detection (PRO-289, 2026-10-20) matches **whole words**, singular or plural only — never across gender or with typos, so «pulpa» isn't «pulpo», «pero»/«espera» aren't «pera», «pardinas» isn't «sardinas», «pechuga» isn't «lechuga». Homographs are read in context: an adjective/participle («hasta que esté dorada», «picada», «rallado») counts only after an article, a number or «de» («la dorada», «dos doradas», «lomos de dorada»); «pasas» only as a noun, not the verb («lo pasas por harina», «pasa a una fuente»); «pasta» only when the step cooks noodles (cuece, hierve, escurre, al dente) and it isn't a paste or a batter («una pasta espesa», «la pasta de la masa»); «mango» not as a pan's handle; «café» not as a cup or a spoon («las tazas de café», «una cucharilla de café»)
   - It still catches what is really missing: a chorizo or a morcilla in the steps and not in the list, «dora el pollo» with no chicken listed, «la dorada» as the fish
2b. **Diet and allergens in the steps** (`STEP_DIET_INGREDIENT_NOT_LISTED`, PRO-268) — a step that names meat, fish, shellfish or an allergen (gluten, dairy, egg, nuts, peanut, soy, sesame, mustard, celery, sulphites/wine, lupin) the ingredients don't account for blocks the save, because the diet and allergen filters read the ingredients: «Lentejas guisadas» said «añadir chorizo y morcilla» and «añadir huesos y pimentón» with none of them listed, so it reached a home without pork. It uses its own word list (`stepDietMentions.ts`), so it works whatever the catalogue has («huesos» is in no catalogue). Read like rule 2 — whole words, singular/plural — and:
   - covered when every word of it is in the recipe's names («pollo» with «caldo de pollo», «vino» with «vinagre de vino»); generic words and cuts («carne», «pescado», «marisco», «frutos secos», «albóndigas», «pechuga», «lomo», «huesos») by any listed member of their family; «claras», «yemas» by a listed egg. A specific meat still counts with another meat listed («chorizo» with «pollo»: a pork-free home)
   - not after «sin» («aceitunas sin hueso»); a cut or «carne» followed by «de» lets the next word speak («lomos de merluza», «la carne del tomate», «huesos de aceituna»); «nuez moscada», «leche de coco / avena / arroz», a size («del tamaño de una nuez», «una nuez de mantequilla») and adjectives («hasta que esté dorada», «que quede clara») don't count
   - a name rule 2 already flagged in that step isn't repeated
   - The catalogue pass `scripts/auditStepDietMentions.ts` (read-only: seed files by default, `--from=db` for a database) lists the catalogue recipes that break this rule, plus rule 2's other unlisted ingredients («pimentón»), in a report for Cocina (`pasos-sin-ingrediente-<fecha>.md` + `.json`); Cocina proposes the fixes in batches for Miguel's OK
3. **No orphan ingredients** — every `RecipeIngredient` must be either listed prominently in `step.text` or referenced by at least one step's `ingredientRefs` (catches dead entries)
4. **Quantity sanity** — for every ingredient, `quantity / servings` must fall inside a per-ingredient sensible range (e.g. ternera: 80–250 g/serving; main proteins keep their 80 g minimum, so a portion that's too small is caught). In the **catalogue audit** that hides system recipes from menus ([Menus → Catalogue quality gate](./menus.md)), that 80 g minimum doesn't apply to starters nor to dishes with rice, legumes or **pasta/noodles** as their base (pasta, espaguetis, macarrones, fideos, tallarines, lasaña, canelones…, whole word; not «pasta de curry», «pasta brisa», «pasta filo»; PRO-338, D-110 extended), unless a member's ficha has `protein_minimum`; the 300 g maximum always applies. Out-of-range quantities block save with a clear message; the user can override with a `force: true` flag for special cases (e.g. roasts). Frying/confit fat noted «para freír…» / «para confitar…» is checked by what the food absorbs (15 % / 25 % of the pan amount) against the ceiling only, so «500 ml para freír» for 4 passes and 2 l for 2 doesn't (see [nutrition.md](./nutrition.md))
5. **Step references resolve** — every id in `step.ingredientRefs` must exist in the recipe's `RecipeIngredient` set
6. **Time consistency** — if `prepTime`, `cookTime`, and step durations are all set, the sum of `step.durationMin` must not exceed `prepTime + cookTime` by more than 20 % (catches typos)
7. **Public tag hygiene** — no tag in the public `tags` array equals a meal name, season, difficulty, or any value in `internalTags`

### Warnings (saved, surfaced to curator)

- An ingredient has no `fdcId` mapping → nutrition will be incomplete
- An ingredient unit is `ml` but the catalog ingredient has no `density` → conversion to grams skipped
- Computed `kcal/servings` falls outside [150, 1500] → suspect quantity error
- Step lacks `durationMin` while `step.text` contains a time hint ("30 minutos", "media hora") → suggest extracting it
- Recipe has no `equipment` set → curator may want to add at least one tool
- `NOTE_STARTS_WITH_NUMBER` (PRO-184) — an ingredient's note starts with a number («6 dientes, laminados», «200 g de…») → put that amount in quantity + unit (e.g. `6 u`) and keep only the how in the note («laminados»). The ficha still scales a countable amount at the start of a note (see [Recipes → Quantity Scaling](./recipes.md)), but new recipes (the catalogue import of PRO-154) shouldn't rely on it
- `BUY_*` — the Shoppability checks below

### Shoppability (`BUY_*` warnings, 2026-10-08)

Reuses the shop-order buy rules ([shop-orders.md](./shop-orders.md) → Buy rules); never blocks a save. Returned as lint warnings on `POST`/`PUT /recipes` and imports, and as `shoppingIssues` (`{ code, message, rowId }`) on `GET /recipes/:id` for the author/admins only.

- `BUY_NO_QUANTITY` — something you have to buy goes `al_gusto` / `pizca` / 0 ("cilantro al gusto") → it never reaches the shopping list. Pantry basics (sal, pimienta, aceite, especias secas…) and optional rows may go al gusto. The message suggests an amount in units the form's selector has ("p. ej. 1 ud (manojo) de cilantro", "1 ud (trozo) de jengibre fresco", "250 g de espinacas"; `quantityHintFor` in `@ona/shared`), never a shop unit like "1 manojo" the user can't pick (PRO-90). "1 ud" or "20 g" of jengibre clear it; "1 al gusto" doesn't
- `BUY_GENERIC` — a family or an open choice in the name: "hierbas aromáticas (romero, tomillo)" → one row per product; "pescado entero fresco (dorada, lubina…)" → name one
- `BUY_NEEDS_CHOICE` — the buy rule needs a choice nobody made: "ternera" with no cut, "jamón" with no serrano/ibérico, "pan blanco" with no type. The name or the ingredient note settles it ("para guisar", "carrilleras", "serrano", "en barra")
- `BUY_NEEDS_WEIGHT` — meat/fish/charcutería counted in units ("2 u de panceta"): the shop weighs, give grams

Fixing it in the editor (PRO-90): typing an amount on a row "al gusto" / "pizca" switches its unit to a buyable one — "ud" when the shop sells it by the piece (jengibre, cilantro), "g" otherwise (`unitAfterQuantity`) — so it isn't saved as "1 al gusto"; the selector shows `u` as "ud" and `al_gusto` as "al gusto". The editor also keeps each row's note and section through a save (it used to drop them, which brought `BUY_NEEDS_CHOICE` back), and after saving it waits for the recipe to be re-read before going back to the detail, so the card there reflects what was saved. Tests: `recipeShoppingUnits.test.ts`, e2e `recipe-shopping-fix.spec.ts` (import → fix → save; "Corregir en la receta" → fix → save).

The 2026-10-08 audit of the 81 production recipes fixed every hit by hand (30 recipes: cuts in notes, quantities for herbs and al-gusto rows, a dorada instead of salmón in "Dorada a la marsellesa", jamón de york in "Sándwich mixto") and recomputed their nutrition; all 81 now pass.

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

Per-ingredient range tables live next to the lint validator. Initial coverage focuses on staples (proteins, grains, oils, common vegetables). Ingredients without a range fall back to a global ceiling of `2000 g/serving` (a soft cap that catches obvious typos like 10 kg of flour). Curators add new ranges as needed. A name not in the table takes the range of its first word («pimiento rojo» → pimiento).

Minimums are a **base or dressing** amount, not a main's, for what goes into a sofrito or a dressing (PRO-289): cebolla, pimiento, zanahoria, puerro and tomate 10 g; apio and chalota 5 g; patata 20 g (in a stew or a soup); ajo 1 g; leche and nata 5 ml; yogur 10 g; aceite and mantequilla 2 g; harina 1 g; sal no minimum; pan 5 g (a slice to thicken a sauce), pan rallado 2 g. Rice, pasta, quinoa and couscous 15 g (also a complement, «lentejas con arroz»; the catalogue audit checks the base of the dish added up). «judías verdes» is a vegetable (20–300 g), not the dry pulse. Mejillones go up to 500 g (with shell, 350–400 g is one plate). Those minimums still catch a unit typo (1 g of onion, 10 ml of milk for four).

## Constraints

- The lint validator is the **same code** for: API saves, seed regeneration, and photo extraction. There is no second implementation
- Lint runs synchronously inside the recipe save endpoint; the validator must complete in < 50 ms for a typical recipe
- Regeneration is never automatic. A curator reviews `regen-passed.jsonl` before applying
- The regeneration script does not call USDA — nutrition is recomputed downstream once the ingredient mappings are in place (see [Nutrition](./nutrition.md))
- Ingredient name matching is a deterministic local algorithm — no LLM call inside the validator. The orphan check (is the recipe's own ingredient mentioned?) is loose: stemming + Levenshtein ≤ 1 + head noun. The not-listed check is strict: whole words, singular/plural, homographs in context (rule 2)
- Tests: `recipeLint.test.ts`; `recipeLintFalsePositives.test.ts` — one case per rejection of the `cocina-01` batch (invented steps) and what must keep failing; `stepDietMentions.test.ts` — rule 2b, «Lentejas guisadas» through the reviewer, and the catalogue pass

## Related specs

- [Recipes](./recipes.md) — the data shape lint protects
- [Nutrition](./nutrition.md) — emits warnings about ingredient nutrition gaps
- [Advisor](./advisor.md) — the photo-extraction skill goes through the same lint

## Source

- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — validator
- [apps/api/src/services/recipeShoppability.ts](../apps/api/src/services/recipeShoppability.ts) — the `BUY_*` checks; [apps/web/src/components/recipes/ShoppingIssues.tsx](../apps/web/src/components/recipes/ShoppingIssues.tsx) — the "Para hacer la compra" card; [packages/shared/src/buy/recipeUnits.ts](../packages/shared/src/buy/recipeUnits.ts) — form units (`unitAfterQuantity`, `quantityHintFor`, `RECIPE_UNIT_LABELS`); [apps/web/src/app/recipes/[id]/edit/page.tsx](../apps/web/src/app/recipes/[id]/edit/page.tsx) — the editor
- [apps/api/src/services/stepDietMentions.ts](../apps/api/src/services/stepDietMentions.ts) — rule 2b (diet and allergen words in the steps); [apps/api/src/services/stepDietMentionsAudit.ts](../apps/api/src/services/stepDietMentionsAudit.ts) + [apps/api/scripts/auditStepDietMentions.ts](../apps/api/scripts/auditStepDietMentions.ts) — the catalogue pass for Cocina
- [apps/api/src/services/recipeLint.ranges.ts](../apps/api/src/services/recipeLint.ranges.ts) — per-ingredient sanity ranges
- [apps/api/src/services/recipePersistence.ts](../apps/api/src/services/recipePersistence.ts) — orchestrator: lint → nutrition aggregate → allergen union → DB write (single canonical save path used by the API route, the photo extractor and the apply script)
- [apps/api/src/services/regenSchema.ts](../apps/api/src/services/regenSchema.ts) — Zod schema describing the LLM regen JSON output, used by both `regenerateRecipes.ts` to validate the model response and by the apply script to type the JSONL rows
- [apps/api/scripts/regenerateRecipes.ts](../apps/api/scripts/regenerateRecipes.ts) — LLM regeneration entry point
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — write reviewed JSONL into DB; supports `--auto-create-missing` (see [Ingredient Auto-Create](./ingredient-auto-create.md))
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) — photo extractor; feeds output through `recipePersistence`
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — final lint-validated catalog
