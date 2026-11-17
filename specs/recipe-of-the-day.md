# La receta del día

One recipe of Mimoia's catalogue per day, with what a post on the networks needs: title, a short text, the photo cut to the two sizes the networks take, key ingredients, minutes, cuisine, credit and the link to the recipe (PRO-1099, Miguel's E-26). It has a public page, `/receta-del-dia`, and Mimo answers «¿cuál es la receta del día?» on the web chat and on WhatsApp (D-051).

## User Capabilities

- **Anyone, with or without an account, opens `/receta-del-dia`**: today's recipe (Madrid's day) with its date, title, the credit line of the ficha (D-067), the photo, the short text, minutes and cuisine, «Lo que lleva» (the key ingredients), «Ver la receta» (`/recipes/<id>`) and «Ver fuente» when the recipe has its original's link. Public chrome (PublicNavbar + Footer, editorial style, `public-container`), no Mimo button. In the sitemap.
- **A given day: `/receta-del-dia/AAAA-MM-DD`**, the link a post keeps. A date that isn't a real day → 404.
- **«Hoy no hay»**: when the day asked for has no recipe, the page says «<día> no tiene receta del día: esta es la última, del <día>.» and shows the last one before it. Before the very first one: «Todavía no hay receta del día» and a link to `/recipes`.
- **Link preview (Open Graph / X card)**: title «<receta> · La receta del día · Mimoia», the short text as description, and the photo cut to 1200×630 as the image; canonical `/receta-del-dia` (or the day's address).
- **The photos for the networks**: `/receta-del-dia/<fecha>/foto/vertical` (1080×1350, Instagram/Facebook feed) and `/receta-del-dia/<fecha>/foto/horizontal` (1200×630, link previews and X), JPEG, on the site's own domain. Only that very day's recipe (no fallback): 404 when that day has none or it has no photo.
- **Mimo** (`get_recipe_of_the_day`, `assistant/recipeOfTheDaySkills.ts`): today's or a given day's (`date`), through the same endpoint as the page, on both channels. It also reads the ficha's allergens (`GET /recipes/:id`) and is told the recipe is the same for everyone, not picked for the household, so it warns when it clashes with the house's allergies or diet. «Hoy no hay» and «todavía no hay» are said as such.
- **Cocina sets the day in the batch file**: `featuredOn: "AAAA-MM-DD"` per recipe of `import --json` or «Subir un JSON» ([Catalogue import](./catalog-import.md)). The recipe still arrives as a draft and **Miguel sees it before it goes out**, like every catalogue recipe (D-164.1): until he publishes it, it is not the recipe of its day (the page shows the last published one).

## API

- `GET /recipe-of-the-day` — public. Today's in Madrid (`todayInMadrid`); if today has none, the last one before, with its own date.
- `GET /recipe-of-the-day/AAAA-MM-DD` — public. That day's, or the last one before it. 400 `INVALID_DATE` for a date that isn't a day (`isIsoDay`: no 2026-02-30); 404 `NONE` when there has never been one up to that day. `Cache-Control: public, max-age=300`.
  Answer (`RecipeOfTheDayView`, `@ona/shared`): `date` (the recipe's day), `requestedDate`, `isRequestedDate`, `recipeId`, `title`, `text`, `imageUrl` (as everywhere: relative for committed photos, absolute for the volume), `photos` (`{ vertical, horizontal }` absolute links on `WEB_PUBLIC_URL`, or null without a photo), `keyIngredients`, `minutes`, `cuisine`, `credit`, `sourceUrl`, `url` (`WEB_PUBLIC_URL/recipes/<id>`).
- `GET /recipe-of-the-day/AAAA-MM-DD/photo/vertical|horizontal` — public. That day's recipe photo cut by the API (sharp, `fit: cover`, attention-centred, JPEG 85), `Cache-Control: public, max-age=3600`; 404 `NO_PHOTO` for another format name, a day without its own recipe or a recipe without a photo. The web route `/receta-del-dia/<fecha>/foto/<formato>` only relays it on the site's domain.

## Constraints

- **Only published catalogue recipes** (`status = 'published'`, `author_id IS NULL`): a draft holding a day is skipped, so nothing reaches the page or Mimo before Miguel publishes it (D-164.1).
- **One recipe per day**: `recipes.featured_on` (date, Madrid's day) with a unique index (`uq_recipes_featured_on`, migration `0106_recipe_featured_on`, only adds). The batch file refuses two recipes on the same day («Receta 2 («…»): la fecha de la receta del día (featuredOn) 2026-11-05 ya es la de la receta 1; solo hay una receta del día por día.») and a value that isn't a day; the import rejects a recipe whose day another recipe already holds, in words («El 2026-11-05 ya tiene receta del día («…»): solo hay una por día (featuredOn).», reason «el revisor la rechaza»), also when two imports race (the unique index answers).
- **Built from the recipe, no AI, never the source's text**: the short text is «<título>, de la cocina <cocina>, en <N> minutos. Con <ingredientes clave>.» (each part only when known). Key ingredients: up to five, in the recipe's order, leaving out optional ones, «pizca» / «al gusto» and salt, water, oil, pepper and ice. Cuisine: the import's hidden `cocina:<slug>`, read as its public tag («española»). Minutes: total time, else prep + cook (`recipeTotalMinutes`). Of `catalog_source`, only the credit line leaves (`catalogSourceCredit`, D-067).
- The photo is read from the recipe's `image_url` (relative ones from `WEB_PUBLIC_URL`, as the week image does), at most 12 MB and 5 s; the last dozen cuts are kept in memory per API process. An unreadable photo → 404, never a broken image.
- The page asks the API on every view (`cache: no-store`, 2.5 s; a slow API shows «todavía no hay» instead of an error), so it changes at Madrid's midnight.
- No health claims in the page or the text (constitution §6; `publicHealthClaims.test.ts` scans `app/(public)`).

## Pending

- Setting or moving the day of a recipe already in the catalogue: today only the batch import sets `featured_on` (a repeated recipe is skipped as a duplicate). An admin field next to «Fuente» would do it.
- `POST /admin/catalog-import/check` doesn't warn yet that a day of the file is already taken in the database: the import says it, recipe by recipe.
- No `usage_events` event for the page or the tool yet (growth gate: it is a top-of-funnel page for the networks; its visits would come from the web analytics).

## Related specs

- [Catalogue import](./catalog-import.md) — the batch file (`featuredOn`) and the publishing rule
- [Recipes](./recipes.md) — the ficha the page links to, the credit line
- [Advisor](./advisor.md) — Mimo's tools
- [Auth](./auth.md) — public routes (`lib/routeAccess.ts`)

## Source

- [apps/api/src/services/recipeOfTheDay.ts](../apps/api/src/services/recipeOfTheDay.ts) — `loadRecipeOfTheDay`, `buildRecipeOfTheDayView`, `keyIngredients`, `cuisineOf`, `shortText`, `recipeOfTheDayPhoto` / `cutPhoto`, the database side
- [apps/api/src/routes/recipeOfTheDay.ts](../apps/api/src/routes/recipeOfTheDay.ts) — the three public routes
- [apps/api/src/services/assistant/recipeOfTheDaySkills.ts](../apps/api/src/services/assistant/recipeOfTheDaySkills.ts) — `get_recipe_of_the_day`
- [packages/shared/src/types/recipeOfTheDay.ts](../packages/shared/src/types/recipeOfTheDay.ts) — `RecipeOfTheDayView`, `isIsoDay`, the two sizes; `featuredOn` in [catalogImport.ts](../packages/shared/src/types/catalogImport.ts)
- [apps/api/src/services/catalogImportDb.ts](../apps/api/src/services/catalogImportDb.ts) — `persistCatalogDraft` saves `featured_on` (a taken day, in words)
- [apps/web/src/app/(public)/receta-del-dia/](../apps/web/src/app/(public)/receta-del-dia/) — the page, the page of a day and the photo route; [components/recipeOfTheDay/RecipeOfTheDayPage.tsx](../apps/web/src/components/recipeOfTheDay/RecipeOfTheDayPage.tsx); [lib/recipeOfTheDay.ts](../apps/web/src/lib/recipeOfTheDay.ts) (fetch and Open Graph)
- Tests: `recipeOfTheDay.test.ts` (the view, «hoy no hay», the routes, the photo sizes, the Open Graph, Mimo on both channels), `catalogImport.test.ts` (`featuredOn` in the file: a real day, one per day, saved), `recipeOfTheDay.smoke.ts` (real Postgres + API: one per day at the database, a taken day in the import, drafts skipped), `e2e/recipe-of-the-day.spec.ts` (today's recipe in the endpoint and on the page, signed out, with its preview; a later day shows the last; 390×844)
