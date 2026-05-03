# Roles & Authorization

Two-role system (`user` and `admin`) for ONA. Admin role gates the catalog management page (`/admin`, ex `/curator`), the user management page, and the audit log. Bootstrap is via the `ADMIN_EMAILS` environment variable.

## Why this exists

Until now `/curator` was reachable by any authenticated user — a real risk because that page can edit the global ingredient catalog and surface every recipe in the system. As soon as ONA started shipping user-created recipes alongside system recipes, the line between "stuff a curator should touch" and "stuff a regular user should touch" became important.

The two-role split is intentional: most decisions today are binary (system vs. self), and adding finer roles (editor, moderator) before there's a real workflow for them would be overengineering.

## User Capabilities

- Logged-in users carry a `role` (`user` by default, `admin` for whitelisted emails)
- Users with `role === 'admin'` see an "Admin" entry from `/profile`'s footer that opens `/admin`
- Users with `role === 'user'` see no admin entry; a direct visit to `/admin` shows a 403 page with a link back home
- Admin status is reconciled on every login: if the user's email is in the `ADMIN_EMAILS` env var, role becomes `admin`; if it's not, an existing admin's role is downgraded to `user`. This keeps the env var the single source of truth for who's an admin
- A user whose `users.suspended_at` is set cannot log in — login returns 403 with a Spanish error explaining the suspension. Admins can suspend / un-suspend from `/admin/users` (see [User Management](./user-management.md))

## Constraints

- `users.role` is an enum (`'user' | 'admin'`) with default `'user'`. Migrations leave existing users on `'user'`; admins are picked up at next login from `ADMIN_EMAILS`
- `ADMIN_EMAILS` is a comma-separated env var. Whitespace tolerated. Case-insensitive comparison against `users.email`
- The `requireAdmin` middleware extends `requireAuth`: it first validates the JWT, then loads the user row, then checks `role === 'admin' && suspended_at IS NULL`. Failure returns 403
- The JWT payload still only carries `userId` — the role is fetched from DB on each privileged request to avoid stale tokens after a role change. This is fine: privileged routes are low-volume
- Admins are always reverse-proxied through audit logging — every successful mutation issued by an admin lands in `admin_audit_log` (see [Admin Audit Log](./admin-audit-log.md))
- The frontend client stores `role` in the auth context next to `userId` so the navbar/profile/admin link rendering doesn't need an extra fetch. The API still re-checks server-side on every privileged request

## Bootstrap & rotation

- Add an email to `ADMIN_EMAILS` and re-deploy. On the admin's next login they're upgraded automatically
- Remove an email from `ADMIN_EMAILS` and re-deploy. On their next login they're downgraded; until they log in again, their existing JWT keeps working (the per-request role check denies privileged actions)
- For local dev, edit `.env`. For production, set the variable on Railway (`ona-api` service)
- There is intentionally no UI for changing role. To grant admin you must edit the env var. This is a deliberate friction so the privilege escalation has an audit trail (commit + deploy)

## Related specs

- [Authentication](./auth.md) — role is added to the JWT-validated user payload
- [Admin Dashboard](./admin-dashboard.md) — gated by `requireAdmin`
- [User Management](./user-management.md) — admin-only user list, suspend, reset password
- [Admin Audit Log](./admin-audit-log.md) — every admin mutation lands here
- [My Recipes](./my-recipes.md) — the user-scoped curator that lives inside `/profile`

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `users.role` enum + `users.suspended_at`
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — `requireAuth`, `requireAdmin`
- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — login reconciles role from `ADMIN_EMAILS`
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `ADMIN_EMAILS` parsing
- [apps/web/src/lib/auth.tsx](../apps/web/src/lib/auth.tsx) — role exposed in the auth context
- [apps/web/src/app/admin/page.tsx](../apps/web/src/app/admin/page.tsx) — 403 if not admin
