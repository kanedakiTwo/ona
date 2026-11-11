# Cook from Pantry

<<<<<<< 7532516f86636df5dad6255684fc6a45c34398de
**Status:** PR 12 shipped. **The card left `/menu` on 2026-11-11 (PRO-1107):** «Con lo que tienes» now lives in the «Cocinar» tab and is built on the «Cocinar ahora» search ([Cook now](./cook-now.md)); `GET /recipes/match-pantry` stays until the plan's task 18 retires it, with no screen calling it.
=======
**Status:** retired (PRO-1108, 2026-11-11). The card on `/menu`, `GET /recipes/match-pantry` and `services/pantryMatcher.ts` are gone; «Con lo que tienes» moves to the «Cocinar» tab, on the «Cocinar ahora» search (`services/cookNow/*`, plan `docs/superpowers/plans/2026-11-03-cocinar-ahora.md`). What follows is what it did, for history.
>>>>>>> ae5c98d17aad64d803a1b844f3fec0bb2444e4da

"Lo que puedes cocinar con lo que tienes" — given the household pantry (PR 11), rank every catalogue recipe by how much of it the household already has on hand. Until 2026-11-11 the top 3 surfaced as a small card on `/menu`.

## User Capabilities

- Nothing on screen any more. Until 2026-11-11 an authed user with a non-empty pantry saw a "Con lo que tienes · Puedes cocinar esto" card on `/menu` (top 3 by coverage, `<matched>/<total> ingredientes`, a percentage, tap → `/recipes/[id]`). Since PRO-1107 the «Con lo que tienes» card is in the «Cocinar» tab and uses `POST /cook-now/proposal` ([Cook now](./cook-now.md)).

## Scoring

Coverage = matched / required, where:
- **required** = recipe ingredients with `optional = false`
- **matched** = required ingredients whose `ingredient_id` appears in any pantry row for the caller's household with `quantity > 0`
- Optional ingredients are **excluded from both numerator and denominator** — missing them doesn't pull the score down.
- When `required = 0` (rare: an all-optional recipe), score is `0` (we don't surface it as a perfect match).

Unit conversion + quantity comparison are deferred. v1's question is "do we have any?", not "do we have enough?". The auto-decrement from PR 11 already lets the user see "ran out" in the pantry page.

## REST Surface

| Method | Path | Notes |
|---|---|---|
| GET | `/recipes/match-pantry?limit=N` | auth-only. `limit` default 3, max 20. Sorted by `coverage desc`, ties broken by `matchedCount desc`, then `totalRequired desc`. Recipes with `matchedCount = 0` are filtered out. **Must be registered before `/recipes/:id`** so the more-specific path matches |

Response shape:

```ts
type PantryMatchHit = {
  recipe: { id, name, imageUrl, totalTime }
  coverage: number  // 0..1
  matchedCount: number
  totalRequired: number
  missing: string[]  // ingredient names, not ids
}
```

## Pure Helper

`scoreRecipeAgainstPantry(ings, pantry)` — exported from `services/pantryMatcher.ts`, unit-tested (6 cases). Same code path used by the route, so a scoring regression trips a unit failure before the UI shows wrong numbers.

## Constraints

- Pantry rows with `ingredient_id = NULL` (manual free-text items like "Pan integral" without a catalog link) **do not contribute to matching**. Only catalog-linked pantry rows count. This means the user needs to add ingredients via a recipe form / auto-decrement to get full benefit. Acceptable for v1; the cross-reference can come later.
- The endpoint scans every recipe + every ingredient on every call. Fine at our current scale (≈100 recipes × avg 8 ingredients = 800 rows); we'll cache or paginate if it ever becomes hot.

## Related specs

- [Pantry](./pantry.md) — the source of the pantry set.
- [Recipes](./recipes.md) — the catalogue we score against.
- [Household](./household.md) — scope policy.

## Source

<<<<<<< 7532516f86636df5dad6255684fc6a45c34398de
- `apps/api/src/services/pantryMatcher.ts` — `scoreRecipeAgainstPantry` (pure), `findPantryMatches` (DB)
- `apps/api/src/routes/recipes.ts` — `GET /recipes/match-pantry` handler
- `apps/api/src/tests/pantryMatcher.test.ts` — 6 cases
=======
Retired in PRO-1108: no code left. Its successor lives in `apps/api/src/services/cookNow/` and `apps/web/src/app/cocinar/page.tsx`.
>>>>>>> ae5c98d17aad64d803a1b844f3fec0bb2444e4da
