# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## User Capabilities

- **Anyone, no account needed**, can browse the public catalogue (shown as "Catálogo Mimoia") at `/recipes-ona` and open any recipe detail at `/recipes-ona/[id]`. The public page only ever lists system recipes (`authorId IS NULL`) — even when a logged-in browser visits, the page forces an anonymous fetch via `apiPublic` so the catalogue is always the curated ONA set. The detail view shows ingredients, steps, nutrition and allergens but no favourite / copy / edit / cook-mode actions; an "Únete a la lista de espera" CTA appears at the bottom of both pages (pre-launch, to `/?ref=receta#lista-de-espera` on the detail and `/?ref=recetas#lista-de-espera` on the list — see [Waitlist](./waitlist.md)).
- Logged-in users browse the catalog at `/recipes` ("D · Luz y foto", 2026-10-08): header "Recetas" + ink "+" (**Nueva receta**), one search field (placeholder "Busca una receta" — search matches names only), **one chip row**, then photo cards (2-column masonry on mobile). A card is the photo with only a **time pill** (total time, else prep time; omitted when unknown) and the Fraunces title — nothing else: no season badge, no ownership badge, no "Selección Mimoia" mark (nearly every recipe is curated, so it would be noise; "Selección Mimoia" is only a chip). Recipes without a photo show a quiet pot placeholder (no stock photo). **Other users' recipes are never returned** — every authenticated caller (including admins) sees only system recipes + their own. When nothing is searched or filtered, a **"De temporada" hero** tops the grid (mobile: one full-bleed 220 px photo; `lg+`: two 290 px cards) with a paper caption "De temporada · N min" + title: an in-season recipe with a photo (curated seasonal ones first, then curated all-year), rotating daily (`pickFeaturedRecipes`). A small "N recetas" line (+ "Quitar filtros" when anything is on) sits above the grid. When the user has copied a system recipe via "Añadir a mis recetas", the catalogue listing **suppresses the original** from this user's view (via the `copied_from_recipe_id` back-reference) so the same dish doesn't appear twice
- Users can copy a system (or another user's) recipe into their own catalog with the **"Añadir a mis recetas"** button on the recipe detail (visible only when `recipe.authorId !== user.id`). The copy is independent — editing it doesn't affect the original — and inherits ingredients, steps, times, nutrition cache and image. The new row gets `internalTags: ['copied-from-catalog']` and `sourceType: 'manual'`
- Users can search recipes by name (case-insensitive substring match)
- Users filter from the **chip row** (toggle buttons with `aria-pressed`; none active = "Todas"): **De temporada** (current season), **En 30 min** (total time ≤ 30), **Desayuno / Comida / Cena / Snack**, **Selección Mimoia** (system recipes only — was the "Catálogo ONA" tab) and **Mis recetas** (the caller's own). Scope persists in `localStorage.ona.recipes.scope`. **Más filtros** (button inside the search on mobile, link at the end of the chip row at `lg+`) opens the advanced filters dialog (bottom sheet on mobile, centred panel at `md+`; Escape / backdrop close it): Temporada (any season, "Ahora: otoño" hint), Tiempo total (15/30/60 min), Comida, Recetas (Todas / Selección Mimoia / Mis recetas), Etiquetas propias, "Limpiar todo" and "Ver N recetas". Active filters with no chip (another season, 15/60 min, tags) show as a count badge on the button. Season, time and scope filter client-side (`filterCatalogRecipes` in `@ona/shared`): a season matches recipes listing it **or with no seasons**, a time filter uses the total time and drops recipes of unknown time; meal, search and tags are server-side
- Users can open a recipe detail view at `/recipes/[id]` (layout "D · Luz y foto", 2026-10-08). **Mobile (< lg)**: 390 px hero photo (back · share · favorite on 44 px paper circles), a cream sheet with an eyebrow (meals · category · total time · difficulty) + title (+ "Rinde…", "Ver fuente", "Cocinada N× · última…" when present), then a tablist: **Ingredientes** (default — "Para [− N raciones +]" stepper, the ingredient list, "Editar ingredientes", the **"Para hacer la compra"** card for the author/admin when some row can't go to the shopping list or a shop order as written — see [recipe-quality.md](./recipe-quality.md) → Shoppability; the same card sits above the ingredient rows on `/recipes/[id]/edit` — then Equipo, Alérgenos, Temporada, Etiquetas) · **Pasos · N** (prep/cook timeline + numbered steps) · **Nutrición** (only when nutrition is cached) · **Notas** ("Cocinada" + "Añadir a recetario", the recipe's own notes / sustituciones / conservación, *Tus notas*, Galería, "Editar receta" + "Regenerar imagen" for author/admin, "Añadir a mis recetas"). Tabs stick to the top while scrolling, follow ←/→/Home/End, and the open tab lives in the URL hash (`#pasos`, `#notas`…) so a reload or link reopens it. A sticky bottom action bar (84 px) holds the single "Empezar a cocinar"; the bottom tab bar is hidden on this route. **Desktop (lg+)**: sticky rounded photo on the left ("← Recetas" pill), long-scroll right column — eyebrow, 48 px title, meta (time · difficulty · kcal por ración), action row (Empezar a cocinar · share · favorite), Ingredientes (stepper + 2-column list), Preparación (big terracotta 01, 02…), Equipo/Alérgenos/Temporada/Etiquetas, Nutrición, Notas. No "Añadir al menú" action yet: there is no add-recipe-to-menu flow from a recipe
- Users can change the number of diners (1–12) with the "Para [− N raciones +]" stepper on the detail; ingredient quantities scale on the fly and "Empezar a cocinar" carries `?servings=N`
- Users can favorite/unfavorite a recipe (toggle via heart button); the toggle is queued offline and replays on reconnect — see [PWA](./pwa.md)
- Users can create their own recipes (form at `/recipes/new`)
- Authors can edit their own recipes via `/recipes/[id]/edit` (a "Editar receta" link sits at the end of the detail's Notas tab / section; hidden for non-author non-admin viewers). The edit form supports name, servings, prep/cook times, difficulty, meals, seasons, tags, full ingredient list (per-row "opc" toggle + trash), drag-and-drop **reorderable** step list (grip handle on the left of each step row; works with mouse, touch, and keyboard via `@dnd-kit`), a **unified multi-entry Notas list** (persists into `recipes.notes`; the legacy `recipes.tips` column drains on every save — historical content is merged into the notes list on load so nothing is lost), and a "Guardar igualmente" path that re-submits with `?force=1` when the lint validator returns soft warnings. Voice users can edit metadata fields (name, prepTime, cookTime, difficulty, notes) via the `edit_recipe` skill and ask "abre el editor" to navigate to the form for ingredient/step changes
- **Admins can edit and delete any recipe** — system catalogue rows (`authorId IS NULL`) included — so the curation workflow lives in the same form as authoring. The "Editar receta" link surfaces on the detail page whenever `user.role === 'admin'`; a small "Admin" badge is shown next to it when the admin is editing someone else's recipe (or a system one). PUT/DELETE on the API short-circuit the author check when `req.user.role === 'admin'`, and the persisted row preserves the original `authorId` (admin edits on a system recipe stay system; admin edits on another user's recipe stay under that user). The "Añadir a mis recetas" copy affordance is hidden for admins (they have direct edit access instead)
- Authors can delete their own recipes (not system recipes; admins can delete any)
- Users can extract a recipe from a photo (image upload → AI extraction)
- Users can import a recipe from a URL — either a YouTube video or a web article — via `/recipes/new`. The server fetches the page, tries `schema.org/Recipe` JSON-LD first, falls back to Mozilla Readability + Claude for articles, and uses video description + caption transcript for YouTube. The LLM also classifies whether the content is actually a recipe; non-recipes return a clear Spanish error. The persisted recipe carries `sourceUrl` and `sourceType`; the recipe detail surfaces a **"Ver fuente"** link under the title (Youtube icon for `sourceType: 'youtube'`, generic external-link icon otherwise). The edit form exposes an optional URL field under "Tiempos y comensales" so any recipe — even manually authored ones — can have a source attached after the fact
- Users can auto-create a missing ingredient from the `/recipes/new` form: if an ingredient name doesn't exist in the catalog, a "Crear nuevo ingrediente" option in the picker opens a modal showing USDA FoodData Central candidates (Foundation/SR Legacy first, Branded filtered out) plus per-100 g nutrition; the user picks one or "Crear sin nutrición". The new row is persisted with full nutrition + inferred allergens and slotted into the recipe form. Same plumbing is reused by the photo extractor and `apply:recipes --auto-create-missing` to avoid skipping recipes whose ingredients are merely absent from the catalog.
- Users can share a recipe via the native share sheet (Web Share API) from a Share2 button in the detail hero (mobile) or action row (desktop) — see [PWA](./pwa.md). **"Pásalo"**: a catalogue recipe shares its public page `/recipes-ona/:id?ref=receta` (opens without an account, with the waitlist CTA); a private recipe is shared as text (name + ingredients) with a link to ONA, since its page is private (`recipeSharePayload` in `@ona/shared`)
- Users can start "Cooking mode" from the detail view ("Empezar a cocinar" — one entry point: the sticky bottom action bar on mobile, the action row on desktop). It navigates to `/recipes/[id]/cook?servings=N`, which holds the screen-wake Wake Lock for the duration of the cook session — see [PWA](./pwa.md) and [Cooking Mode](./cooking-mode.md)
- Users can apply **structured ingredient overrides** to any recipe (ONA, theirs, or another user's) from the detail view. Toggling "Editar ingredientes" (under the ingredient list) unlocks three actions per row — quitar, modificar cantidad/unidad/nota, and a "+ Añadir ingrediente" at the bottom of the section. In read-mode the recipe renders with the overrides baked in: removed rows are struck-through and faded, modified rows show the original quantity struck-through alongside the new value in terracotta, added rows live in a forest-green block underneath the original list. Overrides are per-household (one row per `(household, recipe)` in `recipe_notes.ingredient_overrides`), persist across navigation, and apply every time the household sees the recipe. The **shopping-list aggregator consumes these overrides** before scaling: removed lines drop out of the basket entirely, modified lines use the override's quantity/unit, and added lines (when the free-form `label` resolves against the ingredient catalog) get added to the basket. Adds whose name doesn't match the catalog stay visible on the recipe but are skipped by the shopping list. The recipe matcher itself still scores against the original ingredient list, so a "sin cebolla" override doesn't change which recipes ONA picks for the menu — it only changes what ends up in your basket and on the recipe view
- Users can mark a recipe as **"siempre la cocino para al menos N"** (1–24 raciones; guardan o congelan lo que sobra) in *Notas → Tus notas → Raciones mínimas* on the detail. It's per household (`recipe_notes.min_servings`, migration 0035, `PUT /recipes/:id/notes { minServings }`, `null` clears). Each time the recipe is cooked, the shopping list buys for at least N; a planned leftover belongs to the same batch (see [Shopping](./shopping.md)). The detail's servings scaler starts at N until the user moves it. The assistant sets it too (`update_recipe_notes`, "las lentejas siempre las hago para 6").

## Recipe Sources

**System / Shared recipes** (`authorId = null`):
- Tagged internally with `compartida` (not shown publicly — see *Tag Visibility* below)
- Curated through the regeneration script (see [Recipe Quality](./recipe-quality.md)); each recipe must pass the lint validator before being seeded
- Read-only for users (cannot edit or delete)
- Listed by the **"Selección Mimoia"** chip in the catalog (no per-card mark)

**Seed pipeline (how the system catalog is populated)**:
1. `apps/api/src/seed/recipes.ts` declares 79 recipe shells (name + meta). About 16 carry full `ingredients` / `steps` inline; the other 63 are intentional placeholders (`ingredients: []`, `steps: []`) that get filled in by a second pass.
2. `pnpm --filter @ona/api db:seed` inserts/updates ingredients from `seed/ingredients.ts`, then iterates `seedRecipes`. A recipe is **skipped** when none of its ingredient names resolve in the live `ingredients` table — so the placeholders silently no-op on first seed.
3. `apps/api/scripts/handAuthoredRecipes.ts` carries the full hand-authored bodies (name + qty + unit + steps + step-ingredient refs) for those 63 plus a handful of extras. It resolves names against the *current* prod catalog, refuses recipes whose ingredients are missing, and appends the resolved JSONL to `apps/api/scripts/output/regen-passed.jsonl`.
4. `pnpm --filter @ona/api apply:recipes [--soft-lint] [--auto-create-missing] [--dry-run]` reads that JSONL, runs `lintRecipe`, and inserts/updates by case-insensitive name match. `--soft-lint` downgrades `STEP_INGREDIENT_NOT_LISTED` / `ORPHAN_INGREDIENT` errors to warnings (one-off recovery escape hatch — do **not** rely on it in steady state, lint errors should be fixed upstream in the authoring data). `--auto-create-missing` (default true) inserts new ingredient rows via USDA when the JSONL references unknown names (not unknown UUIDs — those can't be recovered).
5. A real `image_url` for each recipe is either committed under `apps/web/public/images/recipes/<slug>.jpg` (seed assets) or generated on demand via `POST /recipes/:id/regenerate-image` for user copies.

**One-off prod maintenance scripts** (all default to dry-run, take `--execute` to commit):
- `scripts/dedupSystemRecipes.ts` — collapse duplicate system rows by name, rewriting `menus.days[].recipeId` to the canonical id before deleting.
- `scripts/linkSeedRecipeImages.ts` — for any system recipe with `image_url IS NULL`, attach `/images/recipes/<slug>.{jpg,jpeg,png,webp}` if a file already exists on disk (avoids re-paying AiKit for already-generated photos).
- `scripts/fillSeedCatalogGap.ts` — compute the names referenced by `seedRecipes` that are not yet in `ingredients`, try USDA for nutrition, insert (stub when USDA fails). Run before `db:seed` if the catalog is short.
- `scripts/bulkInsertIngredients.ts` — insert stub ingredients (zero nutrition + name-inferred allergens) from a newline-separated stdin list. Used to unblock `handAuthoredRecipes` when the catalog is missing 30+ names at once. Backfill nutrition afterwards with `pnpm seed:usda`.
- `scripts/recomputeRecipeNutrition.ts` — re-aggregate `recipes.nutrition_per_serving` and `recipes.allergens` from the live `ingredients` + `recipe_ingredients` data. Run after `seed:usda` (or after any catalog edit that changes nutrition) so the cached recipe nutrition isn't stale. Default scope is system recipes only; `--scope=all` includes user recipes.
- `scripts/insertMappedIngredients.ts` — read `ingredient-fdc-map.yaml`, insert a stub row for every mapping not yet present in the `ingredients` table, then run `seed:usda` to enrich with real USDA nutrition. This is the "yaml is source of truth → propagate to DB" idempotent step the seed pipeline was missing.

**User-created recipes** (`authorId = user.id`):
- Editable and deletable by the author
- Created via `/recipes/new`, AI extraction from photo, AI extraction from URL, or by copying from the ONA catalog (`POST /recipes/:id/copy`)
- Must pass the same lint rules on save
- Cards carry no badge; they are what the **"Mis recetas"** chip shows

**Copied recipes**: when the user taps "Añadir a mis recetas" on a system recipe (or any recipe they don't own), the server clones the row and all child rows (`recipe_ingredients`, `recipe_steps`) with new UUIDs, remaps `step.ingredientRefs` from old → new ingredient row ids, sets `authorId = req.userId`, drops the source's `compartida` / `auto-extracted` / `from-url` internal tags and adds `copied-from-catalog`, sets `sourceType = 'manual'`, and returns the new recipe. The user is then the author of an independent copy.

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

`/cookbooks/[id]` is **not** a catalogue page — it's a single-cookbook detail with a recipe-thumbnail grid. At `lg+` the page caps at `max-w-[1100px]` and the recipe grid widens from 2 to 4 columns. It does not share `<CatalogFilters>` or `<CatalogGrid>`.

### Recipe detail / Create / Edit desktop layouts (lg+)

`/recipes/[id]` switches at `lg+` (`useIsDesktop`, `hooks/useMediaQuery.ts`) to the two-column split described above: a `max-w-[1280px]` 50/50 grid, the photo `sticky top-7` at `100dvh − 56px`, the title above the fold at 1440×900. Both layouts render the same section blocks; only the chrome differs.

`/recipes/new` and `/recipes/[id]/edit` self-cap at `max-w-2xl` (672 px) on their inner form wrapper, which already reads as a comfortable desktop form width once the sidebar appears at `md+`. No additional outer constraint is added at `lg+`.

## Course classification (`recipes.course`)

Optional enum tagging the recipe's role in a multi-dish meal: `'starter' | 'main' | 'dessert' | null`. Spanish labels via `COURSE_LABELS` in `@ona/shared` (`Entrante / Principal / Postre`).

`null` means "versatile" — the menu generator treats null-tagged recipes as valid stand-alone dishes for single-dish slots. The matcher uses this field when a slot is configured with 2 or 3 dishes (see [`menus.md`](./menus.md) "Multi-dish slots").

Population:
- Seed catalogue + existing user recipes: one-shot LLM script `pnpm --filter @ona/api course:populate` (→ JSONL → optional manual review → `course:apply`). Same two-step pattern as `prep-requirements:populate`. Source: `apps/api/scripts/populateRecipeCourses.ts`.
- New recipes: optional dropdown in `/recipes/new` and `/recipes/[id]/edit` (defaults to "Sin clasificar (auto)" = `null`).

## Ingredient prep requirements

Each `ingredients` row carries an optional `prep_requirements` JSONB column with the shape `{ method: PrepMethod, notes?: string }` where `PrepMethod` is a closed enum: `thaw_24h | thaw_48h | soak_overnight | soak_30min | temper_30min | marinate_2h | marinate_overnight | dough_rise_overnight`. The values encode the typical lead time so the scheduler doesn't need separate config — `PREP_METHOD_HOURS_BEFORE` in `@ona/shared` maps each value to a fixed number of hours.

Population is offline via the LLM script:

  1. `pnpm --filter @ona/api prep-requirements:populate` — loads every ingredient, asks Claude in batches of 50 (one ~$0.02 call per batch), writes JSONL to `apps/api/scripts/output/prep-requirements.jsonl`. Defaults to `null` whenever the LLM is unsure so the catalogue never gets noisy.
  2. Human review of the JSONL.
  3. `pnpm --filter @ona/api prep-requirements:apply` — re-reads the same file and `UPDATE`s the matching rows.

Idempotent: re-running populate overwrites the JSONL; re-running apply overwrites the DB. The scheduler ([Notifications](./notifications.md) / PR-D) reads this column together with `user_memories.prep_habits` to decide which alerts fire for which user when a recipe lands in their menu.

## Ingredient Resolution

Both the photo extractor (`POST /recipes/extract-from-image`) and the URL extractor (`POST /recipes/extract-from-url`) call the shared `matchIngredients()` helper in `apps/api/src/services/recipeExtractor.ts` to bind every extracted ingredient name to a catalogue row id. The cascade has three stages, each is the previous one's fallback:

1. **Token-set match** (`apps/api/src/services/ingredientTokenMatch.ts`, pure / no DB).
   - Tokenise both names lowercase, drop Spanish stop-words (`de`, `del`, `la`, `el`, `las`, `los`, `al`, `en`, `con`, `a`, `y`).
   - **exact**: token sets are equal — "aceite de oliva" ↔ "aceite de oliva".
   - **noise-stripped**: catalogue tokens are a subset of user tokens AND every extra user token is in a curated list of *cooking-state modifiers* (picada, rallado, fresco, maduro, ecológico, asado, …). "cebolla picada" ↦ "cebolla". The list deliberately covers only state, never part-of-animal / variety / regional adjectives.
   - **user-generic**: user tokens are a strict subset of catalogue tokens (user typed less specific than what the catalogue holds). "sal" matched against catalogue "sal marina". When several catalogue entries qualify, the shortest one wins.
   - **NEVER** does a substring fallback that lets the user's input lose semantic content. "pechuga de pollo" does **not** collapse to "pollo"; "jamón ibérico" does **not** collapse to "jamón"; "aceite de girasol" does **not** collapse to "aceite". Anything the user typed beyond the noise list is preserved → cascade falls through.

2. **LLM disambiguation** (`apps/api/src/services/ingredientMatcherLLM.ts`).
   - Single batched call per import: sends every leftover name + the full catalogue + the recipe title to `claude-sonnet-5-5` (adaptive thinking, effort `medium`), gets back `{matches: [{extracted_name, ingredient_id | null}]}`. One round-trip, not one-per-ingredient.
   - System prompt explicitly forbids part-of-animal collapses (the very trap the token matcher refuses) but encourages genuine alias resolution: "chuletón" ↦ "chuleta de vaca", "pimentón dulce de la vera" ↦ "pimentón dulce", "cebolleta" ↦ "cebolla tierna" when present.
   - Failure modes (no API key, network error, malformed JSON) degrade silently to an empty verdict map — the caller still tries stage 3. An import is never blocked on the LLM step.

3. **USDA auto-create** (`apps/api/src/services/ingredientAutoCreate.ts`).
   - Same Foundation/SR-Legacy lookup as the manual ingredient picker, with Spanish↦English translation. Persists a new `ingredients` row with full per-100 g nutrition + inferred allergens.
   - Net effect over time: the first user to import "pechuga de pollo" pays the USDA round-trip; everyone after them hits stage 1 directly.

## API Endpoints

- `GET /recipes?search=&meal=&season=&maxTime=&perPage=&page=` — list with filters; returns the lightweight card shape. **Optional auth:** with a valid Bearer token the response is the system catalogue + the caller's own recipes (other users' recipes are never listed; a personal copy hides the system original it was copied from); without a token only system recipes (`authorId IS NULL`) are returned, so the same endpoint backs the public `/recipes-ona` page anonymously and the app `/recipes` page authenticated.
- `GET /recipes/:id?servings=N` — single recipe; if `servings` is provided and differs from `recipe.servings`, quantities are scaled server-side and a `scaledFrom` field is included. Anonymous callers can only fetch system recipes; requesting a user-authored recipe without a token returns 404 (same shape as "not found" to avoid leaking which IDs exist privately).
- `POST /recipes` (auth) — create user recipe; runs lint validator
- `PUT /recipes/:id` (auth, author only) — update; runs lint validator and recomputes `nutritionPerServing` and `allergens`
- `DELETE /recipes/:id` (auth, author only)
- `GET /user/:id/recipes` (auth) — user's own + favorited recipes
- `POST /user/:id/recipes/:recipeId/favorite` (auth) — toggle favorite. **PR 1B:** each user toggles their own `user_favorites` row, but `GET /user/:id/recipes` returns the household-wide union of favorites when `SHARED_HOUSEHOLD_SCOPE` is on. See [Household](./household.md)
- `POST /recipes/extract-from-image` (auth) — AI recipe extraction; returns the `ExtractedRecipe` draft (ingredients matched against catalog + warnings) so the user can review and adjust it on `/recipes/new` before saving. The draft is **not** persisted server-side — the user submits the normal `POST /recipes` from the form, which runs the lint validator. Defensive JSON parse tolerates ```json…``` fenced responses from the model
- `POST /recipes/:id/copy` (auth) — clone a recipe into the caller's catalog. Refuses with 409 if the user already owns the source. Returns the new recipe
- `POST /recipes/extract-from-url` (auth) — body `{ url, asSystem?: boolean }`. Detects YouTube vs article by hostname. Articles try `schema.org/Recipe` JSON-LD, then fall back to Mozilla Readability + Claude. YouTube combines title + description + caption transcript and feeds it to Claude. **Meta fetcher has a two-step fallback**: first hits Innertube (youtubei.js), and if it returns an empty/short description (datacenter IPs are sometimes rate-limited by YouTube's internal API) the code scrapes the public watch page HTML directly and parses `videoDetails.title` + `videoDetails.shortDescription` out of the embedded `ytInitialPlayerResponse` JSON — so any video whose description carries the full recipe (timestamped step lists like Gipsy Chef uploads) imports cleanly even when Innertube is blocked. Unlike `/extract-from-image`, this endpoint persists the recipe directly and returns `{ recipe, warnings }` (the frontend then redirects to the detail page). Returns 422 with `{ isRecipe: false, reason }` when the LLM decides the URL doesn't describe a cookable recipe, and 422 with a Spanish message when a YouTube video has neither captions nor a usable description. **Cover image is captured automatically**: articles read `schema.org/Recipe.image` (string · `{url}` · array) when JSON-LD is present, otherwise scrape `og:image` / `og:image:secure_url` / `twitter:image` / `<link rel="image_src">` from the page head; YouTube derives `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (guaranteed for every video). The captured URL is persisted into `recipes.image_url` only as a stand-in: right after the save, the **house photo** (below) replaces it in the background. **`asSystem: true` is admin-only** (returns 403 `NOT_ADMIN` for non-admins): persists the recipe with `authorId = null` and `internalTags = ['compartida', 'auto-extracted', 'from-url']` so it shows up under "Selección Mimoia" on `/recipes` and on the public `/recipes-ona` page. The `UrlRecipeImport` component on `/recipes/new` surfaces an "Añadir al catálogo Mimoia" checkbox only when `user.role === 'admin'`
- **The URL is untrusted (SSRF guard, `services/net/publicFetch.ts`)**: article pages are fetched only over http/https on default ports, never to `localhost`, `*.internal`/`*.local`, bare hostnames or private/loopback/link-local/CGNAT/ULA addresses. Every DNS answer is checked again when the connection is made, so DNS rebinding is refused too. Redirects are followed by hand (max 3) and each hop is re-checked. 10 s deadline, 2 MB cap on the decompressed body, HTML-ish content types only, charset honoured. A refused URL → `400 { error }` ("Ese enlace no apunta a una página pública."); a too-big / non-HTML / HTTP-error page → `422 { error }`. YouTube imports only ever call fixed youtube.com endpoints.
- Article pages are fetched with a regular browser User-Agent and `Accept-Language: es-ES`. It's a single page the user explicitly shared, fetched on their behalf. Several recipe sites (e.g. gipsychef.es) answer **403** to self-identified bot agents; that broke "guárdame esta receta" until 2026-10-07.
- **Shared import path** (`services/recipeImport.ts`): `saveExtractedRecipe(extracted, { authorId, internalTags, sourceUrl })` is the one soft-lint persist used by `POST /recipes/extract-from-url`, the assistant skill `import_recipe_from_url` ("guárdame esta receta: <enlace>", web chat + WhatsApp — see [Advisor](./advisor.md)) and WhatsApp recipe photos (`importRecipeFromImage`, tagged `['auto-extracted', 'from-photo']`). Unlike the in-app photo flow (which returns a draft for review), a photo sent over WhatsApp is **persisted directly** with soft lint — the reply links to the recipe so the user can review it. Pure mapping `extractedToWriteInput` is unit-tested in `recipeImport.test.ts`.
- **House photo** (`services/recipeHouseImage.ts`, 2026-10-08): (1) Claude Haiku writes a one-line visual description of the plated dish from name + ingredients + steps (`describeDish`); (2) the prompt = name + that description + a meal-aware framing hint + the fixed house style — home cooking in warm window light, artisan ceramic on worn wood or crumpled linen, and on purpose *not* studio-perfect (uneven cuts, a drip or crumb on the rim, a serving spoon or loose napkin, slightly off-centre; Miguel 2026-10-08: "en la realidad nada es tan perfecto"); (3) the image provider generates it — `RECIPE_IMAGE_PROVIDER=auto` (default) tries AiKit Imagen-fal and falls back to OpenAI `gpt-image-1` (quality medium, 1536×1024 centre-cropped to 4:3), because since 2026-10-08 AiKit answers 403 `API_KEY_ROUTE_NOT_ALLOWED` to API keys; `aikit` / `openai` pin one; (4) Claude Sonnet checks the result (`checkRecipeImage`: right dish? house style — ceramic on wood/linen/cream, warm light, no text/logos/people?); a miss gets **one more try**; it keeps the first that passes, else the first that at least shows the right dish, else saves nothing. **Automatic on create and import**: after `POST /recipes` (when no photo, or a pasted external URL) and after every `saveExtractedRecipe` (URL, WhatsApp photo, assistant), fire-and-forget, cost billed to the author, skipped when the author's monthly AI allowance is spent or no provider is configured. It only ever replaces an image that isn't ours (null or a source og:image/YouTube thumbnail) — never a user upload, a generated photo or a seed JPG — and re-reads the row before writing, so a photo uploaded meanwhile wins. Catalogue audit: `services/recipeImageAudit.ts` checks every recipe's photo (right dish, house style, ≥ 1000 px wide); `scripts/auditRecipeImages.ts` runs it read-only from a laptop, and `cli(['--fix'])` inside the ona-api container regenerates the failing/missing/low-res ones onto the volume (2026-10-08 run: 35 ok, 43 wrong dish or off-style, 3 without photo).
- `POST /recipes/:id/regenerate-image` (auth, author or admin) — the house photo above on demand (describe → generate → check → one retry); 502 "La imagen no ha salido bien" when no attempt shows the dish. Pipes the PNG through sharp (1200 px wide, JPEG q85 + mozjpeg) and writes to `${IMAGE_STORAGE_DIR}/<recipeId>.jpg`; updates `recipes.image_url` to `${IMAGE_PUBLIC_URL_BASE}/<recipeId>.jpg`. Per-user monthly quota (`IMAGE_GEN_MONTHLY_LIMIT`, default 20) tracked atomically on `users.image_gen_count` + `users.image_gen_month_key`: a single conditional UPDATE bumps the counter only if the user is under the cap and the month matches; mismatched month → reset to 1; cap reached → 429 with `{ quota: { used, limit, monthKey } }` and no AiKit call. Failed generations refund the slot. Other users' recipes return 403 (admins may regenerate any); no image provider configured returns 503. Frontend (`useRegenerateRecipeImage`) renders a "Regenerar imagen" button on the author-side detail page and an "Imagen" section in `/recipes/[id]/edit`; both show a "(X/20 este mes)" counter and append `?v=<updatedAt>` to the hero src to bust the long-cached browser image after each regen

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)
- v1 of the URL importer cannot process YouTube videos that lack both captions and a recipe-bearing description (no Whisper / yt-dlp / Gemini fallback yet)
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

## Source

- [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts)
- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts)
- [apps/api/src/services/recipeUrlExtractor.ts](../apps/api/src/services/recipeUrlExtractor.ts) — URL extraction orchestrator (article + YouTube)
- [apps/api/src/services/recipeImport.ts](../apps/api/src/services/recipeImport.ts) — shared soft-lint persist for imports (URL route, `import_recipe_from_url` skill, WhatsApp photos)
- [apps/api/src/services/net/publicFetch.ts](../apps/api/src/services/net/publicFetch.ts) — SSRF-safe page download for user-supplied URLs (`fetchPublicPage`, `assertPublicUrl`, `isPrivateAddress`)
- [apps/api/src/services/sources/article.ts](../apps/api/src/services/sources/article.ts) — JSON-LD parser + Readability fallback
- [apps/api/src/services/sources/youtube.ts](../apps/api/src/services/sources/youtube.ts) — video id parser, transcript fetch, prompt composer
- [apps/api/src/services/sources/sourceType.ts](../apps/api/src/services/sources/sourceType.ts) — URL → 'youtube' | 'article'
- [apps/web/src/components/recipes/UrlRecipeImport.tsx](../apps/web/src/components/recipes/UrlRecipeImport.tsx) — URL input UI in `/recipes/new`
- [apps/api/src/services/recipeVisibility.ts](../apps/api/src/services/recipeVisibility.ts) — who can see which recipe (`visibleAuthorIds`, `visibleRecipeWhere`, `canViewRecipe`); used by the generator, menu routes, pantry matcher, advisor and assistant skills
- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — lint validator (new)
- [apps/api/scripts/tagRecipesByType.ts](../apps/api/scripts/tagRecipesByType.ts) — deterministic backfill that adds the `MEAL_TYPE_TAGS` taxonomy (`cremas | legumbres | pizza | asiatico | mediterraneo | ensalada | parrilla | batch-cooking | pasta | arroz`) onto system recipes by name + ingredient heuristics. Runs dry-run by default; `--execute` commits. Idempotent — re-running on already-tagged rows is a no-op. The matcher's `pinnedType` predicate reads these tags so the "Fijar tipo" menu UX has something to filter against.
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — USDA-backed auto-create + Levenshtein dedupe (new)
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /ingredients/suggest`, `POST /ingredients/auto-create`
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — open ingredient picker + auto-create modal (new). Accepts a `defaultText` prop so unmatched extractor output (photo / URL) is prefilled into the input instead of falling back to the empty placeholder, letting the user confirm via "Crear nuevo" or refine the search.
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient` (new)
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — regenerated catalog
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/api/src/services/recipeImageGenerator.ts](../apps/api/src/services/recipeImageGenerator.ts) — prompt builder + image providers (AiKit Imagen-fal, OpenAI gpt-image fallback) + sharp pipeline
- [apps/api/src/services/recipeHouseImage.ts](../apps/api/src/services/recipeHouseImage.ts), [recipeImageCheck.ts](../apps/api/src/services/recipeImageCheck.ts), [recipeImageAudit.ts](../apps/api/src/services/recipeImageAudit.ts) — house photo on create/import (describe → generate → vision check → retry), the check itself, and the catalogue audit; [scripts/auditRecipeImages.ts](../apps/api/scripts/auditRecipeImages.ts) runs the audit read-only
- [apps/api/scripts/generateRecipeImages.ts](../apps/api/scripts/generateRecipeImages.ts) — bulk hero-image regenerator for the seed (writes slug-keyed JPGs to `apps/web/public/images/recipes/`); flags `--dry-run`, `--only=<slug,…>`, `--include-user`, `--concurrency=N`, `--aspect=4:3|1:1|3:4`, `--skip-existing`, `--no-db`
- [apps/api/scripts/handAuthoredRecipes.ts](../apps/api/scripts/handAuthoredRecipes.ts) — hand-authored bodies for the seed placeholders; appends to `output/regen-passed.jsonl`
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — JSONL → DB applier with lint + auto-create + `--soft-lint` escape hatch
- [apps/api/scripts/dedupSystemRecipes.ts](../apps/api/scripts/dedupSystemRecipes.ts), [linkSeedRecipeImages.ts](../apps/api/scripts/linkSeedRecipeImages.ts), [fillSeedCatalogGap.ts](../apps/api/scripts/fillSeedCatalogGap.ts), [bulkInsertIngredients.ts](../apps/api/scripts/bulkInsertIngredients.ts), [recomputeRecipeNutrition.ts](../apps/api/scripts/recomputeRecipeNutrition.ts), [insertMappedIngredients.ts](../apps/api/scripts/insertMappedIngredients.ts) — one-off prod maintenance scripts
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts) — `useRegenerateRecipeImage(recipeId, userId)` mutation
- [apps/web/src/hooks/useUser.ts](../apps/web/src/hooks/useUser.ts) — `useUser(id)` returns the live `imageGenQuota` for the regenerate counters
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — catalogue page; [packages/shared/src/utils/catalog.ts](../packages/shared/src/utils/catalog.ts) — season badge, `recipeMinutes`, `filterCatalogRecipes`, `pickFeaturedRecipes`
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [apps/web/src/components/recipes/detail/](../apps/web/src/components/recipes/detail/) — detail blocks ([`ServingsScaler`](../apps/web/src/components/recipes/ServingsScaler.tsx): `inline` in cook mode, `pill` on the detail): `RecipeTabs` (tablist), `RecipeActionBar` (sticky cook bar, portalled to `<body>`), `IngredientsSection` / `StepsSection` (`plain` variant on the private detail, `chapter` on the public page), `NutritionCard`
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
