# ONA — Frontend Responsive Towards Desktop

Date: 2026-06-01
Status: Approved by Miguel, ready for implementation plan

## Why

ONA has been a mobile-first PWA. Every authenticated route lives inside a `max-w-[430px]` centred column with a fixed bottom-nav. On any viewport wider than ~430 px the app reads as "a phone screenshot pasted in the middle of a wide cream stripe" — the surrounding 70–80 % of the monitor is wasted.

Miguel wants the frontend to **respond to the available width**: full mobile experience preserved on phones, a proper desktop layout on `≥768 px`, and bespoke multi-column treatments per page on `≥1024 px`. The goal is not "tablet-friendly" but "the same product usable as a primary tool on a laptop".

## Scope

In scope:

- Every authenticated route (`/menu`, `/shopping`, `/recipes`, `/recipes/[id]`, `/recipes/new`, `/recipes/[id]/edit`, `/cookbooks`, `/advisor`, `/profile` + sub-routes, `/admin`).
- Auth chrome (sidebar component, `app/layout.tsx`, `Navbar` mobile gating).
- The relevant `specs/*.md` files (`design-system.md`, plus the per-feature specs touched by each PR).

Out of scope (deliberately):

- `/onboarding` keeps its single-column wizard.
- `/auth` (login/register) keeps a single centred form column.
- `/offline` keeps its single-column status screen.
- `/recipes/[id]/cook` keeps full-screen cook mode with no sidebar (the desktop sidebar hides on this route).
- The public catalog (`/recipes-ona`, `/recipes-ona/[id]`) keeps its existing layout; it has its own `PublicNavbar` and the responsive work doesn't change it.
- API / backend / database — no changes anywhere outside the web app.

## Decisions, with the trade-offs Miguel weighed

1. **Multi-column in every page** (not just key pages, not just reflow). Costs more effort up front but the desktop feels intentionally designed rather than "the mobile app, blown up".
2. **Sidebar fixed on the left** at `md+` (not a top-nav, not an icon-rail). Familiar SaaS pattern, label + icon both visible, doesn't compete with the editorial wordmark.
3. **Multi-column kicks in at `lg` (1024 px)**, not at `md`. At `md` the sidebar appears and content widens but layouts stay close to mobile — that lets tablets in portrait keep a single-column read while landscape iPad + laptops get the full multi-column treatment.
4. **`/profile` absorbs its sub-routes as tabs** in `lg+`. URLs stay (`/profile/memoria`, `/profile/creencias`) but the layout shell on `lg+` renders a sidebar of tabs + the active sub-page in the right column. On mobile each sub-route still navigates as its own page.
5. **`/advisor` gets a side panel** with the nutrition summary + memory in `lg+`. Today both live inline in the chat view; on desktop they belong as persistent context.
6. **E2E desktop testing is on-demand**, not per-PR. Manual smoke (`localhost:3000` at 390 / 768 / 1024 / 1440 viewports) plus typecheck plus visual screenshots in commit messages cover regression at the cadence Miguel wants.
7. **Continuous deploy** — each PR merges + deploys to production when it's ready, no batching.

## Architecture

### Breakpoints

| Range | Layout |
|---|---|
| `< md` (≤767 px) | **Unchanged from today.** Bottom-nav fixed at viewport bottom, content in `max-w-[430px] mx-auto` column, `pb-20` to clear the nav. |
| `md` (768–1023 px) | **Transition.** `<DesktopSidebar />` appears, bottom-nav hides via `md:hidden`, `<main>` gets `md:ml-[208px] md:pb-0`. Pages widen to ~720 px but stay single-column. |
| `lg+` (≥1024 px) | **Multi-column.** Each page activates its bespoke layout (filters sidebar, split panes, grid expansion, etc.). |

The breakpoint values match Tailwind defaults (`md = 768`, `lg = 1024`, `xl = 1280`, `2xl = 1536`).

### Global chrome

**`app/layout.tsx`** changes:

