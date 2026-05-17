# Remaining personalization sessions

Tracking doc for the work that's still pending after Wave 1 + Wave 2 of the [roadmap](./personalization-roadmap.md) landed (PR 5, PR 2/2b/2c/2d, PR 3). Each session below is sized to fit one focused working block; ordering respects the dependency graph and prioritizes value over completeness.

The household foundation (PR 1) is the blocker for half the list. Doing it second means every later track can write household-scoped tables from day one — vs. doing it last means re-migrating every table we built in between.

## Order

| # | Session | What lands | Why now | Est | Depends on |
|---|---|---|---|---|---|
| **1** | **PR 4 — Inline memory editor** | Per-fact inline edit on `/profile/memoria` (string-array tag input, numeric stepper, enum select, record key-value editor for `cuisine_bias` / `time_available` / `meal_times`) | Quick polish on the work shipped; gives the user a non-voice way to fine-tune their memory; warm-up before the big PR 1 | 2h | none |
| **2** | **PR 1 (Part A) — Household tables + invitation flow** | `households` + `household_members` + `household_invites` tables, backfill (one solo household per existing user), invitation endpoints, `/profile/casa` page. Scope changes NOT shipped yet (behind `HOUSEHOLD_SCOPE_ENABLED=false`) | Load-bearing for PRs 6-14. Doing the additive piece first means we can verify in prod without touching any read path | 4h | none |
| **3** | **PR 1 (Part B) — Flip scope from user_id to household_id** | Menus/shopping/favorites/pantry read household_id derived from JWT, feature flag flipped on, old `/menu/:userId/:weekId` aliased for one release | Required before any household-shared feature can ship | 2h | session 2 |
| **4** | **PR 6 — Cook log** | `cook_logs` table, "esto lo cocinamos" UI on meal cards + recipe detail, measured cooking time (auto from cooking mode + manual), feeds times-cooked + last-cooked + adherence | Unblocks PR 7 (times-cooked counter), PR 11 (auto-decrement), PR 15 (adherence). Smallest-impact-first to validate scoping changes from PR 1 | 3h | session 3 |
| **5** | **PR 10 — Shopping basics** | Free-text items, drag-reorder per user, supermarket-route persistence, recurring staples, weekly history snapshots, prices per item + weekly total | Independent from cook log; lots of small features compounding into a serious shopping list UX | 4h | session 3 |
| **6** | **PR 7 — Recipe enrichment** | Per-`(user, recipe)` notes + 1-5 rating + substitutions, times-cooked counter + last-cooked date derived from cook_logs | High user value; requires PR 1 for household scoping + PR 6 for times-cooked feed | 3h | sessions 3, 4 |
| **7** | **PR 11 — Pantry quantities + auto-decrement** | `pantry_items` table with qty + unit + expiresAt, auto-decrement on cook-log entry, expiry warnings in the shopping UI | Required by cook-from-pantry + by ticket OCR | 3h | sessions 3, 4 |
| **8** | **PR 8 — Recipe photos + custom tags + collections** | Multiple photos per recipe (gallery + post-cook result photo), free-form user-tags filterable in catalog, named cookbooks ("Favoritos de Sara", "Para diabéticos") | Substantial UX win; gives users Paprika-class recipe ownership | 3h | session 6 |
| **9** | **PR 12 — Cook from what I have** | Endpoint `/recipes/match-pantry` scoring recipes by % of ingredients the pantry covers, UI card on home showing top 3 | Small but high-value once pantry quantities exist | 2h | session 7 |
| **10** | **PR 14 — Shopping real-time sync (SSE)** | Server-Sent Events stream of shopping list mutations per household, optimistic client reconciliation, "X miembros editando" indicator | The killer feature for family sharing | 3h | sessions 3, 5 |
| **11** | **PR 13 — Ticket OCR** | Upload supermarket receipt → OCR → extract items + prices + dates → update pantry qty + price history. Manual correction UI for low-confidence lines | XL; high uncertainty (Spanish supermarket layouts vary). Treat as its own session | 5h | session 7 |
| **12** | **PR 15 — Analytics** | Monthly nutrition trends, cost trends (€ per week, € per serving), adherence (planeaste 21, cocinaste 15), variety + inflammation extended with cook-log data | Synthesizes everything — needs cook_log + price data | 3h | sessions 4, 11 |
| **13** | **PR 9 — Community recipes (public/private toggle)** | Per-recipe `is_public` flag, new "Comunidad" scope in the catalog alongside ONA / Mis recetas, anti-abuse moderation checklist (admin-flag in a follow-up) | Low priority — nobody is asking yet, but plumbing is small | 2h | session 8 |
| **14** | **PR 16 — Accessibility** | Dark mode (extension of `@theme` tokens), font-size scaling, print stylesheet, color-blind-safe status pills, voice as universal input (not only advisor) | Independent — ship any time. Last for now since the user-visible features above are the priority | 3h | none |

Total: ~42 h across 14 sessions.

## Cross-cutting reminders (every session)

- **Spec gate**: update relevant `specs/*.md` in the same commit.
- **Test gate**: at least one failing-first test per user-visible flow.
- **Spanish copy**, **mobile-first 430 px**, editorial design tokens.
- **Production safety**: zero-downtime migrations only.
- After every session: commit, push to `master`, deploy ona-api + ona-web, verify health probes.

## Risk highlights

- **Session 3 (PR 1 Part B)** is the riskiest: the scope flip can leak data between users if a query forgets the `household_id` filter. Mitigation: integration tests that assert user A's GET returns only A's household's data; feature flag rollback path; one-PR-at-a-time deploy.
- **Session 11 (PR 13 ticket OCR)** has the highest external uncertainty. Mitigation: start with one supermarket layout (Mercadona, most common in Spain), a manual-correction UI, and a confidence-per-line score.
- **Session 14 (PR 16 a11y)** is independent — can be slotted in any week the calendar allows, no PR1 dependency.

## Sessions already shipped (this thread)

- ✅ PR 5 — Manual menu shaping (veto / skip day / leftovers / pin type)
- ✅ PR 2 — User memory foundation
- ✅ PR 2b — `memory.dislikes` → matcher
- ✅ PR 2c — `memory.equipment` + `memory.time_available` → matcher
- ✅ PR 3 — Voice onboarding
- ✅ PR 2d — `nutrition_principles` (override ONA's defaults)
