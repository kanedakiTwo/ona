# Recipes

Recipe catalog, recipe detail, and the data needed to actually cook a recipe.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [El catálogo y la página de receta](./recipes-catalogo.md) — el catálogo público, orden, retiradas y borradores, la página de receta, vistas previas de enlaces, colecciones, «con lo que tengo», «este mes», de dónde viene una receta y las bases de batch cooking.
- [Crear y editar recetas, la API y el escritorio](./recipes-editar.md) — ingredientes en una línea y pasos pegados, lo que pueden editar los admins, cómo se ve en pantalla (también en escritorio) y los endpoints.

## Recipe Model

Each recipe has:
- `name` — required, text
- `imageUrl` — optional
- `servings` — required, positive integer; the canonical number of diners the listed quantities cover
- `yield` — optional human-readable string (e.g. "12 albóndigas", "1 L de salsa")
- `prepTime`, `cookTime`, `activeTime` — minutes (integer, optional, editable). `activeTime` is the hands-on time («de trabajo»); the menu's time limits use it (else `prepTime`) and `totalTime` (else prep + cook). System recipes get the empty ones filled on boot (PRO-138, see [Menus](./menus.md) → Time to cook)
- `totalTime` — minutes, derived by the API on save: sum of `step.durationMin` if all steps have it, else `prepTime + cookTime`. **System recipes (PRO-284, 2026-10-21):** on every boot the total follows the overlap rule — prep + cook − the prep that can be done while a step goes by itself (oven, low heat, pressure cooker, boiling with minutes, resting; up to half the prep, never more than those steps' minutes) — never below the cook time or those steps' minutes, never above the total it had; `cookTime` is never touched. Their prep was also made realistic once (× 0.8, for someone who cooks at home with ease; internal tag `tiempos-pro284`) and the hands-on time drops by the same amount, never above the total. Example: a 40-min oven with 20 of prep → prep 16, total 48. See [Menus](./menus.md) → Time to cook
- `difficulty` — enum `easy | medium | hard`
- `meals` — array of `breakfast | lunch | dinner | snack`
- `seasons` — array of `spring | summer | autumn | winter` (empty = all seasons)
- `equipment` — string array of tools required (e.g. "horno", "procesador", "batidora")
- `allergens` — string array (auto-aggregated from ingredients on save; see [Nutrition](./nutrition.md)). The detail payload (`GET /recipes/:id`, the ficha's «Alérgenos») returns `effectiveAllergens`: the stored union **plus** what the ingredient names say today (`inferAllergenTagsFromName`) — additive, computed on read, no DB write (PRO-61: «Pizza de colores» with «Harina de fuerza» and «Arroz tres delicias» with «Salsa de soja» showed no gluten). The milk tag (`lactosa`, shown as «leche») also comes from cheeses called only by their name (gouda, emmental, brie, camembert, cheddar, edam, gorgonzola, roquefort, ricotta, burrata, provolone, pecorino, grana padano, manchego…), kéfir (not «kéfir de agua»), ghee, «mantequilla clarificada», suero de leche, caseína and bechamel (PRO-332, whole word; «pisto manchego» and plant drinks «leche de coco/avena…» are not milk). A boot step (`applyNameAllergenTags`, `allergenBackfill.ts`) adds `lactosa` to the stored `ingredients.allergen_tags` of those names and to the stored `recipes.allergens` of every recipe that uses them, additive only, so Mimo and the lists that read the stored union agree with the ficha (on the 2026-10-23 staging catalogue: 4 recipes use one of those names, all already «leche» through «queso…»)
- `notes`, `tips`, `substitutions`, `storage` — long-form text, optional
- `freezable` (boolean) and `fridgeDays` (whole days, 1–30) — storage seals (PRO-372, migration `0097_recipe_storage_seals`, both nullable; null = no data). On the detail payload only when set. The ficha shows them in «Notas», under «Conservación» (next to `storage`, which keeps its text): «Se puede congelar» / «No se congela» and «Aguanta N días en nevera» («1 día»); each seal only when there is data, and «Conservación» shows with just the seals. Catalogue recipes get them from Cocina's batch or the house rewrite, and the ones already in the catalogue from a background fill (see [Catalog import](./catalog-import.md) → Storage seals). Users' recipes don't have them yet (no field in the form). Not used by the menu yet: keeping a fridge táper within its days is another task. Tests: `e2e/recipe-storage-seals.spec.ts` (390×844), `catalogImport.test.ts`, `catalogStorageLabels.test.ts`
- `advancePrep` — «preparativos con antelación» (PRO-220, migration `0077_recipe_advance_prep`): up to 5 `{ text, hoursBefore }` (3–140 chars, 0 < h ≤ 72), e.g. «Saca el filete del frigorífico» · 1,5; «Pon los garbanzos en remojo» · 10. Filled by Cocina (COC-12) through `POST`/`PUT /recipes`; a `PUT` without the field keeps what the recipe had (the edit form doesn't show it yet). On the detail payload when non-empty; copied by «Añadir a mis recetas». They become prep alerts without the household's prep habits — see [Notifications](./notifications.md)
- `nutritionPerServing` — cached object: `{ kcal, proteinG, carbsG, fatG, fiberG, saltG }`. Computed when the recipe is saved
- `nutritionIncomplete` — boolean (`recipes.nutrition_incomplete`, migration 0066, PRO-176): an ingredient that matters couldn't be counted (see [Nutrition](./nutrition.md) → Incomplete nutrition). Set on save and recomputed on every boot. The ficha then shows **no figures**: no «kcal por ración» in the desktop meta, and the Nutrición tab/block reads «Aún no podemos calcular la nutrición de esta receta.» (`NutritionUnavailable`). Test: `e2e/recipe-nutrition-incomplete.spec.ts` (390×844)
- `tags` — public-facing string array, normalized (no internal labels, no `meal`/`difficulty` duplicates)
- `dishTypes` — the recipe's **dish types** (`recipes.dish_types`, `DISH_TYPES` keys in `@ona/shared`: legumbres, cremas-sopas, guisos, pescado, pollo, carne, huevos, plancha-brasa, pasta, arroz, pizza, bocadillos, ensaladas, verduras, ceviche, carpaccio-tartar, italiano, japones, chino-wok, indio, mexicano, sudamericano, oriente-medio, tostadas, cereales-avena, yogur-fruta, dulce-finde; each a **dish** or a **broad** type), for the household's **semana tipo** ([Menus](./menus.md)). Set by fixed rules (`dishTypesOf`: name, tags and the three heaviest ingredients that aren't salt, oil, water, broth…; soja and tofu are not a pulse) every time a recipe is saved or imported (`persistRecipe`), when Mimo renames one, copied with a catalogue recipe, and on boot and at the end of `db:seed` for every recipe still null (`applyRecipeDishTypes`, logs «[dish-types] N recetas…»). A row still null gets them computed on read by the menu. Not shown in the UI yet; a wrong one is fixed by Cocina when editing (phase 2+). Tests: `weekType.test.ts` (seed recipes)
- `internalTags` — string array hidden from public UI (e.g. `compartida`, `auto-extracted`, `from-url`, `tiempos-pro284`). A `PUT /recipes/:id` without the field keeps the recipe's (PRO-284; until 2026-10-21 every save from the edit form wiped them; the form sent `[]` from the schema default until PRO-1259)
- `sourceUrl` — origin URL when imported from an article / YouTube video (null otherwise)
- `sourceType` — provenance enum: `manual | image | article | youtube` (null for legacy seeded rows)
- `sourceCredit` — read-only, detail payload only: where a catalogue recipe comes from, as the ficha shows it (D-067; `null` when there is nothing to credit)
- `bases` — read-only, detail payload only: the bases the recipe uses, `{ id, name, servings }` (PRO-373, from `recipe_bases`; absent when none)
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
- `optional` — boolean. Set from the recipe forms by writing «(opcional)» in the ingredient's line (PRO-1115). When true, the recipe detail renders an "opcional" badge inline and the shopping-list aggregator skips the row when scaling
- `role` — `essential` | `secondary` | null (unmarked; `recipe_ingredients.role`, migration `0107_ingredient_roles`, PRO-1105). Essential: without it, it isn't that dish; secondary: it can be left out. Marked by Cocina (the office) on catalogue recipes only, through `PUT /admin/recipes/:id/ingredient-roles` with `x-cocina-token` or an admin JWT, or in its batch files (`imprescindible`); while unmarked an automatic rule decides (`autoIngredientRole`: optional / al gusto / pizca → secondary; protein, cereal, legume → essential; else 15 % of the weighable grams). An optional line is always secondary. Not in the recipe form: an edit keeps the marks (`carryIngredientMarks`) and «Añadir a mis recetas» copies them. Used by «Cocinar ahora» ([Cook now](./cook-now.md))
- `substituteIngredientIds` — catalogue ingredient ids that can stand in for it (`substitute_ingredient_ids`, uuid[], default empty, up to 5; Cocina's batch `sustitutos`); not foreign keys
- `note` — optional free text («en lomos», «picada»). Editable from `/recipes/new` and `/recipes/[id]/edit`: what follows the first comma in the ingredient's line, or what's between brackets («200 g de bacalao, desalado», PRO-109, PRO-1115; trimmed; removing it clears the note on save). The detail shows it next to the ingredient. Tests: `recipeFormContract.test.ts`, `e2e/recipe-ingredient-note.spec.ts`

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
- **The note's countable amount scales too** (PRO-184, Laura 2026-10-16: «Para 1 ración · Ajo · 6 dientes, laminados · 6 g»): when an ingredient's note starts with a number and a unit you count (diente, hoja, rama, ramita, hebra, rodaja, loncha, trozo, tira, cabeza, vaina, guindilla, cayena, pieza, unidad, bola, gajo, tallo, manojo — singular or plural), that number is multiplied by the same factor and rounded to halves, never below ½, with singular/plural fixed («6 dientes, laminados» for 4 → «1½ dientes, laminados» for 1; «2 hojas» → «½ hoja»). Any other note («laminados», «200 g de…», «2 latas») is shown as written. Done in `scaleRecipe` (`?servings=N`) with `scaleIngredientNote` (`@ona/shared`), so the detail and cooking mode show it (`ingredientNoteScaling.test.ts`, `e2e/recipe-note-servings.spec.ts`). Mimo's «la herramienta de raciones me devolvió otra receta» is PRO-183
- Mass and volume units round to a culinary-friendly precision (1 g, 5 g, 25 g, 50 g bands depending on magnitude)
- Step text references via `ingredientRefs` are recomputed at the same scale

## Course classification (`recipes.course`)

Optional enum tagging the recipe's role in a multi-dish meal: `'starter' | 'main' | 'dessert' | null`. Spanish labels via `COURSE_LABELS` in `@ona/shared` (`Entrante / Principal / Postre`).

`null` means "versatile" — the menu generator treats null-tagged recipes as valid stand-alone dishes for single-dish slots. The matcher uses this field when a slot is configured with 2 or 3 dishes (see [`menus.md`](./menus.md) "Multi-dish slots").

Population:
- Seed catalogue + existing user recipes: one-shot LLM script `pnpm --filter @ona/api course:populate` (→ JSONL → optional manual review → `course:apply`). Same two-step pattern as `prep-requirements:populate`. Source: `apps/api/scripts/populateRecipeCourses.ts`.
- New recipes: optional dropdown in `/recipes/new` and `/recipes/[id]/edit` (defaults to "Sin clasificar (auto)" = `null`).

## Constraints

- `name` and `servings` are required; everything else is optional but `difficulty` defaults to `medium` if absent
- Saving a recipe **fails** if the lint validator finds issues (see [Recipe Quality](./recipe-quality.md))
- `nutritionPerServing` and `allergens` are recomputed automatically on every recipe save — never edited by hand
- **Ingredient names on screen (detail, shopping list, pantry, staples)** read as a sentence — «Aceite de oliva virgen», «Pimentón dulce» — via `ingredientDisplayName` (`packages/shared/src/utils/shopFormat.ts`): only the first letter is raised and catalogue accents are restored; brands/acronyms the user typed («Kerrygold», «AOVE») stay. Display-only; stored names are untouched (PRO-02).
- `totalTime` is read-only on the client; clients can edit `prepTime`/`cookTime`/`activeTime`
- Schema migration is destructive (wipe + reseed acceptable; no production data preservation requirement)
- **Drafts** (PRO-154): `visibleRecipeWhere` also requires `status = 'published'`, so every path below skips catalogue drafts; `GET /recipes` filters it explicitly; `GET /recipes/:id` and `POST /recipes/:id/copy` answer 404 for a draft unless the caller is an admin
- **Recipe visibility** (`services/recipeVisibility.ts`): a user can see, be served, or have Mimoia pick the system catalogue (`authorId IS NULL`) + their own recipes + recipes authored by members of their primary household. Another user's private recipe never reaches them through the menu generator, slot regeneration, manual slot pick (`404`), cook-from-pantry, the nutrition advisor or any assistant skill (web chat + WhatsApp). `GET /recipes/:id` returns `404` for an invisible recipe. Before 2026-10-07 the generator and the assistant loaded the whole `recipes` table. Guarded by `recipeVisibilityCoverage.test.ts` (no unscoped read of `recipes` in those files)
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
- [Catalogue import](./catalog-import.md) — batch import, drafts and publishing, «deseos del catálogo»

## Source

- [apps/web/src/lib/menuReturn.ts](../apps/web/src/lib/menuReturn.ts) — `?desde=menu` on recipes opened from the menu, the detail's back target, `/menu`'s `?day=` (tested in `apps/api/src/tests/menuReturn.test.ts`)
- [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts)
- [apps/api/src/services/catalogImport.ts](../apps/api/src/services/catalogImport.ts) — `catalogSourceCredit`: the ficha's credit line from `catalog_source` (D-067)
- [packages/shared/src/utils/ingredientNote.ts](../packages/shared/src/utils/ingredientNote.ts) — scales the countable amount a note starts with (PRO-184)
- [apps/api/src/services/glutenFreeCharcuterie.ts](../apps/api/src/services/glutenFreeCharcuterie.ts) — `dietNotices` for a coeliac household (PRO-196, PRO-1063)
- [apps/api/src/services/recipeBases.ts](../apps/api/src/services/recipeBases.ts) — `loadRecipeBaseUses`: the ficha's «Usa: …» (PRO-373); [packages/shared/src/featuredRecipes.ts](../packages/shared/src/featuredRecipes.ts) — `isBaseRecipe`
- [apps/web/src/components/recipes/DietNotices.tsx](../apps/web/src/components/recipes/DietNotices.tsx) — the notice above the ingredients
- [apps/api/src/middleware/recipeId.ts](../apps/api/src/middleware/recipeId.ts) — `requireRecipeId`: a malformed recipe id is a 404 before the database (PRO-181)
- [apps/api/src/services/recipeVisibility.ts](../apps/api/src/services/recipeVisibility.ts) — who can see which recipe (`visibleAuthorIds`, `visibleRecipeWhere`, `canViewRecipe`); used by the generator, menu routes, pantry matcher, advisor and assistant skills
- [apps/api/src/services/withWhatIHave.ts](../apps/api/src/services/withWhatIHave.ts) — «Con lo que tengo» search (`rankWithWhatIHave`, basics, `loadUserRestrictions` shared with the assistant); picker in `components/recipes/WithWhatIHavePicker.tsx`; tests `withWhatIHave.test.ts` + `e2e/recipes-with-what-i-have.spec.ts`
- [apps/api/src/services/recipeLint.ts](../apps/api/src/services/recipeLint.ts) — lint validator (new)
- [apps/api/src/services/dishTypes.ts](../apps/api/src/services/dishTypes.ts) · [packages/shared/src/constants/dishTypes.ts](../packages/shared/src/constants/dishTypes.ts) — dish types (`dishTypesOf`, `DISH_TYPES`, D-182; replaced `scripts/tagRecipesByType.ts` and `MEAL_TYPE_TAGS`)
- [apps/api/src/services/recipeScaler.ts](../apps/api/src/services/recipeScaler.ts) — quantity scaling + culinary rounding (new)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes`, `recipe_ingredients`, `recipe_steps`, `ingredients`, `ingredient_nutrition`
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — catalogue page; [packages/shared/src/utils/catalog.ts](../packages/shared/src/utils/catalog.ts) — season badge, `recipeMinutes`, `filterCatalogRecipes`, `pickFeaturedRecipes`
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx) — the one recipe page (signed in and out); [layout.tsx](../apps/web/src/app/recipes/[id]/layout.tsx) — link-preview metadata ([lib/recipeMetadata.ts](../apps/web/src/lib/recipeMetadata.ts))
- [apps/web/src/components/shared/RootShell.tsx](../apps/web/src/components/shared/RootShell.tsx) + [apps/web/src/lib/routeAccess.ts](../apps/web/src/lib/routeAccess.ts) + [apps/web/src/lib/recipeShell.ts](../apps/web/src/lib/recipeShell.ts) — public chrome for signed-out visitors on `/recipes`, `/recipes/[id]` and `/cook`; [RecipeWaitlistCta.tsx](../apps/web/src/components/recipes/RecipeWaitlistCta.tsx) — the waitlist blocks (recipe page and catalogue)
- [apps/api/src/services/catalogCollections.ts](../apps/api/src/services/catalogCollections.ts) + [routes/catalogCollections.ts](../apps/api/src/routes/catalogCollections.ts) — collections (`catalog_collections`, migration 0098); [CollectionsRow.tsx](../apps/web/src/components/recipes/CollectionsRow.tsx), [app/recipes/coleccion/[slug]/page.tsx](../apps/web/src/app/recipes/coleccion/[slug]/page.tsx), [hooks/useCatalogCollections.ts](../apps/web/src/hooks/useCatalogCollections.ts)
- [apps/web/next.config.ts](../apps/web/next.config.ts) — `/recipes-ona` and `/recipes-ona/[id]` permanent redirects
- [apps/web/src/components/recipes/](../apps/web/src/components/recipes/)
- [packages/shared/src/units/ingredientLine.ts](../packages/shared/src/units/ingredientLine.ts) — `parseIngredientLine`, `ingredientLineToRow`, `formatIngredientLine` (PRO-1115); [packages/shared/src/utils/splitSteps.ts](../packages/shared/src/utils/splitSteps.ts) — `splitSteps`; [apps/api/src/services/ingredientLineMatch.ts](../apps/api/src/services/ingredientLineMatch.ts) — `matchIngredientName` (`/ingredients/match-lines`, `/ingredients/ensure` in `routes/ingredients.ts`); [components/recipes/form/RecipeTextFields.tsx](../apps/web/src/components/recipes/form/RecipeTextFields.tsx), [hooks/useIngredientLines.ts](../apps/web/src/hooks/useIngredientLines.ts), [lib/ingredientLines.ts](../apps/web/src/lib/ingredientLines.ts) — the two boxes of the forms
- [apps/web/src/components/recipes/detail/](../apps/web/src/components/recipes/detail/) — detail blocks ([`ServingsScaler`](../apps/web/src/components/recipes/ServingsScaler.tsx): `inline` in cook mode, `pill` on the detail): `RecipeTabs` (tablist), `RecipeActionBar` (sticky cook bar, portalled to `<body>`), `IngredientsSection` / `StepsSection` (`plain` variant on the detail), `NutritionCard`
- [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts)
- [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts)