- The authed branch wraps `<main>` with `md:ml-[208px] md:pb-0` (200 px sidebar + 8 px margin). The mobile `pb-20` and 430-px constraints stay inside each `page.tsx`, gated by `md:max-w-none md:mx-0` so they only apply on small screens.
- Adds `<DesktopSidebar />` as a sibling of `<main>`, positioned `fixed inset-y-0 left-0 hidden md:flex w-[200px]`.
- The existing `<Navbar />` mobile bottom-nav gets a `md:hidden` class.
- An outer `<div className="mx-auto max-w-[1400px]">` caps the body width so 4K monitors don't stretch content unreadably.

**New component `<DesktopSidebar />`** (lives at `apps/web/src/components/shared/DesktopSidebar.tsx`):

- Same 5 items as the bottom-nav: Menú, Compra, Recetas, Asesor, Perfil.
- Top: wordmark "Ona" italic Fraunces + the ink-drop isotype, ~28 px.
- Body: vertical list of items, each `flex items-center gap-3` with icon (16 px, current bottom-nav lucide icons) + label (`text-[13px]`, ink/cream colour swap on active).
- Active item: solid ink pill with cream label + filled icon. Matches the bottom-nav active state visually.
- Bottom: same haptic.light + `TransitionLink` mechanics as the mobile nav.

**`<Navbar />` mobile** stays as-is; only its outer container receives `md:hidden`.

### CSS tokens (new)

In `apps/web/src/app/globals.css` under `@theme`:

```css
--sidebar-width: 200px;
--sidebar-gap: 8px;
--container-max: 1400px;
```

These let pages compute their own layouts via `calc(100vw - var(--sidebar-width) - var(--sidebar-gap))` rather than hard-coding offsets.

### Page-shell utility

A new Tailwind utility class `page-shell` (defined as a Tailwind component or a regular CSS class) standardises the per-page wrapper:

```css
.page-shell {
  @apply mx-auto w-full px-5 pb-12;
  /* Each page sets its own max-w via inline class or a variant utility. */
}
```

Pages then read as `<div className="page-shell max-w-[1100px]">…</div>` instead of repeating `mx-auto px-5 pb-20` everywhere.

## Page-by-page layouts

### `/recipes` — catalogue

| Breakpoint | Layout |
|---|---|
| `< md` | Existing 2-col card grid + filter modal (search bar + chips toggle). No change. |
| `md` | Same 2-col grid, container widens to ~720 px. Filter still modal. |
| `lg+` | **3-column shell**: sidebar app (200) · filter sidebar (220) · catalogue grid (4 cols of cards). Filter modal becomes the always-visible sidebar with search bar, meal chips, season chips, frequency chips, custom tag list. Scope segmenter ("Todas / Mis / Catálogo ONA") moves into the filter sidebar's top section. |

Component extraction: `<CatalogGrid>` (the cards-grid sub-tree) and `<CatalogFilters>` (the chips + search). Both consumed by `/recipes` and `/cookbooks` since they share the catalogue shape.

### `/recipes/[id]` — detail

| Breakpoint | Layout |
|---|---|
| `< md` | Existing single-column: hero photo → header → meta → ingredients → steps → notes → CTAs. No change. |
| `md` | Same single-column, container widens to ~840 px. Hero photo respects its aspect ratio. |
| `lg+` | **Split 38/62**: left col holds the hero photo (sticky-ish), the recipe header, "Para X" comensales, tags, equipment, CTAs (Editar, Cocinar, etc). Right col holds Ingredientes (in a 3-sub-column grid because the ingredient list is the dominant content) + Pasos stacked below. Notes/Substituciones/Storage remain at the bottom under the split. |

### `/recipes/new` and `/recipes/[id]/edit` — author / edit form

| Breakpoint | Layout |
|---|---|
| `< md` | Existing wizard-style single column. No change. |
| `md` | Same single column, container widens to ~780 px. |
| `lg+` | **Split 40/60**: left col holds Photo section (with regenerate + upload), Tipo de comida chips, Temporada chips, Planificación chips, Tags. Right col holds Nombre, Tiempos/Comensales, Source URL, Ingredientes, Pasos, Notas, Dificultad. Submit + "Guardar igualmente" stay at the bottom across the full width. |

### `/menu` — Vista Día

