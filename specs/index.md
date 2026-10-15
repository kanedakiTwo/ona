# Specs Index

Quick reference to all system specs for Mimoia. Search-optimized with keywords.

---

## [Authentication](./auth.md)

Registration, login, logout, JWT tokens, session management, onboarding flow, password hashing, public vs protected routes, AuthProvider, demo user, username/email login, bcrypt, `?next=` return path on login/register (safeNext, no open redirect), «Primeros pasos» guide on /menu for new accounts (first_steps_pending, POST /user/:id/first-steps, FirstStepsGuide, PRO-07).

**Source**: `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/app/(auth)/`, `apps/web/src/app/onboarding/`

---

## [Privacy & account deletion](./privacy.md)

"Borrar mi cuenta" (GDPR art. 17, right to erasure), `DELETE /user/:id` with password, own recipes deleted (never fall into the catalogue), household ownership hand-over, menus/shopping reassigned, WhatsApp messages purged, volume images removed, admin accounts refused (409 ADMIN_ACCOUNT), `/privacidad` privacy policy (processors Anthropic/OpenAI/Meta/Railway/AiKit/Cloudflare/Resend, Cloudflare Web Analytics cookieless beacon only when NEXT_PUBLIC_CF_BEACON_TOKEN is set, own usage events kept 180 days, health data consent art. 9, international transfers, AEPD, no cookies), NEXT_PUBLIC_SUPPORT_EMAIL.

**Source**: `apps/api/src/services/accountDeletion.ts`, `apps/api/src/routes/users.ts`, `apps/web/src/components/profile/DeleteAccountCard.tsx`, `apps/web/src/app/(public)/privacidad/page.tsx`, `apps/web/src/lib/cfBeacon.ts`, `apps/web/src/app/layout.tsx`

---

## [Email](./email.md)

Transactional email via Resend (REST API with fetch, no SDK, EU region, mimoia.com verified, D-050), `sendEmail` / `sendEmailBatch` (≤100 per call), `RESEND_API_KEY` unset → skipped (no email in CI/staging), `EMAIL_FROM` Mimoia <hola@mimoia.com>, `RESEND_BASE_URL`, never throws (sent/skipped/failed), masked recipients in logs (`maskEmail`), brand HTML template + text version (`renderBrandEmail`, tables, inline styles, 600 px), `List-Unsubscribe` header, waitlist invitation email «¡Te toca! Ya puedes entrar en Mimoia» sent by `POST /admin/waitlist/invite` (`sendEmail: false` to skip, `emailStatus` per person), PRO-93; personal link `/entrar/<token>` + one reminder at 3 days (`waitlistInviteReminderEmail`), fake Resend in e2e (`E2E_MAIL_URL`), PRO-97; shared brand shell (`emailBrand.ts`: logo, accent headline, forest button, signature, footer band), emails signed by Miguel; welcome email on sign-up (bienvenida: beta / household / general, `welcomeKind`); password reset email («¿Has olvidado la contraseña?», `/recuperar`, `POST /auth/forgot`, 1-hour link, 3 per hour); staging mail sink (buzón de pruebas, `EMAIL_SINK_DOMAINS`, `GET /email-sink`, never on production).

**Source**: `apps/api/src/services/email.ts`, `apps/api/src/services/emailBrand.ts`, `apps/api/src/services/waitlistEmails.ts`, `apps/api/src/services/accountEmails.ts`, `apps/api/src/services/accountMailer.ts`, `apps/api/src/routes/waitlist.ts`, `apps/api/src/routes/auth.ts`

---

## [Newsletter «El menú de los viernes»](./newsletter.md)

Weekly visual email for waitlist entries that ticked the newsletter box (LSSI consent), `POST /admin/newsletter/send` (admin JWT; `dryRun` counts, `testTo` one proof to an admin, real send via Resend batch ≤100, audited `newsletter.send`), content as data (star recipe full-width photo + alt, novedad, truco con Mimo, one CTA) rendered by `renderNewsletterEmail` (tables, inline styles, 600 px), idempotent per issue (`newsletter_sends` unique issue + sha256(email), migration 0046, failed/skipped claims released), newsletter-only opt-out `/newsletter/baja?t=w.<token>` + `POST /newsletter/unsubscribe` (place on the list stays), RFC 8058 `List-Unsubscribe-Post` one-click, hint «Te lo recomendamos: te va a sorprender», PRO-94; beta households opt in at /register or with the profile switch (`users.newsletter_opt_in`, migration 0047, `GET/PUT /newsletter/me`, user token `u.<id>.<hmac>`, one switch per email), PRO-95.

**Source**: `apps/api/src/services/newsletter.ts`, `apps/api/src/routes/newsletter.ts`, `apps/web/src/app/(public)/newsletter/baja/page.tsx`

---

## [Waitlist (pre-launch, Mimoia)](./waitlist.md)

Public pre-launch waitlist on the landing (`#lista-de-espera`), public brand Mimoia (`BRAND_NAME`, D-012), closed beta, invite by batches (tandas) every 2–4 weeks, no queue position / no fake scarcity, segmentation questions (household size, who plans/shops, current method, iOS/Android, supermarket), WhatsApp interest, separate newsletter opt-in (menú de los viernes, LSSI), consent version, honeypot, per-IP rate limit, idempotent on email, referral codes (`?invita=`, Crockford base32), "Invita a tu hogar y entráis antes", owner page `/lista/[code]`, copy + wa.me share, opt-out `/lista/baja` (anonymises), `?ref` / `utm_*` attribution, `waitlist_entries` (migration 0037), `GET /admin/waitlist` (metrics token: segments, sources, referrals, suggested next batch), `POST /admin/waitlist/invite` (admin JWT, audited, emails each invitee via Resend, see Email), register marks joined, public CTAs → waitlist; PRO-97: one-time invitation link `/entrar/<token>` (HMAC token, hashed, migration 0048, `GET /waitlist/invite/:token`, `WAITLIST_INVITE_USED` / `WAITLIST_INVITE_LINK_REQUIRED`), `/register?entrada=` email fixed, admin `/admin/lista-espera` (tanda sugerida with names/emails `GET /admin/waitlist/next-batch`, quitar, «Invitar a estas N personas», por tanda), single reminder after 3 days via notificationScheduler.

**Source**: `packages/shared/src/types/waitlist.ts`, `packages/shared/src/constants/brand.ts`, `apps/api/src/services/waitlist.ts`, `apps/api/src/routes/waitlist.ts`, `apps/api/src/db/migrations/0037_waitlist.sql`, `apps/web/src/components/waitlist/`, `apps/web/src/app/(public)/lista/`, `apps/web/src/app/(public)/page.tsx`

