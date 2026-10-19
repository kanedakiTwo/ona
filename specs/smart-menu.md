# Menú inteligente

Mimo thinks the household's week with everything Mimoia knows about it, and fixed checks make sure nothing unsafe or badly made reaches the household (D-087, proposal `2026-10-19-producto-menu-inteligente` in Mimoia HQ). **Today it is being built in the shadow**: the menu a household sees still comes from the [generator](./menus.md); what exists is listed below, task by task.

## User Capabilities

- Nothing visible yet. The week rules score weeks for the shadow planner and the blind comparison; no menu changes because of them

## Reglas de una semana bien hecha (PRO-254)

`scoreWeek(days, recipes, opts)` (`services/weekRules.ts`, pure) scores a week (`DayMenu[]`) rule by rule. Each rule says whether it **applies**, passes (`ok`), a score 0–1, a short Spanish detail («1 de 2», «domingo: legumbre», «Pollo empanado (sábado)») and the slots that break it. The week's score is the mean of the rules that apply; `ok` = all of them pass. Only lunch and dinner count for the counting rules.

| Rule | Passes when | Doesn't apply |
|---|---|---|
| `legumbre` | a spoon legume (lentejas, garbanzos, alubias, fabes…; tag `tipo:legumbre`/`proteina:legumbre`, or a dry pulse among the ingredients; green beans don't count) in ≥ 2 lunches/dinners | fewer than 6 lunch/dinner slots, or `legumesAllowed: false` |
| `pescado` | fish or seafood as the main in 2–3 lunches/dinners (a fish stock doesn't count) | fewer than 6 slots, or `fishAllowed: false` |
| `proteina_mismo_dia` | no day has the same main protein family (pollo, ternera, cerdo, cordero, pescado, huevo, legumbre, tofu…) at lunch and dinner | no day with both |
| `plato_repetido` (PRO-238) | no recipe — and no two recipes with the same name — twice in the week, except a dish marked `leftover` or `freezer` (sobras, táper) | empty week |
| `aprovechar` | ≥ 2 fresh ingredients shared by two different dishes (staples such as aceite, ajo, cebolla, huevo, especias don't count; 1 shared = 0.5) | fewer than 2 different dishes |
| `cenas_ligeras` | every dinner is light: not a heavy dish type (guiso, arroz, pasta, frito, asado, legumbre…), not red meat or pulses as the main, ≤ 600 kcal per serving when known | the household didn't ask (`lightDinners`, see `asksLightDinners`: «cenas ligeras», «cenar ligero», «por la noche algo ligero») |
| `temporada` | every recipe fits the season (`seasonFit`, else `seasons`, empty = all year) | empty week |

- Main protein and dish type come from the catalogue's `proteina:`/`tipo:` internal tags when present, else from the ingredients (and the name)
- Thresholds live in `WEEK_RULES_CONFIG`. The definitions in words are the Taller's until Cocina writes `reglas-semana.md` (COC-14); changing them is a config or list edit plus its test
- Tests: `weekRules.test.ts` — a week that passes everything, and one failing case per rule (the beta's and test households' cases: lentejas at lunch and dinner the same Sunday, pollo empanado twice, «cenas ligeras» ignored)

## Related specs

- [Menus](./menus.md) — today's generator, which stays as the fallback
- [Ficha del hogar](./household-profile.md) — what the planner reads about the household

## Source

- [apps/api/src/services/weekRules.ts](../apps/api/src/services/weekRules.ts) — the rules, classification helpers and `scoreWeek`
- [apps/api/src/tests/weekRules.test.ts](../apps/api/src/tests/weekRules.test.ts)
