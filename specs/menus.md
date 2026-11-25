# Menus

Weekly meal plan generation and management.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [La pantalla del menú](./menus-pantalla.md) — generar la semana, vista día y vista semana, la hoja de la comida y la de la semana, cambios al momento, confirmaciones y el escritorio.
- [Ajustar la semana a mano](./menus-ajustar.md) — imprimir, quitar y añadir comidas, comensales, vetar, días sin cocinar, notas, sobras y táper, congelador, «antes de planificar», la nevera, rehacer la semana, una comida nueva y los bloqueos.
- [Varios platos por comida y registro de cambios](./menus-platos.md) — comidas con varios platos (rutas por plato, la hoja con varios platos, estado por comida y por plato) y el registro de cambios del menú.
- [Cómo se genera el menú](./menus-generacion.md) — el algoritmo, lo que lee de la ficha, la puerta de calidad del catálogo, lo que el hogar ha dicho del menú, las recetas «de diario» y el tiempo de cocina.
- [Alergias, dietas y restricciones](./menus-restricciones.md) — alergias, dietas, halal, sin alcohol, reglas prudentes, ingredientes compuestos, lo que no gusta y qué pasa cuando cambian las alergias o la dieta.
- [Semana tipo, comidas fijas, comedor escolar y festivos](./menus-semana-tipo.md) — la semana tipo (D-182), las comidas fijas, el menú del comedor escolar y los festivos.
- [Menú del mes, acierto, recetas que cambian y piloto automático](./menus-automatico.md) — el menú del mes, el acierto (cuánto se parece a lo que os gusta), qué pasa cuando cambia una receta y el piloto automático de los jueves.
- [Histórico](./historico/menus.md) — lo que ya no existe y por qué se quitó.

## Menu Structure

A menu is stored per-user per-week:
- `weekStart` is the Monday of the week (`YYYY-MM-DD`)
- `days` is a 7-element array; each day is `{ breakfast?, lunch?, dinner?, snack? }`
- Each filled slot is `{ recipeId, recipeName, servings?, kind?, leftoverOf?, imageUrl? }` — `imageUrl` is **not** persisted in the JSONB; the API resolves it per request from the joined `recipes.image_url` so a regenerate-image takes effect on the very next response. `servings` is the optional per-slot diner override; `kind: 'leftover'` plus `leftoverOf: { day, meal }` marks a slot cloned from another via the leftover endpoint.
- `locked` is a nested object: `{ "<dayIndex>": { "<meal>": true } }`
- `bannedRecipeIds` is a string-array of recipe ids the user vetoed this week; the matcher excludes them across every regeneration call. Carries over when the user re-runs `POST /menu/generate` for the same week.
- `skippedDays` is an integer-array (0-6) of day indices the user marked "sin cocinar"; whole-week regenerate leaves these days empty (no slots get inserted).

## Menu Logs

Every generated menu also creates a `menu_logs` row with:
- Total calories for the week
- Aggregated nutrient profile (vitamins, minerals, etc.)
- Used to update `user_nutrient_balance` (running balance for the advisor)

## Access control (IDOR guards)

Every menu route is scoped to the caller — a logged-in user can only read or
mutate their own menus (or, when `SHARED_HOUSEHOLD_SCOPE` is on, those of a
fellow household member). This closes a former gap where any authenticated
user could read/modify any menu by id.

- `POST /menu/generate` **requires auth** and the body `userId` must equal the
  authenticated user (`403` otherwise). It used to be open — anyone could
  overwrite any user's week by passing their id; that is no longer possible.
- `GET /menu/:userId/:weekId` and `GET /menu/:userId/history` resolve the read
  scope from the **token**, never the path param. Requesting another user's id
  returns `403` unless they share your household.
- Every `/menu/:menuId/...` mutation (regenerate, add/delete/move slot, lock,
  ban, leftover, skip, servings) passes through a `:menuId` param guard:
  `400` if the id isn't a UUID, `404` if no such menu, `403` if it belongs to
  another user/household. Owner-or-same-household access mirrors the shopping
  list rule (`canAccessRow` in `scopeResolver.ts`).

## Constraints

- All menu routes require auth (including `POST /menu/generate`, which also
  enforces that the body `userId` matches the token)
