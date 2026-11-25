# Specs Index · Cuenta, hogar, comunicación y administración

> Parte de [Specs Index](./index.md) (la portada lista todas las partes): auth, versión, privacidad, email, newsletter, lista de espera, blog, planes, opiniones, hogar, roles, admin, métricas, uso, errores, sonda diaria del menú, auditoría, usuarios, diseño y ficha del hogar.

## [Authentication](./auth.md)

**Partes**: [Onboarding](./auth-onboarding.md)

Registration, login, logout, JWT tokens, session management, onboarding flow, password hashing, public vs protected routes (one rule: open-page list in `lib/routeAccess.ts`, every other page signed out → `/login?next=<path+query>`, protected by default, sin cuenta, redirect to login, RootShell), AuthProvider, demo user, username/email login, bcrypt, `?next=` return path on login/register (safeNext, no open redirect), «Primeros pasos» guide on /menu for new accounts (first_steps_pending, POST /user/:id/first-steps, FirstStepsGuide, PRO-07).

**Source**: `apps/api/src/routes/auth.ts`, `apps/api/src/middleware/auth.ts`, `apps/web/src/lib/auth.tsx`, `apps/web/src/lib/routeAccess.ts`, `apps/web/src/components/shared/RootShell.tsx`, `apps/web/src/app/(auth)/`, `apps/web/src/app/onboarding/`

---

## [Version (deployed commit)](./version.md)

Which commit is deployed: a `VERSION_SHA` file the deploy leaves at the top of the tree (gitignored); the API answers it on `/version` (public, no-store), the web on `/version.json` (baked during `next build`); `null` without the file. PRO-365.

**Source**: the `version` route of the API, the web's `version.json` route handler and its `versionSha` helper

---

## [Privacy & account deletion](./privacy.md)

"Borrar mi cuenta" (GDPR art. 17, right to erasure), `DELETE /user/:id` with password, own recipes deleted (never fall into the catalogue), household ownership hand-over, menus/shopping reassigned, WhatsApp messages purged, volume images removed, admin accounts refused (409 ADMIN_ACCOUNT), `/privacidad` privacy policy (processors Anthropic/Groq/OpenAI/Meta/Railway/AiKit/Cloudflare/Resend/Oracle Cloud, nightly encrypted backups kept 14 days, erasure log `erasure_log` (15 days) replayed after a restore with `db:apply-erasures`, Cloudflare Web Analytics cookieless beacon only when NEXT_PUBLIC_CF_BEACON_TOKEN is set, own usage events kept 180 days, health data consent art. 9, international transfers, AEPD, no cookies), NEXT_PUBLIC_SUPPORT_EMAIL, support phone NEXT_PUBLIC_SUPPORT_PHONE / SUPPORT_PHONE (aviso legal, términos, Mimo).

**Source**: `apps/api/src/services/accountDeletion.ts`, `apps/api/src/routes/users.ts`, `apps/web/src/components/profile/DeleteAccountCard.tsx`, `apps/web/src/app/(public)/privacidad/page.tsx`, `apps/web/src/lib/cfBeacon.ts`, `apps/web/src/app/layout.tsx`

---

## [Email](./email.md)

Transactional email via Resend (REST API with fetch, no SDK, EU region, mimoia.com verified, D-050), `sendEmail` / `sendEmailBatch` (≤100 per call), `RESEND_API_KEY` unset → skipped (no email in CI/staging), `EMAIL_FROM` Mimoia <hola@mimoia.com>, `RESEND_BASE_URL`, never throws (sent/skipped/failed), masked recipients in logs (`maskEmail`), brand HTML template + text version (`renderBrandEmail`, tables, inline styles, 600 px), `List-Unsubscribe` header, waitlist invitation email «¡Te toca! Ya puedes entrar en Mimoia» sent by `POST /admin/waitlist/invite` (`sendEmail: false` to skip, `emailStatus` per person), PRO-93; personal link `/entrar/<token>` + one reminder at 3 days (`waitlistInviteReminderEmail`), fake Resend in e2e (`E2E_MAIL_URL`), PRO-97; shared brand shell (`emailBrand.ts`: logo, accent headline, forest button, signature, footer band), emails signed by Miguel; welcome email on sign-up (bienvenida: beta / household / general, `welcomeKind`); password reset email («¿Has olvidado la contraseña?», `/recuperar`, `POST /auth/forgot`, 1-hour link, 3 per hour); staging mail sink (buzón de pruebas, `EMAIL_SINK_DOMAINS`, `GET /email-sink`, never on production).

