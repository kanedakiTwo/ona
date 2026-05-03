# User Management

Admin-only sub-section of `/admin` for browsing the user list, viewing per-user detail (profile, restrictions, registration date), suspending or reactivating accounts, and generating one-time password reset tokens.

## Why this exists

Once ONA has more than one user, an admin needs a way to handle real-world support requests: a user forgot their password, a user is abusive, a user wants their data deleted. Without a UI for these, the admin is reduced to writing SQL or calling backend endpoints by hand.

This is intentionally narrow: **list, detail, suspend, reset password**. Things like "delete user", "edit profile", and "impersonate" are deliberate v2 follow-ups.

## User Capabilities

- An admin opens `/admin` → "Usuarios" tab.
- The tab shows a paginated list (25 per page) sorted by registration date desc. Each row: avatar/initial, username, email, role, suspended state (yes/no), registered (relative time), last login (if recorded; otherwise "—").
- A search bar filters by username or email (case-insensitive). A toggle "solo suspendidos" filters to currently-suspended users.
- Clicking a row opens a side panel with the user detail:
  - Username, email, role
  - Onboarding state (done / pending) + answers if done (household size, restrictions, favorite dishes, priority)
  - Physical profile (sex, age, weight, height, activity level)
  - Counts: recetas creadas, menús generados, último login
  - Action buttons: **Suspender** / **Reactivar**, **Generar enlace de reset**
- **Suspender** flips `suspended_at` to `now()`. Confirms in a small modal ("¿Suspender la cuenta de X? El usuario no podrá iniciar sesión hasta que la reactives."). Records `user.suspend` in the audit log.
- **Reactivar** clears `suspended_at`. Records `user.unsuspend`.
- **Generar enlace de reset** opens a modal with the link `/reset?token=<uuid>` already copied to the clipboard, plus a "Copiar de nuevo" button. The link expires in 24 h. The admin sends the link to the user via whatever channel they prefer (WhatsApp, in-person, etc.); ONA does not send the email.

## What's *not* here in v1

- No "delete user" — users can request deletion via support; admin runs SQL after a cooling-off period.
- No edit-user-profile from the admin side. If a user wants their profile changed, they edit it themselves.
- No impersonation ("ver como X"). Useful for support but high-risk; we'll add it later with stricter audit + a banner.
- No bulk operations. Suspend / reactivate / reset are one user at a time.
- No automated email. The admin sends the reset link manually. Adding email is a separate feature when ONA grows past the "I know all my users" stage.

## Schema additions

```sql
ALTER TABLE users ADD COLUMN role text NOT NULL DEFAULT 'user';
ALTER TABLE users ADD COLUMN suspended_at timestamptz NULL;

-- Index for filter / search
CREATE INDEX idx_users_suspended ON users (suspended_at) WHERE suspended_at IS NOT NULL;

-- Reset tokens
CREATE TABLE password_reset_tokens (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       text NOT NULL UNIQUE,           -- the secret; opaque random string
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_password_reset_user ON password_reset_tokens (user_id);
```

The token is a single-use opaque string (`crypto.randomBytes(32).toString('hex')`). On `/reset?token=X`, the API looks it up, checks `used_at IS NULL` and `expires_at > now()`, and on success accepts a new password and sets `used_at = now()`.

## API

- `GET /admin/users?search=&suspended=&page=` (admin) — paginated list with filters.
- `GET /admin/users/:id` (admin) — full detail including onboarding answers and physical profile.
- `POST /admin/users/:id/suspend` (admin) — sets `suspended_at`; logs.
- `POST /admin/users/:id/unsuspend` (admin) — clears `suspended_at`; logs.
- `POST /admin/users/:id/reset-password-token` (admin) — issues a new token, returns `{ token, link, expires_at }`; logs only `token_id` + `expires_at`, never the secret.
- `POST /auth/reset?token=X` (public) — accepts `{ password }`, validates token, updates `users.password_hash`, marks token used.

## Suspension semantics

- A suspended user's existing JWT keeps decoding, but every privileged endpoint (anything behind `requireAuth`) re-checks `users.suspended_at IS NULL` and returns 401 with `code: 'SUSPENDED'` if not. The frontend catches that code and forces a logout with a Spanish message: "Tu cuenta está suspendida. Contacta con el equipo de ONA si crees que es un error."
- Login (`POST /auth/login`) explicitly rejects suspended users with the same code.
- Suspending an admin is allowed but lands in audit. Re-promoting (re-adding to `ADMIN_EMAILS` and re-deploying) doesn't reactivate a suspended account — admin must explicitly unsuspend first. This avoids the odd state where someone who was suspended for cause silently regains access on next deploy.

## Constraints

- All endpoints behind `requireAdmin` (server-side enforced).
- All mutations write to `admin_audit_log` (see [Admin Audit Log](./admin-audit-log.md)).
- Spanish copy throughout. Editorial design tokens.
- Password reset tokens never appear in audit log payloads (only `token_id` + `expires_at`).
- The admin cannot suspend themselves (the API rejects with 400 — easy footgun otherwise).
- Pagination uses `page` + `per_page` (default 25); the response includes total count for the pagination UI.

## Related specs

- [Roles & Authorization](./roles.md) — gating for the whole sub-section
- [Admin Dashboard](./admin-dashboard.md) — host page, tab-level navigation
- [Admin Audit Log](./admin-audit-log.md) — every mutation here lands there
- [Authentication](./auth.md) — login rejects suspended users; new public `/auth/reset?token=` route

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users.role`, `users.suspended_at`, `password_reset_tokens`
- [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts) — admin user endpoints
- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — `POST /auth/reset?token=` (public consume)
- [apps/api/src/services/passwordReset.ts](../apps/api/src/services/passwordReset.ts) — token mint + consume helpers
- [apps/web/src/app/admin/sections/UsersSection.tsx](../apps/web/src/app/admin/sections/UsersSection.tsx) — list + detail panel
- [apps/web/src/app/(auth)/reset/page.tsx](../apps/web/src/app/(auth)/reset/page.tsx) — public consume page
