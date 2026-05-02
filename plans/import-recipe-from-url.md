# Import Recipe from URL Implementation Plan

## Summary

Add `POST /recipes/extract-from-url` so users can pass a URL — YouTube video or web article — and have ONA extract, lint-validate and **persist** the recipe directly (mirroring the current `POST /recipes/extract-from-image` flow which already persists via `persistRecipe`). Articles use a hybrid path (JSON-LD `schema.org/Recipe` first → Mozilla Readability + Claude fallback). YouTube uses video description + caption transcript only (no Whisper / yt-dlp / Gemini in v1). The LLM also classifies whether the content is actually a recipe and surfaces a clear Spanish error otherwise. The origin URL is persisted on the recipe (`sourceUrl`, `sourceType`).

Design reference: [/Users/alio/.claude/plans/quiero-que-investigues-la-soft-flame.md](/Users/alio/.claude/plans/quiero-que-investigues-la-soft-flame.md).

Code follows TDD per the active session policy: every new pure unit (URL parsing, JSON-LD parsing, payload composition) gets a failing test before any implementation.

## Tasks

- [x] Add `sourceUrl` and `sourceType` end-to-end (DB schema + write input + Recipe type)
  - Add `source_url text` and `source_type text` columns (both nullable) to `recipes` in [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts).
  - Generate migration with `pnpm --filter @ona/api db:generate`. Spec authorizes wipe + reseed.
  - Extend `RecipeWriteInput` in [apps/api/src/services/recipePersistence.ts](../apps/api/src/services/recipePersistence.ts) with optional `sourceUrl?: string | null`, `sourceType?: 'youtube' | 'article' | 'image' | 'manual' | null`. Thread them into the INSERT/UPDATE base fields.
  - Add the same fields to `Recipe` and `createRecipeSchema` in [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts), and the `SourceType` union.
  - Update [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts) `RecipeRow` + `toCard`/`toDetailRecipe` to surface the new fields, and set `sourceType: 'image'` on the existing extract-from-image flow.

- [x] Generalise the extraction provider to also accept text input
  + Touches [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) and [apps/api/src/services/providers/anthropic.ts](../apps/api/src/services/providers/anthropic.ts).
  - Export `matchIngredients` from `recipeExtractor.ts` (currently file-local) so the URL extractor can reuse the auto-create plumbing without duplication.
  - Rename `VisionProvider` → `ExtractionProvider`, keep `extractRecipe(...)` for image, add `extractRecipeFromText(text: string, hint: 'youtube' | 'article'): Promise<RawExtractedRecipe & { isRecipe: boolean; reason?: string }>`.
  - Implement `extractRecipeFromText` in `AnthropicProvider`: same JSON shape as the image prompt (already includes `cookTime`, `servings`, `difficulty`) plus `isRecipe: boolean` and optional `reason` when false. The system prompt mentions whether the source is a YouTube transcript or an article so the model prefers explicit cantidades when present.

- [x] TDD: `parseYouTubeVideoId(url)`
  + New file `apps/api/src/services/sources/youtube.ts` and test `apps/api/src/tests/youtubeSource.test.ts`.
  - Cases: `youtube.com/watch?v=ABC123`, `youtu.be/ABC123`, `m.youtube.com/watch?v=ABC123`, `youtube.com/shorts/ABC123`, `youtube.com/watch?v=ABC123&list=...`, invalid URL → null, non-YouTube URL → null.
  - Watch each test fail, then implement the regex.

- [x] TDD: `detectSourceType(url)`
  + Same `youtubeSource.test.ts` (or a separate `urlExtractor.test.ts`).
  - YouTube hostnames → `'youtube'`; everything else → `'article'`; invalid URL → throws.

