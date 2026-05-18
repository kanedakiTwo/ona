# Cook Log

**Status:** PR 6 shipped.

The cook-log is the **household-scoped** record of "we actually cooked this." It powers three derived signals that other features depend on:

1. **Times-cooked** counter on recipe cards / detail (`Cocinada 3×`).
2. **Last-cooked** date for the recipe-detail meta row + the matcher's recency penalty (planned for PR 7).
3. **Adherence** ("planeaste 21, cocinaste 15") in the analytics page (planned for PR 15).

## User Capabilities

- A logged-in user marks any recipe as cooked from:
  - The recipe detail page (`/recipes/[id]`) — next to "Empezar a cocinar".
  - The menu page (`/menu`) — each `EditorialMealCard` exposes a "Cocinada" pill that records the cook event with menu / day-index / meal as context.
- The pill flips its label to `Cocinada N×` once at least one event exists for the recipe in the household's scope.
- The recipe detail meta row shows `Cocinada N × · última dd mmm` once `N > 0`. The history line stays hidden for never-cooked recipes so the meta row doesn't get noisy on fresh catalog pages.
- The user can delete a cook-log row (corrections) — no "undo" UX yet; the assistant or future analytics page will surface the list.

## Data Model

`cook_logs` table:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `user_id` | uuid → users | who recorded the cook |
| `household_id` | uuid? → households | scope key (PR 1B). Backfill on insert via `getPrimaryHouseholdId(userId)` |
| `recipe_id` | uuid → recipes | required |
| `menu_id` | uuid? → menus | nullable — off-menu cooking still logs |
| `day_index` | int? | 0-6, only when cooked from a menu slot |
| `meal` | text? | breakfast \| lunch \| dinner \| snack |
| `cooked_at` | timestamptz | defaults to `now()`; explicit value allowed for back-fills |
| `duration_min` | int? | measured cooking time (cooking mode populates this in a follow-up PR) |
| `notes` | text? | free-form, max 500 chars (enforced at route layer) |
| `created_at` | timestamptz | bookkeeping |

Indexes: `(household_id, cooked_at)` for the analytics range queries, `(recipe_id)` for the per-recipe stats query.

No UPDATE path — corrections happen via DELETE + new INSERT.

## REST Surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| POST | `/cook-logs` | required | Body validated via zod: `{ recipeId: uuid, menuId?, dayIndex? (0-6), meal? (breakfast\|lunch\|dinner\|snack), durationMin? (>0, ≤1440), notes? (≤500), cookedAt? (ISO) }`. Returns `{ id }` |
| GET | `/cook-logs?limit=N` | required | Recent rows in household scope, most-recent first. `limit` clamped to 200, default 50 |
| GET | `/cook-logs/recipe/:recipeId` | required | Aggregated `{ count, lastCookedAt }`. Used by the badge + button on every meal/recipe card |
| DELETE | `/cook-logs/:cookLogId` | required | Owner / household-member only. 204 on success, 404 if not in scope |

All four routes mount via `apps/api/src/routes/cookLogs.ts` (after `router.use(authMiddleware)`).

## Scope

Same pattern as PR 1B: reads run through `resolveScope(userId)`; inserts dual-populate `user_id` + `household_id`. With `SHARED_HOUSEHOLD_SCOPE=true`, a recipe cooked by anyone in the household counts for the whole house. With the flag off, each user sees only their own log.

## Constraints

- `durationMin` is informational today — cooking mode does not auto-populate it yet (planned PR follow-up). Manual entry comes from a future UI; the column exists so we don't migrate again.
- `summarizeCookLog` (the pure reducer in `services/cookLogStore.ts`) is what unit tests exercise. The route handler just shapes the response — if the reducer regresses, four unit tests fail before the Playwright suite gets a chance.
- The frontend hook `useRecordCook` invalidates two query keys on success: `['cook-logs', 'recipe', recipeId]` (per-recipe stats) and `['cook-logs', 'recent']` (the analytics list). The badge re-renders immediately.

## Related specs

- [Household](./household.md) — scope policy.
- [Menus](./menus.md) — cook events tie back via `menuId` + `dayIndex` + `meal`.
- [Recipes](./recipes.md) — the recipe detail page hosts the primary "Cocinada" CTA.

## Source

- `apps/api/src/db/schema.ts` — `cookLogs` table
- `apps/api/src/db/migrations/0013_pr6_cook_logs.sql` — additive migration
- `apps/api/src/services/cookLogStore.ts` — `summarizeCookLog`, `recordCook`, `getRecipeCookStats`, `listRecentCookLogs`, `deleteCookLog`
- `apps/api/src/routes/cookLogs.ts` — REST surface
- `apps/api/src/tests/cookLogStats.test.ts` — pure-reducer unit tests
- `apps/web/src/hooks/useCookLogs.ts` — TanStack hooks
- `apps/web/src/components/recipes/CookedBadge.tsx` — pill + button variants
- `apps/web/src/app/recipes/[id]/page.tsx` — wired into the detail meta row + cook-mode CTA section
- `apps/web/src/app/menu/page.tsx` — wired into `EditorialMealCard`
- `apps/web/e2e/cook-log.spec.ts` — Playwright regression for the happy path
