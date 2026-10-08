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

### Definition of done — test gate

**A task that touches user-observable behavior is not done until it has a test that would fail if the bug came back.** The lesson of 2026-05-15: three bugs in `/recipes/new` (photo extract shape, empty rows, submit silently doing nothing) all shipped because zero tests covered the create-recipe flow. Use this checklist before reporting a task complete:

```
[ ] Did I change a user-visible flow (form submit, page render, button
    click, route handler, schema)?
[ ] If yes — is there at least ONE test that would fail if my change
    regressed?
      - Pure logic / payload builders / validators → unit test in
        apps/api/src/tests/ (vitest)
      - API route / DB write / business rule → unit test of the
        service + (when infra allows) integration test against the route
      - Multi-step UI / form submit / redirect after action → Playwright
        spec in apps/web/e2e/ (mobile-chromium viewport)
[ ] If the change crosses the form↔schema boundary (form payload vs.
    @ona/shared zod schema) → a contract test exists that runs the form's
    real payload builder against the schema. Drift between the two is the
    most common silent-bug class in this repo (see recipeFormContract.test.ts).
[ ] If I deferred test coverage on purpose → I left a `TODO(test):` marker
    in the file AND told the user explicitly in my reply.
```

**Combined with TDD where it pays:** for pure logic (matchers, builders, validators, aggregators) write the failing test first. For exploratory UI work, the test can land in the same commit as the implementation — but it must land. "I'll write tests later" is the same anti-pattern as "I'll update specs later" — both die in the next sprint.

A code-only PR that touches user-observable behavior with no corresponding test is a bug, equivalent to a missing spec update. The spec-gate above and the test-gate here are sibling checks — both run before a task is reported done.

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
- `POST /menu/generate` **requires auth** and the body `userId` must match the token (was previously open — that IDOR is now closed; see [menus.md](./specs/menus.md) "Access control"). All `/menu/:menuId/...` and `/menu/:userId/...` routes are scoped to the caller.
- Recipe images: **two sources** in production. Seed/system recipes are committed JPGs under `apps/web/public/images/recipes/<slug>.jpg` and served by Next.js (DB stores relative URL `/images/recipes/<slug>.jpg`). User-regenerated images live on the `ona-api-volume` Railway volume mounted at `/data` and are served by the API (DB stores absolute URL `${IMAGE_PUBLIC_URL_BASE}/<recipeId>.jpg`). The frontend renders `<img src=image_url>` and treats both transparently.
- The bottom tab bar (`Navbar`) is fixed, full width, with visible labels; the app `<main>` in `app/layout.tsx` reserves `pb-[calc(5rem+var(--safe-bottom))]` for it, so pages don't add their own bottom padding for the bar. It's hidden on `HIDDEN_ON` routes (cook mode, recipe detail — which has its own sticky action bar).
- The shopping list is rebuilt on **every** `GET /shopping-list` (rolling `from`/`to` range; the single `shopping_lists` row per user is deleted and re-inserted, so its id changes) — check/stock state survives via an `(ingredientId|unit)` overlay. Anything that needs a stable list (e.g. shop orders) must snapshot it. See [shopping.md](./specs/shopping.md).
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
| Waitlist form/questions, batches, referral links, public CTAs, `BRAND_NAME` | `waitlist.md` (+ `privacy.md` if the data collected changes) |

## Adding new specs

