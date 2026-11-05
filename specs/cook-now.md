# Cook now («Cocinar ahora»)

A «Cocinar» tab that, with four questions (time, people, whether something can be bought, the pantry confirmed), proposes a recipe to cook right now and two alternatives. Design: [`docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md`](../docs/superpowers/specs/2026-11-03-cocinar-ahora-design.md); plan: [`docs/superpowers/plans/2026-11-03-cocinar-ahora.md`](../docs/superpowers/plans/2026-11-03-cocinar-ahora.md).

It ships in five phases on one branch, published together at the end (PRO-1105 to PRO-1109). **Phase 1 (PRO-1105) is in:** what each ingredient of a recipe is for. Nothing of it is visible to households yet.

TODO(spec): the tab, the search, «Cocinar esta», the pantry move and the events land with phases 2–5 (plan tasks 7–20); this spec is rewritten then.

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

## Constraints

- **Marks survive edits**: saving a recipe (`persistRecipe`, edit mode) carries each row's role and substitutes to the new rows, first by row id when the ingredient is the same, then by ingredient id (the same ingredient in two sections keeps each row its own marks). A new ingredient comes unmarked; a row id reused for another ingredient doesn't carry the old marks (`carryIngredientMarks`). The recipe form doesn't send marks, so an edit keeps them; an explicit `role` in the write input (Cocina's batch) wins.
- **Marks travel with copies**: «Añadir a mis recetas» on the web (`POST /recipes/:id/copy`) and through Mimo copy each row's role and substitutes (`ingredientMarksOf`). From then on the copy is the household's and Cocina never sees it.
- Columns `recipe_ingredients.role` (text, null = unmarked, checked `essential | secondary`) and `recipe_ingredients.substitute_ingredient_ids` (uuid[], default empty), migration `0105_ingredient_roles` (only adds).
- Substitute ids aren't foreign keys: a substitute ingredient deleted later just stops matching.

## Related specs

- [Recipes](./recipes.md) — the recipe and its ingredients; copies
- [Catalog Import](./catalog-import.md) — Cocina's batch file
- [Menus](./menus.md) — the recipe loader the search will reuse
- [Metrics](./metrics.md) — the other office token (`x-metrics-token`, read only)

## Source

- [packages/shared/src/types/ingredientRole.ts](../packages/shared/src/types/ingredientRole.ts) — `INGREDIENT_ROLES`, `ingredientRoleMarkSchema`, `ingredientRolesUpdateSchema`
- [apps/api/src/services/ingredientRoles.ts](../apps/api/src/services/ingredientRoles.ts) — `carryIngredientMarks`, `ingredientMarksOf`, `autoIngredientRole`, `recipeGrams`, `roleOf`
- [apps/api/src/routes/ingredientRoles.ts](../apps/api/src/routes/ingredientRoles.ts) — the two routes (`CATALOGUE_RECIPE`, `foreignRowIds`), mounted next to `metricsRoutes` in `index.ts`, before the routers with a catch-all `authMiddleware`
- [apps/api/src/middleware/cocinaAuth.ts](../apps/api/src/middleware/cocinaAuth.ts) — `x-cocina-token` or admin JWT; `COCINA_WRITE_TOKEN` in `config/env.ts`
- [apps/api/src/services/recipePersistence.ts](../apps/api/src/services/recipePersistence.ts) — marks carried on edit
- [apps/api/src/services/catalogImport.ts](../apps/api/src/services/catalogImport.ts), [catalogImportDb.ts](../apps/api/src/services/catalogImportDb.ts) — the batch's `imprescindible` / `sustitutos`
- Tests: `ingredientRoles.test.ts` (carry, copy paths, the rule), `cocinaAuth.test.ts`, `ingredientRolesRoute.test.ts` (body, foreign rows, only catalogue recipes in the WHERE of both routes), `catalogImportFile.test.ts` and `catalogImport.test.ts` (the batch fields through the route schema to `persistDraft`)