---

## [Blog](./blog.md)

Public blog on mimoia.com (PRO-92): `/blog` listing and `/blog/[slug]` articles, editorial skin, articles as Markdown files in `apps/web/content/blog/<slug>.md` with a front matter header (titulo, fecha, autor, resumen, imagen, `publicado: true|false`), only published ones listed / readable (unpublished or unknown slug → 404), publishing = L3 approval + flip `publicado`, own dependency-free Markdown subset parser (no raw HTML), SEO (title, meta description, canonical, Open Graph article), `/sitemap.xml` (`app/sitemap.ts`), waitlist CTA `/?ref=blog#lista-de-espera` at the end of every article, "Blog" link in the public footer, `BLOG_CONTENT_DIR` e2e fixtures hook (ignored in production), static pre-render (`generateStaticParams`, `dynamicParams = false`), no CMS / comments.

**Source**: `apps/web/src/app/(public)/blog/`, `apps/web/src/app/sitemap.ts`, `apps/web/src/lib/blog/`, `apps/web/src/components/blog/`, `apps/web/content/blog/`, `apps/web/src/components/shared/Footer.tsx`

---

## [Billing (plans, pricing, subscriptions)](./billing.md)

Plans per household: Esencial (featured, «Recomendado»; 4,99 €/mes, 49,99 €/año) and Plus (8,99 €/mes, 59,99 €/año: voice + proactive WhatsApp + higher caps), monthly/yearly switch, `/precios` public pricing page with comparison table (everything each plan includes) + FAQ, `/profile/suscripcion`, Stripe Checkout with Managed Payments (Link merchant of record, VAT included, `LINK.COM* MIMOIA`), pay during the beta → `trial_end` launch day 2027-01-12 (first charge then), customer portal (card, receipts, change plan, cancel at period end), `GET /billing`, `POST /billing/checkout|portal`, `POST /billing/webhook` (signed, re-reads the subscription), `subscriptions` table (migration 0049), lookup keys `esencial_mensual`…, `scripts/stripeSetup.ts`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, household owner only, account deletion cancels the subscription, beta = Plus for everyone, plan caps not enforced yet.

**Source**: `packages/shared/src/types/plans.ts`, `apps/api/src/services/billing.ts`, `apps/api/src/routes/billing.ts`, `apps/api/scripts/stripeSetup.ts`, `apps/web/src/components/billing/`, `apps/web/src/app/(public)/precios/page.tsx`, `apps/web/src/app/profile/suscripcion/page.tsx`, `apps/web/src/hooks/useBilling.ts`

---

## [Household](./household.md)

Multi-user "shared household" foundation: every authed user has a `primary_household_id` pointing at a `households` row, with `household_members` (one row per user, role `owner`/`member`/`child`) and `household_invites` (32-hex token, 7-day TTL, public preview at `GET /invites/:token`, authed accept at `POST /invites/:token/accept`). At registration we auto-create a solo household named "Mi casa" with the registrant as owner. Owners can rename, generate/revoke invites, remove members, and leave (auto-promotes the oldest remaining member to owner; auto-creates a new solo household for the leaver). Public preview is mounted on a dedicated router BEFORE `userRoutes` so `router.use(authMiddleware)` doesn't intercept it. `GET /households/me` returns name + members + pendingInvites; `/profile/casa` is the management surface. **PR 1B (shipped):** `menus`, `shopping_lists` and `user_favorites` carry a `household_id` column (backfilled in 0012); inserts dual-write; reads switch to household scope when `SHARED_HOUSEHOLD_SCOPE=true` (ON by default, production included, since Railway sets no `NODE_ENV`). The single helper `scopeResolver.resolveScope(userId)` + `scopeWhere(userCol, householdCol, scope)` keeps every route in sync.

**Source**: `apps/api/src/db/schema.ts` (`households`, `household_members`, `household_invites`, `users.primary_household_id`, `household_id` columns on menus/shopping/favorites), `apps/api/src/db/migrations/0011_*.sql` + `0012_pr1b_household_scope.sql`, `apps/api/src/services/householdStore.ts`, `apps/api/src/services/scopeResolver.ts`, `apps/api/src/routes/households.ts`, `apps/api/src/routes/auth.ts` (auto-create on register), `apps/api/src/routes/menus.ts` + `shopping.ts` + `recipes.ts` (scope-aware reads), `apps/api/src/services/menuGenerator.ts` + `assistant/skills.ts` (scope-aware favorites + pantry), `apps/api/src/index.ts` (mount order), `apps/web/src/app/profile/casa/page.tsx`, `apps/web/src/app/invites/[token]/page.tsx`

---

## [Cookbooks](./cookbooks.md)

Household-shared named recipe collections — "Favoritos de Sara", "Para diabéticos", "Recetas de mi madre". `cookbooks(id, household_id, name, description?, emoji?, created_at, updated_at)` + `cookbook_recipes(id, cookbook_id, recipe_id, added_at)` join with `UNIQUE(cookbook_id, recipe_id)` for idempotent add. REST: list / detail / CRUD on cookbooks + idempotent join mutations (`POST /cookbooks/:id/recipes/:recipeId`, `DELETE …`) + reverse lookup `GET /recipes/:id/cookbooks`. Pure name/emoji/description validators are unit-tested (9 cases). Frontend: `/profile/cookbooks` list + `/cookbooks/[id]` detail with inline editor + `<AddToCookbookButton />` bottom-sheet on `/recipes/[id]`.

**Source**: `apps/api/src/db/schema.ts` (`cookbooks`, `cookbookRecipes`), `apps/api/src/db/migrations/0017_pr8a_cookbooks.sql`, `apps/api/src/services/cookbooksStore.ts`, `apps/api/src/routes/cookbooks.ts`, `apps/api/src/tests/cookbooksValidate.test.ts`, `apps/web/src/hooks/useCookbooks.ts`, `apps/web/src/app/profile/cookbooks/page.tsx`, `apps/web/src/app/cookbooks/[id]/page.tsx`, `apps/web/src/components/recipes/AddToCookbookButton.tsx`

---

## [Cook from Pantry](./cook-from-pantry.md)

