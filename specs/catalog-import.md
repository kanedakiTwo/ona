# Catalogue import by batches and «deseos del catálogo»

How Mimoia's recipe catalogue grows from ~80 to 1.000 recipes (D-065, PRO-154): recipes come in by batches from Miguel's books, his mother's recipe book or what Cocina finds or writes, wait as **drafts** nobody sees, and are **published** by a rule. Alongside, the catalogue keeps a list of **dishes households want and we don't have** («deseos del catálogo») so Cocina knows what to bring next.

## User Capabilities

- **Households never see a draft.** A catalogue recipe in `draft` is not in `/recipes` (signed in or out), doesn't open by link (404, same as a missing recipe), the menu never picks it and Mimo never offers it. Once published it behaves like any other catalogue recipe.
- **An admin opens a draft by its link** (`/recipes/<id>` with an admin account): that is how Miguel reviews the sample of a Cocina batch.
- **Photos on demand**: an imported recipe has no photo at first. The house photo ([Recipe Images](./recipe-images.md)) is made in the background the first time the recipe appears in a menu (any menu read) or someone opens it; until then the card shows the usual no-photo placeholder.
- **Admin → Catálogo → «Deseos del catálogo»**: the dishes households asked for that we don't have, most-asked first, with how many households ask and where it came from («favoritos del alta», «menú sin acierto», «petición a Mimo», «Me encanta»). Filters: «Pendientes», «Ya cubiertos» (with a link to the recipe that covers it), «Todos». No names, no emails.

## The import (`apps/api/scripts/catalogImport.ts`)

Run from a laptop with `DATABASE_URL` and `ANTHROPIC_API_KEY` (see the file header for every flag):