- A household without a semana tipo yet (and without an old plantilla) plans lunch + dinner every day (no breakfast, no snack)
- The meals of each day, their diners and their dishes are the household's **semana tipo** (`household_week_types`, below). The old per-user `userSettings.template` (`mealTemplate` day → meal → diners, `mealDishCounts`, `fixedMeals`, `taperDays`; parsed by `legacyPlantilla.ts`) only feeds its one-off migration and is never written again: `PUT /user/:id/settings` keeps those keys as they were stored, whatever the profile sends. A slot's diners seed `servings` of the slot generated there; per-slot overrides on the menu card still win
- If no menu exists for the requested week, `GET /menu/:userId/:weekId` returns 404
- **Mimo makes one menu per request** (PRO-1298, `services/menuRequestGuard.ts`): while a week is being made for a person (`generate_weekly_menu`, or a week of the WhatsApp sign-up's first menu), another request for that same week starts no second generation («No he lanzado otro: … ya se esta preparando»); a WhatsApp message sent before the week's menu was made gets no second one either, and a tapped button only makes a whole week when it or the question it answered asks for one (see [WhatsApp](./whatsapp.md)). The in-flight check lives in the API process (Railway runs one). `POST /menu/generate` on the web is unchanged. Tests: `menuOneRequest.test.ts`, `menuOneRequest.smoke.ts` (two at once → one row in `menus`)
- The shopping page redirects users to `/menu` if no menu exists for the current week
- **Household scope (PR 1B):** menus carry both `user_id` and `household_id`. Inserts always populate both; reads filter by `household_id` when the env flag `SHARED_HOUSEHOLD_SCOPE=true` (default ON in dev/test, OFF in prod). When the flag is on, every member of a shared household reads the same menus. See [Household](./household.md)

## Related specs

- [Recipes](./recipes.md) — what gets selected for slots; `recipe.servings` drives per-recipe scaling
- [Shopping](./shopping.md) — auto-generated from a menu's days
- [Nutrition](./nutrition.md) — provides the cached per-serving nutrition the algorithm now scores against
- [Auth](./auth.md) — user profile drives calorie targets and restrictions
- [Advisor](./advisor.md) — assistant skills can generate, regenerate, and read menus
- [PWA](./pwa.md) — meal regeneration and slot-lock toggles are wrapped by the offline queue

## Source
- [apps/api/src/services/menuRules.ts](../apps/api/src/services/menuRules.ts) — what the household said about its menu: notes read as rules, weekly limits, light and sweet dishes, main food (2026-11-19)
- [packages/shared/src/utils/menuSlots.ts](../packages/shared/src/utils/menuSlots.ts) — `moveSlotInWeek` (server and web), `dishKey` / `slotKey` / `MENU_CHANGED_CODE`, `withLock` / `swapLocks` (PRO-1175) · [apps/web/src/lib/mealSheet.ts](../apps/web/src/lib/mealSheet.ts) — which options the meal sheet shows, `mealWhen`, the «Que elija Mimoia» body (PRO-1175); the multi-dish sheet, each dish's options (PRO-1176) · [apps/web/src/components/menu/DishRow.tsx](../apps/web/src/components/menu/DishRow.tsx) — a dish's row and its «···» · [apps/web/src/components/menu/RecipePickerSheet.tsx](../apps/web/src/components/menu/RecipePickerSheet.tsx) — the picker, its type chips and «Que elija Mimoia» · [apps/web/src/lib/menuOptimistic.ts](../apps/web/src/lib/menuOptimistic.ts) — the menu changes drawn before the API answers · [apps/web/src/components/menu/ChangeFailedNotice.tsx](../apps/web/src/components/menu/ChangeFailedNotice.tsx) — the line when one is undone · [apps/api/src/services/matchableRecipes.ts](../apps/api/src/services/matchableRecipes.ts) — `derivedRecipeReads`, the per-recipe memo (2026-11-10)
- [packages/shared/src/types/cookingTime.ts](../packages/shared/src/types/cookingTime.ts) — day limits (total / trabajo) and `fitsTimeBudget`
- [packages/shared/src/constants/holidays.ts](../packages/shared/src/constants/holidays.ts) — festivos 2026–2027 (BOE) · [apps/api/src/services/menuHolidays.ts](../apps/api/src/services/menuHolidays.ts) — holidays as weekend in the menu (PRO-226)
- [apps/api/src/services/catalogRecipeTimes.ts](../apps/api/src/services/catalogRecipeTimes.ts) — boot-time fill of catalogue times (PRO-138)
- [apps/api/src/services/recipeTimeTrim.ts](../apps/api/src/services/recipeTimeTrim.ts) — realistic totals of catalogue recipes (PRO-284)
- [apps/api/src/services/undercookedRecipes.ts](../apps/api/src/services/undercookedRecipes.ts) — runny yolk and pink mince: hidden tag, «Para embarazo o bebés» line, kept from households with a baby (PRO-1181)

- [apps/api/src/routes/menus.ts](../apps/api/src/routes/menus.ts)
- [packages/shared/src/utils/batchDay.ts](../packages/shared/src/utils/batchDay.ts) — el día de lote: `batchCookingOn`, `batchForLabel`, `isValidBatchDate` (PRO-1046) · [apps/api/src/services/assistant/batchDaySkills.ts](../apps/api/src/services/assistant/batchDaySkills.ts) — Mimo's `set_batch_day`
- [packages/shared/src/types/fixedMeals.ts](../packages/shared/src/types/fixedMeals.ts) — comidas fijas (PRO-218), stored in the semana tipo
- [packages/shared/src/types/weekType.ts](../packages/shared/src/types/weekType.ts) · [packages/shared/src/constants/dishTypes.ts](../packages/shared/src/constants/dishTypes.ts) · [apps/api/src/services/weekType.ts](../apps/api/src/services/weekType.ts) · [apps/api/src/services/weekTypePlan.ts](../apps/api/src/services/weekTypePlan.ts) · [apps/api/src/services/legacyPlantilla.ts](../apps/api/src/services/legacyPlantilla.ts) · [apps/api/src/routes/households.ts](../apps/api/src/routes/households.ts) — semana tipo (D-182)
- [apps/web/src/app/profile/semana-tipo/page.tsx](../apps/web/src/app/profile/semana-tipo/page.tsx) · [apps/web/src/components/weekType/](../apps/web/src/components/weekType/) (`WeekTypeGrid`, `SlotEditor`, `DishTypeChips`, `DishTypeIcon`) · [apps/web/src/components/menu/WeekTypeSkeleton.tsx](../apps/web/src/components/menu/WeekTypeSkeleton.tsx) (phase 5) · [apps/web/src/hooks/useWeekType.ts](../apps/web/src/hooks/useWeekType.ts) — «Tu semana tipo» (phase 2)
- [apps/api/src/services/schoolMenu.ts](../apps/api/src/services/schoolMenu.ts) · [apps/api/src/routes/schoolMenu.ts](../apps/api/src/routes/schoolMenu.ts) · [packages/shared/src/types/schoolMenu.ts](../packages/shared/src/types/schoolMenu.ts) · [apps/web/src/app/profile/casa/cole/page.tsx](../apps/web/src/app/profile/casa/cole/page.tsx) — menú del cole (PRO-224) · [apps/api/src/services/visionImage.ts](../apps/api/src/services/visionImage.ts)
- [apps/api/src/services/menuFit.ts](../apps/api/src/services/menuFit.ts) — «cuánto ha acertado» (PRO-155) · [apps/web/src/components/menu/MenuFitLine.tsx](../apps/web/src/components/menu/MenuFitLine.tsx)
- [apps/api/src/services/menuGenerator.ts](../apps/api/src/services/menuGenerator.ts) — core algorithm
- [apps/api/src/services/everydayMenu.ts](../apps/api/src/services/everydayMenu.ts) — recetas «de diario» and the arranque (PRO-1200)
- [apps/api/src/services/metabolicScore.ts](../apps/api/src/services/metabolicScore.ts) — per-recipe metabolic profile + weekly quality/variety for the fitness
- [apps/api/src/services/menuEdits.ts](../apps/api/src/services/menuEdits.ts) — registro de cambios del menú (PRO-149)
- [apps/api/src/services/menuRecipeRecheck.ts](../apps/api/src/services/menuRecipeRecheck.ts) — saved menus re-checked when a recipe changes or is deleted (PRO-345)
- [apps/api/src/services/menuRestrictionsReview.ts](../apps/api/src/services/menuRestrictionsReview.ts) — saved menus reviewed when someone saves allergies or diet (PRO-364) · [apps/api/src/services/menuSlotPick.ts](../apps/api/src/services/menuSlotPick.ts) — what «Cambiar» and that review know before re-picking a slot
- [apps/api/src/services/taper.ts](../apps/api/src/services/taper.ts) — «el táper de mañana» (PRO-223) · [apps/api/src/services/assistant/taperSkills.ts](../apps/api/src/services/assistant/taperSkills.ts)
- [apps/api/src/services/fridgeBoost.ts](../apps/api/src/services/fridgeBoost.ts) — «¿qué te queda en la nevera?» in the menu (PRO-229)
- [apps/api/src/services/fridgeReader.ts](../apps/api/src/services/fridgeReader.ts) — the fridge text read by Claude, the allergy rule and the question before generating (PRO-295)
- [apps/web/src/components/menu/FridgeHealthQuestion.tsx](../apps/web/src/components/menu/FridgeHealthQuestion.tsx) — «¿Guardo … en tu dieta?» on /menu (PRO-295)
- [apps/api/src/services/weekPlan.ts](../apps/api/src/services/weekPlan.ts) — «antes de planificar» for one week (PRO-225) · [packages/shared/src/types/weekPlan.ts](../packages/shared/src/types/weekPlan.ts) · [apps/web/src/components/menu/WeekPlanQuestions.tsx](../apps/web/src/components/menu/WeekPlanQuestions.tsx) · [apps/web/src/lib/weekPlanForm.ts](../apps/web/src/lib/weekPlanForm.ts)
- [apps/api/src/services/monthMenus.ts](../apps/api/src/services/monthMenus.ts) — «Menú del mes»: import rules, «Copiar a mi semana» (PRO-378) · [apps/api/src/routes/monthMenus.ts](../apps/api/src/routes/monthMenus.ts) · [apps/web/src/app/menu/mes/page.tsx](../apps/web/src/app/menu/mes/page.tsx) · [apps/web/src/components/recipes/MonthMenuCard.tsx](../apps/web/src/components/recipes/MonthMenuCard.tsx) · [apps/web/src/hooks/useMonthMenu.ts](../apps/web/src/hooks/useMonthMenu.ts)
- [apps/api/src/services/menuWeek.ts](../apps/api/src/services/menuWeek.ts) — what a week's regeneration carries over (locks, vetoes, skipped days) + `menuHasDishes`
- [apps/api/src/services/dietaryRestrictions.ts](../apps/api/src/services/dietaryRestrictions.ts) — restrictions/dislikes → allergen tags + ingredient terms · [packages/shared/src/constants/restrictions.ts](../packages/shared/src/constants/restrictions.ts) — `RESTRICTION_PRESETS`
- [apps/api/src/services/matchableRecipes.ts](../apps/api/src/services/matchableRecipes.ts) — the one recipe loader for every matcher path (visibility, fit maps, frequency, allergens)
- [apps/api/src/services/recipeMatcher.ts](../apps/api/src/services/recipeMatcher.ts) — slot matcher
- [apps/api/src/services/profile/reader.ts](../apps/api/src/services/profile/reader.ts) — the ficha's filters for the menu (PRO-253)
- [apps/api/src/services/calorieCalculator.ts](../apps/api/src/services/calorieCalculator.ts) · [nutrientCalculator.ts](../apps/api/src/services/nutrientCalculator.ts)
- [apps/api/src/services/catalogRecipeAudit.ts](../apps/api/src/services/catalogRecipeAudit.ts) — catalogue quality gate (PRO-73) · report [scripts/auditCatalogRecipes.ts](../apps/api/scripts/auditCatalogRecipes.ts)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx)
- [apps/web/src/components/menu/WeekStrip.tsx](../apps/web/src/components/menu/WeekStrip.tsx) — day strip
- [apps/web/src/components/menu/DayMeals.tsx](../apps/web/src/components/menu/DayMeals.tsx) — hero, rows, empty card, day footer · [MealOptions.tsx](../apps/web/src/components/menu/MealOptions.tsx) — meal sheet · [MenuSheet.tsx](../apps/web/src/components/menu/MenuSheet.tsx) — sheet, `SheetAction`, `ConfirmSheet` · [WeekActionsSheet.tsx](../apps/web/src/components/menu/WeekActionsSheet.tsx) · [MenuDesktop.tsx](../apps/web/src/components/menu/MenuDesktop.tsx) · [WeekGridView.tsx](../apps/web/src/components/menu/WeekGridView.tsx) — mobile Vista semana
- [apps/web/src/components/menu/NoDishSheets.tsx](../apps/web/src/components/menu/NoDishSheets.tsx) — «Sin plato todavía», the sheet of an empty slot and of «no hay» (PRO-1177; «Ya lo tengo hecho» → «Nevera» / «Congelador» replaced `FreezerDishSheets`, PRO-82, PRO-240)
- [apps/api/src/services/menuNames.ts](../apps/api/src/services/menuNames.ts) — every dish read with its recipe's name (PRO-240)
- [apps/web/src/lib/menuDay.ts](../apps/web/src/lib/menuDay.ts) — featured meal, headings, eyebrows, `absentMeals`, `feedsLeftovers` (tested in `apps/api/src/tests/menuDayView.test.ts`)
- [apps/web/src/lib/menuReturn.ts](../apps/web/src/lib/menuReturn.ts) — `?day=` of `/menu` and `?desde=menu` on the recipes it opens (back lands on the same week and day) · tests `e2e/menu-back-from-recipe.spec.ts`, `e2e/menu-empty-meal-sheet.spec.ts`
- [apps/web/src/hooks/useMenu.ts](../apps/web/src/hooks/useMenu.ts) — `useGenerateMenu`, `useRegenerateMeal`, `useLockMeal`, `useAddMealSlot`, `useDeleteMealSlot`, `useUpdateSlotServings`
- [packages/shared/src/types/menu.ts](../packages/shared/src/types/menu.ts)
