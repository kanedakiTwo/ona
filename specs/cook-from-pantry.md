# Cook from Pantry

**Status:** PR 12 shipped.

"Lo que puedes cocinar con lo que tienes" — given the household pantry (PR 11), rank every catalogue recipe by how much of it the household already has on hand. The top 3 surface as a small card on `/menu`.

## User Capabilities

- An authed user with a non-empty pantry sees a "Con lo que tienes · Puedes cocinar esto" card at the top of `/menu` (below the page header).
- The card lists the top 3 recipes by pantry coverage, each as a row:
  - thumbnail
  - recipe name
  - `<matched>/<total> ingredientes` + total time (when known)
  - coverage percentage badge (right side)
- Tap a row → goes to `/recipes/[id]`.
- When the pantry is empty or no recipe matches at all, the card hides entirely (no empty state — the user doesn't need yet another "go fill your pantry" prompt).

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

- `apps/api/src/services/pantryMatcher.ts` — `scoreRecipeAgainstPantry` (pure), `findPantryMatches` (DB)
- `apps/api/src/routes/recipes.ts` — `GET /recipes/match-pantry` handler
- `apps/api/src/tests/pantryMatcher.test.ts` — 6 cases
- `apps/web/src/hooks/usePantryMatch.ts`
- `apps/web/src/components/menu/PantryMatchCard.tsx`
- `apps/web/src/app/menu/page.tsx` — mounted below the page header