1. `import --dir=<folder> --origin=miguel|cocina --book="…" --batch=<id>` — a folder of page photos (`.jpg/.png/.webp`) or PDFs (split into pages with `pdftoppm`; page number from the file name or the PDF page). `--json=<file>` takes Cocina's batch file instead (hand-authored shape: ingredients by name with `qty`/`unit`, steps, optional `source` for the file or per recipe). `--dry-run` saves nothing.
2. Per recipe, in order (`services/catalogImport.ts`, orchestration with injected AI and database):
   - **reading**: the photo extractor that `POST /recipes/extract-from-image` uses (`AnthropicProvider.extractRecipe`);
   - **duplicates**: against every catalogue recipe (published and drafts) and the batch itself — same dish when the significant words match (accents, plurals, order and filler words aside: «Tortilla de patata» = «Tortilla de patatas») or the names are ≤ 2 letters apart → skipped, «ya está: …»;
   - **frying / confit oil** (`markCookingMediumLines`, PRO-195, before scaling): a fat line (aceite, manteca, mantequilla, grasa) that is only the frying or confit medium gets a note starting «para freír…» / «para confitar…» («abundante para freír» → «para freír; abundante», «de freír» → «para freír», a name «aceite de girasol para freír» → name «aceite de girasol» + that note), so nutrition counts only what the food absorbs (15 % / 25 %, see [Nutrition](./nutrition.md)) and the reviewer accepts the amount. A mixed line («540 ml — 40 ml para el sofrito y el resto para freír») is split into two lines (40 ml «para el sofrito», 500 ml «para freír»); a mixed note it can't read (no amount, units that don't convert) is left as it is. The rewrite links each oil line to its own step;
   - **quantities for 4** (`scaleToHouseServings`; «al gusto» and «pizca» don't scale);
   - **steps rewritten in the house's own words** plus labels, one Claude Opus 5.5 call (`services/catalogRewriter.ts`, `CLAUDE_MODEL`): meal, season, course, dish type, main protein, techniques, cuisine, active and total time, difficulty, allergen doubt, a short tip. The book's steps are read to understand the technique and **never saved**;
   - **phrase check**: a step (or the tip) that keeps **7 words in a row** of the source is rewritten once more, told which phrases to avoid; if it still copies, the recipe is rejected («copia del libro») and nothing is saved;
   - **ingredients**: matched to the catalogue (token match → AI → a new ingredient is created automatically, as in every import); an ingredient that can't be matched nor created rejects the recipe;
   - **audit** (`auditCatalogRecipe`: no steps, ≤ 2 ingredients, protein or starch per serving out of range) — the issues travel with the draft;
   - **reviewer** (`recipeLint`, strict, inside `persistRecipe`), **nutrition** and **allergens** (computed from the ingredients on save). Reviewer errors reject the recipe with its messages. Since PRO-289 (after `cocina-01` lost 26 of 32 recipes to false positives) the reviewer reads whole words, doesn't ask for water and salt, and takes sofrito vegetables and milk at a dressing amount ([Recipe Quality](./recipe-quality.md));
   - **saved as `draft`**: the row is created as a draft first and then filled, so it is never visible, not even for a moment. Labels go to `tags` (dish type, cuisine) and hidden `internal_tags` (`catalogo-tanda`, `tipo:`, `proteina:`, `tecnica:`, `cocina:`, `alergenos:duda`); `prepTime` = active time, `cookTime` = the rest of the total.
   - The source is kept in `recipes.catalog_source` (origin, book, page, file, batch — **never its text**), with the audit issues and the allergen doubt; `recipes.import_batch` holds the batch id.
3. One failure never stops the batch; the command prints ✓ / = (duplicate) / ✗ (reason) per recipe and a summary with the allergen doubts.

## Publishing (rule of Miguel, 2026-10-16)

- `status --batch=…` — what's in the batch and what `publish` would do.
- **Miguel's sources** (`--origin=miguel`: his books, his mother's recipe book) are published **without going through him** when they pass the audit: `publish --batch=…`.
- **Cocina's** (`--origin=cocina`: found or written by Cocina) need Miguel to look at **one in ten**: `sample --batch=…` picks ⌈n/10⌉ at random (at least one) **plus every recipe with an allergen doubt**, marks them and prints their links (admin account). Miguel's answer goes in with `review --ok=<ids> --no=<ids>`; then `publish --batch=…`.
- `publish` (`planBatchPublish`) holds: any recipe with audit issues («auditoria»); a recipe Miguel turned down («rechazada»); for Cocina's batch, everything until there is a sample («falta_muestra») and Miguel has seen all of it («muestra_sin_revisar»); if he turned **one** down, **the whole batch waits** («muestra_con_rechazos»: the sample says the batch is off). `--dry-run` only prints.
- Publishing closes the wishes the new recipes cover (`markWishesCovered` → `cubierto`, pointing at the recipe).

## Deseos del catálogo

