# Authentication

User registration, login, and session management for ONA.

## User Capabilities

- Users can register with username, email, and password
- Users can log in with either username or email plus password
- Logged-in users receive a JWT token used for subsequent API calls
- Users can log out (clears local token; no server-side invalidation)
- Newly registered users are redirected to onboarding before accessing the app
- Existing users with completed onboarding go directly to `/menu` after login
- `/login` and `/register` honour `?next=<path>`: after success the user lands on `next` instead of `/menu` / `/onboarding`. Only same-origin relative paths are accepted (`safeNext`: must start with `/`, not `//` or `/\`, no newlines), so it can't become an open redirect. The "Crear cuenta" / "Inicia sesión" cross-links carry `next` along. Used by `/whatsapp/conectar` and `/invites/[token]`.

## Onboarding (post-registration)

- Onboarding is required before any in-product page (menu, recipes, shopping, advisor) is meaningful
- The `users.onboardingDone` flag tracks completion
- Onboarding collects: household composition (`adults` + `kidsCount` for children aged 2–10; under 2 doesn't count, over 10 counts as adult), cooking frequency, dietary restrictions, favorite dishes, nutritional priority
- Until `onboardingDone = true`, the landing page redirects authenticated users to `/onboarding`
- Finishing onboarding generates the user's **first real menu** for the current week (`POST /menu/generate`) before landing on `/menu`, built from those answers. It used to land on an auto-created empty week. If generation fails, `/menu` still offers "Generar mi menú"
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
- `/login`, `/register`
- `/onboarding`
- `/whatsapp/conectar?t=<token>` — WhatsApp-first link confirm page (asks to log in / register when logged out; see [WhatsApp](./whatsapp.md))

**Protected** (bottom tab bar, requires auth):
- `/menu`, `/menu/history`
- `/shopping`
- `/recipes`, `/recipes/new`, `/recipes/[id]`, `/recipes/[id]/cook`
- `/advisor`
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
- [apps/web/src/app/onboarding/page.tsx](../apps/web/src/app/onboarding/page.tsx)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users` table
