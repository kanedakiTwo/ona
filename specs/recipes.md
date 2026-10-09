# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## User Capabilities

- **Anyone, no account needed**, can browse the public catalogue (shown as "Catálogo Mimoia") at `/recipes-ona` and open any recipe detail at `/recipes-ona/[id]`. The public page only ever lists system recipes (`authorId IS NULL`) — even when a logged-in browser visits, the page forces an anonymous fetch via `apiPublic` so the catalogue is always the curated ONA set. The detail view shows ingredients, steps, nutrition and allergens but no favourite / copy / edit / cook-mode actions; an "Únete a la lista de espera" CTA appears at the bottom of both pages (pre-launch, to `/?ref=receta#lista-de-espera` on the detail and `/?ref=recetas#lista-de-espera` on the list — see [Waitlist](./waitlist.md)).
- Logged-in users browse the catalog at `/recipes` ("D · Luz y foto", 2026-10-08): header "Recetas" + ink "+" (**Nueva receta**), one search field (placeholder "Busca una receta" — search matches names only), **one chip row**, then photo cards (2-column masonry on mobile). A card is the photo with only a **time pill** (total time, else prep time; omitted when unknown) and the Fraunces title — nothing else: no season badge, no ownership badge, no "Selección Mimoia" mark (nearly every recipe is curated, so it would be noise; "Selección Mimoia" is only a chip). Recipes without a photo show a quiet pot placeholder (no stock photo). **Other users' recipes are never returned** — every authenticated caller (including admins) sees only system recipes + their own. When nothing is searched or filtered, a **"De temporada" hero** tops the grid (mobile: one full-bleed 220 px photo; `lg+`: two 290 px cards) with a paper caption "De temporada · N min" + title: an in-season recipe with a photo (curated seasonal ones first, then curated all-year), rotating daily (`pickFeaturedRecipes`). A small "N recetas" line (+ "Quitar filtros" when anything is on) sits above the grid. When the user has copied a system recipe via "Añadir a mis recetas", the catalogue listing **suppresses the original** from this user's view (via the `copied_from_recipe_id` back-reference) so the same dish doesn't appear twice
- Users can copy a system (or another user's) recipe into their own catalog with the **"Añadir a mis recetas"** button on the recipe detail (visible only when `recipe.authorId !== user.id`). The copy is independent — editing it doesn't affect the original — and inherits ingredients, steps, times, nutrition cache and image. The new row gets `internalTags: ['copied-from-catalog']` and `sourceType: 'manual'`
- Users can search recipes by name (case-insensitive substring match)
- Users filter from the **chip row** (toggle buttons with `aria-pressed`; none active = "Todas"): **De temporada** (current season), **En 30 min** (total time ≤ 30), **Desayuno / Comida / Cena / Snack**, **Selección Mimoia** (system recipes only — was the "Catálogo ONA" tab) and **Mis recetas** (the caller's own). Scope persists in `localStorage.ona.recipes.scope`. **Más filtros** (button inside the search on mobile, link at the end of the chip row at `lg+`) opens the advanced filters dialog (bottom sheet on mobile, centred panel at `md+`; Escape / backdrop close it): Temporada (any season, "Ahora: otoño" hint), Tiempo total (15/30/60 min), Comida, Recetas (Todas / Selección Mimoia / Mis recetas), Etiquetas propias, "Limpiar todo" and "Ver N recetas". Active filters with no chip (another season, 15/60 min, tags) show as a count badge on the button. Season, time and scope filter client-side (`filterCatalogRecipes` in `@ona/shared`): a season matches recipes listing it **or with no seasons**, a time filter uses the total time and drops recipes of unknown time; meal, search and tags are server-side
- Users can open a recipe detail view at `/recipes/[id]` (layout "D · Luz y foto", 2026-10-08). **Mobile (< lg)**: 390 px hero photo (back · share · favorite on 44 px paper circles; for the author/admin, a pencil at the photo's bottom-right that opens `/recipes/[id]/edit`, PRO-03), a cream sheet with an eyebrow (meals · category · total time · difficulty) + title (+ "Rinde…", "Ver fuente", "Cocinada N× · última…" when present), then a tablist: **Ingredientes** (default — "Para [− N raciones +]" stepper, the ingredient list, "Editar ingredientes", the **"Para hacer la compra"** card for the author/admin when some row can't go to the shopping list or a shop order as written — see [recipe-quality.md](./recipe-quality.md) → Shoppability; the same card sits above the ingredient rows on `/recipes/[id]/edit` — then Equipo, Alérgenos, Temporada, Etiquetas) · **Pasos · N** (prep/cook timeline + numbered steps) · **Nutrición** (only when nutrition is cached) · **Notas** ("Cocinada" + "Añadir a recetario", the recipe's own notes / sustituciones / conservación, *Tus notas*, Galería, "Editar receta" + "Regenerar imagen" for author/admin, "Añadir a mis recetas"). Tabs stick to the top while scrolling, follow ←/→/Home/End, and the open tab lives in the URL hash (`#pasos`, `#notas`…) so a reload or link reopens it. A sticky bottom action bar (84 px) holds the single "Empezar a cocinar"; the bottom tab bar is hidden on this route. **Desktop (lg+)**: sticky rounded photo on the left ("← Recetas" pill; author/admin also get the edit pencil top-right), long-scroll right column — eyebrow, 48 px title, meta (time · difficulty · kcal por ración), action row (Empezar a cocinar · share · favorite), Ingredientes (stepper + 2-column list), Preparación (big terracotta 01, 02…), Equipo/Alérgenos/Temporada/Etiquetas, Nutrición, Notas. **"Añadir al menú"** (PRO-04): a calendar button beside "Empezar a cocinar" in the mobile action bar and a pill in the desktop action row open a sheet (`AddToMenuSheet`) with the 7 days of this week, each with Comida / Cena. A free slot shows "Libre" and takes the recipe (`POST /menu/:menuId/day/:day/meal/:meal { recipeId }` when the day lacks the slot, `PUT` when it exists empty); an occupied slot shows its dish and swaps it for this recipe (`PUT … { recipeId }`); a locked slot ("Fijada") or one that already holds the recipe is disabled. After placing it: "«X» está en tu menú: domingo, cena" + "Ver mi menú". No menu this week → "Aún no tienes menú esta semana" + "Ir a mi menú". Logic in `apps/web/src/lib/addToMenu.ts` (unit test `addToMenuSlots.test.ts`, e2e `recipe-add-to-menu.spec.ts`)
- Users can change the number of diners (1–12) with the "Para [− N raciones +]" stepper on the detail; ingredient quantities scale on the fly and "Empezar a cocinar" carries `?servings=N`
- Users can favorite/unfavorite a recipe (toggle via heart button); the toggle is queued offline and replays on reconnect — see [PWA](./pwa.md)
- Users can create their own recipes (form at `/recipes/new`)
- Authors can edit their own recipes via `/recipes/[id]/edit` (a "Editar receta" link sits at the end of the detail's Notas tab / section; hidden for non-author non-admin viewers). The edit form supports name, servings, prep/cook times, difficulty, meals, seasons, tags, full ingredient list (per-row "opc" toggle + trash), drag-and-drop **reorderable** step list (grip handle on the left of each step row; works with mouse, touch, and keyboard via `@dnd-kit`), a **unified multi-entry Notas list** (persists into `recipes.notes`; the legacy `recipes.tips` column drains on every save — historical content is merged into the notes list on load so nothing is lost), and a "Guardar igualmente" path that re-submits with `?force=1` when the lint validator returns soft warnings (the button lives in the "Avisos" card above the sticky "Guardar cambios" pill; same on `/recipes/new` with "Crear receta"). Voice users can edit metadata fields (name, prepTime, cookTime, difficulty, notes) via the `edit_recipe` skill and ask "abre el editor" to navigate to the form for ingredient/step changes
- **Admins can edit and delete any recipe** — system catalogue rows (`authorId IS NULL`) included — so the curation workflow lives in the same form as authoring. The "Editar receta" link surfaces on the detail page whenever `user.role === 'admin'`; a small "Admin" badge is shown next to it when the admin is editing someone else's recipe (or a system one). PUT/DELETE on the API short-circuit the author check when `req.user.role === 'admin'`, and the persisted row preserves the original `authorId` (admin edits on a system recipe stay system; admin edits on another user's recipe stay under that user). The "Añadir a mis recetas" copy affordance is hidden for admins (they have direct edit access instead)
- Authors can delete their own recipes (not system recipes; admins can delete any)
- Users can extract a recipe from a photo (image upload → AI extraction)
- Users can share a recipe via the native share sheet (Web Share API) from a Share2 button in the detail hero (mobile) or action row (desktop) — see [PWA](./pwa.md). **"Pásalo"**: a catalogue recipe shares its public page `/recipes-ona/:id?ref=receta` (opens without an account, with the waitlist CTA); a private recipe is shared as text (name + ingredients) with a link to ONA, since its page is private (`recipeSharePayload` in `@ona/shared`)
- Users can start "Cooking mode" from the detail view ("Empezar a cocinar" — one entry point: the sticky bottom action bar on mobile, the action row on desktop). It navigates to `/recipes/[id]/cook?servings=N`, which holds the screen-wake Wake Lock for the duration of the cook session — see [PWA](./pwa.md) and [Cooking Mode](./cooking-mode.md)
- Users can apply **structured ingredient overrides** to any recipe (ONA, theirs, or another user's) from the detail view. Toggling "Editar ingredientes" (under the ingredient list) unlocks three actions per row — quitar, modificar cantidad/unidad/nota, and a "+ Añadir ingrediente" at the bottom of the section. In read-mode the recipe renders with the overrides baked in: removed rows are struck-through and faded, modified rows show the original quantity struck-through alongside the new value in terracotta, added rows live in a forest-green block underneath the original list. Overrides are per-household (one row per `(household, recipe)` in `recipe_notes.ingredient_overrides`), persist across navigation, and apply every time the household sees the recipe. The **shopping-list aggregator consumes these overrides** before scaling: removed lines drop out of the basket entirely, modified lines use the override's quantity/unit, and added lines (when the free-form `label` resolves against the ingredient catalog) get added to the basket. Adds whose name doesn't match the catalog stay visible on the recipe but are skipped by the shopping list. The recipe matcher itself still scores against the original ingredient list, so a "sin cebolla" override doesn't change which recipes ONA picks for the menu — it only changes what ends up in your basket and on the recipe view
- Users can mark a recipe as **"siempre la cocino para al menos N"** (1–24 raciones; guardan o congelan lo que sobra) in *Notas → Tus notas → Raciones mínimas* on the detail. It's per household (`recipe_notes.min_servings`, migration 0035, `PUT /recipes/:id/notes { minServings }`, `null` clears). Each time the recipe is cooked, the shopping list buys for at least N; a planned leftover belongs to the same batch (see [Shopping](./shopping.md)). The detail's servings scaler starts at N until the user moves it. The assistant sets it too (`update_recipe_notes`, "las lentejas siempre las hago para 6").
- Users import recipes (photo, URL, WhatsApp) and auto-create missing ingredients — see [Recipe Import](./recipe-import.md). Recipes get a generated house photo — see [Recipe Images](./recipe-images.md)

## Recipe Model

Each recipe has:
- `name` — required, text
- `imageUrl` — optional
- `servings` — required, positive integer; the canonical number of diners the listed quantities cover
- `yield` — optional human-readable string (e.g. "12 albóndigas", "1 L de salsa")
- `prepTime`, `cookTime`, `activeTime` — minutes (integer, optional, editable)
- `totalTime` — minutes, derived by the API: sum of `step.durationMin` if all steps have it, else `prepTime + cookTime`
- `difficulty` — enum `easy | medium | hard`
- `meals` — array of `breakfast | lunch | dinner | snack`
- `seasons` — array of `spring | summer | autumn | winter` (empty = all seasons)
- `equipment` — string array of tools required (e.g. "horno", "procesador", "batidora")
- `allergens` — string array (auto-aggregated from ingredients on save; see [Nutrition](./nutrition.md))
- `notes`, `tips`, `substitutions`, `storage` — long-form text, optional
- `nutritionPerServing` — cached object: `{ kcal, proteinG, carbsG, fatG, fiberG, saltG }`. Computed when the recipe is saved
- `tags` — public-facing string array, normalized (no internal labels, no `meal`/`difficulty` duplicates)
- `internalTags` — string array hidden from public UI (e.g. `compartida`, `auto-extracted`, `from-url`)
- `sourceUrl` — origin URL when imported from an article / YouTube video (null otherwise)
- `sourceType` — provenance enum: `manual | image | article | youtube` (null for legacy seeded rows)
- `authorId` — null for system, user id for user-created
- `ingredients` — list of recipe-ingredient rows (see below)
- `steps` — list of step rows (see below)

### RecipeIngredient

Each row:
- `ingredientId` — references the global ingredient catalog
- `ingredientName` — denormalized for display
- `section` — optional string for sub-grouping (e.g. "Para la masa", "Para la salsa"); `null` = ungrouped
- `quantity` — number
- `unit` — enum `g | ml | u | cda | cdita | pizca | al_gusto`
- `optional` — boolean. Editable from the recipe edit form (and the `/recipes/new` creation form) via an `opc` pill toggle next to each ingredient row. When true, the recipe detail renders an "opcional" badge inline and the shopping-list aggregator skips the row when scaling

### Meal & season fit (3-state)

Recipes carry **three-state fit maps** for meals and seasons next to the legacy on/off arrays:

- `mealFit: { breakfast?, lunch?, dinner?, snack? }` — each entry is `'mid'` (encaja a veces) or `'perfect'` (encaja perfecto). Absent key = `'none'`.
- `seasonFit: { spring?, summer?, autumn?, winter? }` — same shape.

The recipe edit / create form exposes these via a single chip that cycles **vacío → mid → perfect → vacío** on tap. Visual progression: outline (none) → soft fill (mid, with a centered `·`) → solid fill + `★` (perfect). Ink palette for meals, forest palette for seasons.

The menu generator's matcher honours both:
- **Filter**: a slot is eligible only when the recipe's fit for that meal/season is `'mid'` or `'perfect'`. `'none'` excludes the recipe entirely.
- **Pool weighting**: `pickRandom` multiplies by `FIT_WEIGHT` (`mid = 1×`, `perfect = 3×`) for the meal AND for the season, then by `2×` if the recipe is a household favourite. A perfect/perfect favourite weighs `18×` against a mid/mid non-favourite at `1×`.

Stored as parallel `recipes.meal_fit` / `recipes.season_fit` jsonb columns (migration 0024). The `meals: text[]` / `seasons: text[]` arrays stay in sync as a derived view so the public catalogue endpoint and the assistant skills keep their existing shape. Legacy recipes saved before the migration have `NULL` in the fit columns — the read layer falls back to deriving `'perfect'` for every entry in the array tagging so old recipes keep their pre-fit semantics.

### Scheduling frequency hint

Each recipe carries an optional `frequency` enum (`recipes.frequency`, migration 0026) that drives how often the menu matcher picks it:

- **Normal** (default; `NULL` in DB) — baseline weight 1×.
- **Frecuente** (`frequent`) — pool weight ×2. Same magnitude as the favourite boost; the two compose multiplicatively.
- **Ocasional** (`occasional`) — pool weight ×0.4. Still selectable when the matcher has no better option (floor of 1 entry in the pool), just rare.
- **Solo finde** (`weekends_only`) — **hard filter**: the recipe is excluded from any Mon-Fri slot (`dayIndex < 5`). On Saturday / Sunday it enters the pool with weight 1×.

The edit form exposes four mutually-exclusive chips under "Planificación"; "Normal" is the default state that maps to a NULL column. Persisted via `createRecipeSchema.frequency` (zod `nullable().optional()`); the DB CHECK constraint clamps writes to the canonical enum.
- `note` — optional inline note (e.g. "picada fina", "del día anterior")
- `displayOrder` — integer, controls UI ordering inside its section

### Step

Each row:
- `index` — integer, position in the recipe (0-based)
- `text` — required, the instruction sentence
- `durationMin` — optional integer, time the step itself takes
- `temperature` — optional integer °C (oven, pan, water bath…)
- `technique` — optional short label ("sofreír", "hornear", "marinar")
- `ingredientRefs` — array of `recipeIngredientId`s used in this step (used to render quantities inline and for cooking-mode highlighting)

## Tag Visibility

The catalog and detail view display only **public** tags. Filtering rules:
- Any tag in `internalTags` is excluded
- Tags that duplicate the `meal`, `season`, or `difficulty` fields are excluded (no more "compartida · easy · lunch" leaking)
- All tags are normalized to the user's display language (Spanish)

## Quantity Scaling

When the user changes the diner count from `recipe.servings` to `target`:
- Each ingredient `quantity` is multiplied by `target / recipe.servings`
- Counted units (`u`) round to the nearest whole; if the result is non-integer, the UI shows a small note (e.g. "1.5 huevos → redondea a 2")
- `pizca` and `al_gusto` never scale
- Mass and volume units round to a culinary-friendly precision (1 g, 5 g, 25 g, 50 g bands depending on magnitude)
- Step text references via `ingredientRefs` are recomputed at the same scale

## Display Constraints

- A `prepTime` of `0` (or any falsy value) is **not** rendered on cards or detail meta — instead, the field is omitted entirely (fixes the prior "0" leak). Cards show `recipeMinutes` (total time, else prep time). **Season rule**: "now" is `detectSeason(date)` — meteorological seasons for Spain (Sep–Nov otoño, Dec–Feb invierno…), browser-local month, the same rule as the menu generator. A season is never derived from the order of `recipe.seasons` (until 2026-10-08 cards showed `seasons[0]`: "Primavera" on every all-year recipe in October). `/recipes` cards show no season; the public `/recipes-ona` cards show `recipeSeasonBadge` — the current season, only for genuinely seasonal recipes in season. Guarded by `catalogSeason.test.ts`
- All meal/season labels go through `MEAL_LABELS` / `SEASON_LABELS` before render (no raw `lunch`/`dinner` in the UI)
- Spanish copy uses correct accents (Otoño, Año, Añadir, Preparación) — no mojibake fallbacks
- The detail view groups ingredients by `section` if any ingredient has one set; otherwise renders a flat list
- The "Para X" caption next to the ingredients title reflects the live scaler value, not a hardcoded number

### Desktop layout (lg+)

At `lg+` (≥1024 px) `/recipes` keeps the desktop sidebar and caps at `max-w-[1180px]`: row 1 = h1 "Recetas" (40 px) + search (max 560 px) + ink "Nueva receta" pill on the right; row 2 = every chip wrapped on one line + "Más filtros" (no filter column); then the two hero cards and a 4-column grid (220 px photos, row-major order). Below `lg` the grid is a 2-column masonry (tall / short photos alternate). State lives in the page; `CatalogFilters.tsx` exports `CatalogSearch`, `CatalogChips` and `CatalogFiltersSheet`; `CatalogGrid.tsx` renders `RecipeCard`; `FeaturedRecipeCard.tsx` is the hero.

`/cookbooks/[id]` is **not** a catalogue page — it's a single-cookbook detail (see [Cookbooks](./cookbooks.md)). Since PRO-43 it reuses `<CatalogGrid>` (same cards, masonry below `lg`, 4 columns at `lg+`, page capped at `max-w-[1180px]`) and passes `renderAction` to lay a "Quitar del recetario" button over each photo; it does not use `<CatalogFilters>`. Without `renderAction` the grid renders exactly as on `/recipes`.

### Recipe detail / Create / Edit desktop layouts (lg+)

`/recipes/[id]` switches at `lg+` (`useIsDesktop`, `hooks/useMediaQuery.ts`) to the two-column split described above: a `max-w-[1280px]` 50/50 grid, the photo `sticky top-7` at `100dvh − 56px`, the title above the fold at 1440×900. Both layouts render the same section blocks; only the chrome differs.

`/recipes/new` and `/recipes/[id]/edit` ("D · Luz y foto", PRO-42) cap at 1180 px and split into two columns at `lg+`: data (and, on edit, the photo) on the left, ingredients and steps (and notes) on the right; the photo/URL import cards sit side by side above the manual form. Below `lg` everything stacks in one column. See [Design System](./design-system.md).

## Course classification (`recipes.course`)

Optional enum tagging the recipe's role in a multi-dish meal: `'starter' | 'main' | 'dessert' | null`. Spanish labels via `COURSE_LABELS` in `@ona/shared` (`Entrante / Principal / Postre`).

`null` means "versatile" — the menu generator treats null-tagged recipes as valid stand-alone dishes for single-dish slots. The matcher uses this field when a slot is configured with 2 or 3 dishes (see [`menus.md`](./menus.md) "Multi-dish slots").

Population:
- Seed catalogue + existing user recipes: one-shot LLM script `pnpm --filter @ona/api course:populate` (→ JSONL → optional manual review → `course:apply`). Same two-step pattern as `prep-requirements:populate`. Source: `apps/api/scripts/populateRecipeCourses.ts`.
- New recipes: optional dropdown in `/recipes/new` and `/recipes/[id]/edit` (defaults to "Sin clasificar (auto)" = `null`).

## API Endpoints

- `GET /recipes?search=&meal=&season=&maxTime=&perPage=&page=` — list with filters; returns the lightweight card shape. **Optional auth:** with a valid Bearer token the response is the system catalogue + the caller's own recipes (other users' recipes are never listed; a personal copy hides the system original it was copied from); without a token only system recipes (`authorId IS NULL`) are returned, so the same endpoint backs the public `/recipes-ona` page anonymously and the app `/recipes` page authenticated.
- `GET /recipes/:id?servings=N` — single recipe; if `servings` is provided and differs from `recipe.servings`, quantities are scaled server-side and a `scaledFrom` field is included. Anonymous callers can only fetch system recipes; requesting a user-authored recipe without a token returns 404 (same shape as "not found" to avoid leaking which IDs exist privately).
- `POST /recipes` (auth) — create user recipe; runs lint validator
- `PUT /recipes/:id` (auth, author only) — update; runs lint validator and recomputes `nutritionPerServing` and `allergens`
- `DELETE /recipes/:id` (auth, author only)
- `GET /user/:id/recipes` (auth) — user's own + favorited recipes
- `POST /user/:id/recipes/:recipeId/favorite` (auth) — toggle favorite. **PR 1B:** each user toggles their own `user_favorites` row, but `GET /user/:id/recipes` returns the household-wide union of favorites when `SHARED_HOUSEHOLD_SCOPE` is on. See [Household](./household.md)
- `POST /recipes/:id/copy` (auth) — clone a recipe into the caller's catalog. Refuses with 409 if the user already owns the source. Returns the new recipe

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- **Ingredient names on screen (detail, shopping list, pantry, staples)** read as a sentence — «Aceite de oliva virgen», «Pimentón dulce» — via `ingredientDisplayName` (`packages/shared/src/utils/shopFormat.ts`): only the first letter is raised and catalogue accents are restored; brands/acronyms the user typed («Kerrygold», «AOVE») stay. Display-only; stored names are untouched (PRO-02).
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)
- **Recipe visibility** (`services/recipeVisibility.ts`): a user can see, be served, or have ONA pick the system catalogue (`authorId IS NULL`) + their own recipes + recipes authored by members of their primary household. Another user's private recipe never reaches them through the menu generator, slot regeneration, manual slot pick (`404`), cook-from-pantry, the nutrition advisor or any assistant skill (web chat + WhatsApp). `GET /recipes/:id` returns `404` for an invisible recipe. Before 2026-10-07 the generator and the assistant loaded the whole `recipes` table. Guarded by `recipeVisibilityCoverage.test.ts` (no unscoped read of `recipes` in those files)
- Structured **ingredient overrides** (`recipe_notes.ingredient_overrides`) flow through to the shopping list and the recipe detail, but the *menu generator/matcher* still scores recipes against their original ingredient list. So a household that "removes cebolla" from every recipe will still see the same recipes get selected by the planner — they just won't see cebolla on the recipe detail or in the basket

## Related specs

- [Cooking Mode](./cooking-mode.md) — fullscreen step-by-step UX, uses `step.durationMin` and `step.ingredientRefs`
- [Nutrition](./nutrition.md) — how `nutritionPerServing` and `allergens` are computed
- [Recipe Quality](./recipe-quality.md) — lint validator and LLM-assisted regeneration of the seed
- [Menus](./menus.md) — recipes are selected for menu slots, scaled to household size
- [Shopping](./shopping.md) — ingredients aggregate into a unit-aware shopping list
- [Design System](./design-system.md) — RecipeCard and detail page styling
- [PWA](./pwa.md) — favorite-toggle offline queue, Web Share button on the detail page, Wake Lock cooking-mode badge
- [Recipe Import](./recipe-import.md) — seed pipeline, photo/URL/WhatsApp import, ingredient resolution and prep requirements
- [Recipe Images](./recipe-images.md) — house photo generation, regenerate-image, catalogue photo audit

## Source

- [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts)
- [apps/api/src/services/recipeVisibility.ts](../apps/api/src/services/recipeVisibility.ts) — who can see which recipe (`visibleAuthorIds`, `visibleRecipeWhere`, `canViewRecipe`); used by the generator, menu routes, pantry matcher, advisor and assistant skills
- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — lint validator (new)
- [apps/api/scripts/tagRecipesByType.ts](../apps/api/scripts/tagRecipesByType.ts) — deterministic backfill that adds the `MEAL_TYPE_TAGS` taxonomy (`cremas | legumbres | pizza | asiatico | mediterraneo | ensalada | parrilla | batch-cooking | pasta | arroz`) onto system recipes by name + ingredient heuristics. Runs dry-run by default; `--execute` commits. Idempotent — re-running on already-tagged rows is a no-op. The matcher's `pinnedType` predicate reads these tags so the "Fijar tipo" menu UX has something to filter against.
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — catalogue page; [packages/shared/src/utils/catalog.ts](../packages/shared/src/utils/catalog.ts) — season badge, `recipeMinutes`, `filterCatalogRecipes`, `pickFeaturedRecipes`
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [apps/web/src/components/recipes/detail/](../apps/web/src/components/recipes/detail/) — detail blocks ([`ServingsScaler`](../apps/web/src/components/recipes/ServingsScaler.tsx): `inline` in cook mode, `pill` on the detail): `RecipeTabs` (tablist), `RecipeActionBar` (sticky cook bar, portalled to `<body>`), `IngredientsSection` / `StepsSection` (`plain` variant on the private detail, `chapter` on the public page), `NutritionCard`
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
