# Authentication

User registration, login, and session management for Mimoia.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [Onboarding](./auth-onboarding.md) — las preguntas después del registro, paso a paso.

## User Capabilities

- Users can register with username, email, and password (the **email** is the field marked `autocomplete="username"`, the username `nickname`, so the browser's password manager saves the email with the password and fills the login form, where people type their email; until 2026-11-23 it saved the username and iPhone's Keychain never filled it in), plus the required box **«Tengo 14 años o más»** (LOPDGDD art. 7, PRO-23): «Crear cuenta gratis» stays disabled until it's ticked, and `POST /register` answers **400** without `ageConfirmed: true` (`registerSchema`, message «Para usar Mimoia tienes que tener 14 años o más.»). The moment is stored in `users.age_confirmed_at` (migration 0039). There is no sign-up from WhatsApp (it only links an existing account)
- Below it, a **separate, optional, unticked** box «Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia» (PRO-132; `NEWSLETTER_OPT_IN_LABEL`, consent version `2026-10-17`) with the hint «Te lo recomendamos: te va a sorprender. Opcional; te das de baja con un clic.» (PRO-95). `POST /register { newsletterOptIn: true }` stores `users.newsletter_opt_in`, `newsletter_consent_at` and `newsletter_consent_version` (migration 0047); the account then gets the Friday email (see [Newsletter](./newsletter.md)). The profile has the same switch
- Users can log in with either username or email plus password
- **«¿Has olvidado la contraseña?»** under the password on `/login` → `/recuperar`: they write their email, «Enviarme el enlace» → `POST /auth/forgot { email }` and the page always says «Si hay una cuenta con <email>, te acabamos de mandar un enlace. Caduca en 1 hora. Si no lo ves en unos minutos, mira en la carpeta de spam.», whether or not the account exists. An existing, not suspended account gets the reset email ([Email](./email.md)) with a one-time `/reset?token=…` link valid 1 hour (at most 3 an hour per account); `/reset` sets the new password as before
- Every new account gets a welcome email, beta / household / general ([Email](./email.md)); it never delays or fails the registration
- **From launch day (2026-12-15) signing up starts the 14-day trial without card** (PRO-135): it counts from the creation of the household (beta households: from launch day). Without a plan when it ends, the household is on the **Gratis** plan (PRO-385, D-158) — it logs in, sees everything and makes its week and its list on the web, but has no Mimo, alerts, recipe imports or shop orders — until someone in the household chooses a plan; nothing is deleted. Before launch day nobody is on Gratis. See [Billing](./billing.md)
- Logged-in users receive a JWT token used for subsequent API calls
- Users can log out (clears local token; no server-side invalidation)
- Newly registered users are redirected to onboarding before accessing the app
- Existing users with completed onboarding go directly to `/menu` after login
- Registering with an email that is on the pre-launch [waitlist](./waitlist.md) (waiting or invited) marks that entry `joined` — fire-and-forget, it never blocks or fails the registration
- `/login` and `/register` honour `?next=<path>`: after success the user lands on `next` instead of `/menu` / `/onboarding`. Only same-origin relative paths are accepted (`safeNext`: must start with `/`, not `//` or `/\`, no newlines), so it can't become an open redirect. The "Crear cuenta" / "Inicia sesión" cross-links carry `next` along. Used by `/whatsapp/conectar`, `/invites/[token]`, the private-recipe notice and the signed-out redirect of every protected page (see "Public vs Protected Routes").
- Sign out: «Salir» at the bottom left of the desktop sidebar (`md+`, Miguel 2026-10-21) and «Cerrar sesión» in Perfil → gear → Ajustes → «Cuenta y privacidad» (`/profile/ajustes`, PRO-1202). Both clear the session and this device's cached data and go back to the landing (`logout` in `lib/auth.tsx`)

## Closed beta (PRO-27)

- `REGISTRATION_MODE` (`invite` by default, `open` to open on launch day; CI's smoke job and staging run `open`). The public web reads it from `GET /public/config` (`{ registration }`, no auth; PRO-167) and, with `open`, sends every public call to action to `/register` ([Waitlist](./waitlist.md) «Open registration»). In `invite`, `POST /register` only creates an account when one of these holds, else **403 `REGISTRATION_INVITE_REQUIRED`** («Mimoia está en beta cerrada…»):
  1. `inviteCode` = a **campaign invitation link** that exists, isn't expired and has uses left (one use is taken atomically);
  2. `waitlistToken` = the **one-time link of a waitlist invitation** (PRO-97): `mimoia.com/entrar/<token>` (`app/entrar/[token]/route.ts`) → `/register?entrada=<token>`. The page asks `GET /waitlist/invite/:token` who it is for, shows «¡Te toca, <nombre>! Vienes de la lista de espera.» and fixes the email (read-only, «Es el correo de tu invitación: no se puede cambiar.»). On submit the API checks the link is valid, unused and for that email, and uses it up atomically with the account (given back if the insert fails). Errors, in Spanish: used → **410 `WAITLIST_INVITE_USED`** («ya se ha usado… inicia sesión», the page shows it with a link to `/login` and the button disabled); unknown → 403 `WAITLIST_INVITE_NOT_FOUND`; another email → 403 `WAITLIST_INVITE_EMAIL_MISMATCH`. An **invited email without the link is rejected** with 403 **`WAITLIST_INVITE_LINK_REQUIRED`** («…crea tu cuenta desde el botón «Crear mi cuenta» del correo…»). Exception: entries invited before PRO-97 (no link exists) still get in with the email alone. In `open` mode a link is optional, but if sent it is checked and used up the same way;
  3. `householdInviteToken` = an unconsumed, unexpired household invitation (`/invites/:token`) — this path must never break;
  4. the email is in `ADMIN_EMAILS`.
- **`mimoia.com/i/<code>` also takes a household's own code (PRO-1016, D-132):** the «Hecho con Mimo · mimoia.com/i/<code>» foot of what people forward (the week Mimo sends, the shared list, a shared recipe) uses the account's referral code. The route asks `GET /waitlist/:code` (an account's or an active list person's code → 200, passing the visitor's `x-forwarded-for` so the per-IP limit counts them) and sends it to the landing with `?invita=<code>` — remembered for the sign-up, stored as `users.invited_by_code` like any `?invita=` (below) and following the registration mode; anything else (or the call failing) is a campaign as before. e2e `share-invite-foot.spec.ts`.
- Campaign links: `mimoia.com/i/<code>` (`app/i/[code]/route.ts`) → `/register?campana=<code>`. `/register` says «¿Ya tienes cuenta? Entra» at the top (under the lead, not only in the footer), and someone who arrives **already signed in** in that browser goes to `next` or `/menu` instead of a second sign-up (only the session found on arrival: the one the form creates goes on to onboarding; 2026-11-23, a friend opened an invitation link again and landed on the sign-up; e2e `register-returning.spec.ts`); the form sends it as `inviteCode` (kept in `sessionStorage.ona.campana` across a /login detour). The household path comes from `?next=/invites/<token>`. A valid campaign is recorded on the account (`users.invite_campaign_id`, table `invite_campaigns`, migration 0042) in either mode. Created and listed in `/admin` → Invitaciones ([Admin](./admin-dashboard.md)); counted in `GET /admin/metrics` → `campaigns` ([Metrics](./metrics.md)).
- **«Invitar a otro hogar» and attribution (PRO-162):** every account has its own invitation code, in the waitlist's format (`users.referral_code`, unique, migration 0053); someone who came from the waitlist keeps their list code, so what they already shared still counts. It is assigned on sign-up (or the first time it's asked for): `GET /referrals/me` (auth) → `{ code, link }`, link `<web>/?invita=<code>`. The landing remembers `?invita=`, `?ref=` and `utm_*` in the browser for 30 days (`lib/signupAttribution.ts`, `localStorage.ona.signupAttribution`) and `/register` sends them (its own URL first) as `invitedBy`, `signupSource`, `utmSource`, `utmMedium`, `utmCampaign`. The API stores the inviter's **code** (`users.invited_by_code`, never their email) when the code belongs to an account or an active waitlist person, it isn't the same person (same email) and they aren't joining the inviter's own household (a member, not another home); `?ref`/`utm_*` go to `users.signup_attribution`. A creator's ref (`cr-<alias>`), there or on the person's waitlist row (same email, for whoever comes in from the invitation without the `ref`), gives the household they create 4 weeks free instead of 14 days (PRO-353, D-130; read on the fly, see [Billing](./billing.md)). A bad or unknown code never fails the sign-up — it is just not stored. With registration closed, `?invita` still leads to the waitlist as before (see [Waitlist](./waitlist.md)); with `REGISTRATION_MODE=open` the invited person signs up directly. Tests: `accountReferrals.test.ts`, `accountReferrals.smoke.ts` (real API + DB), e2e `invite-link.spec.ts` (390×844).
- **«Invitar a otro hogar» button (PRO-163, D-059):** in Perfil (under the six cards, apart from Casa's «Invitar a alguien», which brings someone into *this* household, PRO-118) and under the shopping list (`components/referrals/InviteHouseholdButton.tsx`, `data-testid="invite-household-perfil"` / `"invite-household-compra"`): «¿Conoces otra casa a la que le vendría bien? Mándale tu enlace para que pruebe Mimoia.» and **«Invitar a otro hogar»**, which opens `https://wa.me/?text=` with Miguel's text A (`inviteHouseholdShareText`, `@ona/shared`): «Yo uso Mimoia para el menú de la semana: le escribes por WhatsApp y te lo hace, con la lista de la compra. Pruébalo con mi enlace: <enlace>» (Legal reviews it before publishing). On a computer (`md+`) also **«Copiar»** (the same message to the clipboard). Each tap → `POST /usage/invite-shared` (auth, 204) → one `invite_shared` event, no props ([metrics.md](./metrics.md)). Mimo does the same with `share_invite_link` ([advisor.md](./advisor.md)). Tests: e2e `invite-household-button.spec.ts` (390×844), `appSkills.test.ts`.
- Without an invitation `/register` shows «Mimoia está en beta cerrada» and a link to `/#lista-de-espera`; no account is created.
- Tests: `inviteCampaigns.test.ts` (gate + per-campaign counts), `waitlistInvites.test.ts` (the link), e2e `waitlist-invite.spec.ts` (link fixes the email, creates the account, reuse is an error, invited email without link rejected) and `closed-beta.spec.ts` (the four paths; the e2e API runs `invite` and `global-setup.ts` creates the «e2e» campaign every spec signs up with).

## Profile data shape

The `users` table holds the canonical scalar fields (`sex`, `age`, `weight`, `height`, `activityLevel`, `adults`, `kidsCount`, `cookingFreq`, `restrictions`, `favoriteDishes`, `priority`, `onboardingDone`). `users.householdSize` is a deprecated text column kept only as a backfill source for users registered before migration 0005; new code reads `adults` + `kidsCount` and writes `householdSize = null` on every save. The `user_settings.template` JSONB column stores the richer profile-page state as a single blob: `{ physical, preferences, mealTemplate }`. The `/profile` page reads/writes both: scalar fields go through `PUT /user/:id`, and the rich blob goes through `PUT /user/:id/settings`. Restrictions are kept in both places (`users.restrictions`, which onboarding writes and the menu generator reads, and `preferences.restrictions` in the blob): the profile shows the **union** of the two (trimmed, lowercased, deduped — `unionRestrictions` in `@ona/shared`), so a diet or allergy picked in onboarding appears ticked, and saving writes that same list to both, never dropping either side (PRO-64; `apps/web/e2e/profile-restrictions.spec.ts`).

## Roles and suspension

- `users.role` is `'user' | 'admin'`. Default `'user'`. On every login the server reconciles role against the `ADMIN_EMAILS` env var (lowercased): the account whose stored email is exactly a listed one is upgraded to admin, ex-admins removed from the env are downgraded. An account whose email differs from a listed one only in its capitals never becomes admin (PRO-1271, 2026-11-20).
- `users.suspended_at` is set by the admin via `/admin/users` (see [User Management](./user-management.md)). Login rejects suspended users with `code: 'SUSPENDED'`. Existing JWTs of a suspended user are invalidated at the per-request `authMiddleware` check.
- The auth context client-side carries `role` next to `userId` so the navbar can render the admin entry without an extra fetch. The server still re-checks role on every privileged request — the client value is decoration.

## Constraints

- Username and email are both unique across users (registration returns 409 if either exists). The email is unique **whatever its capitals** (PRO-1271, 2026-11-20): sign-up trims and lowercases it (`registerSchema`), the duplicate check and the login compare `lower(email)`, and the unique index `uq_users_email_lower` backs it. So `Ana@Casa.es` and `ana@casa.es` are one account, and you can log in typing either.
- Passwords are stored hashed with bcrypt (10 rounds)
- JWT tokens are signed with `JWT_SECRET` and expire after `JWT_EXPIRES_IN` (default `90d` — "long but not infinite"). On expiry the API returns `401` with `code: 'TOKEN_EXPIRED'`; the web client treats that like `USER_NOT_FOUND` (wipes local auth, bounces to `/login`). Tokens issued before expiry was introduced never expire — they age out as users re-login. A token with a bad signature or malformed (e.g. after `JWT_SECRET` is rotated) returns `401` with `code: 'INVALID_TOKEN'`, handled the same way.
- A deployed API (`NODE_ENV=production` or running on Railway) **refuses to boot** when `JWT_SECRET` is missing or shorter than 32 characters (`config/jwtSecret.ts`); locally it falls back to `ona-dev-secret`. Rotating the secret logs every user out once.
- `POST /register`, `/login`, `/auth/reset` and `/auth/forgot` are rate-limited per client IP (in-memory fixed window): register `10/hour`, login + reset `20 / 5 min`, forgot `5 / 15 min`. `POST /auth/forgot` answers `200 { ok: true }` at once for any valid email (the email goes out in the background, so neither the answer nor its timing says whether the account exists); 400 `INVALID_EMAIL` for a malformed one. Over the limit returns `429` with `code: 'RATE_LIMITED'` and a `Retry-After` header. The limiter is per-process (approximate across restarts/instances) and relies on `app.set('trust proxy', 1)` to read the real client IP behind Railway's edge. Test harnesses (CI + `apps/web/scripts/test-e2e.sh`, whose Playwright specs register one user per test from localhost) switch the limiters off with `RATE_LIMIT_DISABLED=true`; the flag is **ignored on a deployed API** (same `isDeployedRuntime` check as `JWT_SECRET`: `NODE_ENV=production` or running on Railway), so production limits can't be disabled by env. See `middleware/rateLimit.ts`.
- Login with invalid credentials returns 401 (no distinction between "user not found" and "wrong password")
- Login with a suspended account returns 403 with `code: 'SUSPENDED'`
- All in-product API routes require the JWT in `Authorization: Bearer <token>` header
- `requireAdmin` middleware runs after `authMiddleware` on admin-only endpoints — see [Roles & Authorization](./roles.md)

## Public vs Protected Routes

**One rule (2026-10-15):** every page needs an account unless it is on the open list in `lib/routeAccess.ts`. A signed-out visitor on any other page goes to **`/login?next=<path+query>`** once the session has resolved (`RootShell` paints an empty cream page meanwhile, so the wrong page never flashes), and logging in brings them back there (`safeNext`). New pages are protected by default; unknown URLs signed out land on `/login` too. Before, signed out, `/menu`, `/profile` and `/advisor` hung on «Cargando...», `/shopping` and `/compra` were blank and `/recipes/new` showed a form that couldn't save. Tests: `apps/api/src/tests/routeAccess.test.ts` (the lists), `e2e/app-signed-out.spec.ts`.

**Open** (no account needed):
- Marketing and legal: `/`, `/como-funciona`, `/precios`, `/blog`, `/blog/[slug]`, `/privacidad`, `/terminos`, `/aviso-legal`
- La receta del día: `/receta-del-dia`, `/receta-del-dia/[fecha]` and its photos `/receta-del-dia/[fecha]/foto/[formato]` (PRO-1099, [Recipe of the day](./recipe-of-the-day.md))
- `/login`, `/register` — `/register` stays reachable for invited households, but no public CTA links to it pre-launch (they lead to the [waitlist](./waitlist.md))
- `/recuperar` (ask for the link), `/reset` (password recovery) and `/invites/[token]` (household invitation) — drawn like `/login` (no sidebar, bottom bar, Mimo button or desktop left margin), also for a signed-in user
- `/lista/[code]`, `/lista/baja` (waitlist), `/newsletter/baja`, `/offline` (service-worker fallback)
- Link handlers (`route.ts`): `/i/[code]` (campaign), `/entrar/[token]` (waitlist invitation), `/c/[token]` (shop-order short link)
- **Open, chrome by session** (signed out: public chrome PublicNavbar + Footer on the public grid; signed in: the app shell): `/recipes` (the public catalogue, see [Recipes](./recipes.md) → "Catálogo público"), `/recipes/[id]` and `/recipes/[id]/cook` (catalogue recipes; cook mode full-screen; a private recipe answers «Esta receta es privada.» — API `GET /recipes/:id` uses `optionalAuthMiddleware` and 404s private recipes without a token), `/whatsapp/conectar` (signed out: «Entra en tu cuenta de Mimoia (o créala)…» with login/register links carrying `?next=`; see [WhatsApp](./whatsapp.md))
- `/recipes-ona` and `/recipes-ona/[id]` are permanent redirects to `/recipes` and `/recipes/[id]`

**Protected** (everything else; signed out → `/login?next=…`; signed in, the app shell unless noted):
- `/menu`, `/menu/history`, `/shopping`, `/compra`, `/compra/tiendas`
- `/recipes/new`, `/recipes/[id]/edit`, `/cookbooks/[id]`
- `/profile` and every `/profile/*` page
- `/advisor` — no longer a page (D-023): a client redirect to `/menu?mimo=1`, which opens Mimo. Mimo itself is the floating button on every protected page (see [Advisor](./advisor.md))
- `/onboarding`, `/onboarding/voz` — full-screen, without the app shell
- `/admin` — admin dashboard, also gated by `requireAdmin` (see [Admin Dashboard](./admin-dashboard.md)). The old `/curator` route 301-redirects here.

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
- [apps/web/src/lib/routeAccess.ts](../apps/web/src/lib/routeAccess.ts) — open vs protected pages (`needsAccount`, `signedOutChrome`, `isBareRoute`, `loginHrefFor`); applied by [components/shared/RootShell.tsx](../apps/web/src/components/shared/RootShell.tsx)
- [apps/web/src/lib/safeNext.ts](../apps/web/src/lib/safeNext.ts) — `?next=` validation + carry-over for login/register; `campaignCodeFromLocation`, `waitlistTokenFromLocation`
- [apps/api/src/services/waitlistInvites.ts](../apps/api/src/services/waitlistInvites.ts) — waitlist one-time link: check, use up, give back (PRO-97)
- [apps/web/src/app/entrar/[token]/route.ts](../apps/web/src/app/entrar/%5Btoken%5D/route.ts) — `/entrar/<token>` → `/register?entrada=<token>`
- [apps/web/src/app/(auth)/login/page.tsx](../apps/web/src/app/(auth)/login/page.tsx)
- [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx)
- [apps/web/src/components/auth/AuthShell.tsx](../apps/web/src/components/auth/AuthShell.tsx) — shared look of /login, /register, /recuperar, /reset and /invites ([Design System](./design-system.md))
- [apps/web/src/app/onboarding/page.tsx](../apps/web/src/app/onboarding/page.tsx) · [components/onboarding/OnboardingFlow.tsx](../apps/web/src/components/onboarding/OnboardingFlow.tsx) · [lib/onboardingSteps.ts](../apps/web/src/lib/onboardingSteps.ts) — the questions by step number, `resumeStep`
- [apps/api/src/services/onboardingMemoryAnalysis.ts](../apps/api/src/services/onboardingMemoryAnalysis.ts) — the AI read of the sign-up into the memory and the semana tipo, «Así lo he entendido» (D-182 fase 4)
- [apps/api/src/services/onboarding.ts](../apps/api/src/services/onboarding.ts) — `saveOnboarding`, `onboardingCookingFreq`, `needsOnboarding` / `onboardingStatus` (PRO-178) · [apps/web/src/hooks/useOnboardingGate.ts](../apps/web/src/hooks/useOnboardingGate.ts) — `/menu` → `/onboarding`
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users` table (`first_steps_pending`, migration `0044_first_steps_pending.sql`)
- [apps/api/src/routes/users.ts](../apps/api/src/routes/users.ts) — `GET /user/:id` (`firstStepsPending`), `POST /user/:id/first-steps`
- [apps/web/src/components/menu/FirstStepsGuide.tsx](../apps/web/src/components/menu/FirstStepsGuide.tsx) — the «Primeros pasos» guide on `/menu`
