# Pantry

**Status:** PR 11 shipped.

The household-shared register of "what we have at home" — with real quantities, units, and optional expiry dates. Each entry is either tied to a catalog ingredient (`ingredient_id` set, enabling auto-decrement on cook) or a free-text item the user typed in.

This is separate from the legacy `inStock` boolean inside `shopping_lists.items`, which only said "yes/no" without quantities. Pre-PR-11 pantry behaviour is unchanged; PR 11 layers a real register on top.

## User Capabilities

- A logged-in user can open `/profile/pantry` and see every item in the household pantry with current quantity + unit + (optional) expiry.
- Add a manual item via the inline form (name + qty/unit + optional expiry).
- Add a catalog-linked item by providing `ingredientId` — the second add for the same (household, ingredient) **adds to the existing quantity** instead of duplicating the row (real upsert via manual SELECT-then-UPDATE because Postgres `ON CONFLICT` won't bind to a partial unique index).
- Edit qty / expiry inline (blur to save, Enter to commit).
- Delete any row.
- **Auto-decrement on cook**: when anyone in the household calls `POST /cook-logs` for recipe X, every pantry row whose `ingredient_id` matches a recipe ingredient is deducted by `recipeIngredient.quantity × scaleFactor`, where `scaleFactor = cookedServings / recipe.servings` (defaults to 1 when `servings` isn't passed). Best-effort: the decrement runs in a `try/catch` and never blocks the cook-log insert; the response includes a `pantry: { updatedRowIds, skipped }` summary.
- Expiry pill on each row: red ("Caducado dd mmm") if past, terracotta ("Caduca dd mmm") if within 3 days, neutral otherwise.

## Data Model

`pantry_items`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `household_id` | uuid → households | scope key, NOT NULL |
| `ingredient_id` | uuid? → ingredients | NULL for manual free-text rows; ON DELETE SET NULL |
| `name` | text | required, ≤ 80 chars |
| `quantity` | real | non-negative; default 0 |
| `unit` | text | `g \| ml \| u \| cda \| cdita` (also accepts `kg \| l` at the route for convenience; stored as-given) |
| `expires_at` | date? | YYYY-MM-DD, null = no expiry |
| `last_updated_at` | timestamptz | bumped on every edit + every auto-decrement |
| `created_at` | timestamptz | bookkeeping |

Indexes:
- `idx_pantry_items_household` on `(household_id)`.
- `uq_pantry_items_household_ingredient` — **partial unique** on `(household_id, ingredient_id) WHERE ingredient_id IS NOT NULL`. Prevents catalog-ingredient duplicates per household; free-text rows (NULL `ingredient_id`) can repeat by name.

## REST Surface

| Method | Path | Notes |
|---|---|---|
| GET | `/pantry` | List household pantry rows, ordered by name |
| POST | `/pantry` | Add. Body: `{ name, quantity?, unit?, ingredientId?, expiresAt? }`. When `ingredientId` is present, idempotently merges into the existing row (adds quantities); otherwise inserts a new free-text row |
| PATCH | `/pantry/:id` | Partial update: `name?`, `quantity?`, `unit?`, `expiresAt?` |
| DELETE | `/pantry/:id` | Hard delete |

All four routes are auth-only and household-scoped. Any household member can read or write.

## Auto-decrement Algorithm

When `POST /cook-logs` is called:

1. Resolve `householdId = getPrimaryHouseholdId(userId)`. Bail silently if missing.
2. Resolve `scaleFactor = cookedServings / recipe.servings`. Defaults to `1` if `servings` body field is absent or non-positive.
3. Load every `(ingredient_id, name, quantity, unit)` triple from `recipe_ingredients × ingredients` for the recipe.
4. Load every pantry row for the household with `ingredient_id IS NOT NULL`, keyed by `ingredient_id`.
5. For each recipe ingredient, look up the pantry row. If missing → `skipped`. If present, call `applyPantryDeduct({ quantity, unit }, { quantity: ingQty * scaleFactor, unit: ingUnit })`. If `changed`, UPDATE the row. Otherwise → `skipped` with the reason.
6. Return `{ updatedRowIds, skipped }`.

### `applyPantryDeduct` rules (pure, unit-tested)

| Case | Result |
|---|---|
| `deduct.quantity ≤ 0` | no-op (`changed: false`) |
| `current.quantity ≤ 0` | no-op ("pantry empty") |
| `current.unit !== deduct.unit` | no-op ("unidad X no coincide con la despensa (Y)") — **cross-unit conversion deferred to a follow-up** |
| units match, `deduct < current` | `newQuantity = round3(current - deduct)`, `changed: true` |
| units match, `deduct ≥ current` | `newQuantity = 0`, `changed: true` |

Numeric rounding uses `Math.round(x * 1000) / 1000` to dodge 0.999… artefacts from JS floats.

## Constraints

- Auto-decrement is **silently lossy** when units don't match. The cook-log response surfaces `skipped` so a UI follow-up can prompt "couldn't deduct 200g of rice — your pantry has it in kg". For PR 11 the UI ignores the skip list.
- The cook-log insert always succeeds even if the pantry update throws (`try/catch` around the decrement block). Pantry consistency is best-effort; the cook log is canonical.
- The partial unique index means `onConflictDoUpdate` doesn't bind — we do a manual SELECT-then-INSERT-or-UPDATE in `addPantryForUser`. Two round-trips, totally fine for this surface volume.
- `unit` is validated against the buyable-unit set + `kg` + `l` at the route. The schema stores whatever the client sends (no normalization), which is why we defer cross-unit conversion: a row in `kg` won't match a recipe ingredient in `g` until we plumb the conversion through.

## Related specs

- [Household](./household.md) — scope policy.
- [Cook Log](./cook-log.md) — the trigger surface for auto-decrement; cook-log POST returns the pantry diff in its response body.
- [Shopping](./shopping.md) — the legacy `inStock` boolean inside `shoppingLists.items` is independent of `pantry_items`. A future PR will reconcile them ("cook from pantry" — PR 12).

## Source

- `apps/api/src/db/schema.ts` — `pantryItems`
- `apps/api/src/db/migrations/0016_pr11_pantry_items.sql` — table + partial unique index
- `apps/api/src/services/pantryStore.ts` — `applyPantryDeduct`, `decrementPantryForRecipe`, `resolveCookScale`, CRUD helpers
- `apps/api/src/routes/pantry.ts` — REST surface
- `apps/api/src/routes/cookLogs.ts` — calls `decrementPantryForRecipe` post-insert
- `apps/api/src/tests/pantryDeduct.test.ts` — 6 cases for the pure helper
- `apps/web/src/hooks/usePantry.ts` — TanStack hooks
- `apps/web/src/app/profile/pantry/page.tsx` — management UI
- `apps/web/src/app/profile/page.tsx` — link button