- [x] TDD: `parseJsonLdRecipe(html)`
  + New file `apps/api/src/services/sources/article.ts` and test `apps/api/src/tests/articleSource.test.ts`.
  - Cases:
    1. Single `<script type="application/ld+json">` with `@type: "Recipe"` → returns a `RawExtractedRecipe`-shaped object (name, ingredients parsed from `recipeIngredient[]`, steps from `recipeInstructions[]` whether they're strings, `HowToStep` objects, or arrays of sections).
    2. JSON-LD wrapped inside `@graph` array → finds the recipe node.
    3. ISO 8601 `prepTime: "PT30M"` → parsed to integer minutes.
    4. No JSON-LD or no `@type: "Recipe"` → returns null.
    5. Malformed JSON → returns null (no throw).
  - Watch each fail, then implement using `cheerio` + a small ISO 8601 duration parser.

- [x] TDD: `buildYouTubePromptInput(meta, transcript)`
  + Same youtube test file.
  - Cases:
    1. Title + description (long enough) + transcript → composed into `Title: ... Description: ... Transcript: ...`.
    2. No transcript, long description → still composed without the `Transcript:` block.
    3. Both transcript and description missing or trivial (<200 chars description, no transcript) → throws `NoExtractableContentError`.

- [x] Implement the article source extractor (JSON-LD → Readability + LLM fallback)
  + Adds deps `cheerio`, `@mozilla/readability`, `jsdom` to [apps/api/package.json](../apps/api/package.json).
  - `fetchArticle(url)`: native `fetch` with realistic User-Agent and 10 s `AbortController` timeout. Throws `FetchError` on non-2xx.
  - `extractArticleRecipe(provider, url)`: fetch HTML → `parseJsonLdRecipe`; if hit, return `{ raw, isRecipe: true }`. Else run `Readability` over a `jsdom` window, take `article.textContent` truncated to ~12k chars, call `provider.extractRecipeFromText(text, 'article')`, return its result.

- [x] Implement the YouTube source extractor (description + transcript)
  + Adds deps `youtube-transcript`, `youtubei.js`.
  - `fetchYouTubeMeta(videoId)`: `youtubei.js` `Innertube` client → `{ title, description }`. Fall back to oEmbed for title only if Innertube fails.
  - `fetchYouTubeTranscript(videoId)`: `YoutubeTranscript.fetchTranscript(videoId, { lang: 'es' })`, fallback to default lang. Returns `null` on disabled captions (catch-all).
  - `extractYouTubeRecipe(provider, url)`: `parseYouTubeVideoId` → `fetchYouTubeMeta` + `fetchYouTubeTranscript` (parallel) → `buildYouTubePromptInput` → `provider.extractRecipeFromText(payload, 'youtube')`.

- [x] Implement the orchestrator and HTTP endpoint
  + New file `apps/api/src/services/recipeUrlExtractor.ts`. Touches [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts).
  - `extractRecipeFromUrl(provider, url)`:
    1. `detectSourceType` → dispatch.
    2. If source returns `isRecipe === false`, throw `NotARecipeError(reason)`.
    3. Otherwise reuse `matchIngredients` (with USDA auto-create) on `raw.ingredients`, filter meals/seasons exactly like `extractRecipeFromImage`, return an `ExtractedRecipe` plus `sourceUrl` and `sourceType`.
  - `POST /recipes/extract-from-url` (auth required), Zod body `{ url: z.string().url() }`. Calls the orchestrator, builds the `RecipeWriteInput` (mirrors what extract-from-image does but with `sourceUrl`/`sourceType` and `internalTags: ['auto-extracted', 'from-url']`), calls `persistRecipe`, returns the persisted recipe at 201.
  - Map `NotARecipeError` → 422 with `{ error, reason, isRecipe: false }`. Map `NoExtractableContentError` → 422 with explanatory message. Map fetch failures → 502.

- [x] Frontend: hook, component and integration into `/recipes/new`
  + Touches [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts), `apps/web/src/app/recipes/new/page.tsx`, plus new `apps/web/src/components/recipes/UrlRecipeImport.tsx`.
  - `useExtractRecipeFromUrl()` mutation mirroring `useExtractRecipeFromImage` (POST → 201 → invalidate `['recipes']` + push the new recipe id back).
  - `UrlRecipeImport.tsx`: URL input + "Importar receta" button (editorial design tokens), loading state, error rendering with friendly Spanish copy for `isRecipe: false` and the no-captions case.
  - On `/recipes/new`, present three options ("Manual" / "Desde foto" / "Desde URL"); on URL import success, navigate to `/recipes/<id>` (the persisted recipe) just like the photo flow.

- [x] Update [specs/recipes.md](../specs/recipes.md)
  - User capability bullet: "Users can import a recipe from a URL (YouTube video or article)".
  - API endpoint: `POST /recipes/extract-from-url`.
  - Recipe model: `sourceUrl`, `sourceType`.
  - Constraints: "YouTube videos with no captions and no recipe in the description are not processable in v1".

- [x] Verify implementation
  - Run unit tests: `pnpm --filter @ona/api test` → all green (new tests for URL/JSON-LD/payload pass; existing tests untouched).
  - Run TypeScript lint: `pnpm --filter @ona/api lint` and `pnpm --filter @ona/web lint`.
  - Smoke article with JSON-LD: `curl -X POST .../recipes/extract-from-url` with a `directoalpaladar.com` URL → 201, recipe persisted, no Claude call (verify via API logs).
  - Smoke article without JSON-LD (personal blog) → 201, fallback to Claude.
  - Smoke non-recipe article → 422 with `isRecipe: false`.
  - Smoke YouTube with description recipe → 201.
  - Smoke YouTube with captions only → 201.
  - Smoke YouTube without captions → 422 with the "sin subtítulos" message.
  - DB check: `recipes.source_url` and `recipes.source_type` populated for persisted URLs.
  - UI smoke at 390×844 (Playwright MCP): `/recipes/new` shows the new "Desde URL" option styled with editorial tokens; importing a known JSON-LD URL navigates to `/recipes/<id>` and renders the saved recipe.
