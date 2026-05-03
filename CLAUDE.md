# ONA — Project Guide for Claude

## Read this first

**Before starting any work in this project, read the specs to understand the system.**

The specs live in [`./specs/`](./specs/). Start with the index:

- [`specs/index.md`](./specs/index.md) — keyword-rich lookup of all specs

Then read the specs relevant to your task. The current set covers:

- [`specs/auth.md`](./specs/auth.md) — registration, login, JWT, onboarding
- [`specs/recipes.md`](./specs/recipes.md) — catalog, filters, favorites, photos, AI extraction
- [`specs/menus.md`](./specs/menus.md) — weekly menu generation, recipe matcher, locking
- [`specs/shopping.md`](./specs/shopping.md) — auto-generated list, stock manager, item toggles
- [`specs/advisor.md`](./specs/advisor.md) — AI chat assistant, skills, voice (STT/TTS)
- [`specs/design-system.md`](./specs/design-system.md) — editorial design system, tokens, components

If you're not sure which specs apply, run `/spec study` to load all of them into context.

## Specs are a living document

**Every code change must be checked against the specs.** Before considering a task complete, ask:

1. Did this change introduce, remove, or modify a behavior the user can observe?
2. Did this change rename, move, or delete a file referenced in a spec's `## Source` section?
3. Did this change add or remove a constraint, edge case, or known limitation?

If the answer to any of these is **yes**, update the relevant spec(s) before finishing the task. The spec must reflect the current reality of the code; a divergence between spec and code is a bug in itself.

If the change introduces a new system not covered by any existing spec (e.g., notifications, admin panel, payments), create a new spec file and add an entry to [`specs/index.md`](./specs/index.md). Keep specs under 200 lines and write from the user's perspective.

### Definition of done — spec gate

**A task is not done until its spec impact has been resolved in the same commit / PR.** Use this checklist before reporting a task complete:

```
[ ] Did I change anything in apps/api/src/routes/, apps/api/src/services/,
    apps/web/src/app/, apps/web/src/components/, apps/web/src/hooks/,
    packages/shared/src/types/, or any DB migration?
[ ] If yes → I ran the spec table below and updated every spec affected.
[ ] If a referenced file moved/renamed/disappeared → I fixed `## Source` links.
[ ] If a behavior the user can observe changed → I rewrote the affected
    `## User Capabilities` / `## Constraints` lines.
[ ] If a brand-new system landed → I added a new spec file AND a row to
    `specs/index.md`.
[ ] If I deferred the spec on purpose → I left a `TODO(spec):` marker in the
    relevant spec file AND told the user explicitly in my reply.
```

The spec gate is **not optional polish at the end of a sprint**. It is part of the task itself. When grouping multiple tasks into one commit, the commit must include the spec edits for every task in the group. A code-only PR that touches user-observable behavior is a bug.

Past failure mode: shipping a feature, then doing a "specs sweep" days later. By then the diff is forgotten and details get lost. The fix is to write specs WHILE the change is fresh — same edit session, same commit.

When in doubt: open `specs/index.md`, grep for keywords related to your change, and verify each match still describes reality.

## What ONA is

ONA (Opinionated Nutritional Assistant) is a **mobile-first meal planner** for Spanish speakers. It generates a weekly menu from a recipe catalog, produces a shopping list, manages pantry stock, and provides an AI advisor for nutrition questions. The app is currently mid-migration toward an **editorial visual style** (cream/warm-black palette, Fraunces serif, motion/react animations) — see [`specs/design-system.md`](./specs/design-system.md) for which pages are migrated and which still use the legacy "app mode" green palette.

## Repo layout

- `apps/api/` — Express + Drizzle ORM backend (PostgreSQL)
- `apps/web/` — Next.js 15 frontend (App Router, React 19, Tailwind v4)
- `packages/shared/` — TypeScript types and shared utilities (`@ona/shared`)
- `specs/` — system specs (read these first)
- `notion-export/` — source of the 79 seeded recipes
- `kb/` — knowledge base / agent context
- `docs/deploy.md` — Railway deploy flow (CLI commands, env vars, migrations, troubleshooting). Read this **before** trying to ship to prod or diagnose a stale deploy.

## Working principles

- **Specs document what exists**, not aspirational features. If the code disagrees with a spec, fix the spec or the code — never ignore the divergence.
- **Update specs when you change behavior** (see "Specs are a living document" above).
- **Prefer the editorial design system** (`@theme` tokens in `globals.css`) for new UI: cream `#FAF6EE`, ink `#1A1612`, terracotta `#C65D38`, forest `#2D6A4F`, Fraunces + Cormorant + Inter.
- **All UI strings are in Spanish.** No i18n setup; just write in Spanish.
- **Mobile-first always.** Test at 390×844 (iPhone 14) viewport using Playwright MCP before declaring UI work done.

## Common pitfalls

