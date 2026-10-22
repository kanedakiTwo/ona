# Household

**Status:** PR 1 Part A shipped. PR 1 Part B (scope flip behind feature flag) shipped — **ON in production** (verified 2026-10-14: Railway sets no `NODE_ENV` and `SHARED_HOUSEHOLD_SCOPE` is unset there, so it resolves to `true`).

A "household" is the shared unit that owns menus, shopping lists, favourites and pantry stock. Every authed user belongs to exactly one **primary** household, accessible via `users.primary_household_id`. New users get a solo household auto-created at `/register` so every authed read has a valid scope from the first request.

## User Capabilities

- **Hogar fundador** (2026-10-15): a household created before launch day (`isFoundingHousehold`: `households.created_at` before 2026-12-15 00:00 Madrid, i.e. the closed and the open beta, D-057) shows a terracotta «Hogar fundador» badge (`FoundingBadge`, `data-testid="founding-badge"`) under its name on the profile header and on `/profile/casa`. `GET /households/me` returns `createdAt` and `founding`. Promised on the waitlist; it never goes away.

- A registered user lands on a one-member household called **"Mi casa"** with role `owner`.
- The owner can:
  - Rename the household (`PATCH /households/me`).
  - Generate an invite for role `member` or `child`. The token is 32 hex chars, expires after **30 days** (`HOUSEHOLD_INVITE_TTL_DAYS`, was 7 until PRO-260) and works **once**.
  - Send it from «Mi casa» with **«Enviar por WhatsApp»** (opens `wa.me` with the message already written and the link) or **«Copiar»** (copies the same message). See «Invitar al hogar por WhatsApp» below.
  - Revoke any pending invite before it's consumed.
  - Remove any non-owner member.
- Any member (including the owner) can leave their household via `POST /households/me/leave`:
  - If they're the only member: the household stays (no auto-delete; nothing depends on emptiness yet).
  - If they leave a multi-member household: the oldest remaining member is promoted to owner.
  - Either way, a fresh solo "Mi casa" is auto-created and assigned as the leaver's new primary household.
- A non-authed user can **preview** an invite at `GET /invites/:token` (shows household name, inviter username, role) without logging in — useful for "share this link" flows.
- An authed user can accept at `POST /invites/:token/accept`. The accept call:
  - Atomically marks the invite consumed and inserts the `household_members` row.
  - Updates `users.primary_household_id` so subsequent reads scope to the new household.
  - Rejects with 410 `InviteExpiredError` if the token is already consumed or past its `expires_at`. The consume is atomic (`UPDATE … WHERE consumed_at IS NULL`, before the membership insert), so two people opening the same link at once can't both join.
- **Menú del cole** (PRO-224, see [Menus](./menus.md) → Menú del comedor escolar): when the household has a child (a «Niñ@» member, or a member who counted children 2–10 at sign-up), `/profile/casa` shows a discreet «Menú del cole» row to `/profile/casa/cole`, where the school's monthly menu is uploaded (photo or PDF), checked and saved per household (`school_lunches`). Without a child the row isn't shown; Mimo still takes it

## Alergias y dieta al entrar en una casa (PRO-271, Seguridad)

