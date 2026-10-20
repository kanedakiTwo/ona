# Menú inteligente

Mimo thinks the household's week with everything Mimoia knows about it, and fixed checks make sure nothing unsafe or badly made reaches the household (D-087, proposal `2026-10-19-producto-menu-inteligente` in Mimoia HQ). **Today it is being built in the shadow**: the menu a household sees still comes from the [generator](./menus.md); what exists is listed below, task by task.

## User Capabilities

- Nothing visible yet. Every time a week is generated (the menu page or Mimo's `generate_weekly_menu`, web or WhatsApp), Mimo also thinks the same week in the background and stores its proposal; the household keeps seeing today's menu (PRO-255)
- Every Saturday night Mimo also thinks next week for each active household, in one batch; by Sunday morning each has its week thought (in the shadow: stored, not shown, PRO-258)
- When a menu comes from the planner, opening a dish's «···» sheet shows «Por qué te lo propongo» with Mimo's line, and Mimo tells it when asked «¿por qué me has puesto esto?», in the app and on WhatsApp (PRO-259). Today's generator never writes it, so nothing shows until PRO-257 turns the planner on
- The week rules score weeks for the shadow planner and the blind comparison; no menu changes because of them

## Reglas de una semana bien hecha (PRO-254)

`scoreWeek(days, recipes, opts)` (`services/weekRules.ts`, pure) scores a week (`DayMenu[]`) rule by rule. Each rule says whether it **applies**, passes (`ok`), a score 0–1, a short Spanish detail («1 de 2», «domingo: legumbre», «Pollo empanado (sábado)») and the slots that break it. The week's score is the mean of the rules that apply; `ok` = all of them pass. Only lunch and dinner count for the counting rules.

| Rule | Passes when | Doesn't apply |
|---|---|---|
| `legumbre` | a spoon legume (lentejas, garbanzos, alubias, fabes…; tag `tipo:legumbre`/`proteina:legumbre`, or a dry pulse among the ingredients; green beans don't count) in ≥ 2 lunches/dinners | fewer than 6 lunch/dinner slots, or `legumesAllowed: false` |
| `pescado` | fish or seafood as the main in 2–3 lunches/dinners (a fish stock doesn't count) | fewer than 6 slots, or `fishAllowed: false` |
| `proteina_mismo_dia` | no day has the same main protein family (pollo, ternera, cerdo, cordero, pescado, huevo, legumbre, tofu…) at lunch and dinner | no day with both |
| `plato_repetido` (PRO-238) | no recipe — and no two recipes with the same name — twice in the week, except a dish marked `leftover` or `freezer` (sobras, táper) | empty week |
| `aprovechar` | at least one fresh ingredient shared by two different dishes (staples such as aceite, ajo, cebolla, huevo, especias don't count) | fewer than 2 different dishes |
| `cenas_ligeras` | every dinner is light: not a heavy dish type (guiso, arroz, pasta, frito, asado, legumbre…), not red meat or pulses as the main, ≤ 600 kcal per serving when known | the household didn't ask (`lightDinners`, see `asksLightDinners`: «cenas ligeras», «cenar ligero», «por la noche algo ligero») |
| `temporada` | every recipe fits the season (`seasonFit`, else `seasons`, empty = all year) | empty week |

- Main protein and dish type come from the catalogue's `proteina:`/`tipo:` internal tags when present, else from the ingredients (and the name)
- Thresholds live in `WEEK_RULES_CONFIG`. The definitions in words are the Taller's until Cocina writes `reglas-semana.md` (COC-14); changing them is a config or list edit plus its test
- Tests: `weekRules.test.ts` — a week that passes everything, and one failing case per rule (the beta's and test households' cases: lentejas at lunch and dinner the same Sunday, pollo empanado twice, «cenas ligeras» ignored)

## Mimo piensa la semana, a la sombra (PRO-255)

After `POST /menu/generate` (not the empty week) and Mimo's `generate_weekly_menu` save the generator's week, `startShadowPlan` runs **without being awaited** (it never delays or breaks the menu) and writes one `menu_plans` row for that menu. `MENU_PLANNER_SHADOW=off` turns it off (default on).

1. **Slots** (`slotsToPlan`): the lunch and dinner slots of the generator's week, minus locked slots and «sin cocinar» days; breakfast and snack stay the generator's. Each slot carries its diners (plantilla) and the day's time limit
2. **Candidates** (`buildPlannerCandidates`, code, no AI): main-course recipes that pass today's fixed filters for lunch or dinner (season, allergies and diet, dislikes, equipment, the week's vetoes and «No para mí»/1 star, and the ficha's filters, PRO-253). A recipe the household swapped out, removed or vetoed **2 times** in the last 3 weeks' menus (`menu_edits`) is out. Ranked: loved (favourite, «Me encanta», 5 stars) +3, «Me apetece» +1.5, +1 per ingredient at home (pantry, up to 2), −3 if it was in a menu in the last 14 days. At most 150, one line each (`C1 · name · tipo · proteína · minutes (work) · comida/cena · main ingredients · opinion · «en el menú hace N días» · «en casa: …»`)
3. **The call**: Claude **Opus 5.5** (`PLANNER_MODEL`, D-070) with adaptive thinking, effort `medium`, `max_tokens` 16 000, timeout 180 s, the rules of a good week in a cached system prompt, and as user text: the slots, the household's ficha (`buildFichaDigest`) and memory digest, the 3 previous weeks (latest menu of each) and what the household changed in them («de qué a qué»), and the candidates. Everything between marks is data, not instructions. Closed answer (`PLANNER_OUTPUT_SCHEMA`): per slot, a candidate reference, **one line of why** for the household (no health, no calories) and, for leftovers, the slot they come from. Cost → `cost_events` with feature `menu_planner`, charged to the user and their household (counts for the monthly AI cap)
4. **The checker** (`checkPlan`, code, never trusting the model): the reference must be a candidate; every slot is re-checked against allergies, diet and dislikes (`violatesRestrictions`), the week's vetoes, equipment (and what the ficha says is missing), the day's time (not for leftovers), repeats (also against locked slots; leftovers must point at an earlier slot with the same recipe), missing, duplicated or unrequested slots, and an **internal energy floor**: a day whose lunch + dinner add up to less than 600 kcal per serving (only when every kcal is known) fails both slots — never shown (D-081)
5. **Merge** (`mergeWithGenerator`): each slot that passed takes the planner's dish as its main (leftovers as `variant: leftover`); every other slot keeps the generator's. Status `ok` (all slots from the planner), `partial`, `fallback` (none, or an error, a timeout, a refusal or a broken answer) or `skipped` (no API key, monthly cap used up, no slots, no candidates)

**`menu_plans`** (migration `0084_menu_plans`, only adds a table): menu, user, household, `mode` `shadow`, status and reason, the week as it would have been shown (`days`), the checked slots (recipe, why, leftovers, problems, `source` planner/generator), the checker's summary (problems by kind), `scoreWeek` of the proposal and of the generator's week (PRO-254, for the blind comparison), number of candidates, model, tokens, cost and duration. Deleting the menu, the user or the household deletes it.

- Tests: `menuPlanner.test.ts` (candidates and prompt; the checker with an allergy that slips through and a repeated dish, leftovers, vetoes, equipment, time, a weak day; the merge; the run with the model simulated: Opus 5.5 with thinking and the closed format, cost recorded, no key / over the cap / refusal / broken / error / timeout) and `menuPlanner.smoke.ts` (against Postgres: a «Sin horno hasta nuevo aviso» fact reaches the prompt and no oven recipe is a candidate or in the generated menu, every generated menu gets its row, one simulated run stored, the household's menu untouched)
- Known limitations: one main dish per slot (a second course stays the generator's); the «sobras o táper» the model plans are not yet shown anywhere; the Saturday-night batch is below (PRO-258); nobody sees the «why» until PRO-257/259

## La semana se piensa el sábado por la noche (PRO-258)

`services/menuPlannerWeekly.ts`, from the scheduler tick (`notificationScheduler`, like the ficha refiner). In the shadow while PRO-257 is off; `MENU_PLANNER_SHADOW=off` or no `ANTHROPIC_API_KEY` = it doesn't run.

- **When** (`weeklyPlanDue`): Saturday from 21:00 Madrid (`WEEKLY_PLAN_HOUR`), plus a catch-up on Sunday before 09:00 if the server was down; the target week is the Monday after. Once per week: `menu_planner_runs` is unique per week and claimed before calling Anthropic. Results are collected on the following ticks (every 5 min) once the batch has ended
- **Which households**: the refiner's rule (active plan, trial or beta; never paused nor with a suspended owner), with a menu in the 21 days before the target week (`inactive` otherwise) and the owner under the monthly AI cap (`spend_cap`). Skipped households are counted per reason in the run (`paused`, `not_subscribed`, `suspended`, `inactive`, `spend_cap`, `no_slots`, `no_candidates`, `error`)
- **What goes**: per household, the week as today's generator would make it for the owner (carrying the previous week's locks, vetoes and «sin cocinar» days), or the one the household already has for that week, and the same context and prompt as the on-the-spot planner (PRO-255), as one request of a **Message Batch** (`custom_id` = household)
- **Each result** goes through the same checker and merge (`finishPlan`) and is stored in `menu_planner_run_items` (status `ok` · `partial` · `fallback` · `failed`, the week as it would be shown, slots with their why, checker summary, both weeks' scores, tokens, cost). Cost → `cost_events` (`menu_planner`) at **half** the Opus 5.5 price (`BATCH_PRICE_FACTOR`), charged to the owner and the household. What was sent is kept as recipe ids (`StoredContext`) and rebuilt with the catalogue of the moment the result arrives (a recipe deleted meanwhile no longer counts as a candidate)
- Migration `0085_menu_planner_runs` (only adds tables)
- Still to do with PRO-257: show the thought week on Sunday, and «Mimo está pensando tu semana» while the on-the-spot planner runs in the sign-up and «Regenerar semana»
- Tests: `menuPlannerWeekly.test.ts` (when it is due, who goes and who is left out and why, once per week, half price, collecting leaves each household's week thought, a failed batch, rebuilding the context) and `menuPlannerWeekly.smoke.ts` (one Saturday against Postgres with the real generator and catalogue and a simulated batch)

## Comparación a ciegas en los hogares de prueba (PRO-256)

Only for the test households' staging accounts (`@example.com`, `BLIND_TEST_EMAIL_SUFFIX`); for any other account the routes don't exist (404). No screen in the app: the «Hogares» routine uses the API.

- `GET /menu/:menuId/a-ciegas` (the menu's household): the two weeks of the menu's latest usable shadow plan (`ok`/`partial`) as **A** and **B** — the planner's and the generator's as it was when the plan was made (`menu_plans.generator_days`), in an order fixed per menu (hash of the id, about half and half) and never said. Each week is only days, meals and dish names (leftovers and tápers say so); no «por qué», ids or anything else that gives away its origin. Also the question and the household's earlier pick (`choice`). 404 `NO_PLAN` without a usable plan
- `POST /menu/:menuId/a-ciegas` `{ choice: 'A' | 'B' | 'igual', reason? }` (≤ 500 characters): stored in `menu_blind_votes` (one per plan and person, a new pick replaces it) with what it means (`planner` · `generator` · `tie`); the answer doesn't say which was which
- `GET /admin/menu-planner/comparison?from=AAAA-MM-DD` (admin JWT or `x-metrics-token`; default the last 14 days): one line per test household — plans by status, the checker's problems by kind, Cocina's rules for each week (mean `scoreWeek`, 0–100), votes and reasons, and whether it prefers the planner's week. With the token (`comparisonForAgents` in `services/agentView.ts`) each line has no `householdId` and no `reasons`, only `reasonCounts { planner, generator, tie }`; the admin JWT gets everything (`blindComparisonRoute.test.ts` checks both views; `blindComparison.smoke.ts` the token's against real SQL). Only test accounts
- Migration `0086_menu_blind_votes` (adds the table and the `menu_plans.generator_days` column)
- Not done here: the routine's afternoons and the report in `hogares-prueba/informes/` (Mimoia HQ)
- Tests: `blindComparison.test.ts` (test accounts, A/B fixed and balanced, nothing gives the origin away, the pick mapped back, the report) and `blindComparison.smoke.ts` (read, vote, change the vote, report, 404 for other accounts and other households' menus)

## La línea de por qué en cada plato (PRO-259)

- A recipe dish may carry `why` (`RecipeDish.why`, in the menu's JSONB). `mergeWithGenerator` sets it on the planner's dishes (never on the generator's); nothing else writes it. A new dish (swap, «Cambiar al azar», «Elegir otra receta») is built without it; leftovers cloned from a dish keep it
- **Web:** the meal sheet (`MealOptions`) shows a «Por qué te lo propongo» card above the actions when the slot's first recipe dish has a `why` (`data-testid="dish-why"`)
- **Mimo (web and WhatsApp):** `mealLinesForDay` adds `(por qué: «…»)` after the slot's dishes — the menu block of its context and the menu tools (`get_todays_menu`, `get_weekly_menu`) read it, so it can answer «¿por qué me has puesto esto?». Each why is clipped at 200 characters
- Tests: `menuDishWhy.test.ts` (Mimo's lines with and without a why), `menuPlanner.test.ts` (the merge sets it only on the planner's dishes), e2e `menu-dish-why.spec.ts` (no card for a generator menu; the card with the why injected into GET /menu, 390 px)

## Related specs

- [Menus](./menus.md) — today's generator, which stays as the fallback
- [Ficha del hogar](./household-profile.md) — what the planner reads about the household

## Source

- [apps/api/src/services/weekRules.ts](../apps/api/src/services/weekRules.ts) — the rules, classification helpers and `scoreWeek`
- [apps/api/src/tests/weekRules.test.ts](../apps/api/src/tests/weekRules.test.ts)
- [apps/api/src/services/menuPlanner.ts](../apps/api/src/services/menuPlanner.ts) — candidates, prompt, closed format, checker, merge (pure)
- [apps/api/src/services/menuPlannerShadow.ts](../apps/api/src/services/menuPlannerShadow.ts) — context from the DB, the call, cost, `menu_plans`, `startShadowPlan`
- [apps/api/src/services/blindComparison.ts](../apps/api/src/services/blindComparison.ts) · [apps/api/src/routes/blindComparison.ts](../apps/api/src/routes/blindComparison.ts) · [apps/api/src/db/migrations/0086_menu_blind_votes.sql](../apps/api/src/db/migrations/0086_menu_blind_votes.sql) — comparación a ciegas
- [apps/api/src/tests/blindComparison.test.ts](../apps/api/src/tests/blindComparison.test.ts) · [apps/api/src/tests/blindComparison.smoke.ts](../apps/api/src/tests/blindComparison.smoke.ts)
- [apps/api/src/services/menuPlannerWeekly.ts](../apps/api/src/services/menuPlannerWeekly.ts) — Saturday batch: due, eligibility, submit, collect · [apps/api/src/db/migrations/0085_menu_planner_runs.sql](../apps/api/src/db/migrations/0085_menu_planner_runs.sql)
- [apps/api/src/tests/menuPlannerWeekly.test.ts](../apps/api/src/tests/menuPlannerWeekly.test.ts) · [apps/api/src/tests/menuPlannerWeekly.smoke.ts](../apps/api/src/tests/menuPlannerWeekly.smoke.ts)
- [apps/api/src/db/migrations/0084_menu_plans.sql](../apps/api/src/db/migrations/0084_menu_plans.sql)
- [packages/shared/src/types/menuDish.ts](../packages/shared/src/types/menuDish.ts) — `why` · [apps/api/src/services/menuText.ts](../apps/api/src/services/menuText.ts) — `dishWhys` · [apps/web/src/components/menu/MealOptions.tsx](../apps/web/src/components/menu/MealOptions.tsx) — the card
- [apps/api/src/tests/menuDishWhy.test.ts](../apps/api/src/tests/menuDishWhy.test.ts) · [apps/web/e2e/menu-dish-why.spec.ts](../apps/web/e2e/menu-dish-why.spec.ts)
- [apps/api/src/tests/menuPlanner.test.ts](../apps/api/src/tests/menuPlanner.test.ts) · [apps/api/src/tests/menuPlanner.smoke.ts](../apps/api/src/tests/menuPlanner.smoke.ts)