| Breakpoint | Layout |
|---|---|
| `< md` | Existing scrollable day stack with sticky strip. No change. |
| `md` | Same stack, container widens. |
| `lg+` | **Day stack + preview rail**: left col (60%) is the day stack as today; right col (40%) shows a preview of the next 2 days as smaller compact cards (no full meal-card actions, just thumbnail + name). Tapping a preview card scroll-into-views that day in the left stack. The day-strip moves from top sticky to a left rail inside the page sidebar (vertical L M X J V S D). |

### `/menu` — Vista Semana

| Breakpoint | Layout |
|---|---|
| `< md` | Existing per-day stack with sticky day headers. No change. |
| `md` | Same stack, container widens. |
| `lg+` | **7-column grid**: one column per day Mon-Sun, each column carries its meal cards stacked vertically. Today's column gets a soft terracotta tint. DnD remains between any two cells via the existing `move-slot` endpoint. The "Esta + sig" navigation stays at the top of the page. |

### `/shopping`

| Breakpoint | Layout |
|---|---|
| `< md` | Existing: date range pickers, progress, total, item list grouped by aisle. No change. |
| `md` | Container widens. Range pickers move from stacked to inline. |
| `lg+` | **Sidebar + 3-col grid**: left sidebar (200) holds the date range pickers, progress widget ("12/44"), total estimated card. Main area becomes a 3-column grid where each column is one aisle (frutas y verduras, proteínas, lácteos, etc.) — every aisle visible simultaneously instead of vertical scroll through them. Manual-add form moves to the bottom of the main area, full width. Tabs "Por comprar / Ya en casa" sit above the grid. |

### `/advisor`

| Breakpoint | Layout |
|---|---|
| `< md` | Existing: chat thread + summary section + voice button. No change. |
| `md` | Chat widens. Summary stays inline above. |
| `lg+` | **Chat (60%) + side panel (40%)**: chat thread on the left with voice button as today. Right panel is the persistent context — nutrition summary card on top, memory facts list below, with a small "edit en /profile/memoria" affordance. The summary today rendered via `useAdvisorSummary` moves into the panel; if `useAssistant` hooks remain authoritative for chat state, the side panel is purely read-only. |

### `/profile` (and sub-routes `/profile/memoria`, `/profile/creencias`)

| Breakpoint | Layout |
|---|---|
| `< md` | Three separate pages with their own back-link navigation. No change. |
| `md` | Same separate pages, content widens. |
| `lg+` | **Tab shell**: when on any `/profile*` route, the page layout becomes left tabs sidebar (220 px) + right active panel. Tabs include: Físico, Hogar, Plantilla semanal, Preferencias culinarias, Voz, Notificaciones, Memoria, Creencias. The URL still tracks (`/profile` for the main form, `/profile/memoria` for memory, `/profile/creencias` for beliefs) so direct linking + back-button work. A small shared layout (`/profile/layout.tsx`) detects `lg+` and renders the tab shell; below `lg` each route renders its own page as today. |

### `/cookbooks`

Same shape as `/recipes` catalogue — reuses `<CatalogGrid>` and `<CatalogFilters>`. Layouts identical to `/recipes`.

### `/admin`, `/curator`

| Breakpoint | Layout |
|---|---|
| `< md` | Existing table with horizontal scroll. No change. |
| `md+` | Table widens. Filter chips inline at the top. |
| `lg+` | Table full-width inside the container, filters in a small sidebar (220 px) when there are 3+ filters. Otherwise filters inline. |

### Excepciones (no responsive treatment)

- `/onboarding` — keeps single-column wizard centred `max-w-[600px]` at all breakpoints.
- `/auth/login`, `/auth/register` — single centred form `max-w-[400px]`.
- `/offline` — single-column status screen.
- `/recipes/[id]/cook` — full-screen overlay; sidebar hides on this route via a layout-level check (the route segment opts out of the sidebar).

## Migration plan

Five incremental PRs, each mergeable + deployable on its own. Mobile users see no change until each PR's mobile section is verified.

### PR 1 — Chasis