**Source**: `apps/api/src/services/email.ts`, `apps/api/src/services/emailBrand.ts`, `apps/api/src/services/waitlistEmails.ts`, `apps/api/src/services/accountEmails.ts`, `apps/api/src/services/accountMailer.ts`, `apps/api/src/routes/waitlist.ts`, `apps/api/src/routes/auth.ts`

---

## [Newsletter «El menú de los viernes»](./newsletter.md)

**Partes**: [Carta personal, números, editor, clics y receta por persona](./newsletter-contenido.md)

Weekly visual email for waitlist entries that ticked the newsletter box (LSSI consent), `POST /admin/newsletter/send` (admin JWT; `dryRun` counts, `testTo` one proof to an admin, real send via Resend batch ≤100, audited `newsletter.send`), content as data (star recipe full-width photo + alt, novedad, truco con Mimo, one CTA) rendered by `renderNewsletterEmail` (tables, inline styles, 600 px), idempotent per issue (`newsletter_sends` unique issue + sha256(email), migration 0046, failed/skipped claims released), newsletter-only opt-out `/newsletter/baja?t=w.<token>` + `POST /newsletter/unsubscribe` (place on the list stays), RFC 8058 `List-Unsubscribe-Post` one-click, hint «Te lo recomendamos: te va a sorprender», PRO-94; beta households opt in at /register or with the profile switch (`users.newsletter_opt_in`, migration 0047, `GET/PUT /newsletter/me`, user token `u.<id>.<hmac>`, one switch per email), PRO-95. Own click counter per link and opt-outs per issue (PRO-191: `newsletter_clicks`, `newsletter_unsubscribes`, mimoia.com/n/<issue>/<n> redirect, `GET /newsletter/click`, `GET /admin/newsletter/stats`, Resend tracking off; an opt-out counts under its issue only if that issue was sent to that address, `wasSentTo`, else under `unsubscribesWithoutIssue`). Receta y truco por persona (PRO-1020, D-122 point 4): each account gets a recipe from the issue's `recipes` (never one that breaks the household's allergies or diet, rated «Mejor no» or already sent) and a tip from `NEWSLETTER_TIPS` with `pickTip` (the rules of §6.3 of Marketing's tips: in production and not paused, its condition, not used per `household_feature_usage` or the account's state, a «no» for good, 4-week rest, §5 order then priority, one sharing tip a month, else a forgotten A or the general tip), logged in `newsletter_tip_log` (migration 0098), clicks counted in the slots `receta` (43) and `truco` (44). Marketing leaves its recommendation without an admin session: `PUT /admin/newsletter/drafts/:issueId/recommendation` (only that route) also takes `x-newsletter-token` / `NEWSLETTER_RECOMMENDATION_TOKEN`, audited `newsletter.recommendation` with actor «marketing» (PRO-1198).

**Source**: `apps/api/src/services/newsletter.ts`, `apps/api/src/services/newsletterTips.ts`, `apps/api/src/routes/newsletter.ts`, `apps/api/src/middleware/newsletterAuth.ts`, `apps/web/src/app/(public)/newsletter/baja/page.tsx`

---

## [Waitlist (pre-launch, Mimoia)](./waitlist.md)

Public pre-launch waitlist on the landing (`#lista-de-espera`), public brand Mimoia (`BRAND_NAME`, D-012), closed beta, invite by batches (tandas) every 2–4 weeks, no queue position / no fake scarcity, segmentation questions (household size, who plans/shops, current method, iOS/Android, supermarket), WhatsApp interest, separate newsletter opt-in (menú de los viernes, LSSI), consent version, honeypot, per-IP rate limit, idempotent on email, referral codes (`?invita=`, Crockford base32), "Invita a tu hogar y entráis antes", owner page `/lista/[code]`, copy + wa.me share, opt-out `/lista/baja` (anonymises), `?ref` / `utm_*` attribution, `waitlist_entries` (migration 0037), `GET /admin/waitlist` (metrics token: segments, sources with utm as counts by channel, referral counts without codes, suggested next batch without ids), `POST /admin/waitlist/invite` (admin JWT, audited, emails each invitee via Resend, see Email), register marks joined, public CTAs → waitlist; PRO-97: one-time invitation link `/entrar/<token>` (HMAC token, hashed, migration 0048, `GET /waitlist/invite/:token`, `WAITLIST_INVITE_USED` / `WAITLIST_INVITE_LINK_REQUIRED`), `/register?entrada=` email fixed, admin `/admin/lista-espera` (tanda sugerida with names/emails `GET /admin/waitlist/next-batch`, quitar, «Invitar a estas N personas», por tanda), single reminder after 3 days via notificationScheduler.