"Lo que puedes cocinar con lo que tienes" — PR 12. Ranks every catalogue recipe by what fraction of its required ingredients the household has at home (PR 11 pantry). Pure scorer `scoreRecipeAgainstPantry(ings, pantry)` exported + unit-tested (6 cases): coverage = matched / required, optional ingredients excluded from both sides, ties broken by matchedCount then totalRequired. REST: `GET /recipes/match-pantry?limit=N` (auth-only, default 3, max 20). Frontend: `<PantryMatchCard />` ink-on-cream card on `/menu` below the day's meals with up to 3 recipes + thumbnail + `<matched>/<total>` + coverage percentage. Hides itself when the pantry is empty or no recipe matches.

**Source**: `apps/api/src/services/pantryMatcher.ts`, `apps/api/src/routes/recipes.ts` (handler before `/recipes/:id`), `apps/api/src/tests/pantryMatcher.test.ts`, `apps/web/src/hooks/usePantryMatch.ts`, `apps/web/src/components/menu/PantryMatchCard.tsx`, `apps/web/src/app/menu/page.tsx`

---

## [Pantry](./pantry.md)

Household-shared register of "what's at home" — real quantities + units + optional expiry per item. Distinct from the legacy `shopping_lists.items.inStock` boolean (which only said yes/no). `pantry_items(id, household_id, ingredient_id?, name, quantity, unit, expires_at?, last_updated_at, created_at)` with a **partial unique index** on `(household_id, ingredient_id) WHERE ingredient_id IS NOT NULL` so catalog rows can't duplicate. REST: `GET /pantry`, `POST /pantry` (idempotent merge when `ingredientId` is set), `PATCH /pantry/:id`, `DELETE /pantry/:id`. **Auto-decrement**: `POST /cook-logs` resolves `scaleFactor = cookedServings / recipe.servings`, then deducts `recipeIngredient.quantity × scaleFactor` from every matching pantry row (same `ingredient_id`, same `unit`). Cross-unit conversion deferred. The decrement is best-effort — never blocks the cook-log insert; the response includes `pantry: { updatedRowIds, skipped }`. Pure `applyPantryDeduct` reducer is unit-tested (6 cases). Frontend: `/profile/pantry` page with inline-edit qty + expiry pills (red < 0d, terracotta ≤ 3d).

**Source**: `apps/api/src/db/schema.ts` (`pantryItems`), `apps/api/src/db/migrations/0016_pr11_pantry_items.sql`, `apps/api/src/services/pantryStore.ts`, `apps/api/src/routes/pantry.ts`, `apps/api/src/routes/cookLogs.ts` (calls `decrementPantryForRecipe`), `apps/api/src/tests/pantryDeduct.test.ts`, `apps/web/src/hooks/usePantry.ts`, `apps/web/src/app/profile/pantry/page.tsx`

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

Typed long-term storage of user preferences (dislikes, equipment, time-available per weekday, weekly budget, cuisine bias, cooking skill, meal times, free-form notes). Stable key registry + per-key Zod schema in `@ona/shared`. `user_memories` table, one row per (user_id, key). Advisor injects a Spanish-language digest into every system prompt; `update_memory` skill lets the assistant write inferred facts mid-conversation ("recuerda que no me gusta el cilantro"). REST: `GET /memory`, `PATCH /memory { key, value | facts: [...] }`, `DELETE /memory/:key`. Profile sub-page `/profile/memoria` lists every fact with source badge (Tú / Asistente / Onboarding). 19 contract tests.

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

Recipe hero photo: AI house photo (dish description → AiKit Imagen-fal or OpenAI gpt-image fallback `RECIPE_IMAGE_PROVIDER` → Claude vision check → one retry; automatic on create/import, replaces og:image/YouTube thumbnails, never user uploads), `POST /recipes/:id/regenerate-image`, monthly per-user quota `IMAGE_GEN_MONTHLY_LIMIT`, Railway volume storage (`IMAGE_STORAGE_DIR`, `IMAGE_PUBLIC_URL_BASE`), seed JPGs in `apps/web/public/images/recipes/`, catalogue photo audit `recipeImageAudit` / `auditRecipeImages.ts` (wrong dish / off-style / low-res), `generateRecipeImages.ts`.

**Source**: `apps/api/src/services/recipeImageGenerator.ts`, `apps/api/src/services/recipeHouseImage.ts`, `apps/api/src/services/recipeImageCheck.ts`, `apps/api/src/services/recipeImageAudit.ts`, `apps/api/scripts/auditRecipeImages.ts`, `apps/api/scripts/generateRecipeImages.ts`, `apps/web/src/hooks/useRecipes.ts`, `apps/web/src/hooks/useUser.ts`

---

## [Recipes](./recipes.md)

Recipe catalog, recipe detail, ingredients, sectioned ingredient groups ("Para la masa"), rich steps (text + duration + temperature + technique + ingredient refs), photos (Unsplash + Notion), system vs user recipes, public vs internal tags, favorites, search, meal/season/maxTime filters, «Con lo que tengo» (cook with what I have: 1–3 ingredients → ranked recipes + what is missing, basics excluded, GET /recipes/with-what-i-have), servings, diner scaler with culinary rounding, prepTime/cookTime/activeTime/totalTime, difficulty, equipment, allergens, notes/tips/substitutions/storage, yield, nutritionPerServing, imports and hero photos (see Recipe Import / Recipe Images), "Añadir al menú" sheet from the detail, edit pencil on the photo, sourceUrl/sourceType, hero image, RecipeCard, ServingsScaler. **Recipe detail "D · Luz y foto"**: tabs (Ingredientes · Pasos · Nutrición · Notas, `#hash`), sticky "Empezar a cocinar" action bar, tab bar hidden on the detail, desktop 50/50 split with sticky photo (`RecipeTabs`, `RecipeActionBar`, `useIsDesktop`). **Public catalogue**: `/recipes-ona` is the anonymous-readable list (no login) of system recipes, backed by the same `GET /recipes` endpoint via `optionalAuthMiddleware` — with a token it returns the full catalogue, without one it filters to `authorId IS NULL`. **One recipe page** (página de receta pública, public recipe page): `/recipes/[id]` (+ cook mode) opens signed out for catalogue recipes with the public chrome (PublicNavbar + Footer, `RootShell`, `lib/recipeShell.ts`) and a waitlist CTA (`RecipeWaitlistCta`); private recipe signed out → «Esta receta es privada»; `/recipes-ona/[id]` 308-redirects to `/recipes/[id]`. Share «Pásalo» = title + `/recipes/<id>?ref=receta` (no text). Link previews / Open Graph / canonical / twitter card from `app/recipes/[id]/layout.tsx` `generateMetadata` (`lib/recipeMetadata.ts`).

