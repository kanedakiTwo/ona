# Authentication

User registration, login, and session management for ONA.

## User Capabilities

- Users can register with username, email, and password
- Users can log in with either username or email plus password
- Logged-in users receive a JWT token used for subsequent API calls
- Users can log out (clears local token; no server-side invalidation)
- Newly registered users are redirected to onboarding before accessing the app
- Existing users with completed onboarding go directly to `/menu` after login

## Onboarding (post-registration)

- Onboarding is required before any in-product page (menu, recipes, shopping, advisor) is meaningful
- The `users.onboardingDone` flag tracks completion
- Onboarding collects: household composition (`adults` + `kidsCount` for children aged 2–10; under 2 doesn't count, over 10 counts as adult), cooking frequency, dietary restrictions, favorite dishes, nutritional priority
- Until `onboardingDone = true`, the landing page redirects authenticated users to `/onboarding`
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
- JWT tokens are signed with `JWT_SECRET` and have no expiration set in code (long-lived by default)
- Login with invalid credentials returns 401 (no distinction between "user not found" and "wrong password")
- Login with a suspended account returns 403 with `code: 'SUSPENDED'`
- All in-product API routes require the JWT in `Authorization: Bearer <token>` header
- `requireAdmin` middleware extends `requireAuth` for admin-only endpoints — see [Roles & Authorization](./roles.md)

## Public vs Protected Routes

**Public** (no navbar, no auth required):
- `/` (landing), `/como-funciona`, `/privacidad`, `/terminos`
- `/login`, `/register`
- `/onboarding`

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

- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — register, login endpoints
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — JWT validation
- [apps/web/src/lib/auth.tsx](../apps/web/src/lib/auth.tsx) — client-side AuthProvider
- [apps/web/src/app/(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx)
- [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx)
- [apps/web/src/app/onboarding/page.tsx](../apps/web/src/app/onboarding/page.tsx)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users` table