**Source**: `packages/shared/src/types/waitlist.ts`, `packages/shared/src/constants/brand.ts`, `apps/api/src/services/waitlist.ts`, `apps/api/src/routes/waitlist.ts`, `apps/api/src/db/migrations/0037_waitlist.sql`, `apps/web/src/components/waitlist/`, `apps/web/src/app/(public)/lista/`, `apps/web/src/app/(public)/page.tsx`

---

## [Blog](./blog.md)

Public blog on mimoia.com (PRO-92): `/blog` listing and `/blog/[slug]` articles, editorial skin, articles as Markdown files in `apps/web/content/blog/<slug>.md` with a front matter header (titulo, fecha, autor, resumen, imagen, `publicado: true|false`), only published ones listed / readable (unpublished or unknown slug → 404), publishing = L3 approval + flip `publicado`, own dependency-free Markdown subset parser (no raw HTML), SEO (title, meta description, canonical, Open Graph article), `/sitemap.xml` (`app/sitemap.ts`), waitlist CTA `/?ref=blog#lista-de-espera` at the end of every article, "Blog" link in the public footer, `BLOG_CONTENT_DIR` e2e fixtures hook (ignored in production), static pre-render (`generateStaticParams`, `dynamicParams = false`), no CMS / comments.

**Source**: `apps/web/src/app/(public)/blog/`, `apps/web/src/app/sitemap.ts`, `apps/web/src/lib/blog/`, `apps/web/src/components/blog/`, `apps/web/content/blog/`, `apps/web/src/components/shared/Footer.tsx`

---

## [Billing (plans, pricing, subscriptions)](./billing.md)

Plans per household: Esencial (featured, «Recomendado»; 4,99 €/mes, 49,99 €/año) and Plus (9,99 €/mes, 99,99 €/año: voice + proactive WhatsApp + higher caps), monthly/yearly switch, `/precios` public pricing page with comparison table (everything each plan includes) + FAQ, `/profile/suscripcion`, Stripe Checkout with Managed Payments (Link merchant of record, VAT included, `LINK.COM* MIMOIA`), pay during the beta → `trial_end` launch day 2027-01-12 (first charge then), customer portal (card, receipts, change plan, cancel at period end), `GET /billing`, `POST /billing/checkout|portal`, `POST /billing/webhook` (signed, re-reads the subscription), `subscriptions` table (migration 0049), lookup keys `esencial_mensual`…, `scripts/stripeSetup.ts`, `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET`, household owner only, account deletion cancels the subscription, beta = Plus for everyone, plan caps not enforced yet.

**Source**: `packages/shared/src/types/plans.ts`, `apps/api/src/services/billing.ts`, `apps/api/src/routes/billing.ts`, `apps/api/scripts/stripeSetup.ts`, `apps/web/src/components/billing/`, `apps/web/src/app/(public)/precios/page.tsx`, `apps/web/src/app/profile/suscripcion/page.tsx`, `apps/web/src/hooks/useBilling.ts`

---

## [Feedback (beta opinions box)](./feedback.md)

Beta feedback box: floating «Opinión» pill bottom-left on every signed-in page (not in cook mode / onboarding) → «Danos tu opinión» sheet; Mimo's `leave_feedback` tool in the web chat and on WhatsApp («quiero dejar una sugerencia»); `POST /feedback`, `GET /admin/feedback` (admin JWT with who; `x-metrics-token` counts only for the agents' brief), `user_feedback` table (migration 0051), Admin → Opiniones (`/admin/opiniones`), morning brief summary.

**Source**: `apps/api/src/routes/feedback.ts`, `apps/web/src/components/feedback/FeedbackButton.tsx`, `apps/web/src/app/admin/sections/FeedbackSection.tsx`

