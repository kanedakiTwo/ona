# Admin Audit Log

Append-only record of every mutating action an admin performs. Admins can browse it from a tab in `/admin` to verify recent changes, troubleshoot user reports, and double-check destructive operations.

## Why this exists

`requireAdmin` opens a high-trust path: editing the global ingredient catalog, suspending users, generating reset tokens, mapping recipes to USDA. Any of these can be done by mistake and "who did what when" is the only reliable answer when a user reports something off. Without an audit log the admin's only options are: trust nothing changed, or grep production logs.

The log is append-only; admins cannot delete entries from the UI. Manual deletion stays a DBA-level operation.

## User Capabilities

- An admin opens `/admin` → "Auditoría" tab and sees a reverse-chronological list of admin actions.
- Each entry shows: timestamp, admin (name + email), action code (`ingredient.remap`, `user.suspend`, `user.reset_password.generate`, etc.), target (a name/id), and a short payload summary (e.g. `"fdcId 173410 → 170000"` for a remap).
- A filter strip at the top: filter by admin, by action code, by date range. Default view: last 14 days.
- Clicking an entry expands it to show the full JSONB `payload` (pretty-printed JSON).
- The list is paginated (50 per page).
- There is no UI to delete or edit entries.

## What gets logged

Every admin endpoint that mutates state. Concretely:

- `ingredient.create` — auto-create from the admin dashboard
- `ingredient.update` — `PATCH /ingredients/:id` (aisle, density, unitWeight, allergenTags)
- `ingredient.remap` — `PATCH /ingredients/:id/remap` (USDA fdcId change)
- `ingredient.estimate_nutrition` — admin-triggered LLM estimate
- `recipe.update` — system recipe edit
- `recipe.delete` — system recipe delete
- `user.suspend` — user suspended
- `user.unsuspend` — user reactivated
- `user.reset_password.generate` — admin generated a one-time reset token (the token value itself is NOT stored in the audit payload; only that one was issued)
- `app_error.resolve` — admin marked an error group resolved via `POST /admin/errors/:id/resolve` (target type `app_error`; payload: kind, message, resolvedAt) — see [errors.md](./errors.md)
- `waitlist.invite` — admin marked a batch of waitlist entries invited via `POST /admin/waitlist/invite` (target type `waitlist_entry`, no single target id; payload: batch, count, ids — never emails) — see [waitlist.md](./waitlist.md)
- `newsletter.send` — admin sent an issue of the Friday newsletter via `POST /admin/newsletter/send` (target type `newsletter_issue`, no target id; payload: issueId, sent, failed, skipped — never emails). Dry runs and proofs are not audited — see [newsletter.md](./newsletter.md)
- `invite_campaign.create` / `invite_campaign.delete` — admin created or deleted a campaign invitation link (`POST` / `DELETE /admin/invite-campaigns`, target type `invite_campaign`; payload: name, maxUses, expiresAt on create; name, code and uses on delete)
- `catalog_draft.publish` / `catalog_draft.discard` / `catalog_draft.restore` — Admin → «Recetas pendientes»: a catalogue draft published (Miguel's OK + out), turned down, or its verdict taken back (`POST /admin/catalog-drafts/:id/publish|discard|restore`, target type `recipe`; payload: name, batch, origin, and `wishesCovered` on publish). Written in the same transaction as the change — see [catalog-import.md](./catalog-import.md)
- `catalog_batch.publish` — «Publicar las aprobadas» of a batch (`POST /admin/catalog-batches/:batch/publish`, target type `catalog_batch`, target id = the batch; payload: published, ids, wishesCovered, held by reason). Not written when nothing was published
- `catalog_import.start` — a Cocina batch file imported as drafts from the web (`POST /admin/catalog-import/jobs`, target type `catalog_import`, target id = the job; payload: batch, origin, fileName, recipes). Written before the background import starts; if it can't be written the import never runs
- `network_shop.create` · `network_shop.update` · `network_shop.status` — «Tiendas de Mimoia» (PRO-358, `POST`/`PATCH /admin/shop-network`, target type `network_shop`): payload `{ created: { name, kind } }` on alta, `{ <field>: { before, after } }` for what changed; written in the same transaction as the change

Admin **read** operations do not write to the log. Failed mutations (validation errors, 4xx responses) do not write either — only successful state changes.

## Schema

Single table, append-only:

```sql
admin_audit_log (
  id          uuid PRIMARY KEY,
  admin_id    uuid NOT NULL REFERENCES users(id),
  action      text NOT NULL,                       -- 'ingredient.remap' etc.
  target_type text NOT NULL,                       -- 'ingredient' | 'recipe' | 'user'
  target_id   text,                                -- the row id; nullable for cross-cutting actions
  payload     jsonb NOT NULL DEFAULT '{}',         -- before/after diff or relevant metadata
  created_at  timestamptz NOT NULL DEFAULT now()
)
```

A small index on `(created_at DESC)` for the default feed; another on `(admin_id, created_at DESC)` for the admin filter; a third on `action` for the action filter.

## Payload conventions

- For updates: `{ before: <fields>, after: <fields> }` with only the changed fields.
- For deletes: `{ deleted: <full row snapshot> }`.
- For creates: `{ created: <new row id + key fields> }`.
- For tokens / sensitive operations: `{ token_id: <id>, expires_at: <timestamp> }` — never the secret itself.
- All payloads must serialize cleanly to JSONB. No circular refs, no functions.

## Constraints

- The log is **always written**. If the audit insert fails, the admin action is rolled back. We'd rather refuse a mutation than silently lose its trail.
- Retention: indefinite for now. Add a cron pruning job (e.g. > 1 year) when the table grows past 100 K rows. Spec follow-up.
- The log surface is admin-only — non-admins cannot see any audit entries about themselves either (admins handle those reports).
- All copy in Spanish (column headers, action code translations into readable text via a small Spanish dictionary in the frontend).
- Action codes are stable — once added, never renamed (renames break filters on existing rows). Add new codes; never repurpose old ones.

## Related specs

- [Roles & Authorization](./roles.md) — only admins can write to the log; only admins can read it
- [Admin Dashboard](./admin-dashboard.md) — UI sits as a sub-tab here
- [User Management](./user-management.md) — suspend/reset are the most-watched actions

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `admin_audit_log` table
- [apps/api/src/services/auditLog.ts](../apps/api/src/services/auditLog.ts) — `record(adminId, action, targetType, targetId, payload)` helper called from every admin handler
- [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts) — `GET /admin/audit-log` endpoint with filters + pagination
- [apps/web/src/app/admin/sections/AuditLogSection.tsx](../apps/web/src/app/admin/sections/AuditLogSection.tsx) — feed UI
- [apps/web/src/lib/auditCodes.ts](../apps/web/src/lib/auditCodes.ts) — action code → Spanish phrase
