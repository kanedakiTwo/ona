# Import Recipe from URL Implementation Plan

## Summary

Add a new flow to import recipes from a URL — either a YouTube video or a web article — alongside the existing photo extraction. Articles use a hybrid path (JSON-LD `schema.org/Recipe` first, fallback to `@mozilla/readability` + Claude). YouTube uses video description + caption transcript only (no Whisper / yt-dlp / Gemini in v1). The origin URL is persisted on the recipe (`sourceUrl`, `sourceType`). The LLM also classifies whether the content is actually a recipe and returns a clear error otherwise.

Design reference: [/Users/alio/.claude/plans/quiero-que-investigues-la-soft-flame.md](/Users/alio/.claude/plans/quiero-que-investigues-la-soft-flame.md).

## Tasks

- [ ] Add `sourceUrl` and `sourceType` to the recipe schema and shared types
  - Add `source_url text` and `source_type text` columns (both nullable) to `recipes` in [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts).
  - `sourceType` values: `'youtube' | 'article' | 'image' | 'manual'`.
  - Generate migration with `pnpm --filter @ona/api db:generate`. Spec authorizes wipe + reseed.
  - Extend `Recipe` and `ExtractedRecipe` in [packages/shared/src/types/recipe.ts](../packages/shared/src/types/recipe.ts) with `sourceUrl?: string | null` and `sourceType?: ... | null`. Add `ExtractFromUrlError = { error: string; reason: string; isRecipe: false }`.
  - Update existing photo extraction flow and `POST /recipes` to set `sourceType: 'image'` / `'manual'` accordingly so the column is consistent across paths.

- [ ] Generalize the extraction provider to also accept text input
  + Touches [apps/api/src/services/recipeExtractor.ts](../apps/api/src/services/recipeExtractor.ts) and [apps/api/src/services/providers/anthropic.ts](../apps/api/src/services/providers/anthropic.ts).
  - Rename interface `VisionProvider` → `ExtractionProvider` and add `extractFromText(text: string, hint: 'youtube' | 'article'): Promise<RawExtractedRecipe & { isRecipe: boolean; reason?: string }>`.
  - Keep `extractFromImage` unchanged (rename of method only if needed for symmetry).
  - Implement `extractFromText` in `AnthropicProvider` with a Spanish prompt mirroring the existing image prompt: same JSON shape, same units, same enums, plus an `isRecipe` boolean and optional `reason`. Pass `hint` so the prompt can mention the source ("transcripción de YouTube" vs "artículo web") to improve extraction quality.
  - Export `matchIngredients` from `recipeExtractor.ts` so it can be reused by the URL extractor without duplication.

- [ ] Implement the article source extractor (JSON-LD → Readability + LLM)
  + New file: `apps/api/src/services/sources/article.ts`.
  - Add deps: `@mozilla/readability`, `jsdom`, `cheerio`.
  - `fetchArticle(url)`: `fetch(url)` with a realistic User-Agent + 10s timeout.
  - `parseJsonLd(html)`: use `cheerio` to find every `<script type="application/ld+json">`, JSON.parse, walk arrays / `@graph`, return the first node with `@type === 'Recipe'` (or array containing it). Map directly to `RawExtractedRecipe` (name → `name`, `recipeIngredient[]` → `ingredients`, `recipeInstructions[]` → `steps`, ISO 8601 duration parsing for `prepTime`).
  - If no JSON-LD recipe found, run `Readability` over a `jsdom` window of the HTML → `article.textContent` → call `provider.extractFromText(text, 'article')`.
  - Return shape: `{ raw: RawExtractedRecipe, isRecipe: boolean, reason?: string }`.
  - On HTTP failures or empty article, throw a typed error consumed by the orchestrator.

- [ ] Implement the YouTube source extractor (description + transcript)
  + New file: `apps/api/src/services/sources/youtube.ts`.
  - Add deps: `youtube-transcript`, `youtubei.js`.
  - `parseVideoId(url)`: regex over `youtube.com/watch?v=`, `youtu.be/`, `m.youtube.com`, `youtube.com/shorts/`.
  - `fetchMeta(videoId)`: use `youtubei.js` (or oEmbed + lightweight scrape) to get `title` and `description`.
  - `fetchTranscript(videoId)`: use `youtube-transcript`; concatenate segment `text` joined by spaces. Catch and return `null` if captions are disabled.
  - Compose payload: `Title:\n{title}\n\nDescription:\n{description}\n\nTranscript:\n{transcript}` — omit empty sections.
  - If both description is short (<200 chars) and transcript is `null` → throw `NoExtractableContentError("Este vídeo no tiene subtítulos disponibles ni una descripción con la receta")`.
  - Otherwise call `provider.extractFromText(payload, 'youtube')` and return `{ raw, isRecipe, reason? }`.