- **What counts as «we don't have it»** (`catalogCoversDish`): a dish is covered when every significant word of it is in one published recipe's name («carbonara» ⊂ «Espaguetis a la carbonara»). One shared word isn't enough («pastel de carne» is not covered by «Menestra de verduras con carne»). An answer like «cremas y sopas» means either, so a crema *or* a sopa covers it.
- **One wish per dish** (`dish_key`: accents, plurals, order and filler words aside) — singular and plural share the root since PRO-203 (`stem()` in `recipeLint.ts`: «sopa»/«sopas» → «sop», so «sopas» is covered by «Sopa miso»; wishes saved before keep their old key, so a vote for «sopa» may open a second wish next to an older «sopa» one) and **one vote per household** per source (the user's own id when they have no household); the count is distinct households.
- **Sources today**: `alta` — the favourite dishes of the sign-up (web and WhatsApp, both through `saveOnboarding`) that the catalogue doesn't cover; best effort, never breaks the sign-up. `evaluador` (PRO-155) — favourite dishes the menu evaluator finds «no está en el catálogo» after each generated week (`services/menuFit.ts`). `mimo` is accepted by `recordCatalogWish` for that caller.
- `GET /admin/catalog-wishes?status=abierto|cubierto|descartado|todos&limit=` — admin JWT or `x-metrics-token` (Cocina's read). Returns dish, households, sources, status, covering recipe and dates; never who asked. The dish is free text from a registered user, accepted as a dish name; with the token it is cut to 80 characters (`catalogWishes.test.ts`).

## Constraints

- Only catalogue recipes (`author_id IS NULL`) can be drafts; user recipes are always `published`. `recipes.status` is checked at the database (`'draft' | 'published'`, default `published`, migration 0058).
- Every query that serves recipes to a household goes through `visibleRecipeWhere`, which now also requires `published`; `GET /recipes` filters it explicitly; `GET /recipes/:id` and `POST /recipes/:id/copy` answer 404 for a draft unless the caller is an admin.
- The photo-on-demand request is once per recipe per API process (a rejected photo isn't retried on every view; a restart lets it try again), only for published catalogue recipes with no image at all, and a no-op without an image provider. Cost lands on Mimoia (no author).
- Never put a book's text in tests, fixtures or the database: tests use invented sentences.

## Pending

- **Requests to Mimo that end as a note** → wish (`source: 'mimo'`): the call belongs in `assistant/skills.ts` (`recordCatalogWish({ dish, source: 'mimo', userId })`), left out because that file is being changed in another branch.
- **«Me encanta» with no similar recipe** (`me_encanta`): today every «Me encanta» (rating 5) is on a recipe we have; the source is reserved for when the household profile records loved dishes without a recipe.
- No admin buttons yet to mark a wish «descartado» or to publish from the web; both are done from the command for now.

## Related specs

- [Recipes](./recipes.md) — catalogue, visibility, detail page
- [Recipe Images](./recipe-images.md) — the house photo made on demand
- [Recipe Import](./recipe-import.md) — photo extraction and ingredient resolution shared with user imports
- [Menus](./menus.md) — the generator reads only published recipes
- [Metrics](./metrics.md) — the read-only `x-metrics-token`

## Source

- [apps/api/scripts/catalogImport.ts](../apps/api/scripts/catalogImport.ts) — `import | status | sample | review | publish` (`pnpm --filter @ona/api catalog:import …`)
- [apps/api/src/services/catalogImport.ts](../apps/api/src/services/catalogImport.ts) — orchestration and rules (`importCatalogBatch`, `copiedPhrases`, `findDuplicate`, `scaleToHouseServings`, `draftsFromCocinaJson`, `pickReviewSample`, `planBatchPublish`)
- [apps/api/src/services/catalogRewriter.ts](../apps/api/src/services/catalogRewriter.ts) — the house rewrite prompt and parser (Claude Opus 5.5, cost `catalog_import_rewrite`)
- [apps/api/src/services/catalogImportDb.ts](../apps/api/src/services/catalogImportDb.ts) — real deps (draft-first persist, ingredient matching), batch load / sample / review / publish
- [apps/api/src/services/catalogWishes.ts](../apps/api/src/services/catalogWishes.ts) — wishes (`recordCatalogWish`, `recordWishesFromFavoriteDishes`, `catalogCoversDish`, `listCatalogWishes`, `markWishesCovered`); [routes/catalogWishes.ts](../apps/api/src/routes/catalogWishes.ts) — `GET /admin/catalog-wishes`
- [apps/api/src/services/catalogImageOnDemand.ts](../apps/api/src/services/catalogImageOnDemand.ts) — photo on first menu / first view
- [apps/api/src/services/recipeVisibility.ts](../apps/api/src/services/recipeVisibility.ts) — drafts hidden (`visibleRecipeWhere`, `isHiddenDraft`)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `recipes.status`, `catalog_source`, `import_batch`; `catalog_wishes`, `catalog_wish_votes` (migration `0058_catalog_drafts_wishes`)
- [apps/web/src/app/admin/sections/CatalogWishesSection.tsx](../apps/web/src/app/admin/sections/CatalogWishesSection.tsx) — the admin tab
- Tests: `catalogImport.test.ts` (three invented pages, phrase check, duplicates, sample and publish rule), `catalogWishes.test.ts` (wishes, photos on demand, drafts hidden), `catalogImport.smoke.ts` (real API + DB: draft not in `GET /recipes` nor in the generator's loader, publish, wishes read), `e2e/catalog-wishes.spec.ts` (sign-up favourite → admin tab, 390×844)
