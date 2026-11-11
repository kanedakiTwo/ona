# Cook now («Cocinar ahora»)

A «Cocinar» tab that, with four questions (time, people, whether something can be bought, the pantry confirmed), proposes a recipe to cook right now and two alternatives. Design: [`docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md`](../docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md); plan: [`docs/superpowers/plans/2026-11-03-cocinar-ahora.md`](../docs/superpowers/plans/2026-11-03-cocinar-ahora.md).

It ships in five phases on one branch, published together at the end (PRO-1105 to PRO-1109). **Phase 1 (PRO-1105) is in:** what each ingredient of a recipe is for. **Phase 2 (PRO-1106) is in:** the search, its four routes, Mimo's line and the usage events. **Phase 3 (PRO-1107) is in:** the «Cocinar» tab, with the pantry moved into it.

TODO(spec): the cook mode's menu context, retiring `/recipes/match-pantry` and the end-to-end test land with phases 4–5 (plan tasks 17–20); this spec is rewritten then.

## User Capabilities

- Every ingredient of a recipe is **essential** (without it, it isn't that dish) or **secondary** (it can be left out), and may list **substitutes** (catalogue ingredients that can stand in for it: nata → leche). The search of phase 2 uses it to say what is missing and what can be swapped.
- **Cocina (the office) marks the catalogue**, recipe by recipe:
  - `GET /admin/recipes/ingredient-roles/pending?limit=N` (1–50, default 10): catalogue recipes (drafts included) with any ingredient still unmarked, oldest first, each with its ingredient rows (row id, name, category, quantity, unit, optional, note, section, role, substitutes).
  - `PUT /admin/recipes/:id/ingredient-roles` with `[{ recipeIngredientId, role: 'essential' | 'secondary', substituteIngredientIds: [uuid…] }]` (1–80 marks, up to 5 substitutes each; `ingredientRolesUpdateSchema` in `@ona/shared`). 400 when the body is wrong or a row isn't of that recipe; 404 when the recipe isn't of the catalogue.
  - Auth: an admin JWT, or the header `x-cocina-token` equal to `COCINA_WRITE_TOKEN` (`middleware/cocinaAuth.ts`). With the header, only the token counts: a wrong token, or the variable unset, is 401 `COCINA_TOKEN_INVALID`, with no JWT fallback. The token opens these two routes only.
- **Cocina's batch files** can bring the marks from the start: `imprescindible` and `sustitutos` per ingredient ([Catalog Import](./catalog-import.md)).
- **Until a line is marked, a rule decides** (`autoIngredientRole`, «Regla automática»), in this order:
  1. optional, quantity 0, unit `al_gusto` or `pizca`, or «al gusto» / «pizca» in the note or the displayed unit → secondary;
  2. category `proteina`, `cereal` or `legumbre` → essential, whatever it weighs;
  3. otherwise by weight: 15 % or more of the recipe's weighable grams (the basics salt, oil, water, pepper and flour left out of the total, `recipeGrams`) → essential; less, or a line that can't be weighed (cda, cdita, a unit without a weight) → secondary.
  A mark always wins over the rule (`roleOf`), except that an optional line is always secondary.
- **Households' own recipes keep the rule**: they never reach the office (privacy, E-40). Both routes read and write only catalogue recipes: no author and not a household's copy (`CATALOGUE_RECIPE`). Account deletion removes own recipes before the author goes ([Privacy](./privacy.md)), so a null author is always the catalogue.

### The «Cocinar» tab (phase 3)

- **Five tabs** in the bottom bar and the desktop sidebar: Menú, **Cocinar** (`/cocinar`, chef's hat), Compra, Recetas, Perfil. The page is protected like every app page and its visit counts as `screen_viewed` `cocinar` ([Metrics](./metrics.md)).
- **`/cocinar`**, top to bottom («¿Qué cocinamos?»):
  - **What the menu had for the meal of now** (`TodayPlannedCard`, from `GET /cook-now/today`), unless the meal is locked or there is none: the first dish's photo, «Hoy toca *X*» (or «Hoy tocaban *X e Y*»), the longest total time and «Empezar a cocinar», straight into cook mode for that slot (`cookHref` with `menu`, `day`, `meal`) with the meal's people count, else the household's. Below, always, «¿Otra cosa? Cocinar ahora» (just «Cocinar ahora» with nothing planned), which opens the four questions.
  - **«Con lo que tienes · Puedes cocinar esto»** (`PantryMatchCard`): up to 3 recipes from `POST /cook-now/proposal` with the default answers and `requirePantryUse` (`pantryMatchBody`), each row with thumbnail, name, `cookNowHitLine` and time, linking to the recipe. Hidden while loading, with nothing to show or with `fallback` (they all miss something essential). It left `/menu` (the old `/recipes/match-pantry` card) with this phase.
  - **«Tu despensa»** (`#despensa`): the whole pantry register, as it was in Perfil ([Pantry](./pantry.md)). `/profile/pantry` redirects to `/cocinar#despensa` and Perfil's «Despensa» links there.
- **The four questions** (`CookNowFlow`), one per screen with «Atrás» on top (on the first, it closes the flow) and the answers kept when going back; the chosen option has `aria-pressed`:
  1. «¿Cuánto tiempo tienes?» — «15 min», «30 min», «45 min», «1 h o más»; one tap moves on.
  2. «¿Para cuántos?» — `− N +` (1–20), starting at the meal's people count or the household's (a child is one person, `menuDiners`, as in the menu), and «Seguir».
  3. «¿Puedes comprar algo?» — «Solo lo que hay» · «Sí, algo»; one tap moves on.
  4. **The pantry to confirm** (`PantryConfirmStep`): «Confirma tu despensa» («¿Qué tienes en casa?» when empty, with the search open), grouped Nevera → Congelador → Despensa (folded). Each row: `−` / quantity / `+` (step 1 for u, cda and cdita; 50 for g and ml; the quantity can be typed) and «Quitar»; every change is saved at once and a row at 0 stays. «Añadir» searches the catalogue, then asks where it is (Nevera by default) and adds 1 u. «Proponme una receta» sends the answers (`proposalBody`).
- **The proposal** (`ProposalView`): «Buscando…» while it loads. The preferred recipe big — photo, name, time («· unos minutos más» when it is `margin`), `cookNowHitLine` and Mimo's line when it arrives (no space kept for it) — with «Cocinar esta»; two alternatives below as rows, and tapping one makes it the preferred. Notices: both meals already eaten («Hoy ya habéis comido y cenado: la cocinas igual, pero no la apunto en el menú.»), a locked meal («Esa comida está bloqueada en tu menú: la cocinas igual, pero no la apunto.»), `fallback` («Con lo que hay justo no sale ninguna; a estas les falta una cosa»), nothing found («Con esto no encuentro nada»). «Cambiar respuestas» goes back to question 1.
- **«Cocinar esta»**: when the meal of now had dishes planned, a sheet (`DisplaceSheet`) asks «¿Y el *X*?» / «¿Y las *X e Y*?»: «Pasarlo / Pasarlas a otro día» (the rest of the week, «Mañana», «El jueves»…, each «libre» or «en lugar de *…*»; skipped days and locked meals greyed out) or «Quitarlo / Quitarlas»; closing it counts as taking them out. Then `POST /cook-now/choose` (`chooseBody`: servings go as null when they equal the household's diners, so a meal with its own count keeps it) and cook mode for that slot. A locked meal, or none, goes to cook mode without touching the menu; if the menu answers `locked` or `no_meal`, the notice shows and cook mode opens without the slot.

### The search (phase 2)

- **`GET /cook-now/today`** → `{ weekStart, day, meal, menuId, planned[], locked, slotServings, targets[] }`. `meal` is the **meal of now** (`cookNowMeal`, Madrid time): lunch until 16:00, then dinner; a meal already marked eaten is skipped; `null` when both are eaten. `planned` = the recipe dishes cooked for that slot (`plannedRecipeDishes`: not leftovers, tápers or notes) with name, image and total time. `targets` = the rest of the week (tomorrow → Sunday, same meal) where the planned dishes could move, each saying what it would replace and `disabled` for a skipped day or a locked meal (`displaceTargets`).
- **`POST /cook-now/proposal`** `{ minutes: 15 | 30 | 45 | null, servings: 1–20, canBuy, requirePantryUse? }` (`cookNowProposalSchema`) → `{ meal, fallback, items[] }`, 0–3 recipes, the first one preferred. Each item: `recipe { id, name, imageUrl, totalTime }`, `fit` (`fits` | `margin`), `missingEssential`, `short`, `missingSecondary`, `substitutions [{ missing, use }]`, `uses`, `expiring`. The web writes the line under each one with `cookNowHitLine` («No te falta nada», «Puedes hacerla sin perejil», «Te falta: pollo», «Te falta un poco de arroz», «Cambia la nata por leche»).
  - **Candidates** (`loadCookNowCandidates`): the menu's loader and matcher for that meal and weekday — allergies and diet of the whole household, dislikes, the week's vetoes, «Mejor no», equipment, season — **without the time budget**, main or versatile dishes only (`isCookNowCourse`). Without a meal of now it searches dinner and answers `meal: null`.
  - **Time** (`fitOf`): total time ≤ the answer fits; up to +20 % is `margin`; more, or a recipe without time, is out. `null` minutes = no limit.
  - **What the house has** (`evaluateRecipe`): basics (salt, oil, water, pepper, flour) never count; a line is at home when a catalogue-linked pantry row with quantity > 0 has its id or its word in the name; an active staple counts as at home; a substitute in the pantry stands in (`substitutions`); an optional line never counts as missing. An **essential** line the pantry has in the same unit but not enough of (scaled to the servings asked over the recipe's servings, 4 when unknown) is missing and `short`; different units count as enough. Essential or secondary by `roleOf` (phase 1).
  - **Filter** (`rankCookNow`): «Solo lo que tengo» (`canBuy: false`) allows no missing essential; if nothing is left, the recipes missing exactly one are shown with `fallback: true`. «Sí, algo» allows up to two.
  - **Order**, each criterion only breaking the previous one's ties: fits before margin → fewer missing essentials → more pantry used (each ingredient expiring within 3 days counts double) → fewer missing secondaries → «Repetir a menudo» (5 stars, «Me encanta») first → cooked by the household in the last 7 days last → name.
  - `requirePantryUse: true` (the «Con lo que tienes» card of phase 3) keeps only recipes that use something from the pantry, and doesn't count as a proposal in the usage events.
- **`POST /cook-now/phrase`** `{ recipeId }` → `{ text | null }`: Mimo's line on the preferred recipe (`services/cookNow/phrase.ts`), one sentence of at most 15 words written only from the facts given (what it uses from the pantry, what expires soon, days since it was last cooked, «Repetir a menudo», what can be left out). The only live AI call of the feature: `claude-opus-5-5`, low effort, billed as `cook_now_phrase` in `cost_events` to the household with no user, so it stays **outside Mimo's monthly cap** (`getUserMonthlySpendEur` sums by user). A household on Gratis (`isOnFreePlan`, PRO-385), no API key, an error or more than 5 s → `null` (the web shows the card without it). Cleaned to the first line, without quotes, at most 160 characters (`cleanPhrase`). `null` too when the user can't see the recipe.
- **`POST /cook-now/choose`** `{ recipeId, servings | null, displacedTo | null }` (`cookNowChooseSchema`; no plan guard: changing the week is in Gratis too, PRO-385) puts the recipe in the meal of now (`placeCookNowRecipe`): it replaces every dish of that slot, with `servings` as the slot's diners when given (null = the household default). The planned recipe dishes move, settings kept, to `displacedTo` (same meal, replacing what was there) or go when it is null; leftovers pointing at the moved slot follow it. The changes are written to the menu history (`recordMenuEdits`). A week without a menu gets a row with just that dish, like Mimo's «Con lo que tienes». Answers `{ placed: true, menuId, weekStart, day, meal }`, or `{ placed: false, reason }` with `no_meal`, `locked` (the meal is locked; `today` already says it), `not_found` (not visible) or `banned` (vetoed this week); a `displacedTo` that isn't a free target is 400.
- **Usage events** ([Metrics](./metrics.md)): `cook_now_proposed` (`canBuy`) on each proposal asked, `cook_now_chosen` (`displaced`) on each choice, and `meal_cooked` now carries `fromMenu` (the cook log came with a `menuId`). They watch the growth line's **first strike** (D-158): cooking a dish of the menu.

## Constraints

- **Marks survive edits**: saving a recipe (`persistRecipe`, edit mode) carries each row's role and substitutes to the new rows, first by row id when the ingredient is the same, then by ingredient id (the same ingredient in two sections keeps each row its own marks). A new ingredient comes unmarked; a row id reused for another ingredient doesn't carry the old marks (`carryIngredientMarks`). The recipe form doesn't send marks, so an edit keeps them; an explicit `role` in the write input (Cocina's batch) wins.
- **Marks travel with copies**: «Añadir a mis recetas» on the web (`POST /recipes/:id/copy`) and through Mimo copy each row's role and substitutes (`ingredientMarksOf`). From then on the copy is the household's and Cocina never sees it.
- Columns `recipe_ingredients.role` (text, null = unmarked, checked `essential | secondary`) and `recipe_ingredients.substitute_ingredient_ids` (uuid[], default empty), migration `0107_ingredient_roles` (only adds).
- Substitute ids aren't foreign keys: a substitute ingredient deleted later just stops matching.

## Related specs

- [Recipes](./recipes.md) — the recipe and its ingredients; copies
- [Catalog Import](./catalog-import.md) — Cocina's batch file
- [Menus](./menus.md) — the recipe loader and matcher the search reuses; the slot the choice writes
- [Pantry](./pantry.md) — the register shown in the tab
- [Cook from Pantry](./cook-from-pantry.md) — the old «Con lo que tienes» on `/menu`
- [Metrics](./metrics.md) — the other office token (`x-metrics-token`, read only)

## Source

- [packages/shared/src/cookNow.ts](../packages/shared/src/cookNow.ts) — `cookNowMeal`, `plannedRecipeDishes`, `displaceTargets`, `cookNowHitLine`, the request schemas
- [apps/api/src/services/cookNow/search.ts](../apps/api/src/services/cookNow/search.ts) — `fitOf`, `evaluateRecipe`, `rankCookNow` (pure)
- [apps/api/src/services/cookNow/place.ts](../apps/api/src/services/cookNow/place.ts) — `placeCookNowRecipe` (pure)
- [apps/api/src/services/cookNow/load.ts](../apps/api/src/services/cookNow/load.ts) — `loadCookNowToday`, `loadCookNowCandidates`, `loadCookNowHouse`, `findCookNowProposal`, `loadPhraseFacts`, `chooseCookNowRecipe`
- [apps/api/src/services/cookNow/phrase.ts](../apps/api/src/services/cookNow/phrase.ts) — Mimo's line
- [apps/api/src/routes/cookNow.ts](../apps/api/src/routes/cookNow.ts) — the four routes, mounted next to `cookLogRoutes`
- [apps/api/src/services/matchableRecipes.ts](../apps/api/src/services/matchableRecipes.ts) — the loader brings each line's row id, optional, displayed unit, category, role and substitutes
- [apps/web/src/app/cocinar/page.tsx](../apps/web/src/app/cocinar/page.tsx) — the tab; [components/cocinar/](../apps/web/src/components/cocinar/) — `TodayPlannedCard`, `PantryMatchCard`, `CookNowFlow`, `PantryConfirmStep`, `ProposalView`, `DisplaceSheet`; [hooks/useCookNow.ts](../apps/web/src/hooks/useCookNow.ts); [lib/cookNowPayload.ts](../apps/web/src/lib/cookNowPayload.ts), [lib/cookHref.ts](../apps/web/src/lib/cookHref.ts), [lib/menuDiners.ts](../apps/web/src/lib/menuDiners.ts); [components/pantry/PantryManager.tsx](../apps/web/src/components/pantry/PantryManager.tsx)
- Tests (phase 3): `cookNowContract.test.ts` (the web's bodies against the schemas, `menuDiners`), `cookHref.test.ts`, `webUsagePaths.test.ts`, `routeAccess.test.ts`, `redesignDSubPerfil.test.ts`; e2e `pantry-locations.spec.ts`, `desktop-windows.spec.ts`, `cook-now-tab.spec.ts`
- Tests (phase 2): `cookNowShared.test.ts`, `cookNowSearch.test.ts`, `cookNowPlace.test.ts`, `cookNowLoad.test.ts`, `cookNowPhrase.test.ts`, `usageEvents.test.ts`

- [packages/shared/src/types/ingredientRole.ts](../packages/shared/src/types/ingredientRole.ts) — `INGREDIENT_ROLES`, `ingredientRoleMarkSchema`, `ingredientRolesUpdateSchema`
- [apps/api/src/services/ingredientRoles.ts](../apps/api/src/services/ingredientRoles.ts) — `carryIngredientMarks`, `ingredientMarksOf`, `autoIngredientRole`, `recipeGrams`, `roleOf`
- [apps/api/src/routes/ingredientRoles.ts](../apps/api/src/routes/ingredientRoles.ts) — the two routes (`CATALOGUE_RECIPE`, `foreignRowIds`), mounted next to `metricsRoutes` in `index.ts`, before the routers with a catch-all `authMiddleware`
- [apps/api/src/middleware/cocinaAuth.ts](../apps/api/src/middleware/cocinaAuth.ts) — `x-cocina-token` or admin JWT; `COCINA_WRITE_TOKEN` in `config/env.ts`
- [apps/api/src/services/recipePersistence.ts](../apps/api/src/services/recipePersistence.ts) — marks carried on edit
- [apps/api/src/services/catalogImport.ts](../apps/api/src/services/catalogImport.ts), [catalogImportDb.ts](../apps/api/src/services/catalogImportDb.ts) — the batch's `imprescindible` / `sustitutos`
- Tests: `ingredientRoles.test.ts` (carry, copy paths, the rule), `cocinaAuth.test.ts`, `ingredientRolesRoute.test.ts` (body, foreign rows, only catalogue recipes in the WHERE of both routes), `catalogImportFile.test.ts` and `catalogImport.test.ts` (the batch fields through the route schema to `persistDraft`)
