# Household

**Status:** PR 1 Part A shipped. PR 1 Part B (scope flip) pending.

A "household" is the shared unit that owns menus, shopping lists, favourites and pantry stock. Every authed user belongs to exactly one **primary** household, accessible via `users.primary_household_id`. New users get a solo household auto-created at `/register` so every authed read has a valid scope from the first request.

## User Capabilities

- A registered user lands on a one-member household called **"Mi casa"** with role `owner`.
- The owner can:
  - Rename the household (`PATCH /households/me`).
  - Generate an invite for role `member` or `child`. The token is 32 hex chars and expires after 7 days.
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
  - Rejects with 410 `InviteExpiredError` if the token is already consumed or past its `expires_at`.

## REST Surface

| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/invites/:token` | public | Preview — household name, inviter username, role |
| POST | `/invites/:token/accept` | required | Atomically joins; updates primary household |
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
- **Email field on invites is informational.** Today we don't email anything — the owner copies the share URL manually. The field is stored to give future automation a target.

## Frontend

- `/profile/casa` — owner sees full management UI (rename, invite, revoke, remove). Members see the member list and a "Salir del hogar" button.
- `/invites/[token]` — public preview page; if the visitor isn't authed, the accept button routes through `/register?next=/invites/:token`.
- `/profile` links to `/profile/casa` from the "Memoria del asistente" section's button row.

## Source

- `apps/api/src/db/schema.ts` — `households`, `household_members`, `household_invites`, `users.primary_household_id`
- `apps/api/src/db/migrations/0011_married_speedball.sql` — tables + backfill
- `apps/api/src/services/householdStore.ts` — all business logic (load/rename/invite/accept/revoke/remove/leave)
- `apps/api/src/routes/households.ts` — REST surface; exports `publicHouseholdRouter` (preview) + default router (everything else)
- `apps/api/src/routes/auth.ts` — calls `createSoloHouseholdForNewUser` at register-time
- `apps/api/src/index.ts` — mount order (`publicHouseholdRouter` before `userRoutes`)
- `apps/web/src/app/profile/casa/page.tsx` — household management UI
- `apps/web/src/app/invites/[token]/page.tsx` — public preview + accept page
- `apps/web/e2e/household-casa.spec.ts` — Playwright regression for the happy path