**Source**: `apps/api/src/routes/recipes.ts`, `apps/api/src/middleware/auth.ts` (`optionalAuthMiddleware`), `apps/api/src/services/withWhatIHave.ts`, `apps/api/src/services/recipeScaler.ts`, `apps/api/src/services/recipeImageGenerator.ts`, `apps/api/src/services/recipeHouseImage.ts`, `apps/api/src/services/recipeImageCheck.ts`, `apps/api/src/services/recipeImageAudit.ts`, `apps/api/scripts/auditRecipeImages.ts`, `apps/api/scripts/generateRecipeImages.ts`, `apps/api/scripts/handAuthoredRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`, `apps/api/scripts/dedupSystemRecipes.ts`, `apps/api/scripts/linkSeedRecipeImages.ts`, `apps/api/scripts/fillSeedCatalogGap.ts`, `apps/api/src/seed/recipes.ts`, `apps/web/src/app/recipes/`, `apps/web/src/app/(public)/recipes-ona/`, `apps/web/src/components/recipes/`, `apps/web/src/hooks/useRecipes.ts` (`usePublicRecipes` + `usePublicRecipe`), `apps/web/src/lib/api.ts` (`apiPublic`), `apps/web/src/hooks/useUser.ts`, `apps/web/public/images/recipes/`

---

## [Cooking Mode](./cooking-mode.md)

Hands-free fullscreen cook-along, step-by-step UX, per-step countdown timers, multiple concurrent timers, vibration + chime on timer fire, swipe between steps, ingredient checklist, inline scaled ingredient chips, temperature/technique badges, Wake Lock screen-on, live diner re-scaling inside cooking mode, «Mimo, manos libres» hands-free button (keeps listening through silences until turned off or leaving cook mode), exits cleanly without mutating the recipe, "Empezar a cocinar" entry point.

**Source**: `apps/web/src/app/recipes/[id]/cook/page.tsx`, `apps/web/src/components/cooking/` (`CookingShell`, `StepCard`, `StepTimer`, `ChecklistPanel`), `apps/web/src/hooks/useWakeLock.ts`, `apps/web/src/hooks/useStepTimers.ts`, `apps/web/src/lib/mimoHandsFree.ts`

---

## [Ingredient Auto-Create](./ingredient-auto-create.md)

USDA-backed flow that lets users add a missing ingredient without leaving the recipe form. `GET /ingredients/suggest` returns Foundation/SR Legacy candidates + per-100 g nutrition, `POST /ingredients/auto-create` persists with full nutrition + inferred allergens. Fuzzy dedupe (Levenshtein ≤ 2 on normalized names), Branded entries filtered out, Spanish-to-English query translation, "Crear sin nutrición" escape hatch. Same pipeline reused by the photo extractor and `apply:recipes --auto-create-missing`.

**Source**: `apps/api/src/services/ingredientAutoCreate.ts`, `apps/api/src/routes/ingredients.ts` (`/suggest`, `/auto-create`), `apps/web/src/components/recipes/IngredientAutocomplete.tsx`, `apps/web/src/hooks/useIngredients.ts`

---

## [Roles & Authorization](./roles.md)

Two-role system: `user` (default) + `admin`. Admin role is bootstrapped via `ADMIN_EMAILS` env var — on every login the server reconciles role to env. `requireAdmin` middleware extends `requireAuth` and checks both `role === 'admin'` and `suspended_at IS NULL` per request. Suspended users get 403 with `code: 'SUSPENDED'`. JWT payload only carries `userId`; role is fetched from DB to avoid stale tokens. Frontend auth context exposes role for navbar gating; server still enforces.

**Source**: `apps/api/src/db/schema.ts` (`users.role`, `users.suspended_at`), `apps/api/src/middleware/auth.ts` (`requireAuth`, `requireAdmin`), `apps/api/src/config/env.ts` (`ADMIN_EMAILS`), `apps/web/src/lib/auth.tsx`

---

## [Admin Dashboard](./admin-dashboard.md)

Admin-only page at `/admin` (renamed from `/curator`, gated by `requireAdmin`). Tabs: catalog gaps (sin USDA, sin pasillo, sin densidad, sin peso por unidad, alérgenos sugeridos), system recipes con kcal=0, regen output, **Usuarios** sub-tab, **Auditoría** sub-tab. Reuses the ingredient auto-create modal's USDA flow (manual search + Spanish translations + BEDCA fallback + LLM estimation). Old `/curator` URL kept as a 301-redirect for back-compat.

**Source**: `apps/api/src/routes/admin.ts`, `apps/web/src/app/admin/`, `apps/web/src/hooks/useAdmin.ts`

---

## [My Recipes](./my-recipes.md)

User-scoped recipe curator inside `/profile` ("Mis recetas" tab). Lists recipes where `authorId === user.id`, filters for quality gaps (sin nutrición, sin equipo, ingredientes pendientes de revisar — entries with note 'añadido automáticamente'), edit / delete from each row's "···" sheet, counts strip, future "veces cocinada" + calificación propia. No catalog editing or user management — those are admin-only.

**Source**: `apps/web/src/app/profile/sections/MyRecipesSection.tsx`, `apps/web/src/hooks/useMyRecipes.ts`, `apps/api/src/routes/users.ts` (recipes-curator/gaps endpoint)

---

## [Business Metrics & Cost Ledger](./metrics.md)

