# Assistant Skills Expansion (1–13) Implementation Plan

## Summary

Adds 13 new skills to the assistant so the conversational experience covers the daily reality of cooking and eating: read what's in the pantry, mark groceries off the list while shopping, scale a recipe to the diners at the table, get history, evaluate a food's healthiness through Ona's lens, propose substitutions aligned with the philosophy, score weekly variety, see your eating window, get an inflammation index per recipe, and drive the cooking flow by voice.

Skills 11–13 (cooking-mode commands) are wired end-to-end: the cooking-mode UI is already shipped (see [cooking-mode spec](../specs/cooking-mode.md)), so the skills emit events on a small client-side bus that `CookingShell` subscribes to. Skill 9 (`get_eating_window`) needs `eatenAt` written into the meal slot inside the existing `mark_meal_eaten` skill — additive on the JSONB `menus.days`, no migration. Skill 10 (`get_inflammation_index`) combines real per-ingredient data already in the [nutrition spec](../specs/nutrition.md) (`fiber`, `fat`, `salt`, `recipes.nutritionPerServing`) with keyword heuristics; it stays heuristic until coverage of `fatAcids` / `carbTypes` JSONB on `ingredients` reaches a useful share.

All skills are added to `apps/api/src/services/assistant/skills.ts`, automatically picked up by `getRealtimeTools()` so they work both in the text chat and in the voice mode without further wiring.

## Tasks

- [ ] Add pantry + shopping mutation skills
  - File: `apps/api/src/services/assistant/skills.ts` (modify) — add three definitions:
    + `get_pantry_stock` — reads `items` from the latest `shopping_lists` row for the user, returns the subset with `inStock=true` (name + quantity + unit). Empty result if no list exists yet.
    + `mark_in_stock` — params `{ ingredient: string, inStock?: boolean }`. Locates the latest list, finds the item by case-insensitive ingredient match (fuzzy split-by-word like the existing recipe matchers), toggles `inStock` (or sets to the provided boolean), persists.
    + `check_shopping_item` — same locator, toggles `checked` instead. Refuses gracefully if item not found.
  - All three reuse the data shape already defined in [`apps/api/src/services/shoppingList.ts`](../apps/api/src/services/shoppingList.ts) and the existing endpoints `PUT /shopping-list/:listId/item/:itemId/stock` and `/check`.
  - Spanish summaries (e.g. *"Mantequilla marcada como en casa."*).
  + Why: today the assistant cannot answer *"qué tengo en casa"* nor *"añade leche a la lista"*, which are two of the most natural cooking questions.

- [ ] Add read-only catalog skills (`get_my_recipes`, `get_menu_history`)
  - File: `apps/api/src/services/assistant/skills.ts` (modify)
    + `get_my_recipes` — SELECT from `recipes` where `userId = ctx.userId`, return name + id + meals + prepTime. Distinguishes user-created recipes from system catalog (the current `search_recipes` mixes both).
    + `get_menu_history` — params `{ weeks?: number }` (default 4). SELECT last N rows from `menus` for the user ordered by `weekStart` desc; for each, summarise comidas únicas. Useful for *"¿cuándo cené pollo al curry la última vez?"*.
  - Both pure reads — no migration.

- [ ] Add `scale_recipe` skill
  - File: `apps/api/src/services/assistant/skills.ts` (modify)
  - Params: `{ recipeName: string, servings: number }`.
  - Loads the recipe + ingredients (reuses `loadRecipesWithIngredients` helper already in the file). The base servings is `recipe.servings ?? 2`. Computes ratio `servings / base`. Returns each ingredient with quantity multiplied by the ratio (rounded sensibly: 2 decimals for grams/ml, integer for unidades, ¼ steps for cucharadas).
  - Does **not** mutate the recipe. The summary is human-readable so the model can speak it back.
  - When the upcoming `apps/api/src/services/recipeScaler.ts` (referenced by [recipes spec](../specs/recipes.md) but not yet implemented) exists, replace the inline rounding with a call to it.
  + Why: "esta receta para 3 personas" is asked daily and currently has no answer.

