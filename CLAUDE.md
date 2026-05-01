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

## What ONA is

ONA (Opinionated Nutritional Assistant) is a **mobile-first meal planner** for Spanish speakers. It generates a weekly menu from a recipe catalog, produces a shopping list, manages pantry stock, and provides an AI advisor for nutrition questions. The app is currently mid-migration toward an **editorial visual style** (cream/warm-black palette, Fraunces serif, motion/react animations) — see [`specs/design-system.md`](./specs/design-system.md) for which pages are migrated and which still use the legacy "app mode" green palette.

## Repo layout

- `apps/api/` — Express + Drizzle ORM backend (PostgreSQL)
- `apps/web/` — Next.js 15 frontend (App Router, React 19, Tailwind v4)
- `packages/shared/` — TypeScript types and shared utilities (`@ona/shared`)
- `specs/` — system specs (read these first)
- `notion-export/` — source of the 79 seeded recipes
- `kb/` — knowledge base / agent context

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
- Recipe images are served from Next.js `public/images/recipes/`, not from the API. Image URLs in the DB look like `/images/recipes/<slug>.jpg`.
- The bottom tab bar is fixed at the viewport bottom; app routes use `<main className="mx-auto max-w-[430px] pb-20">` to reserve room.
- `PublicNavbar` links to `/recetas` (Spanish) but the actual route is `/recipes` — broken link.
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
