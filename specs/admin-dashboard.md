# Admin Dashboard

Single admin-only page at `/admin` that exposes catalog gaps, system-recipe quality issues, the latest LLM regen output, user management, and the audit log. This is the renamed and gated successor to the old `/curator` page; the old route 301-redirects to `/admin`.

## Why this exists

Catalog and system-recipe debt accumulates as users auto-create ingredients, the photo extractor falls back to stub rows (`fdcId: NULL`), and the LLM regen pipeline leaves recipes in JSONL files. Without a single admin surface listing the debt, an admin would have to write SQL or grep through `regen-failed.jsonl`. The dashboard is that surface, plus user management and an audit log of admin actions.

It is intentionally small: **a few sections, no charts, no destructive operations without an explicit confirm**. Every action calls an existing endpoint or one of the new admin endpoints.

## User Capabilities

- An admin (see [Roles & Authorization](./roles.md)) opens `/admin` from the "Admin" footer link in `/profile`. A non-admin lands on a 403 page that links back to `/menu`.
- The dashboard shows a counts header (ingredients sin USDA, recetas con kcal=0, alérgenos sugeridos, archivos en regen, usuarios suspendidos, acciones admin recientes).
- Pill-bar tabs jump between sections:
  - **Ingredientes sin USDA** — every ingredient with `fdcId IS NULL`. "Mapear a USDA" reuses the auto-create modal (manual search + Spanish translations + BEDCA fallback + "Estimar con ONA" — see [Ingredient Auto-Create](./ingredient-auto-create.md)).
  - **Pasillo «otros»** — `aisle === 'otros'` or `aisle IS NULL`. Inline `<select>`.
  - **Sin densidad** — heuristic: name matches density-relevant keywords AND `density IS NULL`. Inline numeric input.
  - **Sin peso por unidad** — `aisle === 'produce'` AND `unitWeight IS NULL` AND not bulk leafy. Inline numeric input.
  - **Alérgenos sugeridos** — rows where `inferAllergenTagsFromName(name)` produces tags not currently present.
  - **Recetas de sistema con kcal=0** — system recipes (`authorId IS NULL`) whose `nutritionPerServing.kcal` is falsy. Lists which of their ingredients are still missing `fdcId`. Recipe name links to its detail page; admin fixes the upstream ingredient first, then re-saves the recipe to recompute.
  - **Output de regen** — collapsible list parsed from `apps/api/scripts/output/regen-failed.jsonl` and `regen-skipped.jsonl`.
  - **Usuarios** — see [User Management](./user-management.md). Sub-tab; lists, suspends, and generates reset password tokens.
  - **Auditoría** — see [Admin Audit Log](./admin-audit-log.md). Sub-tab; reverse-chronological feed of admin actions with filters by admin and action.
- Every mutation issued from the dashboard generates an entry in `admin_audit_log`.

## Scope vs My Recipes

The admin dashboard handles **system recipes only** (`authorId IS NULL`). User-created recipes are out of scope here — users curate their own recipes via the "Mis recetas" tab in `/profile` (see [My Recipes](./my-recipes.md)). The split is enforced server-side: every admin mutation that touches a recipe rejects with 400 if `authorId !== NULL`.

## Constraints

- `requireAdmin` middleware on all admin endpoints (server-side enforced — frontend gating is decoration). See [Roles & Authorization](./roles.md).
- The old `/curator` route is kept as a permanent client-side redirect to `/admin`. After 60 days the redirect can be removed; in the meantime old links still work.
- Same heuristics as before for ingredient gaps. Editorial design system tokens (cream `#FAF6EE`, ink `#1A1612`, terracotta `#C65D38`, parchment `#FFFEFA`, border `#DDD6C5`).
- No new dependencies. Spanish copy throughout. The dashboard is server-rendered via Next.js client components but every admin action does an explicit server-side `requireAdmin` check — no Next.js route-level gating only.

## Related specs

- [Roles & Authorization](./roles.md) — middleware, ADMIN_EMAILS bootstrap
- [Ingredient Auto-Create](./ingredient-auto-create.md) — modal reused for "Mapear a USDA"
- [User Management](./user-management.md) — sub-tab for users list/suspend/reset
- [Admin Audit Log](./admin-audit-log.md) — sub-tab for reviewing actions
- [Recipes](./recipes.md) — system recipes are what the dashboard manages
- [Recipe Quality](./recipe-quality.md) — lint validator output drives the regen sub-section
- [My Recipes](./my-recipes.md) — the user-scoped equivalent that sits in `/profile`

## Source

- [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts) — replaces `routes/curator.ts`; all endpoints behind `requireAdmin`
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — `requireAdmin`
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — `inferAllergenTagsFromName`
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts)
- [apps/web/src/app/admin/page.tsx](../apps/web/src/app/admin/page.tsx) — replaces `app/curator/page.tsx`
- [apps/web/src/app/admin/sections/](../apps/web/src/app/admin/sections/) — section components, replaces `app/curator/sections/`
- [apps/web/src/hooks/useAdmin.ts](../apps/web/src/hooks/useAdmin.ts) — replaces `useCurator.ts`
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — gated "Admin" footer link, only visible when `role === 'admin'`
- [apps/web/src/app/curator/page.tsx](../apps/web/src/app/curator/page.tsx) — temporary redirect to `/admin`
