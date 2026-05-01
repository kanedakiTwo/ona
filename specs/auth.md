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
- Onboarding collects: household size, cooking frequency, dietary restrictions, favorite dishes, nutritional priority
- Until `onboardingDone = true`, the landing page redirects authenticated users to `/onboarding`
- Onboarding can also collect physical profile data (sex, age, weight, height, activity level) used by the calorie calculator

## Constraints

- Username and email are both unique across users (registration returns 409 if either exists)
- Passwords are stored hashed with bcrypt (10 rounds)
- JWT tokens are signed with `JWT_SECRET` and have no expiration set in code (long-lived by default)
- Login with invalid credentials returns 401 (no distinction between "user not found" and "wrong password")
- All in-product API routes require the JWT in `Authorization: Bearer <token>` header

## Public vs Protected Routes

**Public** (no navbar, no auth required):
- `/` (landing), `/como-funciona`, `/privacidad`, `/terminos`
- `/login`, `/register`
- `/onboarding`

**Protected** (bottom tab bar, requires auth):
- `/menu`, `/menu/history`
- `/shopping`
- `/recipes`, `/recipes/new`, `/recipes/[id]`
- `/advisor`
- `/profile`

## Related specs

- [Recipes](./recipes.md) — what authenticated users browse and favorite
- [Menus](./menus.md) — generated for authenticated users
- [Design System](./design-system.md) — login/register page styling

## Source

- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — register, login endpoints
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — JWT validation
- [apps/web/src/lib/auth.tsx](../apps/web/src/lib/auth.tsx) — client-side AuthProvider
- [apps/web/src/app/(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx)
- [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx)
- [apps/web/src/app/onboarding/page.tsx](../apps/web/src/app/onboarding/page.tsx)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users` table
