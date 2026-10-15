# Admin Dashboard

Single admin-only page at `/admin` that exposes catalog gaps, system-recipe quality issues, the latest LLM regen output, user management, and the audit log. This is the renamed and gated successor to the old `/curator` page; the old route 301-redirects to `/admin`.

## Why this exists

Catalog and system-recipe debt accumulates as users auto-create ingredients, the photo extractor falls back to stub rows (`fdcId: NULL`), and the LLM regen pipeline leaves recipes in JSONL files. Without a single admin surface listing the debt, an admin would have to write SQL or grep through `regen-failed.jsonl`. The dashboard is that surface, plus user management and an audit log of admin actions.

It is intentionally small: **a few sections, no charts, no destructive operations without an explicit confirm**. Every action calls an existing endpoint or one of the new admin endpoints.

## User Capabilities

- An admin (see [Roles & Authorization](./roles.md)) opens `/admin` from "Panel de admin" in the profile header's "···" sheet (`/profile`). On desktop (`md+`) the left sidebar shows an **«Admin» block under the normal items**, only for admins: Catálogo (`/admin`), Usuarios (`/admin/usuarios`), Invitaciones (`/admin/invitaciones`), Lista de espera (`/admin/lista-espera`) and Auditoría (`/admin/auditoria`), with the active one highlighted (`lib/adminNav.ts`). «Voz» (history of the retired voice mode, D-023) is left out of the menu and the mobile tabs but still opens at `/admin/voz`. Each area has its own heading and one-line intro; the four catalogue counts (ingredientes sin USDA, recetas con kcal=0, alérgenos sugeridos, archivos en regen) only show on Catálogo. Each area has its own URL (route `/admin/[[...seccion]]`; an unknown slug shows the catalogue). On desktop the page then keeps only the catalogue's seven gap tabs, wrapped so none hides off-screen; on mobile (no sidebar) every tab scrolls sideways and the non-catalogue ones navigate to their URL. E2E `admin-sidebar.spec.ts`. A non-admin lands on a 403 page that links back to `/menu`.
- The dashboard shows a counts header (ingredients sin USDA, recetas con kcal=0, alérgenos sugeridos, archivos en regen, usuarios suspendidos, acciones admin recientes).
- Pill-bar tabs jump between sections:
  - **Ingredientes sin USDA** — every ingredient with `fdcId IS NULL`. "Mapear a USDA" reuses the auto-create modal (manual search + Spanish translations + BEDCA fallback + "Estimar con Mimoia" — see [Ingredient Auto-Create](./ingredient-auto-create.md)).
  - **Pasillo «otros»** — `aisle === 'otros'` or `aisle IS NULL`. Inline `<select>`.
  - **Sin densidad** — heuristic: name matches density-relevant keywords AND `density IS NULL`. Inline numeric input.
  - **Sin peso por unidad** — `aisle === 'produce'` AND `unitWeight IS NULL` AND not bulk leafy. Inline numeric input.
  - **Alérgenos sugeridos** — rows where `inferAllergenTagsFromName(name)` produces tags not currently present.
  - **Recetas de sistema con kcal=0** — system recipes (`authorId IS NULL`) whose `nutritionPerServing.kcal` is falsy. Lists which of their ingredients are still missing `fdcId`. Recipe name links to its detail page; admin fixes the upstream ingredient first, then re-saves the recipe to recompute.
  - **Output de regen** — collapsible list parsed from `apps/api/scripts/output/regen-failed.jsonl` and `regen-skipped.jsonl`.
  - **Usuarios** — see [User Management](./user-management.md). Sub-tab; lists, suspends, and generates reset password tokens.
  - **Auditoría** — see [Admin Audit Log](./admin-audit-log.md). Sub-tab; reverse-chronological feed of admin actions with filters by admin and action.
  - **Voz** — *historical since 2026-10-09 (D-023 retired OpenAI Realtime; Mimo's voice turns are ordinary assistant turns now)*: sessions list of the old voice-mode conversations (one row per session) with filters (user search + date range); click a row to drill into all turns of that session in chronological order, each turn tagged with the skill it invoked when applicable. Read-only — no mutations, no audit-log entries on read. Source: [Voice Mode](./voice-mode.md). Backed by `GET /admin/voice-transcripts/sessions` (grouped) and `GET /admin/voice-transcripts` (flat list with `?sessionId=` filter).
- Every mutation issued from the dashboard generates an entry in `admin_audit_log`.

- **Invitaciones** tab (PRO-27, `sections/InvitationsSection.tsx`): create a campaign invitation link — name (e.g. «familia», «amigos-padel», «post-linkedin»), optional max uses, optional expiry — via `POST /admin/invite-campaigns` (admin JWT, audited `invite_campaign.create`); the table lists every campaign (`GET /admin/invite-campaigns`) with its link `mimoia.com/i/<code>`, uses / max, expiry and, from `GET /admin/metrics` → `campaigns`, signups, activation and week 3 over the last 12 weeks, plus a «Sin campaña» row. Each campaign has **«Eliminar»** (2026-10-15): after a browser confirmation («¿Eliminar la campaña «X»? El enlace dejará de funcionar. Las N personas que entraron con él conservan su cuenta, pero se contarán en «Sin campaña».») it calls `DELETE /admin/invite-campaigns/:id` (admin JWT, audited `invite_campaign.delete` with name, code and uses; 404 if it doesn't exist). The link stops letting anyone in at once; accounts keep working and their `invite_campaign_id` goes null (FK `ON DELETE SET NULL`). See [Auth](./auth.md) → Closed beta
- **Lista de espera** (`/admin/lista-espera`, PRO-97, `sections/WaitlistAdminSection.tsx`):
  - **Inscritos**: en la lista, esperando, invitados, ya registrados, plus altas in 7 days, target-segment households and WhatsApp interest; **Por canal** (`?ref` source with counts). Both from `GET /admin/waitlist`.
  - **Tanda sugerida** (`GET /admin/waitlist/next-batch?size=20`, admin JWT only — the metrics token never sees names or emails): each person in invitation order (`suggestNextBatch`) with name, email, answers, channel, WhatsApp, «entra con quien le invitó» and «fuera del segmento». Size editable (1–200). «Quitar» takes someone out of this batch (they stay waiting; «volver a añadir» undoes it).
  - **«Invitar a estas N personas»** → a confirmation («¿Invitar a N personas?… No se puede deshacer.», «Sí, invitar y enviar el correo» / «Cancelar») → `POST /admin/waitlist/invite` with the remaining ids. The result says the batch number, how many were invited and the email counts; for anyone whose email wasn't sent (no Resend key, or a failure) it lists their one-time link to send by hand.
  - **Tandas**: per batch invitados, registrados, sin registrarse and de baja (`batches` of the report). «Activos» (using the app) per batch is not shown: the report doesn't link entries to accounts' activity.
  - E2E `waitlist-invite.spec.ts` at 1440×900 and 390×844.

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
- [Voice Mode](./voice-mode.md) — voice transcripts read view consumes the `voice_transcripts` table populated by the voice-mode client
- [Recipes](./recipes.md) — system recipes are what the dashboard manages
- [Recipe Quality](./recipe-quality.md) — lint validator output drives the regen sub-section
- [My Recipes](./my-recipes.md) — the user-scoped equivalent that sits in `/profile`

## Source

- [apps/api/src/routes/admin.ts](../apps/api/src/routes/admin.ts) — replaces `routes/curator.ts`; all endpoints behind `requireAdmin`
- [apps/api/src/middleware/auth.ts](../apps/api/src/middleware/auth.ts) — `requireAdmin`
- [apps/api/src/services/nutrition/allergens.ts](../apps/api/src/services/nutrition/allergens.ts) — `inferAllergenTagsFromName`
- [apps/api/src/services/nutrition/usdaClient.ts](../apps/api/src/services/nutrition/usdaClient.ts)
- [apps/web/src/app/admin/[[...seccion]]/page.tsx](../apps/web/src/app/admin/%5B%5B...seccion%5D%5D/page.tsx) — replaces `app/curator/page.tsx`
- [apps/web/src/app/admin/sections/](../apps/web/src/app/admin/sections/) — section components, replaces `app/curator/sections/`
- [apps/web/src/app/admin/sections/VoiceTranscriptsSection.tsx](../apps/web/src/app/admin/sections/VoiceTranscriptsSection.tsx) — sessions list + per-session detail view of voice-mode conversations
- [apps/web/src/hooks/useAdmin.ts](../apps/web/src/hooks/useAdmin.ts) — replaces `useCurator.ts`; adds `useVoiceTranscriptSessions` + `useVoiceTranscriptTurns`
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — gated "Panel de admin" entry in the header "···" sheet, only rendered when `role === 'admin'`
- [apps/web/src/lib/adminNav.ts](../apps/web/src/lib/adminNav.ts) — admin areas and their URLs, shared by the sidebar and the page
- [apps/web/src/app/admin/sections/WaitlistAdminSection.tsx](../apps/web/src/app/admin/sections/WaitlistAdminSection.tsx) — «Lista de espera» (PRO-97); API in [apps/api/src/routes/waitlist.ts](../apps/api/src/routes/waitlist.ts)
- [apps/web/src/app/curator/page.tsx](../apps/web/src/app/curator/page.tsx) — temporary redirect to `/admin`
- [apps/api/src/routes/metrics.ts](../apps/api/src/routes/metrics.ts) — `GET /admin/metrics` (own router, mounted before the catch-all auth routers so the metrics token works)

## Business metrics

`GET /admin/metrics?weeks=8` returns weekly active households, resolved weeks, signup cohorts and cost per active household from the cost ledger — admin JWT or the read-only `x-metrics-token`. Its `campaigns` block shows in the Invitaciones tab; otherwise no UI tab yet — see [Business Metrics & Cost Ledger](./metrics.md).

## WhatsApp conversation reviews

`GET /admin/assistant-reviews?limit=N` lists the daily conversation reviews (findings, stats, summary), newest first. `POST /admin/assistant-reviews/run { day?, notify? }` runs or re-runs one day. Both are admin-only; see [WhatsApp](./whatsapp.md) → Conversation reviewer agent. There is no UI tab yet.
