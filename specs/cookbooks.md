# Cookbooks (Collections)

**Status:** PR 8A shipped. PR 8B (custom tags) and PR 8C (multi-photo) are follow-ups.

Household-shared named recipe collections. The lightweight equivalent of Paprika-style "categories" or Evernote "notebooks": tag a recipe to one or more cookbooks, browse them per cookbook.

## User Capabilities

- Any household member can create a cookbook with a **name** (≤ 60 chars), optional **description** (≤ 280 chars), and optional **emoji** (≤ 8 chars, ZWJ sequences OK).
- Add a recipe to any number of cookbooks at once. Removing a recipe from a cookbook never deletes the recipe itself.
- Rename / re-emoji / re-describe an existing cookbook. Delete a cookbook (recipes stay; only the grouping disappears).
- Browse cookbooks at `/profile/cookbooks` → list with cover emoji + recipe counts.
- Drill into `/cookbooks/[id]` to see the recipes inside as the `/recipes` photo cards (2-col masonry, 4 columns at `lg+`), each with a "Quitar del recetario" button over the photo. **Editar recetario** (inline editor) and **Borrar recetario** live in the "···" sheet ("Opciones del recetario") next to the title.
- From any recipe detail page, the "Añadir a recetario" button (top of the Notas tab / section) opens a bottom-sheet picker: tap an existing cookbook to toggle membership, or create a new one on the spot.

## Data Model

`cookbooks`:

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `household_id` | uuid → households | scope, NOT NULL |
| `name` | text | required, ≤ 60 chars (route-enforced) |
| `description` | text? | ≤ 280 chars |
| `emoji` | text? | ≤ 8 chars |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | bumped on every PATCH |

`cookbook_recipes` (join):

| column | type | notes |
|---|---|---|
| `id` | uuid pk | |
| `cookbook_id` | uuid → cookbooks | ON DELETE CASCADE |
| `recipe_id` | uuid → recipes | ON DELETE CASCADE |
| `added_at` | timestamptz | bookkeeping |

Indexes:
- `idx_cookbooks_household` on `(household_id)`.
- `uq_cookbook_recipes_cookbook_recipe` — unique on `(cookbook_id, recipe_id)` so `POST … /recipes/:recipeId` is idempotent.
- `idx_cookbook_recipes_recipe` on `(recipe_id)` — speeds up the reverse "which cookbooks contain X" lookup.

## REST Surface

| Method | Path | Notes |
|---|---|---|
| GET | `/cookbooks` | List household cookbooks with `recipeCount` |
| POST | `/cookbooks` | Create. Body: `{ name, description?, emoji? }`. Validators on each field |
| GET | `/cookbooks/:id` | Detail: cookbook + `recipes[]` (each `{ id, name, imageUrl, addedAt }`, sorted by `added_at desc`) |
| PATCH | `/cookbooks/:id` | Partial update of name / description / emoji |
| DELETE | `/cookbooks/:id` | Hard delete; cascade kills `cookbook_recipes` |
| POST | `/cookbooks/:id/recipes/:recipeId` | Idempotent add (204 even if already present, via `onConflictDoNothing`) |
| DELETE | `/cookbooks/:id/recipes/:recipeId` | Remove one recipe from the cookbook |
| GET | `/recipes/:recipeId/cookbooks` | Reverse lookup — which household cookbooks contain this recipe |

All routes are auth-only + household-scoped. Any household member can read or write.

## Pure Helpers

`validateCookbookName(raw)`, `validateCookbookEmoji(raw)`, `validateCookbookDescription(raw)` — exported from `cookbooksStore.ts`, unit-tested (`cookbooksValidate.test.ts`, 9 cases). They trim, length-check, and return `{ ok: true, value } | { ok: false, reason }`.

## Frontend

- `useCookbooks()`, `useCookbook(id)`, `useCookbooksForRecipe(recipeId)` — queries
- `useCreateCookbook()`, `usePatchCookbook()`, `useDeleteCookbook()` — mutations
- `useAddRecipeToCookbook()`, `useRemoveRecipeFromCookbook()` — join mutations
- `/profile/cookbooks` — list page with inline "Nuevo recetario" form
- `/cookbooks/[id]` — detail page ("D · Luz y foto", PRO-43): compact header + "···" `MenuSheet` (Editar recetario → inline rename / emoji / description editor; Borrar recetario, with confirm) + `CatalogGrid` (via its `renderAction` slot) with a per-recipe remove button
- `<AddToCookbookButton />` — pill + bottom-sheet picker on the recipe detail page
- Entry button on `/profile` → "Mis recetarios"

## Constraints

- The unique index on `(cookbook_id, recipe_id)` means `POST /cookbooks/:id/recipes/:recipeId` is idempotent — calling it twice with the same args is harmless.
- Deleting a cookbook never deletes the underlying recipes.
- The emoji field caps at 8 characters to accommodate ZWJ sequences (e.g. 👨‍👩‍👧 counts as 5 code points). Browsers render them as a single glyph.
- Cookbooks aren't ordered by the user yet — they show in `created_at asc` on the list page. Drag-reorder lands with the shopping drag-reorder in a follow-up.

## Related specs

- [Household](./household.md) — scope policy.
- [Recipe Notes](./recipe-notes.md) — household-scoped consumer annotations on a recipe. Cookbooks are the grouping; notes are the annotation.
- [Recipes](./recipes.md) — author-side recipe data is unchanged; cookbooks layer on top.

## Source

- `apps/api/src/db/schema.ts` — `cookbooks`, `cookbookRecipes`
- `apps/api/src/db/migrations/0017_pr8a_cookbooks.sql`
- `apps/api/src/services/cookbooksStore.ts`
- `apps/api/src/routes/cookbooks.ts`
- `apps/api/src/tests/cookbooksValidate.test.ts`
- `apps/web/src/hooks/useCookbooks.ts`
- `apps/web/src/app/profile/cookbooks/page.tsx`
- `apps/web/src/app/cookbooks/[id]/page.tsx`
- `apps/web/src/components/recipes/AddToCookbookButton.tsx`
- `apps/web/src/app/recipes/[id]/page.tsx` (wired into the Notas tab / section)
- `apps/web/src/app/profile/page.tsx` (link button)