- [ ] Add KB-driven evaluation skills (`evaluate_food_health`, `suggest_substitution`)
  - File: `apps/api/src/services/assistant/skills.ts` (modify) — both follow the same pattern as the existing `nutrition_advice` skill: the handler returns `data` and a `summary` that frames the question for the model, which then composes the verbal reply using the knowledge base loaded in [`systemPrompt.ts`](../apps/api/src/services/assistant/systemPrompt.ts) (the 10 commandments).
    + `evaluate_food_health` — params `{ food: string }`. Summary: *"El usuario pregunta si X es saludable. Evalualo segun los principios de Ona: 1) carga inflamatoria, 2) impacto en insulina, 3) procesado, 4) frecuencia, 5) calidad nutricional real. Da una respuesta corta con criterio propio. Recuerda que `lo que se considera saludable` a menudo no lo es (zumos, arroz blanco, aceites vegetales)."*
    + `suggest_substitution` — params `{ ingredient: string, recipeName?: string, restriction?: string }`. Summary: framed around principle 6 (*el tipo de grasa importa más que la cantidad*): never recommend margarina, vegetable oils, or sweeteners; do recommend ghee, mantequilla, AOVE, fermentados.
  - No DB changes. Uses the existing KB pipeline.
  + Why: these two skills are **what makes Ona feel like Ona** instead of a generic meal planner.

- [ ] Add `get_variety_score`
  - File: `apps/api/src/services/assistant/skills.ts` (modify)
  - Reads the current week's `menus.days`, joins each `recipeId` with `recipe_ingredients` → `ingredients` to count distinct ingredient names. Returns:
    + `distinctIngredients`, `distinctVegetables` (filtered by aisle/group when available), `distinctProteins` (heuristic: any ingredient whose name matches `pollo|pescado|huevo|legumbre|...`), and a 0–100 score (`min(distinct/35, 1) * 100`).
  - The summary cites principle 7 (*temporada y variedad*) — *"Llevas 14 vegetales distintos esta semana, en buen camino. La meta razonable son 25 — añade verdes oscuros y crucíferas."*
  + Why: surfacing variety is sutil but it's the principle most invisibly violated by users.

- [ ] Add `eaten_at` timestamp to menu slots + extend `mark_meal_eaten`
  - File: `apps/api/src/services/assistant/skills.ts` (modify) — when `eaten=true`, also write `eatenAt: new Date().toISOString()` into the slot. When `eaten=false`, clear it.
  - No DB migration: `menus.days` is JSONB so the new field is additive. Existing rows simply lack `eatenAt` until updated.
  - Update the `MealSlot` type in `packages/shared/src/types/menu.ts` (add optional `eatenAt?: string`) so consumers can read it.
  + Why: precursor for `get_eating_window` and the foundation for principle 3 (*frecuencia importa tanto como contenido*).

- [ ] Add `get_eating_window`
  - File: `apps/api/src/services/assistant/skills.ts` (modify)
  - Params: `{ weeks?: number }` (default 2). Reads the user's recent `menus.days` and looks at every slot with `eatenAt` set; computes earliest hour and latest hour per day, average eating window length, and meals/day.
  - Returns a summary citing principle 3: *"Tu ventana media es de 13h (08:30–21:30). Cerrarla a 10h (mover desayuno o cena) reduce la insulina cronica."*
  + Why: window length is the single most actionable insight for someone who wants to reduce inflammation without changing what they eat.

- [ ] Add `get_inflammation_index` (heuristic v1)
  - File: `apps/api/src/services/assistant/skills.ts` (modify)
  - Params: `{ recipeName?: string, weekly?: boolean }` (one or the other; if `weekly`, score each meal in the week + compute average).
  - Heuristic v1: per recipe, compute a 0–100 score using ingredient name patterns (until `ingredient_nutrition` is fully populated):
    + base 50
    + −5 per *procesado* keyword (azucar, harina refinada, aceite_girasol, aceite_soja, aceite_maiz, embutido, salsa_industrial)
    + +5 per *whole-food* keyword (verdura, hoja, semilla, fermentado, pescado_azul, aceite_oliva, aguacate, frutos_secos)
    + +3 per cocción suave (vapor, plancha, horno) inferred from `recipe.steps` keywords
    + −3 per fritura
    + clamp 0–100
  - Surfaces in the summary alongside which keywords drove the score, so the user understands the *why*.
  - Mark the file with a TODO referencing the proper [`nutrition spec`](../specs/nutrition.md) implementation.