When introducing a new system (e.g., notifications, admin panel, payments), add a new spec following the format described in [`/Users/alio/.claude/skills/spec/`](file:///Users/alio/.claude/skills/spec/). Keep it under 200 lines. Always add an entry to `specs/index.md` with relevant search keywords.

## Backlog — Claude can build

Code work the user has scoped but not requested yet — pick up next session unless the user explicitly redirects. Items are ordered top = next-pickup.

_Recipe source links — shipped 2026-05-30: "Ver fuente" affordance on the detail under the title; editable from the edit form; YouTube vs article icon distinguished from `sourceType`._
_Bottom navbar mis-alignment defensive fix — shipped 2026-05-30. Items now use `flex-1 basis-0` so each gets an equal slice regardless of motion's transient measurements; pill is positioned `left-1/2 -translate-x-1/2 w-12` so the layout animation can't push width off. If the bug reproduces despite this, instrument with mount/unmount logs to find the actual race._
**Lista de espera v2** (v1 2026-10-07, see [specs/waitlist.md](./specs/waitlist.md) → Known limitations): (1) retention purge — anonymise/delete entries 6 months after the public launch; (2) an email sender: confirmation (double opt-in), the invitation emails that `POST /admin/waitlist/invite` prepares, and the Friday menu newsletter (with one-click unsubscribe); (3) carry `?ref`/`?utm_*` across public pages and record them on `/register`; (4) a `/admin` tab for the waitlist report + "invitar tanda" button.

**Compra en mis tiendas v2** (v1 shipped 2026-10-07, see [specs/shop-orders.md](./specs/shop-orders.md) → Constraints): (1) read photos of a shop's reply/ticket (today WhatsApp photos go to recipe import — `whatsapp/inbound.ts`); (2) carry recipe notes ("picada", "en lomos") into the list so lines arrive annotated; (3) pack-size rounding (1 huevo → media docena, 25 g jengibre → 1 trozo); (4) reminders when a shop/user hasn't answered before the shop's cut-off; (5) "tiendas conectadas": shop opts in by QR to ONA's number so ONA reads replies directly (needs real number + business verification + utility template — Meta policy, see the research report); (6) email sent by ONA with per-order reply addresses.

_Responsive desktop — shipped 2026-06-04 across 5 PRs. `<DesktopSidebar />` at `md+`, bottom-nav hidden at `md+`, `--sidebar-width`/`--sidebar-gap`/`--container-max` tokens, `/recipes` 3-col shell + 4-col card grid at `lg+`, `/cookbooks/[id]` 4-col grid at `lg+`, Vista Semana 7-col grid (DnD verified for cross-column drops), every authed page widens at `lg+` instead of sitting in a 430 px column. Bespoke per-page splits (38/62 recipe detail with sticky hero, 40/60 form layouts, vertical day-strip + preview rail, /shopping 3-col aisle grid, /profile tabs shell, /advisor side panel) were deferred to follow-up polish PRs — see [design-system.md "Pragmatic scope vs original plan"](./specs/design-system.md) and [docs/superpowers/specs/2026-06-01-responsive-desktop-design.md](./docs/superpowers/specs/2026-06-01-responsive-desktop-design.md) for the original vision._

## Todo Miguel

This is the **single source of truth** for work that's pending on Miguel's side (out of Claude's reach: device tests, asset replacement, manual ops, third-party setup, etc).

**Convention**:
- Whenever a task finishes but leaves something for Miguel to do, Claude appends it here with a short rationale + concrete acceptance criteria
- When Miguel reports "I did X" (or equivalent), Claude removes the matching item from this list
- Keep entries terse: one bullet per item; if it grows, link out to a longer doc
- Items are roughly ordered by priority (top = next)

**Scope**: Only items that genuinely require Miguel — external account setup, physical device testing, branded artwork, etc. Code work that Claude can do (refactors, bug fixes, page migrations) does NOT belong here; those go in regular tasks.

### Pending

- [ ] **Marca Mimoia — registrarla bien** (decidido seguir con Mimoia el 2026-10-08; detalle en [reports/A tu gusto y Apapacho como marca.md](./reports/A%20tu%20gusto%20y%20Apapacho%20como%20marca.md) y `research_notes/A tu gusto y Apapacho como marca/marcas_mimoia.md`): nadie tiene MIMOIA, pero "MIMO" pesa y Starship Technologies la tiene para apps de pedido/entrega de comida (EUTM 016775306, EE. UU., México), además de Mimo GmbH y Xiaomi. Encargar a un agente de la propiedad industrial (1) una investigación de uso de MIMO por Starship en UE/EE. UU./México y (2) la solicitud de MIMOIA en EUIPO acotada a clases 9 y 42 (software de menús, recetas y asistente de cocina), sin 39/43. Hecho = solicitud presentada con número.

- [ ] **Lista de espera (Mimoia) — antes de abrirla (~16–21 oct)** ([specs/waitlist.md](./specs/waitlist.md)):
  - Aprobar el copy: sección de la landing, pantalla de éxito, `/lista/[code]`, `/lista/baja` y el texto para WhatsApp.
  - **Bloqueante**: `NEXT_PUBLIC_SUPPORT_EMAIL` (ona-web). La gente de la lista no tiene "persona que te invitó" y `/privacidad` necesita un contacto real para ejercer derechos.
  - Revisión legal de "11. Lista de espera" en `/privacidad` (consentimiento, LSSI para el menú de los viernes, conservación hasta lanzamiento + 6 meses).
  - Cuando mimoia.com apunte a ona-web: `WEB_PUBLIC_URL=https://mimoia.com` en ona-api (enlaces de invitación y de baja).
  - Para invitar una tanda: `GET /admin/waitlist` (o el agente con el token) → `POST /admin/waitlist/invite {"ids":[…]}` con tu JWT de admin → escribirles con el `unsubscribeUrl` de cada uno.

- [ ] **Auditoría 2026-10-07 — lo que queda de tu lado** (todo lo de código está hecho y en prod):
  - **Backups**: activar los backups de Postgres en Railway y hacer una restauración de prueba; copia periódica del volumen `ona-api-volume` (fotos de usuarios). Hoy no hay ninguna red si se pierde la base de datos.
  - **Errores en producción**: ya no hace falta Sentry: hay registro de errores propio (`specs/errors.md`), decisión de Miguel 2026-10-07.
  - **Privacidad**: revisión legal de `/privacidad` cuando exista la forma jurídica (responsable con identidad real, datos de salud con consentimiento explícito, transferencias a EE. UU.). Ver [specs/privacy.md](./specs/privacy.md).
  - **WhatsApp**: en WhatsApp Manager, crear plantillas *Utility* por tipo de aviso (p. ej. `ona_menu_de_hoy`, `ona_aviso_preparacion`, `ona_lista_compra`, `ona_plan_semana`; cuerpo con un único `{{1}}`) y pasarme los nombres aprobados → `WHATSAPP_TEMPLATES`.
  - *(Opcional)* secreto `USDA_FDC_API_KEY` en GitHub Actions para que corra el smoke de USDA en CI.

- [ ] **Compra en mis tiendas — primer pedido real** (v1 en prod 2026-10-07, [specs/shop-orders.md](./specs/shop-orders.md)): tus tiendas The Fruits of the World (WhatsApp +34 913 52 51 11), Ben-Car Boadilla (WhatsApp pedidos 638 015 827), Pescaderías Los Alonso (WhatsApp 616 943 425; Pescados Aparicio no tenía número fiable) y El Corte Inglés (web) ya están dadas de alta en tu hogar.
  - *(Opcional)* Los Alonso reparte gratis en Pozuelo/Boadilla (mismo día si pides antes de las 13:00): para usarlo, en `/compra/tiendas` cambia la entrega a "A domicilio" con tu dirección (hoy está en "recojo en tienda").
  - Avisar en persona a la frutería y a la carnicería (Miguel se encarga) de que les pedirás por WhatsApp con una lista y que te digan precio por kilo y total antes de prepararlo.
  - Haz un pedido de verdad: "hazme la compra" por WhatsApp → envía cada enlace → reenvía a Ona lo que contesten → aprueba → cierra al recoger. Hecho = un pedido cerrado por tienda y las respuestas reales guardadas (sirven para calibrar el lector).
  - v1.1 (2026-10-08, "cómo se compra"): validar los valores por defecto (tomate de ensalada, pimiento verde italiano, naranja de zumo, carne picada mixta, dorada; se cambian en cada línea y Ona recuerda lo elegido). Al avisar a las tiendas, preguntar: mínimo que ponen de jamón y de picada (Ben-Car), pedido mínimo a domicilio y franja de reparto (apuntarlo en `/compra/tiendas`), y si les vale una línea sin cantidad ("Galletas Daniela").

- [ ] **ONA HQ (la empresa con agentes) — arranque**: vive en [`kanedakiTwo/ona-hq`](https://github.com/kanedakiTwo/ona-hq) (local: `~/ona-hq`). Cada mañana `/ona-dia` (≤ 15 min), los lunes `/ona-semana` (≤ 30 min), y notas para los agentes con `/ona-inbox`. Pendiente de Miguel esta semana:
  - Pasar el contacto del/de la dietista-nutricionista (D-005). El mensaje de primer contacto lo prepara Marketing.
  - Hacer una lista de 10–15 hogares conocidos para la beta (abre el 2026-10-28).
  - Pedir cita con una gestoría con las preguntas del §8 de `research/findings/2026-10-07-forma-juridica.md`. Confirmar D-004 en `/ona-dia`.
  - Añadir un número real de WhatsApp al portfolio actual de Meta, **sin pedir todavía la verificación** (D-004).
  - Reescribir con su voz las secciones [BORRADOR] de `constitution.md` (misión y POV, unos 15 min).

- [ ] **WhatsApp — optional follow-ups** (channel live in prod since 2026-10-06; linked + "genera menú" verified end-to-end; setup notes in [specs/whatsapp.md](./specs/whatsapp.md) → Configuration):
  - *(Optional, for proactive messages when you haven't written to Ona in 24 h)* WhatsApp Manager → Plantillas → new **Utility** template, Spanish, e.g. `ona_aviso`, body `Aviso de ONA: {{1}} Respóndeme por aquí si quieres cambiar algo.` → once approved, tell Claude to set `WHATSAPP_TEMPLATE_NAME=ona_aviso`.
  - Household members: tell Claude their ONA emails (added to `WHATSAPP_ALLOWED_EMAILS`) and add their phones in Meta → Paso 1 "Para" (max 5 on the test number).
  - Later, to open it to everyone or show "ONA" instead of "Test Number": real phone number + business verification in Meta (Paso 2), then redo the webhook field + WABA subscription for the new account.

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