---

## [Household](./household.md)

Multi-user "shared household" foundation: every authed user has a `primary_household_id` pointing at a `households` row, with `household_members` (one row per user, role `owner`/`member`/`child`) and `household_invites` (32-hex token, 7-day TTL, public preview at `GET /invites/:token`, authed accept at `POST /invites/:token/accept`). At registration we auto-create a solo household named "Mi casa" with the registrant as owner. Owners can rename, generate/revoke invites, remove members, and leave (auto-promotes the oldest remaining member to owner; auto-creates a new solo household for the leaver). Public preview is mounted on a dedicated router BEFORE `userRoutes` so `router.use(authMiddleware)` doesn't intercept it. `GET /households/me` returns name + members + pendingInvites; `/profile/casa` is the management surface. **PR 1B (shipped):** `menus`, `shopping_lists` and `user_favorites` carry a `household_id` column (backfilled in 0012); inserts dual-write; reads switch to household scope when `SHARED_HOUSEHOLD_SCOPE=true` (ON by default, production included, since Railway sets no `NODE_ENV`). The single helper `scopeResolver.resolveScope(userId)` + `scopeWhere(userCol, householdCol, scope)` keeps every route in sync.

**Source**: `apps/api/src/db/schema.ts` (`households`, `household_members`, `household_invites`, `users.primary_household_id`, `household_id` columns on menus/shopping/favorites), `apps/api/src/db/migrations/0011_*.sql` + `0012_pr1b_household_scope.sql`, `apps/api/src/services/householdStore.ts`, `apps/api/src/services/scopeResolver.ts`, `apps/api/src/routes/households.ts`, `apps/api/src/routes/auth.ts` (auto-create on register), `apps/api/src/routes/menus.ts` + `shopping.ts` + `recipes.ts` (scope-aware reads), `apps/api/src/services/menuGenerator.ts` + `assistant/skills.ts` (scope-aware favorites + pantry), `apps/api/src/index.ts` (mount order), `apps/web/src/app/profile/casa/page.tsx`, `apps/web/src/app/invites/[token]/page.tsx`

---

## [Roles & Authorization](./roles.md)

Two-role system: `user` (default) + `admin`. Admin role is bootstrapped via `ADMIN_EMAILS` env var — on every login the server reconciles role to env. `requireAdmin` middleware extends `requireAuth` and checks both `role === 'admin'` and `suspended_at IS NULL` per request. Suspended users get 403 with `code: 'SUSPENDED'`. JWT payload only carries `userId`; role is fetched from DB to avoid stale tokens. Frontend auth context exposes role for navbar gating; server still enforces. Read-only `x-metrics-token` exception on fifteen aggregate GETs (pinned by `tokenRoutes.test.ts`). Per-email feature switch (interruptor por email) `BASKET_EXTENSION_EMAILS` for «Enviar a <cadena>» (undo never checks it).

**Source**: `apps/api/src/db/schema.ts` (`users.role`, `users.suspended_at`), `apps/api/src/middleware/auth.ts` (`requireAuth`, `requireAdmin`), `apps/api/src/middleware/metricsAuth.ts`, `apps/api/src/config/env.ts` (`ADMIN_EMAILS`, `BASKET_EXTENSION_EMAILS`), `apps/api/src/services/basketExtension.ts`, `apps/web/src/lib/auth.tsx`

---

## [Admin Dashboard](./admin-dashboard.md)

Admin-only page at `/admin` (renamed from `/curator`, gated by `requireAdmin`). Tabs: catalog gaps (sin USDA, sin pasillo, sin densidad, sin peso por unidad, alérgenos sugeridos), system recipes con kcal=0, regen output, **Recetas pendientes** (`/admin/recetas`: catalogue drafts by batch, publicar / descartar, import a Cocina batch JSON in the background — see Catalogue import), **Usuarios** sub-tab, **Auditoría** sub-tab. Reuses the ingredient auto-create modal's USDA flow (manual search + Spanish translations + BEDCA fallback + LLM estimation). Old `/curator` URL kept as a 301-redirect for back-compat.

**Source**: `apps/api/src/routes/admin.ts`, `apps/web/src/app/admin/`, `apps/web/src/hooks/useAdmin.ts`

---

## [My Recipes](./my-recipes.md)

