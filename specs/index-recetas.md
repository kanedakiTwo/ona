# Specs Index · Recetas, cocina y catálogo

> Parte de [Specs Index](./index.md) (la portada lista todas las partes): recetarios, cocinar con la despensa, despensa, notas, registro de cocina, memoria, fotos, importar, imágenes, recetas, cocinar ahora, receta del día, modo cocina, ingredientes, nutrición, calidad e importación del catálogo.

## [Cookbooks](./cookbooks.md)

Household-shared named recipe collections — "Favoritos de Sara", "Para diabéticos", "Recetas de mi madre". `cookbooks(id, household_id, name, description?, emoji?, created_at, updated_at)` + `cookbook_recipes(id, cookbook_id, recipe_id, added_at)` join with `UNIQUE(cookbook_id, recipe_id)` for idempotent add. REST: list / detail / CRUD on cookbooks + idempotent join mutations (`POST /cookbooks/:id/recipes/:recipeId`, `DELETE …`) + reverse lookup `GET /recipes/:id/cookbooks`. Pure name/emoji/description validators are unit-tested (9 cases). Frontend: `/profile/cookbooks` list + `/cookbooks/[id]` detail with inline editor + `<AddToCookbookButton />` bottom-sheet on `/recipes/[id]`.

**Source**: `apps/api/src/db/schema.ts` (`cookbooks`, `cookbookRecipes`), `apps/api/src/db/migrations/0017_pr8a_cookbooks.sql`, `apps/api/src/services/cookbooksStore.ts`, `apps/api/src/routes/cookbooks.ts`, `apps/api/src/tests/cookbooksValidate.test.ts`, `apps/web/src/hooks/useCookbooks.ts`, `apps/web/src/app/recipes/recetarios/page.tsx`, `apps/web/src/app/cookbooks/[id]/page.tsx`, `apps/web/src/components/recipes/AddToCookbookButton.tsx`

---

## [Cook from Pantry](./cook-from-pantry.md)

"Lo que puedes cocinar con lo que tienes" — PR 12. Ranks every catalogue recipe by what fraction of its required ingredients the household has at home (PR 11 pantry). Pure scorer `scoreRecipeAgainstPantry(ings, pantry)` exported + unit-tested (6 cases): coverage = matched / required, optional ingredients excluded from both sides, ties broken by matchedCount then totalRequired. REST: `GET /recipes/match-pantry?limit=N` (auth-only, default 3, max 20). Frontend: `<PantryMatchCard />` ink-on-cream card on `/menu` below the day's meals with up to 3 recipes + thumbnail + `<matched>/<total>` + coverage percentage. Hides itself when the pantry is empty or no recipe matches. **Retired (PRO-1108, 2026-11-11):** card, route and scorer gone; «Con lo que tienes» lives in the «Cocinar» tab (PRO-1107), on the «Cocinar ahora» search ([Cook now](./cook-now.md)).

**Source**: none left (successor: `apps/api/src/services/cookNow/`, `apps/web/src/app/cocinar/page.tsx`, `apps/web/src/components/cocinar/PantryMatchCard.tsx`)

---

## [Pantry](./pantry.md)

Household-shared register of "what's at home" — real quantities + units + optional expiry per item. Distinct from the legacy `shopping_lists.items.inStock` boolean (which only said yes/no). `pantry_items(id, household_id, ingredient_id?, name, quantity, unit, expires_at?, location, stored_at?, last_updated_at, created_at)` (nevera / congelador / despensa, grouped by place in «Tu despensa», `GET /pantry?location=`, monthly freezer review «¿Lo meto en el menú?» + `plan_freezer_items`, PRO-228) with a **partial unique index** on `(household_id, ingredient_id) WHERE ingredient_id IS NOT NULL` so catalog rows can't duplicate. REST: `GET /pantry`, `POST /pantry` (idempotent merge when `ingredientId` is set), `PATCH /pantry/:id`, `DELETE /pantry/:id`. **Auto-decrement**: `POST /cook-logs` resolves `scaleFactor = cookedServings / recipe.servings`, then deducts `recipeIngredient.quantity × scaleFactor` from every matching pantry row (same `ingredient_id`, same `unit`). Cross-unit conversion deferred. The decrement is best-effort — never blocks the cook-log insert; the response includes `pantry: { updatedRowIds, skipped }`. Pure `applyPantryDeduct` reducer is unit-tested (6 cases). Frontend: «Tu despensa» in the «Cocinar» tab (`/cocinar#despensa`, `components/pantry/PantryManager.tsx`; `/profile/pantry` redirects there since PRO-1107) with inline-edit qty + expiry pills (red < 0d, terracotta ≤ 3d).