- [ ] Add cooking-mode voice skills (stubs)
  - File: `apps/api/src/services/assistant/skills.ts` (modify) — three skills that all return `{ data, summary, uiHint: 'cooking_navigate' | 'cooking_timer' | 'cooking_step' }`:
    + `start_cooking_mode` — params `{ recipeName: string }`. Resolves the recipe id via fuzzy match (same helper as `get_recipe_details`), returns `data: { recipeId, recipeName }` so the client can `router.push(/recipes/${recipeId}/cook)`.
    + `set_timer` — params `{ minutes: number, label?: string }`. Returns `data: { minutes, label }`. Doesn't track state server-side; the client's cooking-mode page consumes the event.
    + `next_step` / `previous_step` (single skill named `cooking_step` with param `direction: 'next'|'previous'|'repeat'`). Same shape: emits an event the cooking page consumes.
  - Front-end consumption (the cooking-mode page subscribing to these events) is **out of scope** for this plan — it lands with [cooking-mode spec](../specs/cooking-mode.md). The skills are added now so the assistant already speaks them and the future page just listens.
  + Why: shipping these as stubs ahead of the cooking page means voice-driven cooking works the day cooking-mode lands, with no follow-up plan.

- [ ] Wire all new skills into the exports + system prompt
  - File: `apps/api/src/services/assistant/skills.ts` (modify) — add the 13 new skill consts to the `skills: SkillDefinition[]` array.
  - File: `apps/api/src/services/assistant/systemPrompt.ts` (modify) — add usage hints for the new skills following the same style as existing instructions (e.g. *"Cuando el usuario pregunte 'qué tengo en casa' o cite ingredientes disponibles, usa get_pantry_stock"*).
  - No client wiring needed: voice mode picks them up automatically via `getRealtimeTools()`. The text-mode `AdvisorChat` already runs the skill loop.

- [ ] Update specs
  - File: `specs/advisor.md` (modify) — extend the `## Assistant Skills` list with the 13 new entries and a one-line description each.
  - File: `specs/index.md` (modify) — append the new skills to the Advisor keywords block so search works.
  - File: `specs/nutrition.md` (modify, planned spec) — note that `get_inflammation_index` is a heuristic v1 to be replaced when `ingredient_nutrition` coverage reaches 80%.
  - File: `specs/cooking-mode.md` (modify) — note that `start_cooking_mode`, `set_timer`, `cooking_step` already exist as backend skills; the spec only needs to describe how the cooking-mode page subscribes to their `uiHint` events.

- [ ] Verify implementation
  - Backend: typecheck passes (`pnpm --filter @ona/api lint` or `tsc --noEmit`).
  - Backend: from a `curl` session with a real JWT, call `POST /assistant/:userId/chat` with each prompt and confirm the right skill is invoked + the summary is sensible:
    + *"qué tengo en la nevera"* → `get_pantry_stock`
    + *"marca leche como comprada"* → `check_shopping_item`
    + *"tengo mantequilla en casa"* → `mark_in_stock`
    + *"recetas que he guardado yo"* → `get_my_recipes`
    + *"cuándo cené tortilla por última vez"* → `get_menu_history`
    + *"esta receta para 4 personas"* → `scale_recipe`
    + *"el zumo de naranja es sano"* → `evaluate_food_health` returns a reply citing 10 commandments tone (no, by the way)
    + *"no tengo nata, qué uso"* → `suggest_substitution`
    + *"cómo voy de variedad esta semana"* → `get_variety_score`
    + *"a qué horas como"* → `get_eating_window` (works once at least one meal has been marked eaten)
    + *"qué tan inflamatoria es la pasta carbonara"* → `get_inflammation_index`
    + *"empieza a cocinar [receta]"* → `start_cooking_mode` returns the recipeId
    + *"ponme un timer de 12 minutos"* → `set_timer` returns `{ minutes: 12 }`
    + *"siguiente paso"* → `cooking_step` returns `{ direction: 'next' }`
  - Voice mode: same 14 prompts spoken into the orb (pick a couple that involve mutation: `mark_in_stock`, `scale_recipe`, `evaluate_food_health`). Confirm that the model speaks the result and that mutations land in the DB (check `/shopping-list/:listId` after).
  - Mobile 390×844: open the chat, send each prompt, confirm the response renders without breaking.
  - Confirm none of the existing 13 skills regressed (re-run `qué toca cocinar hoy`, `genera un menú nuevo`).
