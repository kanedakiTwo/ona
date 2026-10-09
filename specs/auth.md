# Authentication

User registration, login, and session management for ONA.

## User Capabilities

- Users can register with username, email, and password, plus the required box **«Tengo 14 años o más»** (LOPDGDD art. 7, PRO-23): «Crear cuenta gratis» stays disabled until it's ticked, and `POST /register` answers **400** without `ageConfirmed: true` (`registerSchema`, message «Para usar Mimoia tienes que tener 14 años o más.»). The moment is stored in `users.age_confirmed_at` (migration 0039). There is no sign-up from WhatsApp (it only links an existing account)
- Users can log in with either username or email plus password
- Logged-in users receive a JWT token used for subsequent API calls
- Users can log out (clears local token; no server-side invalidation)
- Newly registered users are redirected to onboarding before accessing the app
- Existing users with completed onboarding go directly to `/menu` after login
- Registering with an email that is on the pre-launch [waitlist](./waitlist.md) (waiting or invited) marks that entry `joined` — fire-and-forget, it never blocks or fails the registration
- `/login` and `/register` honour `?next=<path>`: after success the user lands on `next` instead of `/menu` / `/onboarding`. Only same-origin relative paths are accepted (`safeNext`: must start with `/`, not `//` or `/\`, no newlines), so it can't become an open redirect. The "Crear cuenta" / "Inicia sesión" cross-links carry `next` along. Used by `/whatsapp/conectar` and `/invites/[token]`.

## Closed beta (PRO-27)

- `REGISTRATION_MODE` (`invite` by default, `open` to open on launch day; CI's smoke job and staging run `open`). In `invite`, `POST /register` only creates an account when one of these holds, else **403 `REGISTRATION_INVITE_REQUIRED`** («Mimoia está en beta cerrada…»):
  1. `inviteCode` = a **campaign invitation link** that exists, isn't expired and has uses left (one use is taken atomically);
  2. the email is on the [waitlist](./waitlist.md) with status `invited`;
  3. `householdInviteToken` = an unconsumed, unexpired household invitation (`/invites/:token`) — this path must never break;
  4. the email is in `ADMIN_EMAILS`.
- Campaign links: `mimoia.com/i/<code>` (`app/i/[code]/route.ts`) → `/register?campana=<code>`; the form sends it as `inviteCode` (kept in `sessionStorage.ona.campana` across a /login detour). The household path comes from `?next=/invites/<token>`. A valid campaign is recorded on the account (`users.invite_campaign_id`, table `invite_campaigns`, migration 0042) in either mode. Created and listed in `/admin` → Invitaciones ([Admin](./admin-dashboard.md)); counted in `GET /admin/metrics` → `campaigns` ([Metrics](./metrics.md)).
- Without an invitation `/register` shows «Mimoia está en beta cerrada» and a link to `/#lista-de-espera`; no account is created.
- Tests: `inviteCampaigns.test.ts` (gate + per-campaign counts), e2e `closed-beta.spec.ts` (the four paths; the e2e API runs `invite` and `global-setup.ts` creates the «e2e» campaign every spec signs up with).

## Onboarding (post-registration)

- Onboarding is required before any in-product page (menu, recipes, shopping, Mimo) is meaningful
- The `users.onboardingDone` flag tracks completion
- Onboarding collects: household composition (`adults` + `kidsCount` for children aged 2–10; under 2 doesn't count, over 10 counts as adult), cooking frequency, dietary restrictions, favorite dishes, nutritional priority. Dietary restrictions are health data: the step shows the separate, unticked health-data consent box and only stores them when it's ticked (`healthConsent: true` in the body records the consent) — see [Privacy](./privacy.md) → Health-data consent (PRO-21)
- Until `onboardingDone = true`, the landing page redirects authenticated users to `/onboarding`
- Finishing onboarding generates the user's **first real menu** for the current week (`POST /menu/generate`) before landing on `/menu`, built from those answers. It used to land on an auto-created empty week. The client marks the user onboarded only **after** that generate answers (button "Preparando tu menú..."): marking it first let `/onboarding`'s "already onboarded" redirect reach `/menu` before the menu existed, and `/menu` auto-created an empty week on top (fixed 2026-10-08, guarded by `e2e/registration-onboarding.spec.ts`, which now sees the "Tu semana está en blanco" card). An already-onboarded user who opens `/onboarding` goes straight to `/menu`. If generation fails, `/menu` still offers "Generar mi menú"
- Onboarding can also collect physical profile data (sex, age, weight, height, activity level) used by the calorie calculator

## Profile data shape

The `users` table holds the canonical scalar fields (`sex`, `age`, `weight`, `height`, `activityLevel`, `adults`, `kidsCount`, `cookingFreq`, `restrictions`, `favoriteDishes`, `priority`, `onboardingDone`). `users.householdSize` is a deprecated text column kept only as a backfill source for users registered before migration 0005; new code reads `adults` + `kidsCount` and writes `householdSize = null` on every save. The `user_settings.template` JSONB column stores the richer profile-page state as a single blob: `{ physical, preferences, mealTemplate }`. The `/profile` page reads/writes both: scalar fields go through `PUT /user/:id`, and the rich blob goes through `PUT /user/:id/settings`.

## Roles and suspension

- `users.role` is `'user' | 'admin'`. Default `'user'`. On every login the server reconciles role against the `ADMIN_EMAILS` env var (case-insensitive): matches are upgraded to admin, ex-admins removed from the env are downgraded.
- `users.suspended_at` is set by the admin via `/admin/users` (see [User Management](./user-management.md)). Login rejects suspended users with `code: 'SUSPENDED'`. Existing JWTs of a suspended user are invalidated at the per-request `requireAuth` check.
- The auth context client-side carries `role` next to `userId` so the navbar can render the admin entry without an extra fetch. The server still re-checks role on every privileged request — the client value is decoration.

## Constraints

- Username and email are both unique across users (registration returns 409 if either exists)
- Passwords are stored hashed with bcrypt (10 rounds)
- JWT tokens are signed with `JWT_SECRET` and expire after `JWT_EXPIRES_IN` (default `90d` — "long but not infinite"). On expiry the API returns `401` with `code: 'TOKEN_EXPIRED'`; the web client treats that like `USER_NOT_FOUND` (wipes local auth, bounces to `/login`). Tokens issued before expiry was introduced never expire — they age out as users re-login. A token with a bad signature or malformed (e.g. after `JWT_SECRET` is rotated) returns `401` with `code: 'INVALID_TOKEN'`, handled the same way.
- A deployed API (`NODE_ENV=production` or running on Railway) **refuses to boot** when `JWT_SECRET` is missing or shorter than 32 characters (`config/jwtSecret.ts`); locally it falls back to `ona-dev-secret`. Rotating the secret logs every user out once.
- `POST /register`, `/login`, and `/auth/reset` are rate-limited per client IP (in-memory fixed window): register `10/hour`, login + reset `20 / 5 min`. Over the limit returns `429` with `code: 'RATE_LIMITED'` and a `Retry-After` header. The limiter is per-process (approximate across restarts/instances) and relies on `app.set('trust proxy', 1)` to read the real client IP behind Railway's edge. Test harnesses (CI + `apps/web/scripts/test-e2e.sh`, whose Playwright specs register one user per test from localhost) switch the limiters off with `RATE_LIMIT_DISABLED=true`; the flag is **ignored on a deployed API** (same `isDeployedRuntime` check as `JWT_SECRET`: `NODE_ENV=production` or running on Railway), so production limits can't be disabled by env. See `middleware/rateLimit.ts`.
- Login with invalid credentials returns 401 (no distinction between "user not found" and "wrong password")
- Login with a suspended account returns 403 with `code: 'SUSPENDED'`
- All in-product API routes require the JWT in `Authorization: Bearer <token>` header
- `requireAdmin` middleware extends `requireAuth` for admin-only endpoints — see [Roles & Authorization](./roles.md)

## Public vs Protected Routes

**Public** (no navbar, no auth required):
- `/` (landing), `/como-funciona`, `/privacidad`, `/terminos`
- `/recipes-ona`, `/recipes-ona/[id]` — public ONA catalogue (system recipes only, see [Recipes](./recipes.md))
- `/login`, `/register` — `/register` stays reachable for invited households, but no public CTA links to it pre-launch (they lead to the [waitlist](./waitlist.md))
- `/lista/[code]`, `/lista/baja` — waitlist owner page and opt-out (public chrome via `PUBLIC_PREFIXES`)
- `/onboarding`
- `/whatsapp/conectar?t=<token>` — WhatsApp-first link confirm page (asks to log in / register when logged out; see [WhatsApp](./whatsapp.md))

**Protected** (bottom tab bar, requires auth):
- `/menu`, `/menu/history`
- `/shopping`
- `/recipes`, `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/cook`
- `/advisor` — no longer a page (D-023): a client redirect to `/menu?mimo=1`, which opens Mimo. Mimo itself is the floating button on every protected page (see [Advisor](./advisor.md))
- `/profile`
- `/admin` — admin dashboard, gated by `requireAdmin` (see [Admin Dashboard](./admin-dashboard.md)). The old `/curator` route 301-redirects here.

## Related specs

- [Recipes](./recipes.md) — what authenticated users browse and favorite
- [Menus](./menus.md) — generated for authenticated users
- [Roles & Authorization](./roles.md) — `user`/`admin` roles, ADMIN_EMAILS bootstrap, requireAdmin
- [User Management](./user-management.md) — admin list/suspend/reset password
- [Design System](./design-system.md) — login/register page styling

## Source

- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — register, login endpoints; auth rate limiters
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — JWT validation (incl. `TOKEN_EXPIRED`, `INVALID_TOKEN`)
- [apps/api/src/config/jwtSecret.ts](../apps/api/src/config/jwtSecret.ts) — boot-time `JWT_SECRET` strength check
- [apps/api/src/middleware/rateLimit.ts](../apps/api/src/middleware/rateLimit.ts) — fixed-window IP rate limiter
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `JWT_EXPIRES_IN`
- [apps/web/src/lib/auth.tsx](../apps/web/src/lib/auth.tsx) — client-side AuthProvider
- [apps/web/src/lib/safeNext.ts](../apps/web/src/lib/safeNext.ts) — `?next=` validation + carry-over for login/register
- [apps/web/src/app/(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx)
- [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx)
- [apps/web/src/app/onboarding/page.tsx](../apps/web/src/app/onboarding/page.tsx) · [components/onboarding/OnboardingFlow.tsx](../apps/web/src/components/onboarding/OnboardingFlow.tsx)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users` table