- `<DesktopSidebar />` component.
- `app/layout.tsx` updated for `md+` chrome (sidebar appears, bottom-nav hides, container shifts).
- `globals.css` adds `--sidebar-width`, `--sidebar-gap`, `--container-max` tokens.
- `page-shell` utility class.
- Each `page.tsx` still uses its own `max-w-[430px]` — the chasis loads but pages don't widen yet.
- `specs/design-system.md` updated with the new breakpoint matrix + sidebar component.

### PR 2 — `/recipes` and `/cookbooks`

- Extract `<CatalogGrid>` and `<CatalogFilters>` components.
- `/recipes/page.tsx` and `/cookbooks/page.tsx` adopt the 3-col shell at `lg+`.
- Filter modal logic stays as a fallback on `< lg`.
- `specs/recipes.md` updated with the new desktop layout description.

### PR 3 — `/menu` (Vista Día + Vista Semana)

- Vista Semana grid 7-col at `lg+`.
- Vista Día split with preview rail at `lg+`.
- Day strip variant for the page sidebar (vertical orientation).
- `specs/menus.md` updated.

### PR 4 — `/recipes/[id]`, `/recipes/new`, `/recipes/[id]/edit`, `/shopping`

- Recipe detail: split 38/62 at `lg+`.
- Edit form: split 40/60 at `lg+`.
- Shopping: sidebar + 3-col aisle grid at `lg+`.
- `specs/recipes.md`, `specs/shopping.md` updated.

### PR 5 — `/profile` + `/advisor` + chrome final + remaining routes

- `/profile/layout.tsx` introduces the tab shell at `lg+`. Sub-route pages absorbed as tabs.
- `/advisor` side panel at `lg+`.
- `/admin`, `/curator` minor adjustments.
- `/onboarding`, `/auth`, `/offline`, `/cook` audited and tagged as explicit no-op exceptions.
- Bottom-nav final state validated (`md:hidden` confirmed in every place it renders).
- `specs/advisor.md`, `specs/auth.md` updated. `CLAUDE.md` Todo Miguel cleaned of any responsive-related items.

## Testing strategy

- **Typecheck (`tsc --noEmit`)** runs locally before each PR; merge blocked if it fails.
- **Manual smoke** at viewports `390×844` (iPhone 14), `768×1024` (iPad portrait), `1024×768` (iPad landscape), `1440×900` (MacBook), `1920×1080` (external monitor) for every page the PR touches. Includes navigation in/out of the page, sidebar interactions, the page's primary actions (add slot, check item, drag-and-drop, etc.).
- **API tests** (`pnpm --filter @ona/api vitest`) only when a PR touches backend (PR 5 if `/advisor` summary refactor is needed). Default: not run.
- **E2E desktop (Playwright at 1440×900)** on demand. When Miguel asks or when a regression is suspected, specs land in `apps/web/e2e/desktop/*.spec.ts`.
- **Visual regression** via `mcp playwright` screenshots at mobile + desktop for the page(s) the PR touches, pasted into the commit message body so the merge history serves as a visual log.

## Spec gate

Per the project's spec-gate convention in `CLAUDE.md`:

- PR 1 updates `specs/design-system.md` (new section: "Responsive towards desktop" with the breakpoint matrix + sidebar component + token list).
- Each subsequent PR updates the specs of the pages it touches with the new desktop layout description.
- This design document itself (`docs/superpowers/specs/2026-06-01-responsive-desktop-design.md`) stays as the canonical reference; the per-feature specs cite back to it.

## Open follow-ups (not blocking implementation)

- **Mobile landscape**: a phone rotated to landscape (e.g. 844×390) hits `md` and would see the sidebar appear. This is technically correct but may feel wrong on a tiny landscape phone. Consider adding `@media (max-height: 500px)` to keep bottom-nav even when width crosses md. Defer until someone reports it.
- **iPad split-screen**: a multitasked iPad with two apps side-by-side may report widths in the 600–800 range. Should work fine with our breakpoints but worth verifying once.
- **Keyboard shortcuts**: not part of this design. A dedicated follow-up could add Cmd+K navigation, Cmd+/ search, etc. now that the desktop layout supports them ergonomically.
