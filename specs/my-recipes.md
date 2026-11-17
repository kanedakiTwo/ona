# My Recipes

User-scoped curator at `/recipes/mias`, in the Recetas tab (PRO-1202; it was a card in `/profile`), where any logged-in user can manage the recipes **they** authored: edit, delete, see quality gaps in their own work, and review repair-marker entries.

## Why this exists

When Mimoia only had system recipes, the `/curator` page treated all recipes the same. Now that users can create recipes (via `/recipes/new`, the photo extractor, the URL importer, the LLM regen pipeline), each user has their own slice of the catalog — and they're the only person who should be touching it. They want the same convenience the admin dashboard offers (filter by gap, edit inline) but scoped to their own work.

It lives in the Recetas tab since PRO-1202 (Miguel 2026-11-12, maqueta `docs/maquetas/2026-11-12-perfil.html`): the profile keeps only what changes the menu, and a person looks for their recipes where the recipes are.

## User Capabilities

- A logged-in user opens Recetas, taps «Mis recetas» (a paper link with «N creadas por ti», next to «Recetarios», shown when nothing is filtered) and, on `/recipes/mias` («‹ Recetas», h1 «Las que has *creado tú*.», a «Nueva receta» pill), sees a list of recipes where `authorId === user.id`. Tapping a row opens the recipe; its "···" opens a sheet with **Editar** and **Eliminar** (PRO-39).
- Each row shows: name, image, servings, kcal/serving, allergens, last edited, status pills (e.g. "sin nutrición", "ingredientes auto-añadidos", "sin equipo", "sin tiempo").
- The user can:
  - **Editar** — opens `/recipes/<id>/edit` (existing form, gated to author).
  - **Eliminar** — confirm modal in Spanish, then deletes (cascading to `recipe_ingredients` and `recipe_steps`).
  - **Solo con pendientes** (checkbox, "ver pendientes de revisar") — filters to recipes that have at least one ingredient with `note ILIKE '%añadido automáticamente%'` (the marker the regen `repair` step writes when it has to invent an ingredient). The user clicks an entry → goes to the recipe edit form to set the real quantity and unit.
- A counts strip at the top shows: total recetas, recetas sin nutrición, ingredientes pendientes de revisar.
- The user **cannot** see or edit system recipes (`authorId IS NULL`) here — those belong to the admin dashboard. If a system recipe and a user recipe share a name, both are listed in their respective surfaces (the user only sees the system one as a public catalog read in `/recipes`).
- Optional v1.1 (flagged as follow-up): "veces cocinada" + "calificación propia" if/when Mimoia tracks cook events. Not required for this version.

## Scope vs Admin Dashboard

| | Admin dashboard | My Recipes |
| --- | --- | --- |
| Authority | `role === 'admin'` | any logged-in user |
| Recipes covered | `authorId IS NULL` | `authorId === user.id` |
| Catalog edits (ingredients) | yes | no |
| User management | yes | no |
| Audit log | written | not written |

The two surfaces deliberately do not overlap.

## Constraints

- The route is `/recipes/mias` (a static segment, so it isn't read as a recipe id; `screenOfPath` leaves it out of `receta`).
- All API endpoints are scoped: `GET /user/:id/recipes-curator/gaps` returns rows for `authorId === :id` only, and the route's auth middleware enforces `:id === requesting user`.
- Repair markers are detected by a SQL `ILIKE` on `recipe_ingredients.note` — the marker text is "añadido automáticamente" by convention. If the convention changes, the helper updates in one place.
- No new dependencies. Spanish copy and editorial design tokens, same as the admin dashboard.
- Editing a user-owned recipe always re-runs the lint validator and the nutrition aggregator on save — same flow as `/recipes/new`. This keeps user-edited recipes in sync without a separate path.

## Related specs

- [Roles & Authorization](./roles.md) — auth boundary; this surface is below the admin gate
- [Admin Dashboard](./admin-dashboard.md) — system-recipe equivalent
- [Recipes](./recipes.md) — the underlying recipe model and edit flow
- [Recipe Quality](./recipe-quality.md) — repair markers and lint rules

## Source

- [apps/web/src/app/recipes/mias/page.tsx](../apps/web/src/app/recipes/mias/page.tsx) — the page (PRO-1202)
- [apps/web/src/components/recipes/MyRecipesSection.tsx](../apps/web/src/components/recipes/MyRecipesSection.tsx) — list + filters + actions
- [apps/web/src/components/recipes/YourRecipesLinks.tsx](../apps/web/src/components/recipes/YourRecipesLinks.tsx) — «Mis recetas» and «Recetarios» on `/recipes`
- [apps/web/src/hooks/useMyRecipes.ts](../apps/web/src/hooks/useMyRecipes.ts) — react-query hooks
- [apps/api/src/routes/users.ts](../apps/api/src/routes/users.ts) — `GET /user/:id/recipes-curator/gaps` (new)
- [apps/api/src/services/recipePersistence.ts](../apps/api/src/services/recipePersistence.ts) — reused on edit
