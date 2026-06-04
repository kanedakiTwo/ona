# Design System

Visual language and tokens for ONA. The system is **editorial-first** — inspired by premium cookbook design — with a transitional "app mode" (green palette) still present in some in-product views.

## Canonical System: Editorial

Defined in [`apps/web/src/app/globals.css`](../apps/web/src/app/globals.css) under `@theme`. This is the source of truth for all new UI.

### Palette

**Warm neutrals**:
- `--color-cream` `#FAF6EE` — page background
- `--color-cream-deep` `#F2EDE0` — slightly darker surface
- `--color-paper` `#FFFEFA` — cards, inputs
- `--color-bone` `#EFE8D8` — skeleton/placeholder

**Ink scale**:
- `--color-ink` `#1A1612` — primary text, dark CTA
- `--color-ink-mid` `#4A4239` — body
- `--color-ink-soft` `#7A7066` — secondary
- `--color-ink-light` `#A39A8E` — placeholders
- `--color-border` `#DDD6C5` — primary border
- `--color-border-soft` `#E8E2D3` — subtle dividers

**Brand greens**:
- `--color-forest-deep` `#1B4332`
- `--color-forest` `#2D6A4F` — primary green
- `--color-forest-mid` `#40916C`
- `--color-leaf` `#52B788` / `--color-leaf-light` `#95D5B2`
- `--color-mint` `#D8F3DC`

**Warm accents (terracotta family)**:
- `--color-terracotta` `#C65D38` — italic emphasis, badges
- `--color-terracotta-soft` `#E0917D`
- `--color-ochre` `#D4A24C`
- `--color-clay` `#B8765B`

### Typography

Three editorial fonts loaded as Next.js `next/font/google` variables:
- `--font-fraunces` — variable serif with `opsz` and `SOFT` axes; used for `font-display` headings
- `--font-cormorant` — Cormorant Garamond italic; used for `font-italic` emphasis within headings
- `--font-inter` — body, UI labels, microcopy (weights 300–700)
- `--font-jetbrains` — monospace for quantities, technical labels

Predefined utility classes in `globals.css`:
- `.text-editorial-xl` — clamp(3.5–7rem), `opsz=144 SOFT=0`, line-height 0.95 (hero)
- `.text-editorial-lg` — clamp(2.5–4.5rem), `SOFT=30` (section heads)
- `.text-editorial-md` — clamp(1.75–2.5rem), `opsz=60` (sub-section)
- `.text-eyebrow` — 0.7rem, uppercase, letter-spacing 0.18em (kicker labels)
- `.font-display`, `.font-display-soft`, `.font-italic` — type-family wrappers

### Components

Defined as classes in `globals.css`:
- `.btn-editorial` — pill, `bg-ink`/`text-cream`, hovers to forest
- `.btn-editorial-primary` — pill, `bg-forest`/`text-cream`, hovers to forest-deep
- `.btn-editorial-outline` — pill, transparent with ink border
- `.btn-magnetic` — radial-gradient hover effect tied to `--mouse-x/y`
- `.input-editorial` — bottom-border-only input with forest focus
- `.chip-filter` — pill chip with `data-active` toggle to dark
- `.card-editorial` — paper bg, `radius-lg` (18px), lift on hover, image scale on hover
- `.divider-dotted` — dashed top border using border-color

### Atmosphere & Motion

