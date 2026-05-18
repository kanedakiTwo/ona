# Recipe Notes

**Status:** PR 7 shipped.

Per-household personal notes / 1-5 star rating / free-form substitutions on a recipe. Distinct from `recipes.notes` and `recipes.substitutions` (which belong to the recipe's **author**) — this is the **consumer's** annotation: "we thought it was a bit salty, swap onion for leek next time".

## User Capabilities

- On a recipe detail page, an authed user sees a "Tus notas" card with:
  - **5-star rating** (terracotta) — tap a star to set, tap the same star again to clear, or tap "Quitar".
  - **Notas personales** — free-form 1000-char note. Click to edit, save / cancel buttons.
  - **Sustituciones tuyas** — free-form 1000-char swaps note. Same inline-edit pattern.
- All three fields are independent and partial: editing the rating doesn't touch notes / substitutions, and vice versa.
- The card shows "editado por <username>" when the last edit was made by another household member.

## Scope

**Household-scoped.** One row per `(household_id, recipe_id)`. With `SHARED_HOUSEHOLD_SCOPE=true`, every member sees and edits the same row — concurrent writes are last-write-wins (no merge UX yet; deferred until shared editing becomes a real complaint).

## Data Model

`recipe_notes`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `household_id` | uuid → households | scope key |
| `recipe_id` | uuid → recipes | |
| `notes` | text? | consumer note, up to 1000 chars |
| `rating` | int? | check 1..5; null = not rated |
| `substitutions` | text? | consumer swaps note, up to 1000 chars |
| `last_edited_by_user_id` | uuid? → users | for the audit / "editado por" UX |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | bumped on every upsert |

Indexes:
- `uq_recipe_notes_household_recipe` on `(household_id, recipe_id)` — unique.
- `idx_recipe_notes_recipe` on `(recipe_id)`.

Check constraint `recipe_notes_rating_check` enforces 1..5 at the DB. The API also validates via `validateRating` before writing.

## REST Surface

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/recipes/:recipeId/notes` | required | Returns row or `null` (200 either way — saves the client a 404-branch on an empty form) |
| PUT | `/recipes/:recipeId/notes` | required | Body `{ notes?, rating?, substitutions? }`. Partial upsert: undefined fields preserve, explicit `null` clears, strings are trimmed (empty → null) and capped at 1000 chars. `rating` must be int 1..5 or null |

Both routes mount via `apps/api/src/routes/recipeNotes.ts` (after `router.use(authMiddleware)`).

## Pure Helpers

`applyNotesPatch(current, patch)` and `validateRating(raw)` are exported from `services/recipeNotesStore.ts` and unit-tested (`recipeNotesPatch.test.ts`, 9 cases). The route handler calls into these so a regression trips a unit failure before touching the DB.

## Constraints / Edge Cases

- Empty strings collapse to `null` on save — `notes: ""` is functionally the same as `notes: null`.
- The 1000-char cap is enforced **client-side** by the textarea `maxLength` and **server-side** by `applyNotesPatch` (silent truncation, no error). The route accepts up to 2000 chars at the schema layer so the server-side cap is a single source of truth.
- The route is auth-only; non-authed users on `/recipes-ona/[id]` (public catalogue) never see the section because the page conditionally renders it (`user && <RecipeNotesSection />`).
- Concurrent edits: two members editing simultaneously means the last write wins. No conflict-resolution UI yet.

## Related specs

- [Household](./household.md) — scope policy + how `getPrimaryHouseholdId` resolves.
- [Cook Log](./cook-log.md) — the times-cooked / last-cooked badge that lives in the same meta row as the rating.
- [Recipes](./recipes.md) — author-side `notes` / `substitutions` columns are separate from this household-scoped consumer note.

## Source

- `apps/api/src/db/schema.ts` — `recipeNotes` table
- `apps/api/src/db/migrations/0015_pr7_recipe_notes.sql`
- `apps/api/src/services/recipeNotesStore.ts` — `applyNotesPatch`, `validateRating`, `getRecipeNotesForUser`, `upsertRecipeNotes`
- `apps/api/src/routes/recipeNotes.ts` — REST surface
- `apps/api/src/tests/recipeNotesPatch.test.ts` — pure-helper unit tests (9 cases)
- `apps/web/src/hooks/useRecipeNotes.ts` — TanStack hooks
- `apps/web/src/components/recipes/RecipeNotesSection.tsx` — UI card with stars + inline-edit fields
- `apps/web/src/app/recipes/[id]/page.tsx` — wired below the cook-mode CTA section