**Source**: `apps/api/src/db/schema.ts` (`pantryItems`), `apps/api/src/db/migrations/0016_pr11_pantry_items.sql`, `apps/api/src/services/pantryStore.ts`, `apps/api/src/routes/pantry.ts`, `apps/api/src/routes/cookLogs.ts` (calls `decrementPantryForRecipe`), `apps/api/src/tests/pantryDeduct.test.ts`, `apps/web/src/hooks/usePantry.ts`, `apps/web/src/components/pantry/PantryManager.tsx`

---

## [Recipe Notes](./recipe-notes.md)

Per-household consumer annotation on a recipe: 1-5 star rating + free-form notes + free-form substitutions + **custom tags** (PR 8B). Distinct from the author's `recipes.notes` — this is what you and your household think about the dish ("le va un toque de comino"; "sin cebolla, con puerro"; tags: vegano, sin gluten, rápido). One row per `(household_id, recipe_id)`; any member can read or write; last-write-wins on concurrent edits. REST: `GET /recipes/:recipeId/notes`, `PUT /recipes/:recipeId/notes` with partial `{ notes?, rating?, substitutions?, customTags? }` body (undefined preserves, null clears, strings trim+cap at 1000 chars; `customTags` is lowercased + deduped + capped at 10 entries × 30 chars). New `GET /custom-tags` returns `[{ tag, count }]` for the household. DB enforces rating ∈ {1..5} via CHECK constraint. Pure `applyNotesPatch` + `validateRating` + `sanitizeCustomTags` helpers are unit-tested. Frontend: `RecipeNotesSection` card on `/recipes/[id]` with stars + inline-edit text fields + chip-input for tags.

**Source**: `apps/api/src/db/schema.ts` (`recipeNotes`), `apps/api/src/db/migrations/0015_pr7_recipe_notes.sql` + `0018_pr8b_recipe_notes_custom_tags.sql`, `apps/api/src/services/recipeNotesStore.ts`, `apps/api/src/routes/recipeNotes.ts`, `apps/api/src/tests/recipeNotesPatch.test.ts` + `customTagsSanitize.test.ts`, `apps/web/src/hooks/useRecipeNotes.ts`, `apps/web/src/components/recipes/RecipeNotesSection.tsx`, `apps/web/src/app/recipes/[id]/page.tsx`

---

## [Cook Log](./cook-log.md)

Household-scoped record of "we actually cooked this." Feeds the times-cooked counter, the last-cooked date, and the adherence analytics (planeaste 21 / cocinaste 15) for upcoming PRs. `cook_logs(id, user_id, household_id, recipe_id, menu_id?, day_index?, meal?, cooked_at, duration_min?, notes?, created_at)` — append-only; corrections via DELETE + INSERT. REST: `POST /cook-logs`, `GET /cook-logs`, `GET /cook-logs/recipe/:recipeId` (returns `{ count, lastCookedAt }`), `DELETE /cook-logs/:id`. Frontend: `CookedBadge` component (pill on recipe detail meta row, button on cook-mode section; "Marcar como cocinada" in each /menu meal sheet); `useCookLogs` TanStack hooks. Pure `summarizeCookLog` reducer kept as a top-level export so the unit suite hits the same code path.

**Source**: `apps/api/src/db/schema.ts` (`cookLogs`), `apps/api/src/db/migrations/0013_pr6_cook_logs.sql`, `apps/api/src/services/cookLogStore.ts`, `apps/api/src/routes/cookLogs.ts`, `apps/api/src/tests/cookLogStats.test.ts`, `apps/web/src/hooks/useCookLogs.ts`, `apps/web/src/components/recipes/CookedBadge.tsx`, `apps/web/src/app/recipes/[id]/page.tsx`, `apps/web/src/components/menu/MealOptions.tsx`, `apps/web/e2e/cook-log.spec.ts`

---

## [User Memory](./user-memory.md)