- [ ] Create the URL extractor orchestrator and HTTP endpoint
  + Touches [apps/api/src/routes/recipes.ts](../apps/api/src/routes/recipes.ts) and new `apps/api/src/services/recipeUrlExtractor.ts`.
  - `extractRecipeFromUrl(provider, url)`: detect type via hostname (`youtube.com`, `youtu.be`, `m.youtube.com` → youtube; everything else → article), dispatch to the right source, apply `matchIngredients` and the same meal/season filtering used in `extractRecipeFromImage`, return the same `ExtractedRecipe` shape plus `sourceUrl` and `sourceType`.
  - If the source returns `isRecipe: false`, surface that all the way up.
  - Add `POST /recipes/extract-from-url` (auth required) with Zod body `{ url: z.string().url() }`. On `isRecipe: false`, respond `400` with `{ error, reason, isRecipe: false }`. Otherwise respond with `ExtractedRecipe`.
  - Map domain errors (`NoExtractableContentError`, fetch failures, transcript disabled) to readable Spanish messages.

- [ ] Frontend: hook, component and integration into `/recipes/new`
  + Touches [apps/web/src/hooks/useRecipes.ts](../apps/web/src/hooks/useRecipes.ts), `apps/web/src/app/recipes/new/page.tsx`, plus new `apps/web/src/components/recipes/UrlRecipeImport.tsx`.
  - `useExtractRecipeFromUrl()` mutation mirroring `useExtractRecipeFromImage` (POST to the new endpoint, surface errors).
  - `UrlRecipeImport.tsx`: URL input + "Importar receta" button, loading state, friendly error rendering (especially for `isRecipe: false` and the no-captions case). On success calls `onExtracted(extracted)` with `sourceUrl`/`sourceType` included.
  - On `/recipes/new`, add a third option ("Manual" / "Desde foto" / "Desde URL") using the project's editorial design tokens; reuse the existing review form for all three paths.
  - Ensure the create-recipe submission persists `sourceUrl` and `sourceType` from the extracted payload.

- [ ] Update [specs/recipes.md](../specs/recipes.md)
  - Add a bullet under *User Capabilities*: "Users can import a recipe from a URL (YouTube video or article)".
  - Add `POST /recipes/extract-from-url` under *API Endpoints*.
  - Add `sourceUrl` and `sourceType` to the *Recipe Model*.
  - Add a *Constraints / Known limitations* note: YouTube videos with no captions and no recipe in the description are not processable in v1.

- [ ] Verify implementation
  - Open `/recipes/new` in the browser at 390×844 (Playwright MCP), confirm the new "Desde URL" tab renders with editorial styling.
  - Article with JSON-LD: paste a `directoalpaladar.com` recipe URL → extraction completes in <500 ms, no Claude call (verify via API logs); review form is pre-filled with name, ingredients and steps.
  - Article without JSON-LD: paste a personal blog post → fallback path hits Claude, extraction succeeds (~3 s).
  - Article that's not a recipe: paste a news article → endpoint returns `400` with `isRecipe: false` and a Spanish reason; UI shows a friendly error.
  - YouTube with recipe in description: paste a video where the description contains the recipe → extraction works without needing transcripts.
  - YouTube with captions only: paste a video without recipe in description but with auto-captions → transcript path produces a complete recipe.
  - YouTube without captions and short description: paste a video with captions disabled → endpoint returns the "sin subtítulos disponibles" error; UI surfaces it clearly.
  - YouTube non-recipe (vlog): returns `isRecipe: false`.
  - End-to-end persistence: import an article recipe, save it, navigate to `/recipes`, open the saved recipe, confirm it renders correctly and that `recipes.source_url` / `recipes.source_type` are populated in the DB (`psql` query).
  - Lint validator: confirm extracted recipes pass `recipeLint` before reaching the form (no validation errors thrown during extraction for the test URLs above).