User-scoped recipe curator at `/recipes/mias` («Mis recetas», in the Recetas tab since PRO-1202). Lists recipes where `authorId === user.id`, filters for quality gaps (sin nutrición, sin equipo, ingredientes pendientes de revisar — entries with note 'añadido automáticamente'), edit / delete from each row's "···" sheet, counts strip, future "veces cocinada" + calificación propia. No catalog editing or user management — those are admin-only.

**Source**: `apps/web/src/app/recipes/mias/page.tsx`, `apps/web/src/components/recipes/MyRecipesSection.tsx`, `apps/web/src/hooks/useMyRecipes.ts`, `apps/api/src/routes/users.ts` (recipes-curator/gaps endpoint)

---

## [Business Metrics & Cost Ledger](./metrics.md)

**Partes**: [Eventos de uso y la línea de crecimiento](./metrics-uso.md) · [Costes y precios](./metrics-costes.md)

`GET /admin/metrics?weeks=8` for the Dirección / Finance agents: weekly active households, resolved weeks (menu for the week + shopping-list use that week or the weekend before), new households, signup cohorts with W1–W4 retention, cost per active household (EUR) by provider and feature, ISO weeks on the Europe/Madrid clock, KPIs, activation, retention, unit economics. Auth: admin JWT or read-only `x-metrics-token` = `METRICS_READ_TOKEN` (GET only, 405 METRICS_TOKEN_READ_ONLY otherwise; also opens /admin/usage, /admin/errors, /admin/waitlist, /admin/price-survey, /admin/feedback, /admin/assistant-reviews/flags, /admin/catalog-wishes, /admin/extension-gaps and /admin/extension-sends (huecos y envíos de la extensión del navegador, nombre recortado: regla, catálogo o tecleado; `duracionMs`; `days` 1–90), /admin/newsletter/stats, /admin/menu-planner/comparison, /admin/menu-planner/gemelos, /notices/afina/stats; with the token, user text comes out as counts and closed lists (routes in the shape of real templates), `services/agentView.ts`; the two extension routes crop for everyone in `services/basketExtension.ts`; disabled when unset); admins/suspended excluded unless `includeInternal=1`. Cost ledger `cost_events` (one row per paid provider call: Anthropic Claude, OpenAI transcription (WhatsApp voice notes, Mimo's voice), ElevenLabs read-aloud, Meta WhatsApp templates, AIKIT images; historical Realtime voice rows; user, household, feature, model, units, micro-euros; fire-and-forget; AsyncLocalStorage attribution), `activity_events` (shopping check / in-stock / add), price table `config/pricing.ts` with `COST_PRICE_OVERRIDES` and `ADVISOR_EUR_PER_USD` FX, `getUserMonthlySpendEur` for budget limits, UNVERIFIED prices, migration 0033, `errors` block (7-day summary of the in-house error tracker; the same token also opens `GET /admin/errors`). Product analytics / eventos de uso: `usage_events` (migration 0045, own table, no third party), `trackEvent` fire-and-forget, `props` sanitised (no free text), events signup_completed, onboarding_completed, first_steps_completed/skipped, menu_generated, meal_swapped, shopping_list_viewed, shopping_item_checked, recipe_imported (source url/photo/whatsapp_photo/whatsapp_url/social), recipe_created, cook_mode_started (also `POST /usage/cook-mode-started` when web cook mode opens, PRO-188), meal_cooked (also `mark_meal_eaten` eaten: true, `via: eaten`), mimo_message (channel web/whatsapp/voice), whatsapp_linked, shop_order_prepared, carrefour_click (botón «Hacer este pedido en Carrefour.es» on the súper card of /compra, PRO-84), basket_extension_sent / basket_extension_undo (cesta enviada a la extensión del navegador y deshecha; not passive, they make a household active; props lineas, tabla, busqueda, fallidas, ok, error, bajoMinimo, manual), app_opened_installed (passive; `POST /usage/app-opened`, device android/ios/desktop, once per household and day); installed PWA / app instalada and push notifications on (avisos activados, `push_subscriptions`) per device in `/admin/metrics` weekly (`installedAppHouseholds`, `pushEnabledHouseholds`, PRO-83); web middleware `trackUsageRoutes` + Mimo skill runner `recordSkillUsage`, `x-mimoia-internal` header avoids double counting; `GET /admin/usage?days=28` daily/weekly counts, active households (DAU/WAU), activation funnel (signup → first menu → shopping list → cooked → active week 2), 180-day retention purge in the scheduler tick.

**Source**: `apps/api/src/routes/metrics.ts`, `apps/api/src/middleware/metricsAuth.ts`, `apps/api/src/services/businessMetrics.ts`, `apps/api/src/services/usageEvents.ts`, `apps/api/src/services/basketExtension.ts` (`loadBasketGaps`, `loadBasketSends`), `apps/api/src/services/usageReport.ts`, `apps/api/src/db/migrations/0045_usage_events.sql`, `apps/api/src/services/costLedger.ts`, `apps/api/src/services/activityEvents.ts`, `apps/api/src/config/pricing.ts`, `apps/api/src/db/migrations/0033_cost_ledger.sql`

---

## [Uso de cada función por hogar](./feature-usage.md)

PRO-1023 (D-122, punto 4): catálogo de funciones en código, una entrada por truco (`FEATURE_CATALOG`: id, nombre, `accion` | `ajuste`, por hogar o persona, qué `usage_events` cuentan), y tabla `household_feature_usage` (primera vez, última vez, `uses_30d`, `uses_total` y `counted_until` por hogar o persona y función) que rellena cada noche, desde la 01:00 de Madrid, una pasada del planificador sobre los eventos de ayer. Una acción suma un uso por evento; un ajuste, una vez por semana en que actuó. `uses_total` sigue después de la purga de 180 días de los eventos. Solo cifras y fechas; CASCADE con el hogar y con la cuenta.

**Source**: `packages/shared/src/constants/featureCatalog.ts`, `apps/api/src/services/featureUsage.ts`, `apps/api/src/services/notificationScheduler.ts`, `apps/api/src/db/schema.ts` (`householdFeatureUsage`), `apps/api/src/db/migrations/0097_household_feature_usage.sql`, `apps/api/src/tests/featureUsage.test.ts`, `apps/api/src/tests/featureUsage.smoke.ts`

---

## [Error Tracking (in-house)](./errors.md)

Own error tracker, Sentry alternative with no third party: `app_errors` grouped table (fingerprint = kind + normalised message + top stack frame; count, first/last seen, sample stack/path, release, browser family, last user, resolved), client errors from the web (`window.onerror`, `unhandledrejection`, `error.tsx` / `global-error.tsx` boundaries "Algo se ha torcido", `navigator.sendBeacon` / keepalive fetch to public `POST /client-errors`, 8 KB cap, per-IP 30/min, dedupe per page load, ≤ 10 reports per page, off in dev unless `NEXT_PUBLIC_ERROR_REPORTING`), API 5xx capture (route pattern, console.error capture via AsyncLocalStorage, error middleware, `unhandledRejection`), scrubbing (emails, phones, IPs, JWT, Bearer, query strings, SQL params, tokens), write throttle / coalescing, `GET /admin/errors` for Mimoia HQ agents (admin JWT or `x-metrics-token`), `POST /admin/errors/:id/resolve` (audited), `errors` block in `/admin/metrics`, migration 0036.

**Source**: `apps/api/src/services/appErrors.ts`, `apps/api/src/routes/appErrors.ts`, `apps/api/src/middleware/errorCapture.ts`, `apps/api/src/db/migrations/0036_app_errors.sql`, `packages/shared/src/types/clientErrors.ts`, `apps/web/src/lib/errorReporter.ts`, `apps/web/src/app/error.tsx`, `apps/web/src/app/global-error.tsx`

---

## [Menu probe (sonda diaria del menú)](./menu-probe.md)

Daily GitHub Actions probe (PRO-396): signs in to staging and production with its own test account, generates next week's menu, times it; ROJO if it fails, comes back empty or takes > 30 s. JSON result without personal data (entorno, segundos, ok, fecha, semana, tope, motivo) as artifacts `menu-probe-staging` / `menu-probe-production`; staging signs up a throwaway account with the smoke invitation; production needs `PROBE_USERNAME` / `PROBE_PASSWORD` in the `menu-probe-production` environment.

**Source**: `apps/api/src/services/menuProbe.ts`, `apps/api/scripts/menuProbe.ts`, `docs/workflows/menu-probe.yml`

---

## [Admin Audit Log](./admin-audit-log.md)

Append-only `admin_audit_log` table — every successful admin mutation lands here. Action codes (`ingredient.create/update/remap`, `recipe.update/delete`, `user.suspend/unsuspend`, `user.reset_password.generate`, `catalog_draft.publish/discard/restore`, `catalog_batch.publish`, `catalog_import.start`, `catalog_collection.import`, …). Payload is a JSONB before/after diff. Browseable from the "Auditoría" sub-tab in `/admin` with filters by admin and action code, paginated 50/page. Reset-token secrets never appear in payloads (only `token_id` + `expires_at`). Action codes are stable forever — never renamed.

**Source**: `apps/api/src/db/schema.ts` (`admin_audit_log`), `apps/api/src/services/auditLog.ts`, `apps/web/src/app/admin/sections/AuditLogSection.tsx`

---

## [User Management](./user-management.md)

Admin sub-tab at `/admin` → "Usuarios": paginated list (search by username/email, filter "solo suspendidos"), per-user detail panel (profile, restrictions, registration date, counts), **suspend** / **unsuspend** with confirm modal, **generar enlace de reset** (24 h one-time token, link copied to clipboard, admin sends manually — no automated email). Suspending an admin is allowed but logged. Out of scope v1: delete user, edit user profile, impersonate. Public `/reset?token=X` consume page.

**Source**: `apps/api/src/db/schema.ts` (`password_reset_tokens`), `apps/api/src/routes/admin.ts` (users endpoints), `apps/api/src/services/passwordReset.ts`, `apps/web/src/app/admin/sections/UsersSection.tsx`, `apps/web/src/app/(auth)/reset/page.tsx`

---

## [Design System](./design-system.md)

**Partes**: [Páginas en modo editorial y las que quedan en modo app](./design-system-paginas.md)

Editorial design system, brand Mimoia everywhere users see it (`BRAND_NAME`, rename guard `brandName.test.ts`: the old project name survives only in technical identifiers such as `@ona/shared`), imagotipo / logo (spoon with a heart cut-out, `MimoiaLogo`, `MimoiaSymbol`, `MimoAvatar`, lowercase "mimoia" lockup), one shared public footer (`Footer.tsx`, contact `lib/contact.ts` → hola@mimoia.com), one public grid / rejilla pública (`public-container` utility, `--public-max` 1200 px, `--public-gutter` 24/40 px; navbar logo, footer logo and page h1 aligned; reading pages / páginas de lectura left-aligned 720 px column; `e2e/public-grid.spec.ts`), design tokens (`@theme` in globals.css), color palette (cream, ink, terracotta, forest, mint), typography (Fraunces variable, Cormorant Garamond italic, Inter, JetBrains Mono), motion/react animations, magnetic buttons, grain texture, link-reveal underlines, marquee, layoutId pill nav, editorial mode pages (landing, como-funciona, recipes, recipe detail "D" with tabs + sticky action bar), app mode legacy pages (menu, shopping, profile), Tailwind v4, mobile-first 430px max-width, 4-tab bottom tab bar (Menú, Compra, Recetas, Perfil), components (RecipeCard, meal photo cards, WeekStrip, Navbar, FavoriteButton, MimoProvider, MimoPanel, MimoButton floating companion)., labelled bottom tab bar, menu), app mode legacy pages (shopping, font-serif-text, terracotta-deep, ink-muted, MenuSheet, RecipeCover

**Source**: `apps/web/src/app/globals.css`, `apps/web/src/app/layout.tsx`, `apps/web/src/components/shared/`, `apps/web/src/components/mimo/`

---

## [Ficha del hogar](./household-profile.md)

**Partes**: [Cómo aprende la ficha y quién la lee](./household-profile-aprende.md) · [«Tu ficha»: la API, la pantalla y Mimo](./household-profile-tu-ficha.md)

Household profile / ficha viva (D-064, PRO-150): data model of everything Mimoia knows about a household, per person. `profile_facts` (subject household / member / person without account, type, value, origin user|onboarding|ai_realtime|ai_nightly|ai_weekly, confidence 0–1, evidence, valid_until, status active|retired), new fact types (fixed_dish, skipped_meal, dish_frequency, affinity −2..+2, effort, temporary_situation, shopping, batch_cooking, novelty) plus every user_memories key, `household_persons` (alias + age band, never a minor's name, `MINOR_ALIASES`), `household_profiles` (portrait / retrato ≤ 250 words, version, model), `profile_questions` (pending questions), `profile_changes` (history). Health rules (consent, nothing from WhatsApp, never deduced at night), visibility per fact (health only for its owner; adults see the rest; `visibleProfileFacts`). Idempotent boot copy from `user_memories` (`applyProfileFromMemories`). Migration 0057. Cómo cocináis en casa / cooking style (PRO-217, D-069): `cooking_style` fact (cada día, aprovecho, batch cooking, improviso), sign-up step 3 of 6, `/profile` card «Cómo cocináis», `GET`/`PUT /household/cooking-style`, Mimo tool `set_cooking_style`. **One source** (PRO-316): every memory write lands in the ficha in the same transaction (`writer.ts`, `upsertProfileFact`, memory as mirror). **«Tu ficha» API** (PRO-317, D-110): `GET /household/profile` (retrato, personas, hechos en frases para quien lee, temas, origen «Lo dijiste tú / Del alta / Lo he deducido», pregunta pendiente, lo último aprendido), «¿Por qué lo sé?» (pruebas, confianza en palabras, «Cómo lo uso»), confirmar / corregir con IA / olvidar, deshacer lo de Mimo, contestar la pregunta, pausar «Aprender de lo que hago» por persona, personas sin cuenta, descargar mi ficha; protein_minimum («proteína en cada plato»). Migrations 0088, 0089 and 0091. **«Tu ficha» screen** (PRO-318): `/profile/ficha` (retrato, «Una pregunta» Sí/No/Ahora no, «Lo último que he aprendido», chips La casa / Tú / miembros / personas sin cuenta, hechos por temas con su origen, hoja «¿Por qué lo sé?», Corregir, Olvidar, «+ Persona», Editar, Quitar de la casa, Salud «Solo lo ves tú», interruptor «Aprender de lo que hago», «Añadir algo que deba saber» → Mimo con borrador, hogar nuevo «Todavía os conozco poco», descargar), `/profile/ficha/historial` («Lo que ha cambiado», Deshacer), tarjeta «Tu ficha» primera en Perfil (sustituye a «Memoria»).

Daily signals / señales del día (PRO-151): `collectHouseholdDaySignals` (`services/profile/signals.ts`) — one household, one Madrid day, compact text for the nightly refiner (PRO-152): web chat and WhatsApp with Mimo's tool trace, `menu_edits`, «Afina tu menú» `recipe_verdicts` (empty until PRO-146), cook log, «¿Qué tal?» ratings, shopping events with product names (`activity_events.item`, `shopping_remove`), pantry, recipes created/imported/saved, feedback, sign-up answers with the free text (`users.onboarding_note`, `onboarding_completed_at`); people as P1/P2; no health from WhatsApp (`stripHealthFromWhatsAppText`, `HEALTH_TEXT_PATTERNS`, LEG-03); size cap `SIGNALS_MAX_CHARS`, oldest dropped first. Migration 0063.

Nightly refiner / refinador nocturno (PRO-152, in the shadow): `services/profile/refiner.ts`, `runProfileRefinerIfDue` from `notificationScheduler` after 03:00 Madrid; households with activity and a plan, trial or beta (never paused, under the monthly spend cap); Claude Opus 5.5 with adaptive thinking through the Anthropic Message Batches API (`messages.batches`), closed JSON output (`REFINER_OUTPUT_SCHEMA`, Zod), rules in code (`planRefinement`: no deduced health — discarded and recorded without content —, user facts become pending questions, max 10 changes a night, references F1/P1/X1 only); `profile_refiner_runs`, `profile_refinements` (migration 0064); cost `cost_events` feature `ficha` at half price (`BATCH_PRICE_FACTOR`). Source: `apps/api/src/services/profile/refiner.ts`, `apps/api/src/db/migrations/0064_profile_refiner.sql`.

**Source**: `packages/shared/src/types/householdProfile.ts`, `apps/api/src/services/profileFromMemories.ts`, `apps/api/src/db/schema.ts`, `apps/api/src/db/migrations/0057_household_profile.sql`, `apps/web/src/app/profile/ficha/`, `apps/web/src/components/ficha/`, `apps/web/src/hooks/useFicha.ts`, `apps/web/src/lib/ficha.ts`

---
