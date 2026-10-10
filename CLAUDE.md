# ONA — Project Guide for Claude

## Read this first

**Before starting any work in this project, read the specs to understand the system.**

The specs live in [`./specs/`](./specs/). Start with the index:

- [`specs/index.md`](./specs/index.md) — keyword-rich lookup of all specs

Then read the specs relevant to your task. The current set covers:

- [`specs/auth.md`](./specs/auth.md) — registration, login, JWT, onboarding
- [`specs/recipes.md`](./specs/recipes.md) — catalog, filters, favorites, detail
- [`specs/recipe-import.md`](./specs/recipe-import.md) / [`specs/recipe-images.md`](./specs/recipe-images.md) — imports and AI extraction / hero photos
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
- `docs/deploy.md` — Railway deploy flow (CLI commands, env vars, migrations, troubleshooting, **staging**). Read this **before** trying to ship to prod or diagnose a stale deploy. There is a `staging` environment (https://ona-web-staging.up.railway.app) and a nightly agent ("Taller") that merges and deploys backlog tasks marked `lista` — check `git log origin/master` for its overnight commits before you start.

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
- There is no advisor page: `/advisor` redirects to `/menu?mimo=1`. Chat (typed and spoken) goes through `MimoProvider` (`useMimo`, `components/mimo/`), the floating companion on every signed-in page. `useAdvisor` / `useAdvisorSummary` are legacy and unused.

## When to update which spec

| Change | Spec to update |
|--------|----------------|
| New API route, auth rule, onboarding step | `auth.md` |
| Recipe model, filters, favorites, detail page | `recipes.md` |
| Recipe import (photo/URL/WhatsApp), seed pipeline, ingredient resolution | `recipe-import.md` |
| Recipe hero photo generation, regenerate-image, photo audit | `recipe-images.md` |
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
- Every item has an id `MIG-NN` (next free number, never reused) and this shape, so the ONA HQ panel can show it as a plain task with a checkbox:
  `- [ ] **MIG-NN · Título corto** — Por qué importa, en una frase.` then sub-bullets with the steps (`Cómo:` first). Write it in plain Spanish, for Miguel, with no jargon he doesn't use.
- Whenever a task finishes but leaves something for Miguel to do, Claude adds it here in that shape.
- Miguel ticks tasks off in the panel (they are stored in the panel's database, collection `hechas`), or tells Claude. `/ona-dia` (or Claude when told) removes ticked items from this list.
- Items are ordered by priority (top = next).

**Scope**: Only items that genuinely require Miguel — external account setup, physical device testing, branded artwork, etc. Code work that Claude can do (refactors, bug fixes, page migrations) does NOT belong here; those go in regular tasks.

### Pending

- [ ] **MIG-01 · Elegir los hogares de la beta** — La beta abre el 21 de octubre y empieza por 10–15 hogares que conoces.
  - Cómo: haz tu lista (no hace falta pasárnosla: son datos personales). Marketing y Customer Success te preparan el mensaje el 12 y el 14; se lo mandas tú por WhatsApp con un enlace de invitación `mimoia.com/i/<código>` (se crea en `/admin` → Invitaciones; o pídeselo a Claude).
  - Lo único que necesitamos: cuántos hogares son y cuántos querrán usar Mimo por WhatsApp. Con el número de prueba de Meta caben 5 teléfonos; a cada uno hay que darlo de alta (su email en `WHATSAPP_ALLOWED_EMAILS` y su teléfono en Meta → Paso 1 «Para»).
  - Estado (2026-10-10): 14 hogares en tu lista; falta añadir a las amigas de Sara y refinarla.

- [ ] **MIG-02 · Pasar el contacto del/de la dietista** — Queremos que un profesional colegiado revise recetas y mensajes antes de abrir (D-005).
  - Cómo: dile a Claude su nombre y cómo contactar. El primer mensaje lo prepara Marketing.

- [ ] **MIG-03 · Activar las copias de seguridad de la base de datos** · *aplazada hasta el fin de la beta* — Hoy, si se pierde la base de datos de producción, se pierde todo: menús, recetas y hogares.
  - **2026-10-10:** Railway no permite backups en el plan Hobby; hace falta Pro. Miguel lo deja así hasta el fin de la beta, salvo que otro requisito pida Pro antes (D-030 en ona-hq). Riesgo aceptado.
  - Cómo: en Railway → proyecto `ona-app` → servicio Postgres (producción) → Backups, actívalos y haz una restauración de prueba en staging.
  - Además: una copia periódica del volumen `ona-api-volume`, donde están las fotos que suben los usuarios.

- [ ] **MIG-04 · Hacer un pedido real a tus tiendas** — Es la única forma de comprobar «Compra en mis tiendas» con respuestas de verdad, y sirven para afinar cómo Mimo las lee.
  - Cómo: avisa en persona a la frutería y a la carnicería de que les pedirás por WhatsApp con una lista y que te digan precio por kilo y total. Luego, por WhatsApp a Mimo: «hazme la compra» → envía cada enlace → reenvíale lo que contesten → aprueba → cierra al recoger.
  - Hecho cuando: un pedido cerrado por tienda. Tus tiendas ya están dadas de alta: The Fruits of the World, Ben-Car Boadilla, Pescaderías Los Alonso y El Corte Inglés (web).
  - Al avisarlas, pregunta: mínimo de jamón y de picada (Ben-Car), pedido mínimo y franja de reparto a domicilio, y si les vale una línea sin cantidad («Galletas Daniela»). Revisa también los valores por defecto (tomate de ensalada, pimiento verde italiano, naranja de zumo, carne picada mixta, dorada).
  - Opcional: Los Alonso reparte gratis en Pozuelo/Boadilla si pides antes de las 13:00; para usarlo, cambia la entrega a «A domicilio» en `/compra/tiendas`.

- [ ] **MIG-05 · Poner al día las plantillas de WhatsApp** — Sin plantillas aprobadas, Mimo no puede escribirte primero cuando llevas más de 24 h sin hablarle, y las que hay aún dicen «ONA».
  - Cómo: en WhatsApp Manager → Plantillas, vuelve a enviar a aprobación las que dicen «ONA» (p. ej. `ona_aviso`: «Aviso de Mimoia: {{1}}…»; los nombres no cambian).
  - Crea plantillas de tipo *Utilidad*, en español, una por aviso: `ona_menu_de_hoy`, `ona_aviso_preparacion`, `ona_lista_compra`, `ona_plan_semana` (cuerpo con un único `{{1}}`). Cuando estén aprobadas, pásale los nombres a Claude.

- [ ] **MIG-06 · Añadir un número real de WhatsApp en Meta** — Con el número de prueba solo pueden hablar con Mimo 5 teléfonos y sale como «Test Number».
  - Cómo: en Meta, añade un número real al portfolio actual, **sin pedir todavía la verificación del negocio** (D-004). Después Claude rehace el webhook y la suscripción para la cuenta nueva.

- [ ] **MIG-07 · Escribir con tu voz la misión de Mimoia** — La constitución de ONA HQ guía a todos los agentes y su misión y punto de vista siguen en borrador.
  - Cómo: en `~/ona-hq/constitution.md`, reescribe las secciones marcadas [BORRADOR] (unos 15 min).

- [ ] **MIG-08 · Activar «Hola Mimo» para hablar sin tocar** — Hoy la palabra de activación sigue siendo «Hola Ona» y no está activa en producción.
  - Cómo: en console.picovoice.ai, saca una clave de acceso y entrena la palabra «Hola Mimo» (español, Porcupine WASM). Pásale a Claude la clave y el fichero `.ppn`; él los pone en Railway (`NEXT_PUBLIC_PICOVOICE_ACCESS_KEY`) y cambia `WAKE_PHRASE`.

- [ ] **MIG-15 · Poner la cuchara en tus perfiles** — La app, el favicon y el botón de Mimo ya llevan el imagotipo (la cuchara con el corazón, elegido el 9 de octubre); faltan las redes, que solo puedes cambiar tú.
  - Cómo: al crear o editar cada cuenta (@conmimoia), abre la guía de marca (panel → «Lo esencial» → Marketing) → sección «Redes sociales»: para cada red está la foto de perfil y la portada al tamaño exacto, con su enlace de descarga. Súbelas tal cual.
  - Redes: Instagram, TikTok, Facebook, YouTube, el canal de WhatsApp y el número de Mimo (WhatsApp Manager → Perfil), LinkedIn (tu fondo de perfil y, si creas la página de empresa, su logo y portada).
  - Hecho cuando: todas las cuentas creadas muestran la cuchara.
  - Estado (2026-10-10): hecho Instagram; Facebook, en curso. Faltan TikTok, YouTube, WhatsApp (canal y número de Mimo) y LinkedIn.

- [ ] **MIG-10 · Probar en tu móvil lo que no se puede probar solo** — Hay cosas que solo se ven en un teléfono de verdad.
  - Instalar la app en Android (Chrome) y en iPhone (Safari): que se abra a pantalla completa, con el color crema y respetando la barra de estado.
  - En una receta, «Empezar a cocinar» y bloquear el móvil: la pantalla debe seguir encendida al volver.
  - Avisos a la hora de comer: en el perfil, actívalos con la hora 1 minuto después y deja la app abierta; al tocar el aviso debe abrir la app.
  - Vibración al tocar (solo Android), botón de compartir en una receta y en la lista de la compra, y la sensación general al cambiar de pantalla y deslizar entre pestañas.

- [ ] **MIG-11 · Comprobar «Regenerar imagen» en producción** — Confirma que las fotos nuevas se guardan y se ven bien.
  - Cómo: en mimoia.com, crea una receta y pulsa «Regenerar imagen»; la foto debe aparecer y seguir ahí al recargar.

- [ ] **MIG-12 · Revisión legal de la privacidad** — Cuando exista la SL, un abogado tiene que revisar `/privacidad`: responsable con nombre real, datos de salud con consentimiento explícito, envíos a EE. UU. y el apartado de la lista de espera.
  - Cuándo: con la forma jurídica decidida (16 de noviembre). Ver `specs/privacy.md`.

- [ ] **MIG-13 · Registrar la marca Mimoia · aplazada** — Nadie tiene MIMOIA, pero hay muchas marcas «MIMO» (Starship, para apps de pedir comida; Mimo GmbH; Xiaomi).
  - Cuándo: no antes de la decisión del 16 de noviembre (D-024: ningún gasto de más de 200 € hasta validar la beta).
  - Coste: en España (OEPM) 127,88 € la primera clase y 82,84 € cada clase más (clases 9 y 42: 210,72 €), sin agente. En la UE (EUIPO) 850 € la primera clase y 50 € la segunda, más 300–600 € de agente si se encarga.
  - Detalle en `reports/A tu gusto y Apapacho como marca.md`.

- [ ] **MIG-14 · Abrir el registro el día D** — Hasta el 12 de enero solo se entra con invitación (beta cerrada).
  - Cómo: ese día, pon `REGISTRATION_MODE=open` en `ona-api` de producción (o pídeselo a Claude). Opcional antes: la clave `USDA_FDC_API_KEY` en GitHub Actions para que el CI pruebe también la búsqueda de ingredientes.