- The `inStock` field is camelCase end-to-end (frontend, API, DB JSONB). Never use `in_stock`.
- The `GET /recipes` endpoint does not currently return `is_favorite`; favorite state on cards is not persisted across reloads (known limitation, see [recipes.md](./specs/recipes.md)).
- `POST /menu/generate` does NOT require auth (known quirk, see [menus.md](./specs/menus.md)).
- Recipe images: **two sources** in production. Seed/system recipes are committed JPGs under `apps/web/public/images/recipes/<slug>.jpg` and served by Next.js (DB stores relative URL `/images/recipes/<slug>.jpg`). User-regenerated images live on the `ona-api-volume` Railway volume mounted at `/data` and are served by the API (DB stores absolute URL `${IMAGE_PUBLIC_URL_BASE}/<recipeId>.jpg`). The frontend renders `<img src=image_url>` and treats both transparently.
- The bottom tab bar is fixed at the viewport bottom; app routes use `<main className="mx-auto max-w-[430px] pb-20">` to reserve room.
- The shopping list is generated on the **first** GET and persisted; if the menu changes afterwards, the list does NOT regenerate automatically.
- `useAdvisor` is legacy; new code should use `useAssistant` for chat. The advisor page still calls `useAdvisorSummary` for the nutrition summary.

## When to update which spec

| Change | Spec to update |
|--------|----------------|
| New API route, auth rule, onboarding step | `auth.md` |
| Recipe model, filters, photos, favorites, AI extraction | `recipes.md` |
| Menu algorithm, generation rules, locking, calorie targets | `menus.md` |
| Shopping list generation, item toggle, stock, household scaling | `shopping.md` |
| Assistant skill added/removed, voice behavior, prompts | `advisor.md` |
| New design token, font, component, page migrated to editorial | `design-system.md` |

## Adding new specs

When introducing a new system (e.g., notifications, admin panel, payments), add a new spec following the format described in [`/Users/alio/.claude/skills/spec/`](file:///Users/alio/.claude/skills/spec/). Keep it under 200 lines. Always add an entry to `specs/index.md` with relevant search keywords.

## Todo Miguel

This is the **single source of truth** for work that's pending on Miguel's side (out of Claude's reach: device tests, asset replacement, manual ops, third-party setup, etc).

**Convention**:
- Whenever a task finishes but leaves something for Miguel to do, Claude appends it here with a short rationale + concrete acceptance criteria
- When Miguel reports "I did X" (or equivalent), Claude removes the matching item from this list
- Keep entries terse: one bullet per item; if it grows, link out to a longer doc
- Items are roughly ordered by priority (top = next)

**Scope**: Only items that genuinely require Miguel — external account setup, physical device testing, branded artwork, etc. Code work that Claude can do (refactors, bug fixes, page migrations) does NOT belong here; those go in regular tasks.

### Pending

- [ ] **Finish the seed image batch** — paused at 38/87 (49 system recipes still without `image_url`). Resume with `--skip-existing` so the already-paid 38 are skipped: `cd apps/api && AIKIT_API_KEY=aik_… npx tsx scripts/generateRecipeImages.ts --skip-existing`.

- [ ] **End-to-end check on production** after the next `ona-api` deploy: register a fresh user, create a recipe, hit "Regenerar imagen" — confirms the Railway volume writes survive and `IMAGE_PUBLIC_URL_BASE` (`https://ona-api-production.up.railway.app/images/recipes`) actually serves the JPEG. (Volume `ona-api-volume` mounted at `/data` and the three env vars `AIKIT_API_KEY`, `IMAGE_STORAGE_DIR`, `IMAGE_PUBLIC_URL_BASE` are already set on `ona-api` via Railway CLI.)

- [ ] **Replace placeholder PWA assets** with real branded artwork — `apps/web/public/icons/*.png` + `apps/web/public/favicon.ico`. Same paths, same sizes; the SW picks up new revisions on next build. Current placeholders are an "ONA" wordmark on cream (generator: `apps/web/scripts/generate-pwa-placeholders.mjs`).

- [ ] **Voice-mode setup in Railway** (OpenAI key already set ✓):
  - `NEXT_PUBLIC_PICOVOICE_ACCESS_KEY` — get from console.picovoice.ai
  - Upload the `Hola Ona` `.ppn` wake-word model file (trained at console.picovoice.ai, custom wake-word "Hola Ona")
  - *(Optional, cost control)* `REALTIME_DAILY_MINUTES_PER_USER` — caps per-user OpenAI Realtime minutes/day. Defaults to 30 if unset.

- [ ] **Device-only manual tests** (the rest is covered by Playwright):
  - Install: Android Chrome → confirm prompt + home-screen install + standalone launch with cream theme
  - Install: iOS Safari → follow the bottom-sheet instructions, confirm splash screen + translucent status bar + safe-area-inset respected
  - Lighthouse PWA category = 100 against the deployed URL (DevTools → Lighthouse)
  - Wake Lock holds when device is locked via power button (recipe detail → "Empezar a cocinar")
  - Notification fires at meal time + tap-to-open behavior (profile → opt-in → set time 1 min ahead → leave tab open)
  - Haptic vibration is perceived (Android only — tap a tab, toggle a favorite, check shopping item)
  - Native share sheet renders (iOS/Android — recipe detail Share button + shopping export)
  - Subjective UX feel: page transitions cross-fade (~250ms), swipe-between-tabs gesture (edge resistance, 30% threshold, vertical scroll preserved)
