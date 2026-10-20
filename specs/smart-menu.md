# Menú inteligente

Mimo thinks the household's week with everything Mimoia knows about it, and fixed checks make sure nothing unsafe or badly made reaches the household (D-087, proposal `2026-10-19-producto-menu-inteligente` in Mimoia HQ). **Today it is being built in the shadow**: the menu a household sees still comes from the [generator](./menus.md); what exists is listed below, task by task.

## User Capabilities

- Nothing visible yet. Every time a week is generated (the menu page or Mimo's `generate_weekly_menu`, web or WhatsApp), Mimo also thinks the same week in the background and stores its proposal; the household keeps seeing today's menu (PRO-255)
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
- Known limitations: one main dish per slot (a second course stays the generator's); the «sobras o táper» the model plans are not yet shown anywhere; batch on Saturday night is PRO-258; nobody sees the «why» until PRO-257/259

## Related specs

- [Menus](./menus.md) — today's generator, which stays as the fallback
- [Ficha del hogar](./household-profile.md) — what the planner reads about the household

## Source

- [apps/api/src/services/weekRules.ts](../apps/api/src/services/weekRules.ts) — the rules, classification helpers and `scoreWeek`
- [apps/api/src/tests/weekRules.test.ts](../apps/api/src/tests/weekRules.test.ts)
- [apps/api/src/services/menuPlanner.ts](../apps/api/src/services/menuPlanner.ts) — candidates, prompt, closed format, checker, merge (pure)
- [apps/api/src/services/menuPlannerShadow.ts](../apps/api/src/services/menuPlannerShadow.ts) — context from the DB, the call, cost, `menu_plans`, `startShadowPlan`
- [apps/api/src/db/migrations/0084_menu_plans.sql](../apps/api/src/db/migrations/0084_menu_plans.sql)
- [apps/api/src/tests/menuPlanner.test.ts](../apps/api/src/tests/menuPlanner.test.ts) · [apps/api/src/tests/menuPlanner.smoke.ts](../apps/api/src/tests/menuPlanner.smoke.ts)