Typed long-term storage of user preferences (dislikes, equipment, time-available per weekday, weekly budget, cuisine bias, cooking skill, meal times, free-form notes). Stable key registry + per-key Zod schema in `@ona/shared`. `user_memories` table, one row per (user_id, key). Advisor injects a Spanish-language digest into every system prompt; `update_memory` skill lets the assistant write inferred facts mid-conversation ("recuerda que no me gusta el cilantro"). REST: `GET /memory`, `PATCH /memory { key, value | facts: [...] }`, `DELETE /memory/:key`. Profile sub-page `/profile/memoria` lists every fact with source badge (Tú / Asistente / Onboarding) — since PRO-318 it is «Editar mis datos uno a uno», linked from «Tu ficha» (no «Memoria» card in Perfil). 19 contract tests.

**Source**: `packages/shared/src/types/userMemory.ts`, `apps/api/src/services/userMemoryStore.ts`, `apps/api/src/routes/memory.ts`, `apps/api/src/services/assistant/contextLoader.ts`, `apps/web/src/hooks/useUserMemory.ts`, `apps/web/src/app/profile/memoria/page.tsx`

---

## [Recipe Photos](./recipe-photos.md)

Household-shared photo gallery per recipe (PR 8C). Distinct from `recipes.image_url` (the author's hero) — this is the consumer's "look how it came out" wall. `recipe_photos(id, recipe_id, household_id, uploaded_by_user_id?, image_url, caption?, created_at)` — one JPEG per row, file keyed by row id, stored on the Railway volume via the existing `IMAGE_STORAGE_DIR` + `IMAGE_PUBLIC_URL_BASE` env vars. Sharp pipeline: `rotate()` (EXIF) → resize to 1600px wide → JPEG q85. REST: `GET /recipes/:recipeId/photos`, `POST /recipes/:recipeId/photos` (multipart, ≤ 8 MB, accepts jpeg/png/webp/heic/heif), `DELETE /recipes/:recipeId/photos/:photoId`. Frontend: `<RecipePhotoGallery />` on `/recipes/[id]` — 3-col thumbnail grid + lightbox + inline upload with optional caption + per-thumbnail delete. Any household member can read or write.

**Source**: `apps/api/src/db/schema.ts` (`recipePhotos`), `apps/api/src/db/migrations/0019_pr8c_recipe_photos.sql`, `apps/api/src/services/recipePhotosStore.ts`, `apps/api/src/routes/recipePhotos.ts`, `apps/web/src/hooks/useRecipePhotos.ts`, `apps/web/src/components/recipes/RecipePhotoGallery.tsx`, `apps/web/src/app/recipes/[id]/page.tsx`

---

## [Recipe Import](./recipe-import.md)

Where recipes come from: system/shared vs user recipes, copies ("Añadir a mis recetas", `copied-from-catalog`), seed pipeline (`seed/recipes.ts` shells + `handAuthoredRecipes.ts` → `regen-passed.jsonl` → `apply:recipes`, `--soft-lint`, `--auto-create-missing`), prod maintenance one-offs (`dedupSystemRecipes`, `linkSeedRecipeImages`, `fillSeedCatalogGap`, `bulkInsertIngredients`, `recomputeRecipeNutrition`, `insertMappedIngredients`), AI extraction from photo (ExtractedRecipe draft, no auto-persist), from URL (YouTube or article: JSON-LD, Readability, Claude, Innertube + watch-page fallback, og:image cover; Instagram / TikTok post caption via og:description, else «mándame una captura» `NEEDS_SCREENSHOT`), SSRF guard `publicFetch`, catalogue «Ver fuente» links from the Notion `Link` column (`applyCatalogSourceLinks`, runs after `db:migrate` and `db:seed`), shared import persist `recipeImport.ts` (URL route, `import_recipe_from_url` skill, WhatsApp photos), ingredient resolution cascade (token-set match, LLM disambiguation, USDA auto-create), ingredient prep requirements (`prep_requirements`, thaw/soak/marinate).

**Source**: `apps/api/src/services/recipeExtractor.ts`, `apps/api/src/services/recipeUrlExtractor.ts`, `apps/api/src/services/recipeImport.ts`, `apps/api/src/services/net/publicFetch.ts`, `apps/api/src/services/sources/`, `apps/api/src/services/ingredientTokenMatch.ts`, `apps/api/src/services/ingredientMatcherLLM.ts`, `apps/api/src/services/ingredientAutoCreate.ts`, `apps/api/scripts/handAuthoredRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/components/recipes/UrlRecipeImport.tsx`

---

## [Recipe Images](./recipe-images.md)

Recipe hero photo: AI house photo (dish description → AiKit inference API gpt-image-2 high quality `AIKIT_IMAGE_MODEL` `AIKIT_IMAGE_QUALITY`, nano-banana-pro on a failed check `AIKIT_IMAGE_RETRY_MODEL` (D-117) or OpenAI gpt-image fallback on 403/429/5xx `RECIPE_IMAGE_PROVIDER` → Claude vision check → one retry; automatic on create/import, replaces og:image/YouTube thumbnails, never user uploads), `POST /recipes/:id/regenerate-image`, monthly per-user quota `IMAGE_GEN_MONTHLY_LIMIT`, Railway volume storage (`IMAGE_STORAGE_DIR`, `IMAGE_PUBLIC_URL_BASE`), seed JPGs in `apps/web/public/images/recipes/`, catalogue photo audit `recipeImageAudit` / `auditRecipeImages.ts` (wrong dish / off-style / low-res), `generateRecipeImages.ts`.

**Source**: `apps/api/src/services/recipeImageGenerator.ts`, `apps/api/src/services/recipeHouseImage.ts`, `apps/api/src/services/recipeImageCheck.ts`, `apps/api/src/services/recipeImageAudit.ts`, `apps/api/scripts/auditRecipeImages.ts`, `apps/api/scripts/generateRecipeImages.ts`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/src/hooks/useUser.ts`

---

## [Recipes](./recipes.md)

**Partes**: [El catálogo y la página de receta](./recipes-catalogo.md) · [Crear y editar recetas, la API y el escritorio](./recipes-editar.md)

Recipe catalog, recipe detail, ingredients, sectioned ingredient groups ("Para la masa"), recipe form with ingredients one per line («200 g de lentejas», parseIngredientLine, ✓ / ¿cuál? / nuevo, created on save) and pasted steps (splitSteps), rich steps (text + duration + temperature + technique + ingredient refs), photos (Unsplash + Notion), system vs user recipes, public vs internal tags, favorites, search, meal/season/maxTime filters, «Con lo que tengo» (cook with what I have: 1–3 ingredients → ranked recipes + what is missing, basics excluded, GET /recipes/with-what-i-have), servings, diner scaler with culinary rounding, prepTime/cookTime/activeTime/totalTime, difficulty, equipment, allergens, notes/tips/substitutions/storage, yield, nutritionPerServing, imports and hero photos (see Recipe Import / Recipe Images), "Añadir al menú" sheet from the detail, edit pencil on the photo, sourceUrl/sourceType, hero image, RecipeCard, ServingsScaler. **Recipe detail "D · Luz y foto"**: tabs (Ingredientes · Pasos · Nutrición · Notas, `#hash`), sticky "Empezar a cocinar" action bar, tab bar hidden on the detail, desktop 50/50 split with sticky photo (`RecipeTabs`, `RecipeActionBar`, `useIsDesktop`). **Public catalogue** (catálogo público, recetas sin cuenta): `/recipes` signed out is the anonymous-readable list (no login) of system recipes — public chrome on the public grid, editorial header, only generic filters (no «Nueva receta», «Mis recetas», «Selección Mimoia», «Con lo que tengo»), waitlist CTA `CatalogueWaitlistCta` (`?ref=recetas`), in the sitemap — backed by the same `GET /recipes` endpoint via `optionalAuthMiddleware` — with a token it returns the full catalogue, without one it filters to `authorId IS NULL`. `/recipes-ona` 308-redirects to `/recipes`. **One recipe page** (página de receta pública, public recipe page): `/recipes/[id]` (+ cook mode) opens signed out for catalogue recipes with the public chrome (PublicNavbar + Footer, `RootShell`, `lib/recipeShell.ts`) and a waitlist CTA (`RecipeWaitlistCta`); private recipe signed out → «Esta receta es privada»; `/recipes-ona/[id]` 308-redirects to `/recipes/[id]`. Share «Pásalo» = title + `/recipes/<id>?ref=receta` (no text). Link previews / Open Graph / canonical / twitter card from `app/recipes/[id]/layout.tsx` `generateMetadata` (`lib/recipeMetadata.ts`).

**Source**: `apps/api/src/routes/recipes.ts`, `apps/api/src/middleware/auth.ts` (`optionalAuthMiddleware`), `apps/api/src/services/withWhatIHave.ts`, `apps/api/src/services/recipeScaler.ts`, `apps/api/src/services/recipeImageGenerator.ts`, `apps/api/src/services/recipeHouseImage.ts`, `apps/api/src/services/recipeImageCheck.ts`, `apps/api/src/services/recipeImageAudit.ts`, `apps/api/scripts/auditRecipeImages.ts`, `apps/api/scripts/generateRecipeImages.ts`, `apps/api/scripts/handAuthoredRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`, `apps/api/scripts/dedupSystemRecipes.ts`, `apps/api/scripts/linkSeedRecipeImages.ts`, `apps/api/scripts/fillSeedCatalogGap.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/app/recipes/`, `apps/web/src/lib/routeAccess.ts`, `apps/web/src/components/recipes/`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/next.config.ts` (`/recipes-ona` redirects), `apps/web/src/hooks/useUser.ts`, `apps/web/public/images/recipes/`

---

## [Cook now («Cocinar ahora»)](./cook-now.md)

«Cocinar ahora» tab, qué cocino (five phases, PRO-1105 to PRO-1109, all in): pestaña Cocinar `/cocinar` with the meal of now, the four questions, despensa confirmada, the proposal 1 + 2, «Cocinar esta», the sheet «¿Y las…?», «Con lo que tienes» and the pantry (`/profile/pantry` redirects); cook mode with menu context (`cookHref`, `?menu=&day=&meal=`): «Terminar» marks «✓ Comido» and goes back to /menu; e2e `cook-now.spec.ts`; essential and secondary ingredients (imprescindibles y secundarios, `recipe_ingredients.role`), substitutes (sustitutos, `substitute_ingredient_ids`), the automatic rule (regla automática: protein/cereal/legume, 15 % of the weight, optional/al gusto/pizca secondary, `autoIngredientRole`, `roleOf`), marks kept on edit and on «Añadir a mis recetas» (`carryIngredientMarks`, `ingredientMarksOf`), Cocina marks the catalogue (`GET /admin/recipes/ingredient-roles/pending`, `PUT /admin/recipes/:id/ingredient-roles`, `x-cocina-token` / `COCINA_WRITE_TOKEN`, only catalogue recipes, households' own recipes never reach the office), batch file `imprescindible` / `sustitutos`. Phase 2: the search (búsqueda: meal of now / comida de ahora, time fit with +20 % margin, pantry, staples, substitutes, missing essentials, «Solo lo que tengo» / «Sí, algo», order), `GET /cook-now/today`, `POST /cook-now/proposal`, `POST /cook-now/phrase` (Mimo's line, la frase de Mimo, `cook_now_phrase` cost outside the monthly cap), `POST /cook-now/choose` (puts it in the meal, moves the planned dishes / pasarlas a otro día), usage events `cook_now_proposed`, `cook_now_chosen`, `meal_cooked.fromMenu`. Keywords: cocinar ahora, qué cocino, pestaña Cocinar, despensa confirmada, imprescindible, secundario, sustituto, ingredient roles, x-cocina-token, cook-now.

**Source**: `packages/shared/src/types/ingredientRole.ts`, `packages/shared/src/cookNow.ts`, `apps/api/src/services/cookNow/`, `apps/api/src/routes/cookNow.ts`, `apps/api/src/services/ingredientRoles.ts`, `apps/api/src/routes/ingredientRoles.ts`, `apps/api/src/middleware/cocinaAuth.ts`, `apps/api/src/services/recipePersistence.ts`, `apps/api/src/services/catalogImport.ts`, `apps/web/src/app/cocinar/page.tsx`, `apps/web/src/components/cocinar/`, `apps/web/src/hooks/useCookNow.ts`

---

## [La receta del día](./recipe-of-the-day.md)

Recipe of the day / receta del día (PRO-1099, E-26): one published catalogue recipe per day (`recipes.featured_on`, unique, migration 0106; `featuredOn` in Cocina's batch file, Miguel sees it before it goes out, D-164.1), public `GET /recipe-of-the-day` and `GET /recipe-of-the-day/AAAA-MM-DD` (Madrid's today; «hoy no hay» → the last one, with its date; 404 `NONE`, 400 `INVALID_DATE`), social post pack / paquete para redes (title, short text built from the recipe, key ingredients, minutes, cuisine, credit, source link, recipe link), photo cut to 1080×1350 and 1200×630 (`/recipe-of-the-day/:date/photo/vertical|horizontal`, sharp; web relay `/receta-del-dia/<fecha>/foto/<formato>`), public page `/receta-del-dia` and `/receta-del-dia/<fecha>` with Open Graph / X card, in the sitemap, Mimo tool `get_recipe_of_the_day` (web chat and WhatsApp, D-051; warns it isn't picked for the household's allergies).

**Source**: `apps/api/src/services/recipeOfTheDay.ts`, `apps/api/src/routes/recipeOfTheDay.ts`, `apps/api/src/services/assistant/recipeOfTheDaySkills.ts`, `packages/shared/src/types/recipeOfTheDay.ts`, `apps/web/src/app/(public)/receta-del-dia/`, `apps/web/src/components/recipeOfTheDay/`, `apps/web/src/lib/recipeOfTheDay.ts`

---

## [Cooking Mode](./cooking-mode.md)

Hands-free fullscreen cook-along, step-by-step UX, per-step countdown timers, multiple concurrent timers, vibration + chime on timer fire, swipe between steps, ingredient checklist, inline scaled ingredient chips, temperature/technique badges, Wake Lock screen-on, live diner re-scaling inside cooking mode, «Mimo, manos libres» hands-free button (keeps listening through silences until turned off or leaving cook mode), exits cleanly without mutating the recipe, "Empezar a cocinar" entry point.

**Source**: `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/` (`CookingShell`, `StepCard`, `StepTimer`, `ChecklistPanel`), `apps/web/src/hooks/useWakeLock.ts`, `apps/web/src/hooks/useStepTimers.ts`, `apps/web/src/lib/mimoHandsFree.ts`

---

## [Ingredient Auto-Create](./ingredient-auto-create.md)

USDA-backed flow that lets users add a missing ingredient without leaving the recipe form. `GET /ingredients/suggest` returns Foundation/SR Legacy candidates + per-100 g nutrition, `POST /ingredients/auto-create` persists with full nutrition + inferred allergens. Fuzzy dedupe (Levenshtein ≤ 2 on normalized names), Branded entries filtered out, Spanish-to-English query translation, "Crear sin nutrición" escape hatch. Same pipeline reused by the photo extractor and `apply:recipes --auto-create-missing`.

**Source**: `apps/api/src/services/ingredientAutoCreate.ts`, `apps/api/src/routes/ingredients.ts` (`/suggest`, `/auto-create`), `apps/api/src/services/ingredientLineMatch.ts` (`/match-lines`, `/ensure`), `apps/web/src/hooks/useIngredients.ts`

---

## [Nutrition](./nutrition.md)

Per-serving nutrition (kcal, protein, carbs, fat, fiber, salt), per-ingredient catalog with USDA FoodData Central (FDC) mapping via `fdcId`, per-100 g nutrition columns directly on the `ingredients` table (no separate `ingredient_nutrition` table), density (g/ml), unitWeight (g/u), recipe-level aggregation cached on save, allergen tags (gluten, lactosa, huevo, frutos secos, soja, pescado, marisco, sésamo, sulfitos…), "sin gluten" filtering, advisor + menu generator consume real nutrition, USDA seed cache.

**Source**: `apps/api/src/services/nutrition/`, `apps/api/src/seed/usda.ts`, `apps/api/src/db/schema.ts` (per-100 g columns on `ingredients`)

---

## [Recipe Quality](./recipe-quality.md)

Lint validator for recipe data integrity, blocks save on missing ingredients in steps (whole words, singular/plural, homographs in context — «pulpa», «pero», «dorada» adjective, the verb «pasas», «pasta» as a batter; water and salt never need listing; «pollo» with «muslos de pollo» counts as listed), meat, fish, shellfish or allergens named in a step and not listed (`STEP_DIET_INGREDIENT_NOT_LISTED`, PRO-268, own word list, «chorizo», «huesos»; catalogue pass `auditStepDietMentions.ts` → report for Cocina), orphan ingredients, out-of-range gramajes per serving (dressing minimums for sofrito vegetables, milk, oil), broken `ingredientRefs`, time-sum inconsistency, public/internal tag leakage. Warnings for nutrition gaps, missing density, suspicious kcal. **Shoppability** (`BUY_NO_QUANTITY`, `BUY_GENERIC`, `BUY_NEEDS_CHOICE`, `BUY_NEEDS_WEIGHT`): ingredients the shopping list / shop orders can't use (al gusto, ternera sin corte, hierbas genéricas, panceta en unidades) → `shoppingIssues` on the recipe detail, "Para hacer la compra" card. Same lint runs on user save, on photo extraction, and on the LLM regeneration pipeline. Curator scripts: `regenerateRecipes.ts` (LLM-driven JSONL output) + `applyRegeneratedRecipes.ts` (human-reviewed apply). Per-ingredient sanity ranges.

**Source**: `apps/api/src/services/recipeLint.ts`, `apps/api/src/services/stepDietMentions.ts`, `apps/api/scripts/auditStepDietMentions.ts`, `apps/api/src/services/recipeShoppability.ts`, `apps/web/src/components/recipes/ShoppingIssues.tsx`, `apps/api/scripts/regenerateRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`

---

## [Catalogue import & «deseos del catálogo»](./catalog-import.md)

**Partes**: [La importación por lotes](./catalog-import-importacion.md)

Catalogue to 1.000 recipes (PRO-154, D-065): batch import `scripts/catalogImport.ts` (`import | status | sample | review | publish`, `catalog:import`) from page photos, PDF pages (pdftoppm) or Cocina JSON; extraction, duplicates (`findDuplicate`), quantities for 4, steps rewritten in the house's words (never the book's text, 7-word phrase check `copiedPhrases`), labels (meal, season, dish type, protein, technique, cuisine, active/total time, difficulty, allergen doubt), new ingredients auto-created, audit + recipeLint, nutrition, allergens; recipes saved as `draft` (`recipes.status`, `catalog_source` book + page, `import_batch`, migration 0058) hidden from `GET /recipes`, the menu and Mimo (admins open them by link); publishing rule: Miguel's sources publish when the audit passes, Cocina's one by one, only those Miguel reviewed and OK'd — he sees all of them, D-099, PRO-290 (`listForReview`, `planBatchPublish`, hold reason `sin_revisar`); photo made while a draft and nothing published without it (`catalogPhotos`, hold reason `sin_foto`, `publishWhenPhoto`, `publishIfWaitingForPhoto`, «Haciendo su foto», «Sale en cuanto tenga su foto»), photo on first menu / first view as a safety net (`catalogImageOnDemand`, `claimCatalogPhoto` every 6 h); «deseos del catálogo» (`catalog_wishes`, `catalog_wish_votes`, households count, sign-up favourites with no similar recipe, `recordCatalogWish`, `GET /admin/catalog-wishes` with metrics token, Admin → Catálogo tab); Admin → **«Recetas pendientes»** (`/admin/recetas`): drafts by batch like a cookbook index (allergen doubts first, credit, audit in words, photo), «Publicar» (OK + publish one, `publishCatalogDraft`, 409 `AUDIT_HOLD`), «Descartar» / «Recuperar» (Miguel's «no», kept as a tombstone so a re-import skips it), «Publicar las aprobadas» per batch (`publishBatch`), upload or paste a Cocina batch JSON checked with the shared zod schema (`cocinaBatchFileSchema`, Spanish problems with recipe/ingredient positions, `checkCocinaBatchText`, `buildCatalogImportPayload`), preview of what it would skip (`previewDuplicates`), import as drafts in the background (`catalog_import_jobs`, migration 0090, one at a time, progress per recipe, `interrupted` on reboot, `NO_AI_KEY` 503, 2 MB body), `GET/POST /admin/catalog-drafts…`, `/admin/catalog-batches/:batch/publish`, `/admin/catalog-import/check|jobs` (admin JWT, audited `catalog_draft.*`, `catalog_batch.publish`, `catalog_import.start`).

**Source**: `apps/api/scripts/catalogImport.ts`, `apps/api/src/services/catalogImport.ts`, `apps/api/src/services/catalogRewriter.ts`, `apps/api/src/services/catalogImportDb.ts`, `apps/api/src/services/catalogReview.ts`, `apps/api/src/services/catalogImportJobs.ts`, `apps/api/src/routes/catalogReview.ts`, `packages/shared/src/types/catalogImport.ts`, `apps/api/src/services/catalogWishes.ts`, `apps/api/src/services/catalogImageOnDemand.ts`, `apps/api/src/routes/catalogWishes.ts`, `apps/web/src/app/admin/sections/CatalogWishesSection.tsx`, `apps/web/src/app/admin/sections/PendingRecipesSection.tsx`, `apps/web/src/app/admin/sections/CatalogImportPanel.tsx`, `apps/web/src/hooks/useCatalogReview.ts`

---