- `.grain` / `.grain-subtle` — SVG noise overlay at 8% / 4% opacity
- `.link-reveal` — underline that draws right-to-left on hover
- `.animate-float` — 6s vertical bob
- `.animate-blob` — organic morphing border-radius
- `.marquee` — horizontal scroll loop (used in social proof)
- Easings: `--ease-out-expo` `cubic-bezier(0.19, 1, 0.22, 1)` is the default for editorial
- Motion library: [`motion/react`](https://motion.dev) is used for stagger, parallax (`useScroll`/`useTransform`), `layoutId` shared elements (active nav pill), and `AnimatePresence` (filter expansion)

### Spacing & Radius

`--space-1`…`--space-48` (4px → 192px) and `--radius-sm`/`md`/`lg`/`xl`/`full` (4 / 10 / 18 / 28 / 9999). Used in editorial components; mixed with arbitrary `[#hex]` and Tailwind utilities elsewhere.

### Safe-area & section theme-color

`:root` exposes the four iOS safe-area insets as CSS variables that components consume directly:

- `--safe-top` → `env(safe-area-inset-top)`
- `--safe-bottom` → `env(safe-area-inset-bottom)`
- `--safe-left` → `env(safe-area-inset-left)`
- `--safe-right` → `env(safe-area-inset-right)`

The `.standalone-pt` utility applies `padding-top: var(--safe-top)` so content drawn under the translucent iOS status bar is pushed below it (the bottom `Navbar` and offline banner both use these insets). The browser status bar is tinted per section: `theme-color = #FAF6EE` (cream) for app routes, `#1A1612` (ink) for public/landing routes — see [PWA](./pwa.md) for the full installable-app surface.

## Pages currently in Editorial Mode

- `/` (landing) — hero with parallax, magnetic CTA, masonry steps, marquee
- `/como-funciona` — accordion FAQ, step images
- `/recipes` — beige bg, sticky search, expandable filter sheet, editorial header with rust italic
- `/recipes/[id]` — large hero photo with cream sheet, dotted ingredient list, monospace quantities, "Capitulo 01/02" eyebrow labels
- `Footer` — `bg-ink` (`#1A1612`) with cream text, big editorial CTA before links
- `PublicNavbar` — transparent over hero, beige/blur after scroll, mobile menu uses `font-display` 3xl
- `Navbar` (bottom tab bar) — floating pill `bg-paper/95` with `bg-ink` active pill that animates between tabs (`motion layoutId="nav-pill"`)

## Pages still in App Mode (legacy, green palette)

These have not been migrated to the editorial system yet:
- `/menu` — green/mint palette, `[#2D6A4F]` accents, `[#EAF3DE]` chips
- `/shopping` — same
- `/profile` — same
- `/advisor` — green avatar, mint chat header
- `/login` — photo background with white form sheet (transitional; uses `font-display` for logo but green submit button)

## Layout

- App routes: `<main className="mx-auto max-w-[430px] pb-20">` (mobile-only canvas, leaves room for fixed bottom nav)
- Public routes: full-width with internal `max-w-7xl` (~1280px) editorial composition
- Public routes have their own top `PublicNavbar`; the bottom `Navbar` only renders for authenticated app routes

## Iconography

- All icons from `lucide-react`
- Default sizes: 13–22px
- Strokes: 1.5–1.6 (inactive), 2–2.5 (active)

## Constraints

- The `inStock` field is camelCase end-to-end (frontend, API, DB JSONB) — never `in_stock`
- Spanish-language only (no i18n setup)
- Mobile-first (test at 390×844 — iPhone 14 — before declaring UI work done)
- Tailwind v4 with `@theme` block; no `tailwind.config.js`
- Several pages still mix arbitrary `[#hex]` values and `--color-*` tokens; prefer the tokens for new code
- `PublicNavbar` links to `/recetas` (Spanish) but the actual route is `/recipes` — known broken link

## Common Components

| Component | File | Notes |
|-----------|------|-------|
| `Navbar` (bottom tab bar) | `components/shared/Navbar.tsx` | Pill style, motion layoutId active state |
| `PublicNavbar` | `components/shared/PublicNavbar.tsx` | Transparent → blur on scroll |
| `Footer` | `components/shared/Footer.tsx` | Hidden on `/` (landing has its own) |
| `WeekStrip` | `components/menu/WeekStrip.tsx` | 7-day picker with status circles |
| `MealPhotoCard` | `components/menu/MealPhotoCard.tsx` | Photo card with gradient overlay |
| `RecipeCard` | `components/recipes/RecipeCard.tsx` | Catalog card |
| `FavoriteButton` | `components/recipes/FavoriteButton.tsx` | Heart toggle |
| `AdvisorChat` | `components/advisor/AdvisorChat.tsx` | Chat bubbles + voice mic |

## Related specs

- All other specs reference UI components and tokens here
- [PWA](./pwa.md) — installable shell, safe-area variables, dynamic per-section `theme-color`, View Transitions, swipe gestures, "Sin conexión" banner

## Responsive towards desktop

ONA supports a desktop layout at `md+` (≥768 px) and bespoke multi-column pages at `lg+` (≥1024 px). Mobile behaviour is unchanged.

### Breakpoint matrix

| Range | Layout |
|---|---|
| `< md` (≤767 px) | Bottom-nav fixed at viewport bottom, content in `max-w-[430px] mx-auto` column. |
| `md` (768–1023 px) | `<DesktopSidebar />` appears (200 px wide), bottom-nav hidden, `<main>` shifted right via `md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))]`. Pages still cap at `max-w-[430px]` inside `<main>` at this breakpoint — the bespoke per-page widening kicks in at `lg+`. |
| `lg+` (≥1024 px) | Per-page bespoke layouts (filters sidebar, split views, multi-col grids). Each page documents its desktop layout in its own spec. |

### Tokens (globals.css `@theme`)

- `--sidebar-width: 200px;`
- `--sidebar-gap: 8px;`
- `--container-max: 1400px;`

### Components

- `<DesktopSidebar />` at `apps/web/src/components/shared/DesktopSidebar.tsx` — persistent left nav at `md+`. Items: Menú, Compra, Recetas, Asesor, Perfil. Hides on `/recipes/[id]/cook` routes.
- `<Navbar />` mobile bottom-nav unchanged; just gains `md:hidden` on its outer `<nav>`.

### Exceptions (no responsive treatment)

- `/onboarding`, `/auth/*`, `/offline`, `/recipes/[id]/cook` — single-column at all breakpoints.
- Public site (`/recipes-ona`) uses its own `PublicNavbar` and is unaffected.

### Pragmatic scope vs original plan

The migration (June 2026) shipped the chasis (sidebar at `md+`, container caps) + the `/recipes` 3-col catalogue shell + the Vista Semana 7-col grid + page-by-page container widening at `lg+`. The original plan ([docs/superpowers/specs/2026-06-01-responsive-desktop-design.md](../docs/superpowers/specs/2026-06-01-responsive-desktop-design.md)) also called for bespoke per-page splits (38/62 recipe detail with sticky hero, 40/60 form layouts, vertical day-strip + preview rail, sidebar + 3-col aisle grid on `/shopping`, `/profile` tabs shell, `/advisor` side panel). Those bespoke layouts were deferred to follow-up polish PRs — the foundational responsive win is delivered without them, and the editorial splits can land iteratively as taste decisions allow.

## Source

- [apps/web/src/app/globals.css](../apps/web/src/app/globals.css) — `@theme` tokens, all editorial classes
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — fonts, viewport, root layout
- [apps/web/src/app/(public)/page.tsx](../apps/web/src/app/(public)/page.tsx) — editorial reference (landing)
- [apps/web/src/app/(public)/como-funciona/page.tsx](../apps/web/src/app/(public)/como-funciona/page.tsx)
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — editorial in-app
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx) — app mode (legacy)
- [apps/web/src/components/shared/Navbar.tsx](../apps/web/src/components/shared/Navbar.tsx) — pill tab bar
- [apps/web/src/components/shared/PublicNavbar.tsx](../apps/web/src/components/shared/PublicNavbar.tsx)
- [apps/web/src/components/shared/Footer.tsx](../apps/web/src/components/shared/Footer.tsx)