Test households, 2026-10-19/20: whoever joined by invitation was never asked (the sign-up is skipped for a member of someone else's household, `needsOnboarding`), and their first menu brought shrimp to someone allergic to shellfish and dairy to someone lactose intolerant.

- **After accepting** (`/invites/[token]` → «Aceptar invitación»), the person lands on **«Tus alergias y tu dieta»** (`/profile/casa/alergias?next=/menu`) before the menu: «Antes de ver el menú de la casa: ¿tienes alguna alergia o intolerancia, o sigues alguna dieta (vegetariana, sin cerdo…)? El menú de la casa las tendrá en cuenta para todos.» Same picker as the sign-up (`RestrictionsPicker`: the separate unticked health-data box, then the `RESTRICTION_PRESETS` chips and free text). The button says what it does: box unticked → «Ahora no» (nothing stored; «Si no nos lo dices, el menú no sabrá lo que no puedes comer.»); ticked with nothing chosen → «No tengo ninguna, ver el menú» (the consent records the answer); ticked with something → «Guardar y ver el menú». Saving = `POST /user/:id/health-consent` + `PUT /user/:id { restrictions }`, as «Tu menú está listo». An existing account sees its saved restrictions ticked. If something was added and the household's current week already has dishes: «El menú de esta semana ya estaba hecho y puede llevar algo de lo que no tomas. ¿Lo rehacemos? Los platos fijados se quedan.» → «Rehacer el menú de esta semana» (`POST /menu/generate`, from today) or «Ver el menú tal cual». The same page is the profile's **«Alergias e intolerancias»** card (`?next=/profile`, 2026-10-22: a tester couldn't find where to add «intolerancia al pimiento» after the sign-up): intro «¿Tienes alguna alergia o intolerancia, o sigues alguna dieta…? Si no está en la lista, escríbela…», buttons «Volver» / «No tengo ninguna» / «Guardar», and «Dejar el menú tal cual» instead of «Ver el menú tal cual»; it returns to /profile. In `RestrictionsPicker` the free-text box says «Otra: escríbela (p. ej. pimiento)», and what is typed but not added yet counts and is saved (`onTypingChange` + `withTyped`, here, in the sign-up and in «Tu menú está listo»): the button already says «Guardar» and «Guardar» without Enter keeps it. It is not added on blur: the new chip pushed the button down under the finger and the tap was lost; «nada», «ninguna», «no tengo» (or «nada. como d todo…») are not saved as a restriction, «nada de cerdo» / «no como cerdo» are (`saysNone`, `lib/restrictionText.ts`).
- **The menu is everyone's:** the weekly generation reads the restrictions of every member, whoever generates (see [Menus](./menus.md) → Restrictions & allergies).
- **«Generar mi menú» warns** (`HouseholdAllergiesNotice`, mounted at the top of «Antes de generar», `WeekPlanQuestions`, so only on a blank, non-past week; never blocks the button). `GET /households/me/allergies` → `{ meAnswered, pending: [username], anyAnswered }`. **Answered** = restrictions saved (profile or memory) **or** health consent in force (consent with nothing saved = «contestó que ninguna»); nothing saved and no consent = «no ha contestado». Caller not answered → «No sabemos tus alergias ni tu dieta.» (or «Nadie en casa nos ha dicho sus alergias ni su dieta.» when no one has) · «El menú no puede evitar lo que no sabe. Dínoslo antes de generarlo; si no tienes ninguna, dínoslo también.» + «Tampoco nos lo ha dicho <nombre>.» + **«Decir mis alergias»** (→ the screen above, back to `/menu`). Caller answered, others not → «<nombre> aún no nos ha dicho sus alergias ni su dieta, así que el menú no las tiene en cuenta. Solo puede decirlo cada persona, desde su perfil.» Everyone answered → nothing.
- Limits: health data is per person (art. 9 consent), so nobody can say another member's allergies; a child account answers for itself. The single-slot menu paths still read only the caller's restrictions.
- Tests: `householdAllergies.test.ts` (answered vs not, the union), `householdAllergiesRoute.smoke.ts` (the endpoint; the owner's week without the member's shrimp recipe), e2e `household-invite-allergies.spec.ts` at 390×844 (invitation → questions → a week without shellfish; the warning until «ninguna»).

## Invitar al hogar por WhatsApp (PRO-260, D-088)

«Familia en el mismo hogar»: the couple or the family in the same account, so both see the menu and the list.

- In `/profile/casa`, every pending invite shows its link plus **«Enviar por WhatsApp»** and **«Copiar»** (`components/household/FamilyInviteShare.tsx`). The message (`familyInviteShareText` in `@ona/shared`): «Te invito a nuestra casa en Mimoia: así compartimos el menú de la semana y la lista de la compra, y lo que uno apunta lo ve el otro. Entra con este enlace (vale 30 días): <enlace>». No health claims.
- The first tap of either stamps `household_invites.shared_at` (`POST /households/me/invites/:id/shared`, owner-only, idempotent): an invite prepared but never handed on keeps it null.
- Every invite records **where it was prepared** in `household_invites.source` (`HOUSEHOLD_INVITE_SOURCES`): `casa` (Mi casa, and every invite before 2026-10-20), `alta`, `compra`, `mimo`. `POST /households/me/invites` takes `source` (unknown → `casa`) and `shared: true` (Mimo hands the link over in the same reply, so it counts as sent at once). Migration `0081_household_invite_source.sql` (additive).
- Mimo (`invite_to_household`, web chat and WhatsApp, D-051) creates the invite with `source: 'mimo'` and gives the same written message; in the web chat also the `wa.me` link to send it in one tap.
- **Measured** (PRO-263): `GET /admin/usage` → `familyInvites` counts invites prepared, sent and accepted per moment, and the goal (households with 2 adults or more that have 2 accounts) — see [metrics.md](./metrics.md).
- Not «Invitar a otro hogar» (PRO-163), which brings a different household to Mimoia with the account's referral link.

## Ofrecer la invitación (PRO-261, D-088)

The invitation is offered in three moments, **once each and never again** (like D-052 with WhatsApp). The sign-up and the list are PRO-261; Mimo after the first resolved week is PRO-262.

- **Who:** only a household with **one account** whose user is the owner (only the owner can invite), and **2 adults or more** (`users.adults`; in the sign-up, what the form says at that moment). Never after a «no» to Mimo's offer. Pure rules in `services/familyInviteOffers.ts` (`familyOfferDue`, tests `familyInviteOffers.test.ts`).
- **Sign-up (`alta`):** on «¿Para cuántos cocinas?» (step 1 of the web sign-up), with 2 adults or more: «¿Quieres que la otra persona vea también el menú y la lista?» · «Te preparo el mensaje con el enlace para que entre en tu casa.» It hides if the count drops to 1 and comes back within the same visit.
- **Shopping list (`compra`):** the first time the list is on screen, under the header: «Compártela con quien compra contigo» · «Si entra en tu casa, ve esta lista al momento y lo que tacha uno lo ve el otro.»
- Both cards (`components/household/FamilyInviteOffer.tsx`): «Te preparo el mensaje» creates the invite (`source` = the moment) and turns into «Enviar por WhatsApp» + «Copiar» (as in Mi casa); a ✕ («Ahora no») hides it. A failure says to do it from Perfil → Mi casa.
- **Once:** `users.family_invite_offers` (jsonb `{ alta?, compra?, mimo?, mimoDeclined? }`, migration `0081_household_invite_source.sql`, additive) is stamped atomically the first time each card is shown (`POST /households/me/family-offer { moment }`); `GET /households/me/family-offer` → `{ alta, compra }` (`alta` = may still be offered, the form checks its own adults). The card stays for the rest of that visit and never comes back (reload, other device, navigating back).
- Not offered in the WhatsApp sign-up (Mimo asks the questions there): the Mimo moment (PRO-262) covers those households.
- **Mimo (`mimo`, PRO-262):** the same in the web chat and on WhatsApp (D-051; `chat()` in `engine.ts`, text and WhatsApp modes, never voice or the sign-up chat). Once the household has a **resolved week** (a menu for that week and the list used that week or the weekend before — the `/admin/metrics` definition), Mimo adds once, at the end of its next reply: «Esta semana ya tienes menú y lista. ¿Se los mando también a tu pareja o a quien vive contigo? Si me dices que sí, te preparo el mensaje con el enlace para que entre en tu casa y lo vea todo.» A «sí» → `invite_to_household` (`source: 'mimo'`). Only in a reply, so on WhatsApp always inside the 24-hour window, never a message of its own or a template. Same «who» as above, and not while an invitation is pending (they're already inviting, e.g. in that same turn). Stamped atomically (`mimo`); a «no» as the next message (the whole message: «no», «no gracias», «vivo sola»…; not «No, cámbiame el jueves») stamps `mimoDeclined` and it never comes back, nor the list card. **Weekly aviso budget (D-069):** `familyOfferBudgetGate` must say yes (and spend the unit, kind `family_invite`, priority 4) before it's stamped; until the PRO-215 budget is merged the gate lets it through (`TODO(PRO-215)` in `services/familyInviteMimo.ts`). A failure leaves the reply as it was. Tests `familyInviteMimo.test.ts`.

## REST Surface

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/invites/:token` | public | Preview — household name, inviter username, role |
| POST | `/invites/:token/accept` | required | Atomically joins; updates primary household; the web then opens «Tus alergias y tu dieta» (PRO-271) |
| GET | `/households/me/allergies` | required | Who has said their allergies and diet: `{ meAnswered, pending, anyAnswered }` (PRO-271) |
| GET | `/households/me` | required | Returns `HouseholdDetails` with members + pendingInvites |
| PATCH | `/households/me` | owner | Body: `{ name: string }` |
| POST | `/households/me/invites` | owner | Body: `{ role: 'member' \| 'child', email?: string }` |
| POST | `/households/me/invites/:inviteId/revoke` | owner | 204 on success |
| POST | `/households/me/members/:userId/remove` | owner | Can't remove yourself this way — use `/leave` |
| POST | `/households/me/leave` | required | Auto-creates new solo for the leaver |

## Data Model

- `households(id uuid pk, name text default 'Mi casa', owner_id uuid -> users, created_at)`
- `household_members(id uuid pk, household_id, user_id, role check IN ('owner','member','child'), joined_at)` — unique on `(household_id, user_id)`
- `household_invites(id, household_id, invited_by_user_id, email?, token unique, role check IN ('member','child'), expires_at, consumed_at?, consumed_by_user_id?, created_at)`
- `users.primary_household_id uuid` — pointer to the household this user currently scopes reads/writes to

The 0011 migration includes an **idempotent backfill** (NOT EXISTS guards) so every pre-existing user gets a solo household + owner membership + primary pointer in one pass.

## Constraints / Edge Cases

- **Router ordering matters.** `users.ts` calls `router.use(authMiddleware)`, which catches every request that reaches that router. The public preview route therefore lives on a dedicated `publicHouseholdRouter` exported from `routes/households.ts` and mounted **before** `userRoutes` in `index.ts`.
- **Register fallback.** If the auto-create solo-household helper throws during registration, we swallow the error and let the auth middleware surface `code: 'NO_HOUSEHOLD'` on the next read — registration must never fail because of household plumbing.
- **Owner self-leave.** The leaver gets a new solo household; the next-oldest member of the original household is promoted to owner. The original household never ends up ownerless.
- **Pending vs consumed invites.** `pendingInvites` in `HouseholdDetails` only includes invites with `consumed_at IS NULL` AND `expires_at > now()`.
- **Email field on invites is informational.** Today we don't email anything — the owner sends the link by WhatsApp or copies it. The field is stored to give future automation a target.
- **Mimo's monthly budget is per person, not per household.** `ADVISOR_MONTHLY_BUDGET_EUR` caps each account's own spend (`users.advisor_spend_micros`, see [Advisor](./advisor.md)); members of a household don't share one cap.

## Frontend

- `/profile/casa` — each pending invite: role, «Caduca <fecha>», the link, «Enviar por WhatsApp» and «Copiar» (PRO-260; the old icon that copied only the link is gone). On phones the members/invites column is `grid-cols-1` (`minmax(0,1fr)`) so the long `/invites/<token>` URL truncates instead of widening the cards past the screen edge (fixed 2026-10-14, pinned by `e2e/household-casa.spec.ts`). Owner sees full management UI (rename, invite, revoke, remove). Members see the member list and can leave. Since PRO-40 (2026-10-10) the secondary actions live in "···" sheets: the header one ("Cambiar nombre" — owner; tapping the name still renames — and "Salir del hogar"), one per member ("Quitar del hogar") and one per pending invite ("Revocar invitación"). "Invitar a alguien" → role → "Crear invitación" and "Copiar enlace" stay inline.
- `/invites/[token]` — public preview page; if the visitor isn't authed, the accept button routes through `/register?next=/invites/:token`, and registration returns them to the invite (`next` honoured since 2026-10, see [Auth](./auth.md)). Accepting goes to `/profile/casa/alergias?next=/menu` (PRO-271; until then, `/profile/casa`).
- `/profile` links to `/profile/casa` from the "Memoria del asistente" section's button row.

## PR 1B — household-scoped reads (feature-flagged)

PR 1B added a parallel `household_id` foreign key to `menus`, `shopping_lists` and `user_favorites`, backfilled from `users.primary_household_id` in migration `0012_pr1b_household_scope.sql`. New writes dual-populate both `user_id` (legacy) and `household_id` (new) so the column never drifts. Reads pass through a single helper:

```ts
import { resolveScope, scopeWhere } from '../services/scopeResolver.js'

const scope = await resolveScope(userId)              // env-flag aware
db.select().from(menus).where(scopeWhere(menus.userId, menus.householdId, scope))
```

Behaviour matrix:

| `SHARED_HOUSEHOLD_SCOPE` | Behaviour |
|--------------------------|-----------|
| `false` (only if set explicitly, or with `NODE_ENV=production`) | Reads filter by `user_id` — pre-PR-1B behaviour exactly |
| `true` (default everywhere today, production included) | Reads filter by `household_id` — any member sees the household's rows |

Without an explicit value the flag is `NODE_ENV !== 'production'`. Railway sets no `NODE_ENV`, so it is **ON in production and staging**: household members (owner, member, child) see the same menus, shopping list, favourites and pantry. `SHARED_HOUSEHOLD_SCOPE=false` on Railway would switch reads back to per-user.

Affected surfaces:
- `POST /menu/generate`, `GET /menu/:userId/:weekId`, `GET /menu/:userId/history`
- `GET /shopping-list/:menuId`, `POST /shopping-list/:listId/regenerate` (also the access check — household members can regenerate each other's lists)
- `GET /user/:id/recipes` (favorites column), favorite toggle still keys on the actual user but household reads aggregate across members
- The matcher (`menuGenerator.ts`) — favorites boost now spans the household
- The assistant skills surface (`get_todays_menu`, `get_shopping_list`, `toggle_favorite`, `get_pantry_stock`, `mark_in_stock`, etc.) — same scope rules apply

The favorite **toggle** stays per-user (each member can independently star/unstar). The household-aware **read** unions every member's stars. So if A stars X, the household reads "X is favorited"; B clicking unstar only removes their own row (which didn't exist), and tests verify no duplicate is inserted (unique constraint on `(user_id, recipe_id)`).

Edge cases:
- `household_id` is nullable for the rollout window. Existing rows are backfilled; new inserts dual-write. If a row somehow lands with `household_id IS NULL`, the read path falls back to `user_id` via `pickScope` (covered by unit test).
- The shopping-list access check (`POST /shopping-list/:listId/regenerate`) accepts the request if (a) the requester is the list's owner OR (b) the requester's primary household matches the list's `household_id` (only when flag is on). Cross-household requests still 403.

## Source
- `apps/web/src/components/profile/SchoolMenuLink.tsx` — the «Menú del cole» row (PRO-224)

- `apps/api/src/db/schema.ts` — `households`, `household_members`, `household_invites`, `users.primary_household_id`, plus `household_id` on `menus`/`shopping_lists`/`user_favorites`
- `apps/api/src/db/migrations/0011_married_speedball.sql` — tables + backfill
- `apps/api/src/db/migrations/0012_pr1b_household_scope.sql` — household_id columns + idempotent backfill
- `apps/api/src/services/householdStore.ts` — all business logic (load/rename/invite/accept/revoke/remove/leave)
- `apps/api/src/services/scopeResolver.ts` — `pickScope`, `resolveScope`, `scopeWhere`, `getPrimaryHouseholdId`
- `apps/api/src/config/env.ts` — `SHARED_HOUSEHOLD_SCOPE` flag (unset ⇒ `NODE_ENV !== 'production'`; ON on Railway)
- `apps/api/src/tests/scopeResolver.test.ts` + `householdScopeSmoke.test.ts` — pure-logic regressions for the flag matrix
- `apps/api/src/routes/menus.ts`, `apps/api/src/routes/shopping.ts`, `apps/api/src/routes/recipes.ts` — readers wired through `scopeWhere`
- `apps/api/src/services/menuGenerator.ts`, `apps/api/src/services/assistant/skills.ts` — scope-aware favorites + pantry
- `apps/api/src/routes/households.ts` — REST surface; exports `publicHouseholdRouter` (preview) + default router (everything else)
- `apps/api/src/routes/auth.ts` — calls `createSoloHouseholdForNewUser` at register-time
- `apps/api/src/index.ts` — mount order (`publicHouseholdRouter` before `userRoutes`)
- `apps/web/src/app/profile/casa/page.tsx` — household management UI
- `apps/web/src/app/invites/[token]/page.tsx` — public preview + accept page
- `apps/web/src/app/profile/casa/alergias/page.tsx` — «Tus alergias y tu dieta» after accepting (PRO-271)
- `apps/web/src/components/menu/HouseholdAllergiesNotice.tsx` — the warning above «Generar mi menú» (PRO-271)
- `apps/api/src/services/householdAllergies.ts` — who has answered, every member's restrictions for the menu (PRO-271)
- `apps/web/e2e/household-invite-allergies.spec.ts` — invitation → questions → menu without shellfish, 390×844
- `apps/web/e2e/household-casa.spec.ts` — Playwright regression for the happy path and «Enviar por WhatsApp» at 390 px (PRO-260)
- `packages/shared/src/types/familyInvite.ts` — TTL, sources, `familyInviteShareText` (tests `apps/api/src/tests/familyInvite.test.ts`)
- `apps/web/src/components/household/FamilyInviteShare.tsx` — «Enviar por WhatsApp» + «Copiar»
- `apps/web/src/components/household/FamilyInviteOffer.tsx` — the offer card and `useFamilyOfferOnce` (sign-up `OnboardingFlow.tsx`, `/shopping`)
- `apps/api/src/services/familyInviteOffers.ts` — who gets the offer, once per moment; `0081_household_invite_source.sql`
- `apps/api/src/services/familyInviteMimo.ts` — Mimo's offer after the first resolved week (PRO-262), called from `assistant/engine.ts`
- `apps/web/e2e/family-invite-offer.spec.ts` — sign-up with 2 adults and first visit to the list, once each (PRO-261)
- `apps/api/src/db/migrations/0081_household_invite_source.sql` — `household_invites.source`, `shared_at`
