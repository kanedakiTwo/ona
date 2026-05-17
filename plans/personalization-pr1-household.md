# Household Foundation Implementation Plan

## Summary

Introduce a `households` entity that owns menus, shopping lists, pantry stock, favorites, cook logs, and (later) shared recipes. Every existing user is backfilled into a solo household so production data keeps working. Adds an invitation flow so a second user can join an existing household. Switches every household-scoped route from `userId` to `householdId` derivation. Without this PR the family-sharing tracks (D, H) and any data the household co-owns (recipes, pantry, shopping) cannot be built without re-doing scoping later.

This is the riskiest migration in the personalization roadmap. Ship it before everything else.

## Tasks

- [ ] Add `households`, `household_members`, `household_invites` tables (Drizzle schema + migration)
  + `households`: id (uuid pk), name (text, default "Mi casa"), created_at, owner_id (FK users)
  + `household_members`: id, household_id (FK), user_id (FK), role enum 'owner'|'member'|'child' default 'member', joined_at; unique (household_id, user_id)
  + `household_invites`: id, household_id (FK), invited_by_user_id (FK), email (text, lowercased), token (text, 32 chars, indexed unique), role enum 'member'|'child', expires_at (default now()+7d), consumed_at (nullable), created_at
  + `users.primary_household_id` nullable uuid FK (for fast lookup; one query per request)
  + Indexes on (household_id), (user_id), token
  + Migration is additive only — no NOT NULL constraints yet on the scoping FKs added in step 3
  + See [`specs/auth.md`](../specs/auth.md) for the existing users schema this stacks on
- [ ] Backfill migration: every existing user gets a solo household
  + Insert `households(name='Mi casa', owner_id=user.id)` for every existing `users.id`
  + Insert `household_members(household_id, user_id, role='owner')` for every such household
  + Update `users.primary_household_id` to the new household id
  + Wrap in a transaction; idempotent (skip users with existing membership)
  + Document the backfill SQL in the migration file's comment header so it's reproducible
- [ ] Add `household_id` (nullable) to `menus`, `shopping_lists`, `user_favorites`, plus the `cook_logs` table we'll add in PR 6 (skip cook_logs here — it doesn't exist yet)
  + Add the column as nullable on each
  + Backfill: `UPDATE menus SET household_id = (SELECT primary_household_id FROM users WHERE id = menus.user_id)`. Same for shopping_lists and user_favorites
  + After backfill, set NOT NULL
  + Keep `user_id` columns for historical attribution ("who created this menu?") but stop using them for scope checks
  + Add indexes on `(household_id)` and `(household_id, week_start)` for menus
- [ ] Backend: derive `householdId` from JWT in `authMiddleware`
  + Read `users.primary_household_id` on every authed request and stash it on `req.householdId`
  + If a user has no primary household (shouldn't happen post-backfill, but be defensive), 500 with `code: 'NO_HOUSEHOLD'`
  + Helper `requireHouseholdMember(householdId)` that re-validates the user belongs to the requested household (for routes that take a household id in the path)
- [ ] Routes: switch menus / shopping / favorites / pantry from user-scoped to household-scoped
  + `GET /menu/:userId/:weekId` → `GET /menu/:weekId` (read `req.householdId`); keep old path as a 301 alias for one release
  + `POST /menu/generate` body `{ userId, weekStart }` → continues working but now writes the menu's `household_id` from the user's primary household. Stop using user_id for the menu rowid
  + Same for `/shopping/*`, `/user/:id/favorites` (rename to `/household/favorites`), pantry
  + Document the deprecated user-scoped paths in `specs/menus.md` / `specs/shopping.md` with a removal date
- [ ] API: household management endpoints (all auth-required)
  + `GET /households/me` — returns the user's primary household + member list (with display names + roles)
  + `PATCH /households/me` body `{ name }` — owner-only; rename household
  + `POST /households/me/invites` body `{ email, role }` — owner-only; generates a `household_invites` row with a 7-day token, returns `{ token, expiresAt, inviteUrl }` (the email is NOT auto-sent — owner shares the link manually like the admin reset-password flow)
  + `GET /invites/:token` — public, returns `{ householdName, invitedByName, expiresAt }` (no auth — the recipient may not have an account yet)
  + `POST /invites/:token/accept` (auth required, so the recipient must register or log in first) — adds them to the household as the role specified in the invite, sets their `primary_household_id`, marks the invite consumed
  + `POST /households/me/members/:userId/remove` — owner-only; can't remove self if last owner
  + `POST /households/me/leave` — current user leaves; if owner and there's another member, promote oldest member; if owner and alone, the household is dropped
- [ ] Frontend: hook `useHousehold()` returns the current household + members
  + TanStack Query, key `["household", "me"]`
  + Stale time 60s; invalidated by every mutation below
- [ ] Frontend: `/profile/casa` page
  + List members with role badges (Owner / Miembro / Niño) and join date
  + Rename household (owner only)
  + Invite UI: input email + role select → on submit, show the invite URL in a copyable box ("Comparte este enlace con quien quieras invitar; caduca el [fecha]")
  + Pending invites list (not yet consumed) with revoke button
  + Per-member remove button (owner only)
  + "Salir de la casa" button at the bottom with confirm dialog
- [ ] Frontend: `/invites/:token` public page
  + Renders household name + inviter name + expiry
  + If user is logged in: "Aceptar invitación" button → calls accept endpoint, redirects to `/menu`
  + If user is anonymous: "Crea tu cuenta para unirte" button → redirect to /register with `?invite=<token>` query, then auto-accept after register
- [ ] Update `useAuth` to expose `householdId` for client-side scoping
  + Set on login / register response: backend now returns `{ token, user, householdId }`
  + Persist alongside `ona_token` and `ona_user`
  + Provides a sanity check (frontend can pre-filter caches by householdId)
- [ ] Spec updates
  + New spec `specs/household.md` — model, roles, invitation flow, scoping invariant, migration history
  + Edit `specs/menus.md` to note that menus are now household-scoped (user_id is historical only)
  + Edit `specs/shopping.md` same change
  + Edit `specs/auth.md` to mention `users.primary_household_id`
  + Add `household.md` row to `specs/index.md`
- [ ] Tests
  + Unit: backfill SQL is idempotent (run twice, second run is a no-op) — vitest with an in-memory or local Postgres fixture
  + Unit: `requireHouseholdMember` rejects users who aren't members
  + Unit: invite acceptance happy path + expired token rejected + double-accept rejected
  + Integration: a registered user creates an invite, a second user accepts, both see the same menu after the first runs `/menu/generate`
  + Playwright: `/profile/casa` member list + invite link generation at 390×844
- [ ] Verify implementation
  + Local DB: run the migration; confirm every existing user now has `primary_household_id` set and a matching `household_members` row
  + Local DB: run `SELECT user_id FROM users WHERE primary_household_id IS NULL` — must return 0 rows
  + Backend: `GET /households/me` with each existing user's token returns their solo household with role 'owner'
  + Backend: create an invite as user A, accept it as a freshly registered user B, then `GET /households/me` from B's session returns A's household with B as 'member'
  + Backend: A generates a menu → B's `GET /menu/:weekId` returns the same menu
  + Backend: B leaves the household → `GET /households/me` returns B's solo household again (auto-created on leave)
  + Frontend: `/profile/casa` shows both users; A revokes a pending invite (URL stops working)
  + Frontend: open `/invites/:token` while logged out; the page renders the invite preview
  + Production rehearsal: run the migration against a copy of prod data; confirm no user is orphaned