`GET /admin/metrics?weeks=8` for the Dirección / Finance agents: weekly active households, resolved weeks (menu for the week + shopping-list use that week or the weekend before), new households, signup cohorts with W1–W4 retention, cost per active household (EUR) by provider and feature, ISO weeks on the Europe/Madrid clock, KPIs, activation, retention, unit economics. Auth: admin JWT or read-only `x-metrics-token` = `METRICS_READ_TOKEN` (GET only, 405 METRICS_TOKEN_READ_ONLY otherwise; also opens /admin/usage, /admin/errors, /admin/waitlist, /admin/assistant-reviews/flags; disabled when unset); admins/suspended excluded unless `includeInternal=1`. Cost ledger `cost_events` (one row per paid provider call: Anthropic Claude, OpenAI transcription (WhatsApp voice notes, Mimo's voice), ElevenLabs read-aloud, Meta WhatsApp templates, AIKIT images; historical Realtime voice rows; user, household, feature, model, units, micro-euros; fire-and-forget; AsyncLocalStorage attribution), `activity_events` (shopping check / in-stock / add), price table `config/pricing.ts` with `COST_PRICE_OVERRIDES` and `ADVISOR_EUR_PER_USD` FX, `getUserMonthlySpendEur` for budget limits, UNVERIFIED prices, migration 0033, `errors` block (7-day summary of the in-house error tracker; the same token also opens `GET /admin/errors`). Product analytics / eventos de uso: `usage_events` (migration 0045, own table, no third party), `trackEvent` fire-and-forget, `props` sanitised (no free text), events signup_completed, onboarding_completed, first_steps_completed/skipped, menu_generated, meal_swapped, shopping_list_viewed, shopping_item_checked, recipe_imported (source url/photo/whatsapp_photo/whatsapp_url/social), recipe_created, cook_mode_started, meal_cooked, mimo_message (channel web/whatsapp/voice), whatsapp_linked, shop_order_prepared, carrefour_click (botón «Hacer este pedido en Carrefour.es» on the súper card of /compra, PRO-84), app_opened_installed (passive; `POST /usage/app-opened`, device android/ios/desktop, once per household and day); installed PWA / app instalada and push notifications on (avisos activados, `push_subscriptions`) per device in `/admin/metrics` weekly (`installedAppHouseholds`, `pushEnabledHouseholds`, PRO-83); web middleware `trackUsageRoutes` + Mimo skill runner `recordSkillUsage`, `x-mimoia-internal` header avoids double counting; `GET /admin/usage?days=28` daily/weekly counts, active households (DAU/WAU), activation funnel (signup → first menu → shopping list → cooked → active week 2), 180-day retention purge in the scheduler tick.

**Source**: `apps/api/src/routes/metrics.ts`, `apps/api/src/middleware/metricsAuth.ts`, `apps/api/src/services/businessMetrics.ts`, `apps/api/src/services/usageEvents.ts`, `apps/api/src/services/usageReport.ts`, `apps/api/src/db/migrations/0045_usage_events.sql`, `apps/api/src/services/costLedger.ts`, `apps/api/src/services/activityEvents.ts`, `apps/api/src/config/pricing.ts`, `apps/api/src/db/migrations/0033_cost_ledger.sql`

---

## [Error Tracking (in-house)](./errors.md)

Own error tracker, Sentry alternative with no third party: `app_errors` grouped table (fingerprint = kind + normalised message + top stack frame; count, first/last seen, sample stack/path, release, browser family, last user, resolved), client errors from the web (`window.onerror`, `unhandledrejection`, `error.tsx` / `global-error.tsx` boundaries "Algo se ha torcido", `navigator.sendBeacon` / keepalive fetch to public `POST /client-errors`, 8 KB cap, per-IP 30/min, dedupe per page load, ≤ 10 reports per page, off in dev unless `NEXT_PUBLIC_ERROR_REPORTING`), API 5xx capture (route pattern, console.error capture via AsyncLocalStorage, error middleware, `unhandledRejection`), scrubbing (emails, phones, IPs, JWT, Bearer, query strings, SQL params, tokens), write throttle / coalescing, `GET /admin/errors` for Mimoia HQ agents (admin JWT or `x-metrics-token`), `POST /admin/errors/:id/resolve` (audited), `errors` block in `/admin/metrics`, migration 0036.

**Source**: `apps/api/src/services/appErrors.ts`, `apps/api/src/routes/appErrors.ts`, `apps/api/src/middleware/errorCapture.ts`, `apps/api/src/db/migrations/0036_app_errors.sql`, `packages/shared/src/types/clientErrors.ts`, `apps/web/src/lib/errorReporter.ts`, `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`

---

## [Admin Audit Log](./admin-audit-log.md)

Append-only `admin_audit_log` table — every successful admin mutation lands here. Action codes (`ingredient.create/update/remap`, `recipe.update/delete`, `user.suspend/unsuspend`, `user.reset_password.generate`). Payload is a JSONB before/after diff. Browseable from the "Auditoría" sub-tab in `/admin` with filters by admin and action code, paginated 50/page. Reset-token secrets never appear in payloads (only `token_id` + `expires_at`). Action codes are stable forever — never renamed.

**Source**: `apps/api/src/db/schema.ts` (`admin_audit_log`), `apps/api/src/services/auditLog.ts`, `apps/web/src/app/admin/sections/AuditLogSection.tsx`

---

## [User Management](./user-management.md)

Admin sub-tab at `/admin` → "Usuarios": paginated list (search by username/email, filter "solo suspendidos"), per-user detail panel (profile, restrictions, registration date, counts), **suspend** / **unsuspend** with confirm modal, **generar enlace de reset** (24 h one-time token, link copied to clipboard, admin sends manually — no automated email). Suspending an admin is allowed but logged. Out of scope v1: delete user, edit user profile, impersonate. Public `/reset?token=X` consume page.

**Source**: `apps/api/src/db/schema.ts` (`password_reset_tokens`), `apps/api/src/routes/admin.ts` (users endpoints), `apps/api/src/services/passwordReset.ts`, `apps/web/src/app/admin/sections/UsersSection.tsx`, `apps/web/src/app/(auth)/reset/page.tsx`

---

## [Nutrition](./nutrition.md)

Per-serving nutrition (kcal, protein, carbs, fat, fiber, salt), per-ingredient catalog with USDA FoodData Central (FDC) mapping via `fdcId`, per-100 g nutrition columns directly on the `ingredients` table (no separate `ingredient_nutrition` table), density (g/ml), unitWeight (g/u), recipe-level aggregation cached on save, allergen tags (gluten, lactosa, huevo, frutos secos, soja, pescado, marisco, sésamo, sulfitos…), "sin gluten" filtering, advisor + menu generator consume real nutrition, USDA seed cache.

**Source**: `apps/api/src/services/nutrition/`, `apps/api/src/seed/usda.ts`, `apps/api/src/db/schema.ts` (per-100 g columns on `ingredients`)

---

## [Recipe Quality](./recipe-quality.md)

Lint validator for recipe data integrity, blocks save on missing ingredients in steps, orphan ingredients, out-of-range gramajes per serving, broken `ingredientRefs`, time-sum inconsistency, public/internal tag leakage. Warnings for nutrition gaps, missing density, suspicious kcal. **Shoppability** (`BUY_NO_QUANTITY`, `BUY_GENERIC`, `BUY_NEEDS_CHOICE`, `BUY_NEEDS_WEIGHT`): ingredients the shopping list / shop orders can't use (al gusto, ternera sin corte, hierbas genéricas, panceta en unidades) → `shoppingIssues` on the recipe detail, "Para hacer la compra" card. Same lint runs on user save, on photo extraction, and on the LLM regeneration pipeline. Curator scripts: `regenerateRecipes.ts` (LLM-driven JSONL output) + `applyRegeneratedRecipes.ts` (human-reviewed apply). Per-ingredient sanity ranges.

**Source**: `apps/api/src/services/recipeLint.ts`, `apps/api/src/services/recipeShoppability.ts`, `apps/web/src/components/recipes/ShoppingIssues.tsx`, `apps/api/scripts/regenerateRecipes.ts`, `apps/api/scripts/applyRegeneratedRecipes.ts`

---

## [Menus](./menus.md)

Weekly meal planning, menu generation algorithm using cached `nutritionPerServing`, recipe matcher, slot regeneration, meal locking, calorie targets, BMR, season detection, favorites boost, no-repeats, week navigation, WeekStrip day strip, "D · Luz y foto" layout, featured-meal photo hero, "Empezar a cocinar", meal "···" sheet (Vetar, Tipo, Fijar, Comensales, Quitar), week "···" sheet (Regenerar semana, Compartir, Vaciar semana, Vista semana, Historial), desktop "La semana" columns, drag and drop move-slot, editorial photo-less cover, menu history, day index 0-6 (Monday-Sunday), household-weighted scaling (`adults + 0.5 × kidsCount`), catalogue quality gate / auditoría del catálogo (recipes without steps, too few ingredients, quantities per serving out of range skipped by the generator, PRO-73).

**Source**: `apps/api/src/routes/menus.ts`, `apps/api/src/services/menuGenerator.ts`, `apps/api/src/services/recipeMatcher.ts`, `apps/api/src/services/catalogRecipeAudit.ts`, `apps/api/scripts/auditCatalogRecipes.ts`, `apps/web/src/app/menu/`, `apps/web/src/components/menu/`, `apps/web/src/hooks/useMenu.ts`

---

## [Shopping](./shopping.md)

Auto-generated shopping list, unit-aware ingredient aggregation (g/ml/u/cda/cdita), unit conversion via `density`/`unitWeight`, aisle grouping (produce/proteínas/lácteos/panadería/despensa/congelados), household-weighted scaling (`adults + 0.5 × kidsCount`) over `recipe.servings`, optional ingredient handling, regenerate endpoint, check-off items, pantry stock manager, inStock toggle, export to clipboard, list vs stock tabs, progress bar. **PR 10A:** manual free-text items (`kind: 'manual'`, `ingredientId: null`), per-item `pricePerUnit`, weekly-total banner powered by the pure `computeListTotal` reducer. **PR 10B:** household recurring staples — `household_staples` table (per-household, soft-toggleable via `active`); the aggregator pre-pends every active staple to every fresh + regenerated list (dedup'd by name via `mergeStaplesIntoItems`); regenerate now preserves manual items + re-applies staples. REST: `POST /shopping-list/:id/items`, `PATCH /shopping-list/:id/item/:itemId`, `DELETE /shopping-list/:id/item/:itemId`, `GET /shopping-list/:id/totals`, `GET / POST /staples`, `PATCH / DELETE /staples/:id`.

**Source**: `apps/api/src/routes/shopping.ts`, `apps/api/src/routes/staples.ts`, `apps/api/src/services/shoppingList.ts` (incl. `computeListTotal`, `mergeStaplesIntoItems`), `apps/api/src/services/staplesStore.ts`, `apps/api/src/db/schema.ts` (`householdStaples`), `apps/api/src/db/migrations/0014_pr10b_household_staples.sql`, `apps/web/src/app/shopping/`, `apps/web/src/components/shopping/` (incl. `ShoppingExtensions.tsx`), `apps/web/src/hooks/useShopping.ts`, `apps/web/src/hooks/useStaples.ts`, `apps/web/src/app/profile/staples/page.tsx`

---

## [Compra en mis tiendas](./shop-orders.md)

"Hazme la compra" without any supermarket API: the household's own shops (`household_shops`: frutería, carnicería, pescadería, supermercado, otra; WhatsApp / email / web / teléfono; recoger o a domicilio) and per-shop orders (`shop_orders`, status draft → sent → quoted → approved → closed/cancelled, lines as JSONB snapshot). `POST /shop-orders/prepare` rebuilds the 7-day list and routes each pending line by name/aisle (fish → pescadería, meat → carnicería, produce → frutería, packaged → súper), skipping pantry basics (cda/cdita, sal, aceite, especias) and lines already in an open order. Order written in the customer's voice ("Hola, soy Miguel. Os paso un pedido…"), fish asked in clean weight with FAO whole-weight conversion (merluza ÷0.53), accents restored on catalogue names; handed over as `wa.me` / `mailto` / web checklist with El Corte Inglés per-product search links. Shop reply pasted or forwarded → Claude Haiku parse + pure normaliser → per-line OK / Revisar / No hay (±10 % vs the user's own or the shop's last €/kg, wild "lonja" fish always to approval, substitutes and different quantities to the user, "no hay" dropped never substituted) + cap "hasta X €" (only proposed from precise prices). Approve → confirmation message + `price_memory`; close → ticks the list. Public side-effect-free short links `GET /shop-orders/link/:token` + web `/c/[token]` redirect. Mimoia never messages a shop nor handles money. **v1.1 buy rules** (`@ona/shared` buy/rules + convert): ~150 curated "cómo se compra" rules (pieza/peso/envase, cabeza/manojo/bandeja, minimums, medio melón, choices serrano/ibérico remembered in `household_buy_prefs`, súper packs, "probablemente lo tienes", El Corte Inglés search text), compounds split, duplicates merged, blockers (choice / amount / address), pickup vs delivery per order with address + ETA question, delivery minimum per shop, add before sending (`PATCH { add }`, `edit_shop_order`), recipe notes carried into the list; migration 0038. Pages `/compra`, `/compra/tiendas`; skills `manage_shops`, `prepare_shop_orders`, `register_shop_reply`, `approve_shop_order`, `close_shop_order`, `get_shop_orders`; migration 0034. Botón «Hacer este pedido en Carrefour.es» on the súper card (search link per line on carrefour.es, no affiliation, click counter `carrefour_click`, PRO-84).

**Source**: `packages/shared/src/types/shopOrders.ts`, `packages/shared/src/utils/shopFormat.ts`, `apps/api/src/services/shopOrders/`, `apps/api/src/routes/shopOrders.ts`, `apps/api/src/services/assistant/shopOrderSkills.ts`, `apps/api/src/db/migrations/0034_shop_orders.sql`, `apps/web/src/app/compra/`, `apps/web/src/app/c/[token]/route.ts`, `apps/web/src/components/compra/`, `apps/web/src/hooks/useShopOrders.ts`

---

## [Advisor](./advisor.md)

AI chat assistant named Mimo (of Mimoia; `ASSISTANT_NAME`, persona "Hola, soy Mimo, de Mimoia", renamed 2026-10-08), floating companion on every signed-in page (D-023: `MimoButton` with the brand spoon as Mimo's face, `MimoPanel` bottom sheet < lg / 400 px right column at lg+ with `--mimo-panel-width`, per-page suggestions, «Empezar de nuevo», conversation kept across navigation in sessionStorage `mimo.chat.v1`, pages refresh after `actionTaken`, no «Asesor» tab, `/advisor` → `/menu?mimo=1`), page context (`context.path` → hidden «Pantalla actual» note, `pageContext.ts`, recipe named only if `canViewRecipe`), chat modes text / voice / onboarding, AI disclosure (EU AI Act art. 50: permanent caption in the Mimo panel, first WhatsApp messages — `AI_DISCLOSURE*` in `@ona/shared`), function calling, 64 skills total (7 shop-order skills — manage_shops, prepare_shop_orders, edit_shop_order, register_shop_reply, approve_shop_order, close_shop_order, get_shop_orders; 24 UI-parity skills over the app REST API: meal notes "cenamos fuera", skip day, multi-dish, servings, lock, move, ban, leftovers, shopping items, staples, pantry, cook log, recipe notes/rating, cookbooks, profile restrictions, weekly template, household invite), resolutive mode (all requests per turn, "Hecho:" replies, explicit request beats stored dislike, refusal guard), multi-round tool loop (up to 6 rounds/turn), Claude Sonnet 5.5 (adaptive thinking, effort medium; Haiku 4.5 until 2026-10-12), cooking knowledge (answers how-to questions without the catalogue), cacheable prompt (instructions vs user context), tool trace per turn (⟦hecho: …⟧ in WhatsApp history, daily review sees inputs/results), truncation retry, refusal fallback, health questions (PRO-62: `HEALTH_RULE` — Mimo no es médico, deriva al pediatra o al médico ante bebés, diabetes, tensión o síntomas, «Mimoia no sustituye a un profesional sanitario», nada de glucosa ni insulina; `health_talk` flag; live eval `scripts/evalHealthAnswers.ts`), tools per channel, memory list merge, unverified-claim flag (no forced rewrites), import_recipe_from_url (share a recipe link → saved recipe), menu/recipe reads (get_todays_menu, get_recipe_details, get_weekly_nutrition, get_shopping_list, suggest_recipes, search_recipes, get_my_recipes, get_menu_history, scale_recipe), WhatsApp-first sign-up (complete_onboarding, first steps in the chat, «¿Dónde quieres hablar con Mimo?» on /onboarding), mutations (generate_weekly_menu, swap_meal, toggle_favorite, mark_meal_eaten, create_recipe, edit_recipe, recipe_variation, mark_in_stock, check_shopping_item, update_household, add_recipe_to_mine), pantry (get_pantry_stock), advice grounded in Mimoia's cooking principles (`kb/principios-mimo.md`, «Cómo cocina Mimoia», PRO-67; nutrition_advice, evaluate_food_health, suggest_substitution, get_variety_score, get_eating_window, cook_with_what_i_have — «tengo X y Y, ¿qué hago?», get_week_balance — kitchen balance of the week in cooking words, no health claims), and cooking-mode voice control (start_cooking_mode, set_timer, cooking_step). One brain for typing and talking: voice input (record → `POST /stt` → chat `mode: 'voice'`), read-aloud (`POST /tts`, ElevenLabs, browser fallback), «Manos libres», Spanish, conversation history, `useMimo`, `useRecorder`, `useVoice`, suggested prompts, microphone button.

**Source**: `apps/api/src/routes/assistant.ts`, `apps/api/src/routes/stt.ts`, `apps/api/src/services/assistant/` (incl. `pageContext.ts`), `apps/web/src/components/mimo/`, `apps/web/src/app/advisor/` (redirect), `apps/web/src/hooks/useAssistant.ts`, `apps/web/src/hooks/useRecorder.ts`, `apps/web/src/hooks/useVoice.ts`, `apps/web/src/lib/cookingCommands.ts`

---

## [Voice (Mimo)](./voice-mode.md)

Talking to Mimo in the app (D-023, 2026-10-09): the same Claude assistant for typed and spoken turns, tap-to-talk mic in the Mimo panel, `useRecorder` (MediaRecorder + analyser, silence detection ~1.3 s, 8 s no-speech, 30 s cap), `POST /stt` (OpenAI transcription, `mimo_voice_transcription`, 60/min, ≤ 10 MB), chat `mode: 'voice'` (short spoken replies), read-aloud `POST /tts` (ElevenLabs, `chat_tts`, `ELEVENLABS_VOICES`, «Voz de Mimo» picker with preview, browser `speechSynthesis` fallback), «Leer las respuestas en voz alta» (`localStorage mimo.speak`), «Manos libres» hands-free loop, «Mimo, manos libres» in cook mode (silence doesn't end it, leaving `/cook` does; `lib/mimoHandsFree.ts`), Web Speech recogniser fallback, no spoken activation phrase (Mimo opens with a tap, D-032), profile chapter 04 «Mimo por voz», voice onboarding loop, cooking by voice, Spanish. OpenAI Realtime retired (no `/realtime/*`, no orb overlay, no «Modo voz» toggle, no minutes quota; `voice_transcripts` no longer written).

**Source**: `apps/web/src/components/mimo/MimoProvider.tsx`, `apps/web/src/components/mimo/MimoPanel.tsx`, `apps/web/src/hooks/useRecorder.ts`, `apps/web/src/hooks/useVoice.ts`, `apps/web/src/lib/mimoHandsFree.ts`, `apps/api/src/routes/stt.ts`, `apps/api/src/routes/tts.ts`, `apps/api/src/services/stt.ts`, `apps/api/src/services/tts.ts`

---

## [PWA](./pwa.md)

Native-feeling Progressive Web App: installable (Android + iOS), offline-capable (app shell + viewed recipes via next-pwa runtime caching), IndexedDB mutation queue replayed on the `online` event, install prompt bottom sheet (3-visit / second-`/menu`-visit gate, 30/365-day dismissal windows), haptic feedback (Vibration API), Web Share (recipe + shopping export), Wake Lock cooking mode, local meal-time Notifications scheduled via `setTimeout`, View Transitions API + motion/react page transitions, global loading state = delayed 2 px terracotta top bar (`app/loading.tsx`, no animated splash, no full-screen loader), SwipeNavigator pan-gesture between bottom tabs, manifest, service worker (next-pwa / Workbox), apple-touch-icon, 8 splash screens, status bar tinting, safe-area-inset CSS variables, dynamic theme-color per section (cream app / ink public), maskable icons, monochrome adaptive icon, iOS Safari quirks, "sin conexión" banner.

**Source**: `apps/web/public/manifest.webmanifest`, `apps/web/public/icons/`, `apps/web/src/lib/pwa/`, `apps/web/src/components/pwa/`, `apps/web/next.config.ts`

---

## [Notifications](./notifications.md)

Server-side Web Push (VAPID keys, `push_subscriptions` table, `web-push` lib) so the assistant can reach the user even with the tab closed — foundation for prep alerts ("saca el pescado del congelador 24h antes"), menu reminders, future heartbeat events. Subscribe / unsubscribe / test endpoints under `/push/*`; service worker handles `push` + `notificationclick`. Dead endpoints (404/410 Gone) auto-reap on next dispatch. Prep alerts are checked against the current menu right before sending (regenerated week, skipped day, dish gone → `cancelled`). Profile card opt-in. Degrades to "Push no configurado" when VAPID env vars are missing.

**Source**: `apps/api/src/db/schema.ts` (`pushSubscriptions`), `apps/api/src/db/migrations/0015_push_subscriptions.sql`, `apps/api/src/services/pushNotifier.ts`, `apps/api/src/routes/push.ts`, `apps/api/src/config/env.ts` (`VAPID_*`), `apps/web/worker/index.ts`, `apps/web/src/lib/webPush.ts`, `apps/web/src/hooks/useWebPush.ts`, `apps/web/src/app/profile/page.tsx`

---

## [WhatsApp](./whatsapp.md)

WhatsApp channel for the assistant via Meta WhatsApp Cloud API: webhook (`GET` verify handshake + `POST` with `X-Hub-Signature-256` HMAC over the raw body, mounted before `express.json()`), wamid dedupe, async per-phone serial queue, WhatsApp-first linking (unlinked number gets a `/whatsapp/conectar` link → login/register → send a one-time code from WhatsApp; the sending phone is the one linked, so forwarded links can't hijack), profile linking with a one-time 6-char code sent from WhatsApp (`wa.me` deep link "Vincular Mimoia: XXXXXX", 10-min TTL), `whatsapp_links` / `whatsapp_link_codes` / `whatsapp_messages` (server-side chat history: last 20 msgs within 12 h), `chat(..., { mode: 'whatsapp' })` system-prompt mode, `[[opciones: Sí | No]]` → native reply buttons, voice notes transcribed with OpenAI `gpt-4o-mini-transcribe`, recipe photos + shared links imported as recipes, proactive messages (daily brief, cooking reminder for long dinners, "¿hiciste la cena?" check-in → log_cooked, Saturday shopping reminder, Sunday "¿te preparo el menú?" nudge, prep alerts; per-kind switches `whatsapp_links.prefs` editable by chat via set_whatsapp_notifications), daily conversation reviewer agent (Opus 5.5 reviews yesterday's chats → `assistant_reviews`, `GET/POST /admin/assistant-reviews`, WhatsApp summary to WHATSAPP_REVIEW_EMAILS; deterministic detectors health_talk / health_claim (§6 guard list) / unverified_done ("Hecho" without a change in the tool trace) / error_refusal; anonymised flags for the Mimoia HQ agents `GET /admin/assistant-reviews/flags` with metrics token, `anonymise()` masks names, phones, emails, addresses) respecting Meta's 24 h window with optional template fallback `WHATSAPP_TEMPLATE_NAME`, Europe/Madrid clock, deep links into the app by `uiHint`, monthly € budget + suspension + `WHATSAPP_ALLOWED_EMAILS` gates, stale-retry drop (>2 h), `/profile` "WhatsApp" card ("Mimo en WhatsApp") (connect, masked phone, notify toggle, disconnect), real number +34 626 68 55 11 on Mimoia's own Meta app since 2026-10-14 (before: Meta test number, 5 recipients; duplicate-WABA gotcha), env `WHATSAPP_*` + `WEB_PUBLIC_URL`, WhatsApp-first sign-up ends with three suggestions after the opt-in answer (`first_steps`, PRO-07).

**Source**: `apps/api/src/routes/whatsapp.ts`, `apps/api/src/services/whatsapp/`, `apps/api/src/services/assistantFlags.ts`, `apps/api/src/services/anonymise.ts`, `apps/api/src/db/migrations/0030_whatsapp.sql`, `apps/api/src/services/assistant/systemPrompt.ts`, `apps/api/src/services/stt.ts`, `apps/api/src/services/recipeImport.ts`, `apps/web/src/components/profile/WhatsAppCard.tsx`, `apps/web/src/hooks/useWhatsApp.ts`

---

## [Design System](./design-system.md)

Editorial design system, brand Mimoia everywhere users see it (`BRAND_NAME`, rename guard `brandName.test.ts`: the old project name survives only in technical identifiers such as `@ona/shared`), imagotipo / logo (spoon with a heart cut-out, `MimoiaLogo`, `MimoiaSymbol`, `MimoAvatar`, lowercase "mimoia" lockup), one shared public footer (`Footer.tsx`, contact `lib/contact.ts` → hola@mimoia.com), one public grid / rejilla pública (`public-container` utility, `--public-max` 1200 px, `--public-gutter` 24/40 px; navbar logo, footer logo and page h1 aligned; reading pages / páginas de lectura left-aligned 720 px column; `e2e/public-grid.spec.ts`), design tokens (`@theme` in globals.css), color palette (cream, ink, terracotta, forest, mint), typography (Fraunces variable, Cormorant Garamond italic, Inter, JetBrains Mono), motion/react animations, magnetic buttons, grain texture, link-reveal underlines, marquee, layoutId pill nav, editorial mode pages (landing, como-funciona, recipes, recipe detail "D" with tabs + sticky action bar), app mode legacy pages (menu, shopping, profile), Tailwind v4, mobile-first 430px max-width, 4-tab bottom tab bar (Menú, Compra, Recetas, Perfil), components (RecipeCard, meal photo cards, WeekStrip, Navbar, FavoriteButton, MimoProvider, MimoPanel, MimoButton floating companion)., labelled bottom tab bar, menu), app mode legacy pages (shopping, font-serif-text, terracotta-deep, ink-muted, MenuSheet, RecipeCover

**Source**: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/shared/`, `apps/web/src/components/mimo/`

---
