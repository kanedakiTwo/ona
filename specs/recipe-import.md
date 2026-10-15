# Recipe Import

Where recipes come from: the seed pipeline, import from a photo, a URL (article or YouTube) or WhatsApp, copies of catalogue recipes, and how extracted ingredient names bind to the catalogue. Split out of [Recipes](./recipes.md) (PRO-08).

## User Capabilities

- Users can import a recipe from a URL — a YouTube video, a web article or an Instagram/TikTok post (below) — via `/recipes/new`. The server fetches the page, tries `schema.org/Recipe` JSON-LD first, falls back to Mozilla Readability + Claude for articles, and uses video description + caption transcript for YouTube. The LLM also classifies whether the content is actually a recipe; non-recipes return a clear Spanish error. The persisted recipe carries `sourceUrl` and `sourceType`; the recipe detail surfaces a **"Ver fuente"** link under the title (Youtube icon for `sourceType: 'youtube'`, generic external-link icon otherwise). The edit form exposes an optional URL field under "Tiempos y comensales" so any recipe — even manually authored ones — can have a source attached after the fact
- Users can import a recipe from an **Instagram or TikTok post** (PRO-30), from `/recipes/new` or by sharing the link with Mimo (chat or WhatsApp). We never download or transcribe the video: plan A is the post caption read from the page head (`og:description`, falling back to `description` / `twitter:description`, the longest wins; Instagram's "N likes, N comments - cuenta on …:" prefix is stripped). When the caption holds the whole recipe (ingredients **and** steps), it goes through the text extractor with a `social` hint that forbids filling anything in from the dish name, and the recipe is saved with `sourceUrl` (so the detail shows **"Ver fuente"**; `sourceType` stays `'article'`) and the post's `og:image` as the stand-in cover. Plan B, in every other case (login wall or HTTP error, no caption, caption shorter than 80 characters — no LLM call —, "receta en mi bio", ingredients without steps or vice versa): nothing is saved and the answer is exactly **«No he podido leer la receta de este vídeo; mándame una captura»** — the web route returns `422 { error, code: 'NEEDS_SCREENSHOT' }` and the URL card adds "Súbela en «Crear desde foto»"; on chat/WhatsApp the skill tells Mimo to relay that sentence (a screenshot sent by WhatsApp is imported directly as a recipe photo)
- Users can auto-create a missing ingredient from the `/recipes/new` form: if an ingredient name doesn't exist in the catalog, a "Crear nuevo ingrediente" option in the picker opens a modal showing USDA FoodData Central candidates (Foundation/SR Legacy first, Branded filtered out) plus per-100 g nutrition; the user picks one or "Crear sin nutrición". The new row is persisted with full nutrition + inferred allergens and slotted into the recipe form. Same plumbing is reused by the photo extractor and `apply:recipes --auto-create-missing` to avoid skipping recipes whose ingredients are merely absent from the catalog.

## Recipe Sources

**System / Shared recipes** (`authorId = null`):
- Tagged internally with `compartida` (not shown publicly — see *Tag Visibility* below)
- Curated through the regeneration script (see [Recipe Quality](./recipe-quality.md)); each recipe must pass the lint validator before being seeded
- Read-only for users (cannot edit or delete)
- Listed by the **"Selección Mimoia"** chip in the catalog (no per-card mark)
- **Link to the original** (PRO-57): catalogue recipes that came from Notion carry the `Link` of their Notion row as `sourceUrl` (`sourceType` `youtube` for YouTube, `article` otherwise), so the detail shows **"Ver fuente"**. `applyCatalogSourceLinks` (`services/catalogSourceLinks.ts`) fills it for every recipe with `author_id IS NULL AND source_url IS NULL` whose name matches a Notion row ignoring accents, case and repeated spaces (one-letter typos tolerated on names of 12+ characters when only one row is that close: «noddles», «chiken»). It never touches user recipes or a recipe that already has a link, so re-running it is a no-op. It runs by itself after `db:migrate` on every API boot (staging and production deploys; a failure is logged and never blocks the boot) and at the end of `db:seed` (fresh/CI databases). The boot log says `[catalog-source-links] N recetas del catálogo sin enlace: X emparejadas, Y sin emparejar (names…)`. The Notion links are embedded in `seed/notionSourceLinks.ts` (a unit test keeps it equal to the CSV); a cell with a note after the URL («… (TBD)», Ceviche) is not a confirmed source and is skipped
- **Catalogue data fixes** (PRO-78): «Arroz al caldero» was seeded with only «Arroz, Ajo», so diet and allergy filters couldn't see its fish and it reached vegetarian weeks. The seed now lists the Notion original's ingredients for its 4 servings (arroz 500 g, 5 ñoras, caldo de pescado 1,5 l, lubina 600 g, tomate concentrado 30 g, ajo 15 g, aceite de oliva virgen 60 ml, alioli 100 g; steps still missing, PRO-73). `applyCatalogRecipeFixes` (`services/catalogRecipeFixes.ts`) brings existing catalogues in line: it only rewrites the system recipe (`author_id IS NULL`) named «Arroz al caldero» while its ingredients are still exactly arroz + ajo, creates any missing ingredient from its `seed/ingredients.ts` entry (lubina and caldo de pescado tagged `pescado`, alioli `huevo`) and recomputes that recipe's allergens and nutrition. A user copy, an edited recipe or a second run is left alone. It runs after `db:migrate` on every boot (failure logged, never blocks) and at the end of `db:seed`; the log says `[catalog-recipe-fixes] «Arroz al caldero»: …`

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
- Created via `/recipes/new`, AI extraction from photo, AI extraction from URL, or by copying from the Mimoia catalog (`POST /recipes/:id/copy`)
- Must pass the same lint rules on save
- Cards carry no badge; they are what the **"Mis recetas"** chip shows

**Copied recipes**: when the user taps "Añadir a mis recetas" on a system recipe (or any recipe they don't own), the server clones the row and all child rows (`recipe_ingredients`, `recipe_steps`) with new UUIDs, remaps `step.ingredientRefs` from old → new ingredient row ids, sets `authorId = req.userId`, drops the source's `compartida` / `auto-extracted` / `from-url` internal tags and adds `copied-from-catalog`, sets `sourceType = 'manual'`, and returns the new recipe. The user is then the author of an independent copy.

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

## Ingredient prep requirements

Each `ingredients` row carries an optional `prep_requirements` JSONB column with the shape `{ method: PrepMethod, notes?: string }` where `PrepMethod` is a closed enum: `thaw_24h | thaw_48h | soak_overnight | soak_30min | temper_30min | marinate_2h | marinate_overnight | dough_rise_overnight`. The values encode the typical lead time so the scheduler doesn't need separate config — `PREP_METHOD_HOURS_BEFORE` in `@ona/shared` maps each value to a fixed number of hours.

Population is offline via the LLM script:

  1. `pnpm --filter @ona/api prep-requirements:populate` — loads every ingredient, asks Claude in batches of 50 (one ~$0.02 call per batch), writes JSONL to `apps/api/scripts/output/prep-requirements.jsonl`. Defaults to `null` whenever the LLM is unsure so the catalogue never gets noisy.
  2. Human review of the JSONL.
  3. `pnpm --filter @ona/api prep-requirements:apply` — re-reads the same file and `UPDATE`s the matching rows.

Idempotent: re-running populate overwrites the JSONL; re-running apply overwrites the DB. The scheduler ([Notifications](./notifications.md) / PR-D) reads this column together with `user_memories.prep_habits` to decide which alerts fire for which user when a recipe lands in their menu.

## API Endpoints

- `POST /recipes/extract-from-image` (auth) — AI recipe extraction; returns the `ExtractedRecipe` draft (ingredients matched against catalog + warnings) so the user can review and adjust it on `/recipes/new` before saving. The draft is **not** persisted server-side — the user submits the normal `POST /recipes` from the form, which runs the lint validator. Defensive JSON parse tolerates ```json…``` fenced responses from the model
- `POST /recipes/extract-from-url` (auth) — body `{ url, asSystem?: boolean }`. Detects YouTube vs article by hostname. Articles try `schema.org/Recipe` JSON-LD, then fall back to Mozilla Readability + Claude. YouTube combines title + description + caption transcript and feeds it to Claude. **Meta fetcher has a two-step fallback**: first hits Innertube (youtubei.js), and if it returns an empty/short description (datacenter IPs are sometimes rate-limited by YouTube's internal API) the code scrapes the public watch page HTML directly and parses `videoDetails.title` + `videoDetails.shortDescription` out of the embedded `ytInitialPlayerResponse` JSON — so any video whose description carries the full recipe (timestamped step lists like Gipsy Chef uploads) imports cleanly even when Innertube is blocked. Unlike `/extract-from-image`, this endpoint persists the recipe directly and returns `{ recipe, warnings }` (the frontend then redirects to the detail page). Returns 422 with `{ isRecipe: false, reason }` when the LLM decides the URL doesn't describe a cookable recipe, and 422 with a Spanish message when a YouTube video has neither captions nor a usable description. **Cover image is captured automatically**: articles read `schema.org/Recipe.image` (string · `{url}` · array) when JSON-LD is present, otherwise scrape `og:image` / `og:image:secure_url` / `twitter:image` / `<link rel="image_src">` from the page head; YouTube derives `https://i.ytimg.com/vi/<videoId>/hqdefault.jpg` (guaranteed for every video). The captured URL is persisted into `recipes.image_url` only as a stand-in: right after the save, the **house photo** ([Recipe Images](./recipe-images.md)) replaces it in the background. **`asSystem: true` is admin-only** (returns 403 `NOT_ADMIN` for non-admins): persists the recipe with `authorId = null` and `internalTags = ['compartida', 'auto-extracted', 'from-url']` so it shows up under "Selección Mimoia" on `/recipes` and on the public `/recipes-ona` page. The `UrlRecipeImport` component on `/recipes/new` surfaces an "Añadir al catálogo Mimoia" checkbox only when `user.role === 'admin'`
- **The URL is untrusted (SSRF guard, `services/net/publicFetch.ts`)**: article pages are fetched only over http/https on default ports, never to `localhost`, `*.internal`/`*.local`, bare hostnames or private/loopback/link-local/CGNAT/ULA addresses. Every DNS answer is checked again when the connection is made, so DNS rebinding is refused too. Redirects are followed by hand (max 3) and each hop is re-checked. 10 s deadline, 2 MB cap on the decompressed body, HTML-ish content types only, charset honoured. A refused URL → `400 { error }` ("Ese enlace no apunta a una página pública."); a too-big / non-HTML / HTTP-error page → `422 { error }`. YouTube imports only ever call fixed youtube.com endpoints.
- Article pages are fetched with a regular browser User-Agent and `Accept-Language: es-ES`. It's a single page the user explicitly shared, fetched on their behalf. Several recipe sites (e.g. gipsychef.es) answer **403** to self-identified bot agents; that broke "guárdame esta receta" until 2026-10-07.
- **Shared import path** (`services/recipeImport.ts`): `saveExtractedRecipe(extracted, { authorId, internalTags, sourceUrl })` is the one soft-lint persist used by `POST /recipes/extract-from-url`, the assistant skill `import_recipe_from_url` ("guárdame esta receta: <enlace>", web chat + WhatsApp — see [Advisor](./advisor.md)) and WhatsApp recipe photos (`importRecipeFromImage`, tagged `['auto-extracted', 'from-photo']`). Unlike the in-app photo flow (which returns a draft for review), a photo sent over WhatsApp is **persisted directly** with soft lint — the reply links to the recipe so the user can review it. Pure mapping `extractedToWriteInput` is unit-tested in `recipeImport.test.ts`.

## Constraints

- TODO(spec): PRO-57 also asked that, when a photo import looks like a screenshot of a web page or social network, Mimo asks «¿Tienes el enlace del original?». Not built: the photo extractor returns no "screenshot" signal yet, and on WhatsApp the link the user sends back would be imported as a second recipe (`import_recipe_from_url`) instead of being attached to the photo one — that needs a "set the source of the last imported recipe" step. Today a photo import has no link; it can be added by hand in the edit form

- Instagram / TikTok: only the caption is read; the audio and on-screen text of the video are not (out of scope). Instagram often serves a login wall to server requests, in which case the user always gets the screenshot answer
- v1 of the URL importer cannot process YouTube videos that lack both captions and a recipe-bearing description (no Whisper / yt-dlp / Gemini fallback yet)

## Related specs

- [Recipes](./recipes.md) — recipe model, catalogue, detail, core endpoints
- [Recipe Images](./recipe-images.md) — the house photo every import gets
- [Ingredient Auto-Create](./ingredient-auto-create.md) — USDA-backed ingredient creation
- [Recipe Quality](./recipe-quality.md) — lint validator run on save

## Source

- [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts)
- [apps/api/src/services/recipeUrlExtractor.ts](../apps/api/src/services/recipeUrlExtractor.ts) — URL extraction orchestrator (article + YouTube)
- [apps/api/src/services/recipeImport.ts](../apps/api/src/services/recipeImport.ts) — shared soft-lint persist for imports (URL route, `import_recipe_from_url` skill, WhatsApp photos)
- [apps/api/src/services/net/publicFetch.ts](../apps/api/src/services/net/publicFetch.ts) — SSRF-safe page download for user-supplied URLs (`fetchPublicPage`, `assertPublicUrl`, `isPrivateAddress`)
- [apps/api/src/services/sources/article.ts](../apps/api/src/services/sources/article.ts) — JSON-LD parser + Readability fallback
- [apps/api/src/services/sources/youtube.ts](../apps/api/src/services/sources/youtube.ts) — video id parser, transcript fetch, prompt composer
- [apps/api/src/services/sources/social.ts](../apps/api/src/services/sources/social.ts) — Instagram / TikTok: host detection, caption parsing (`og:description`), `SocialCaptionUnavailableError` (screenshot answer)
- [apps/api/src/services/sources/sourceType.ts](../apps/api/src/services/sources/sourceType.ts) — URL → 'youtube' | 'article'
- [apps/web/src/components/recipes/UrlRecipeImport.tsx](../apps/web/src/components/recipes/UrlRecipeImport.tsx) — URL input UI in `/recipes/new`
- [apps/api/src/services/ingredientAutoCreate.ts](../apps/api/src/services/ingredientAutoCreate.ts) — USDA-backed auto-create + Levenshtein dedupe (new)
- [apps/api/src/routes/ingredients.ts](../apps/api/src/routes/ingredients.ts) — `GET /ingredients/suggest`, `POST /ingredients/auto-create`
- [apps/web/src/components/recipes/IngredientAutocomplete.tsx](../apps/web/src/components/recipes/IngredientAutocomplete.tsx) — open ingredient picker + auto-create modal (new). Accepts a `defaultText` prop so unmatched extractor output (photo / URL) is prefilled into the input instead of falling back to the empty placeholder, letting the user confirm via "Crear nuevo" or refine the search.
- [apps/web/src/hooks/useIngredients.ts](../apps/web/src/hooks/useIngredients.ts) — `useSearchIngredients`, `useSuggestIngredient`, `useAutoCreateIngredient` (new)
- [apps/api/src/seed/recipes.ts](../apps/api/src/seed/recipes.ts) — regenerated catalog
- [apps/api/src/services/catalogSourceLinks.ts](../apps/api/src/services/catalogSourceLinks.ts) — catalogue ↔ Notion link backfill (`applyCatalogSourceLinks`, `matchSourceLink`), run from [db/migrate.ts](../apps/api/src/db/migrate.ts) and [seed/index.ts](../apps/api/src/seed/index.ts); data in [seed/notionSourceLinks.ts](../apps/api/src/seed/notionSourceLinks.ts)
- [apps/api/src/services/catalogRecipeFixes.ts](../apps/api/src/services/catalogRecipeFixes.ts) — boot-time catalogue data fix for «Arroz al caldero» (`applyCatalogRecipeFixes`, PRO-78), list taken from [seed/recipes.ts](../apps/api/src/seed/recipes.ts), new ingredients in [seed/ingredients.ts](../apps/api/src/seed/ingredients.ts)
- [apps/api/scripts/handAuthoredRecipes.ts](../apps/api/scripts/handAuthoredRecipes.ts) — hand-authored bodies for the seed placeholders; appends to `output/regen-passed.jsonl`
- [apps/api/scripts/applyRegeneratedRecipes.ts](../apps/api/scripts/applyRegeneratedRecipes.ts) — JSONL → DB applier with lint + auto-create + `--soft-lint` escape hatch
- [apps/api/scripts/dedupSystemRecipes.ts](../apps/api/scripts/dedupSystemRecipes.ts), [linkSeedRecipeImages.ts](../apps/api/scripts/linkSeedRecipeImages.ts), [fillSeedCatalogGap.ts](../apps/api/scripts/fillSeedCatalogGap.ts), [bulkInsertIngredients.ts](../apps/api/scripts/bulkInsertIngredients.ts), [recomputeRecipeNutrition.ts](../apps/api/scripts/recomputeRecipeNutrition.ts), [insertMappedIngredients.ts](../apps/api/scripts/insertMappedIngredients.ts) — one-off prod maintenance scripts
