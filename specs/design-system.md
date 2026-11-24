# Design System

Visual language and tokens for Mimoia. The system is **editorial-first** — inspired by premium cookbook design — with a transitional "app mode" (green palette) still present in some in-product views.

## Partes

Esta spec está partida por temas (tope de 5.000 palabras por spec, PRO-405); cada parte lleva su texto entero:

- [Páginas en modo editorial y las que quedan en modo app](./design-system-paginas.md) — página a página, cómo se ve cada una en el sistema editorial, y las que siguen con la paleta verde.

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
- `--color-ink-soft` `#7A7066` — secondary · `--color-ink-muted` `#6E655B` — eyebrows/secondary text on cream that must pass AA (ink-soft is 4.49:1 there)
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
- `--color-terracotta` `#C65D38` — italic emphasis, badges · `--color-terracotta-deep` `#B5432A` — accent text at small/medium sizes (AA on cream)
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
- `.font-display`, `.font-display-soft`, `.font-italic` — type-family wrappers (`.font-display` pins `opsz 144` + weight 400)
- `.font-serif-text` — Fraunces at its natural optical size with no weight pinned, for titles at text sizes (`font-[650]`); used by `/menu`

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
- `.route-loading-bar` — the global loading state (`app/loading.tsx`): 2 px terracotta sweep fixed at `top: var(--safe-top)`, transparent for the first 300 ms, static under reduced motion. No splash or full-screen loaders: content shows as soon as it's ready (see [PWA](./pwa.md) → Loading)
- Easings: `--ease-out-expo` `cubic-bezier(0.19, 1, 0.22, 1)` is the default for editorial
- Motion library: [`motion/react`](https://motion.dev) is used for stagger, parallax (`useScroll`/`useTransform`), `layoutId` shared elements, and `AnimatePresence` (filter expansion)

### Spacing & Radius

`--space-1`…`--space-48` (4px → 192px) and `--radius-sm`/`md`/`lg`/`xl`/`full` (4 / 10 / 18 / 28 / 9999). Used in editorial components; mixed with arbitrary `[#hex]` and Tailwind utilities elsewhere.

### Safe-area & section theme-color

`:root` exposes the four iOS safe-area insets as CSS variables that components consume directly:

- `--safe-top` → `env(safe-area-inset-top)`
- `--safe-bottom` → `env(safe-area-inset-bottom)`
- `--safe-left` → `env(safe-area-inset-left)`
- `--safe-right` → `env(safe-area-inset-right)`

The `.standalone-pt` utility applies `padding-top: var(--safe-top)` so content drawn under the translucent iOS status bar is pushed below it (the bottom `Navbar` and offline banner both use these insets). The browser status bar is tinted per section: `theme-color = #FAF6EE` (cream) for app routes, `#1A1612` (ink) for public/landing routes — see [PWA](./pwa.md) for the full installable-app surface.

## Layout

- App routes: `<main className="mx-auto max-w-[430px] pb-[calc(9.5rem+var(--safe-bottom))]">` (mobile-only canvas; reserves the fixed bottom nav, the floating buttons above it — Mimo on the right, «Opinión» on the left — and the iOS home-indicator inset, PRO-122). Below `md`, `html` also has `scroll-padding-bottom: calc(150px + safe)`, so a control scrolled into view (focus, `scrollIntoView`) lands above them. **The floating buttons hide** while a sheet or dialog is open (`[role="dialog"]` in the page) and, below 768 px, while a text field has the focus (the keyboard is up) — `hooks/useFloatingButtonsHidden.ts`. The recipe form's sticky save bar sits above them (`bottom: 140px` on mobile). Guarded by `e2e/floating-buttons.spec.ts` (390×844)
- Public routes: full-width bands with the content on **one public grid** (since 2026-10-15; before, navbar, footer and pages used four different widths and nothing lined up). The `public-container` utility (`globals.css`) caps the content box at `--public-max` (1200 px) and pads it with `--public-gutter` (24 px) on mobile and `--public-gutter-md` (40 px) from `md` — the same numbers the landing hero and the `PublicNavbar` always used. `PublicNavbar`, `Footer` and every public page (`/`, `/como-funciona`, `/precios`, `/blog`, `/blog/[slug]`, `/lista/[code]`, `/lista/baja`, `/newsletter/baja`, `/privacidad`, `/terminos`, `/aviso-legal`) use it, so at 1440 px the navbar logo, the footer logo and each page's `<h1>` start at x = 120 (360 at 1920) and the navbar's CTA and the footer's contact block end on the same right edge. Full-bleed bands (sand `#F2EDE0`, the dark manifesto, the marquee) keep their background on the `<section>`; only the inner content follows the grid. Narrower blocks inside a page (FAQ columns, the waitlist pages' `max-w-2xl`) sit **left-aligned on the grid line**, not centred; symmetric centred blocks (final CTAs, the manifesto, the counter) stay centred
- **Reading pages** (`/privacidad`, `/terminos`, `/aviso-legal`, a blog article): a `max-w-[720px]` text column (`data-testid="reading-column"`) **left-aligned on the grid line**, so the title starts at the logo's x like on every other page and the right side is air — an editorial page rather than a lone centred strip (centred, the title sat 256 px right of the logo at 1440 and the page looked like a different site). Same `<h1>` on the three legal pages (Fraunces `text-4xl md:text-5xl`, ink); they start below the fixed navbar (`pt-28 md:pt-32`)
- Mobile (390): every public page, the navbar and the footer use the same 24 px gutter (the blog and the legal pages were at 16 px, `/precios` at 20) and nothing scrolls sideways. Pinned by `e2e/public-grid.spec.ts` (1440×900, 1920×1080 and 390×844)
- Public routes have their own top `PublicNavbar`; the bottom `Navbar` only renders for authenticated app routes, and hides itself on `/recipes/[id]` (that page's sticky action bar takes its place; the page pads its bottom for it)

## Iconography

- All icons from `lucide-react`
- Default sizes: 13–22px
- Strokes: 1.5–1.6 (inactive), 2–2.5 (active)

## Constraints

- **The brand is Mimoia everywhere users see it** (decision D-012 in Mimoia HQ, 2026-10-07; coordinated rename 2026-10-08): the public site, the logged-in app (**imagotipo** since 2026-10-09, `components/brand/Mimoia.tsx`: a wooden spoon with a heart cut out of the bowl, "comida con cariño", + lowercase "mimoia" in Fraunces 650 — `MimoiaLogo` in the public navbar, footer, desktop sidebar `app-wordmark` and auth screens; `MimoiaSymbol` also on Mimo's floating button, the app icon, favicon and WhatsApp photo; **Mimo's own face** since 2026-10-18 (D-058, PRO-137) is `MimoAvatar`: Marketing's SVG copied unchanged from ona-hq `brand/logos/` to `public/brand/mimo-avatar.svg` (> 64 px) and `mimo-avatar-64.svg` (≤ 64 px, thicker features), cream spoon with eyes, smile and heart-cheek on a forest circle, used only where Mimo talks (chat panel header and Mimo's bubbles); offline/error wordmarks, "Mimoia · Receta" eyebrow, "Selección Mimoia"), the PWA manifest and splash screens, share texts and WhatsApp copy. The AI assistant is **Mimo** (chat, voice, WhatsApp: "Soy Mimo…"). Landing copy is written from the customer's mental load ("Lo cansado no es cocinar. Es decidir."), not from features, and never uses health data in examples (no doctors, diets or intolerances in the sample chats).
- The `inStock` field is camelCase end-to-end (frontend, API, DB JSONB) — never `in_stock`
- Spanish-language only (no i18n setup)
- Mobile-first (test at 390×844 — iPhone 14 — before declaring UI work done)
- Tailwind v4 with `@theme` block; no `tailwind.config.js`
- Several pages still mix arbitrary `[#hex]` values and `--color-*` tokens; prefer the tokens for new code
- **Brand names**: user-facing copy uses `BRAND_NAME` ("Mimoia") and `ASSISTANT_NAME` ("Mimo") from `@ona/shared`. The old project name survives only in technical identifiers that would break if renamed (lowercase `ona` in package names, env vars, DB, localStorage keys, routes such as `/recipes-ona`, Meta template names; constants such as `ONA_PRINCIPLES`). Prose says Mimoia too: UI copy, prompts, logs, code comments and the living docs (CLAUDE.md, specs, plans, docs outside `docs/research/` and `docs/superpowers/`). `apps/api/src/tests/brandName.test.ts` fails if the old name reappears as a word in any of them (allow-list: old DB migrations; tests that feed or forbid the old name). Pre-launch, every public CTA leads to the waitlist (`/#lista-de-espera`, with `?ref=` where useful), never to `/register`
- **No health claims in public copy** (landing, footer, `/como-funciona`, the waitlist components…): no "antiinflamatorio", "previene", "cura", "adelgaza", "controla la glucosa", microbioma, cardiólogo as endorsement, etc. Mimoia's nutrition philosophy guides the product, not the marketing (Mimoia HQ constitution §6; RD 1907/1996 art. 4). Describe the cooking style instead ("casera, variada, de temporada, con buen aceite de oliva"). Guarded in CI by `apps/api/src/tests/publicHealthClaims.test.ts` (scans `app/(public)`, the `Footer` and `components/waitlist/`); legal pages (`/privacidad`, `/terminos`) are exempt.
- **Form fields: required with an asterisk, the rest «(opcional)»** (PRO-1103, Miguel 2026-11-03). Every field of a web form carries one mark, never none: a required one ends its label in « \*» (`terracotta-deep`, semibold; drawn by `.field-mark-required::after` in `globals.css` with empty alt text, `content: " *" / ""`, so it is neither read aloud nor part of the label's text — the field is still labelled «Email», which `getByLabel('Email', { exact: true })` relies on; the control itself carries `required`, or `aria-required="true"` where the form validates in JS and the browser bubble would get in the way), an optional one in « (opcional)» (`ink-muted`, normal weight, read aloud), «(opcionales)» when the label names several things («Etiquetas», «Notas», «Gastos de envío»). «Required» means the saved thing needs a value, even when it comes pre-filled (a unit select, the household stepper). Forms with required fields end with the discreet line «\* Obligatorio» (12 px `ink-muted`) above or beside the submit. Everything goes through `components/FieldLabel.tsx`: `FieldLabel` (`required` | `optional` [+ `plural`]; the types refuse neither; `as` for `span`/`legend`/`div` titles of chip or radio groups), `FieldMark` (the mark alone, inside checkbox rows and card titles) and `RequiredNote`. A list of unlabelled rows (ingredients, steps, notes) is one field: its card title carries the mark (`FormCard mark={…}` in the recipe forms → `data-field-group`). No «(opcional)» in placeholders or hints: it lives in the label. Out of scope: search boxes, the Mimo box, filter bars and one-field forms. Guarded by `apps/api/src/tests/fieldLabel.test.ts` (the component) and `apps/web/e2e/form-field-marks.spec.ts` (390 px: every field of `/register` and `/recipes/new` marked, helper `e2e/_fieldMarks.ts`)

## Common Components

| Component | File | Notes |
|-----------|------|-------|
| `Navbar` (bottom tab bar) | `components/shared/Navbar.tsx` | Fixed, labelled tabs, `HIDDEN_ON` route list |
| `PublicNavbar` | `components/shared/PublicNavbar.tsx` | Transparent → blur on scroll |
| `WaitlistSection` | `components/waitlist/WaitlistSection.tsx` | Landing waitlist form + success state |
| `ReferralShare` | `components/waitlist/ReferralShare.tsx` | Referral link, copy (clipboard fallback), wa.me share |
| `Footer` | `components/shared/Footer.tsx` | One public footer, landing included; contact from `lib/contact.ts` |
| `WeekStrip` / `MenuSheet` (+ `SheetAction`, `ConfirmSheet`) / `RecipeCover` | `components/menu/` | /menu day strip · sheet primitive (`ConfirmSheet`: "Cancelar" + terracotta-deep action pill, used instead of `window.confirm`) · photo or bone block + meal icon |
| `RecipeCard` | `components/recipes/RecipeCard.tsx` | `/recipes` card: photo + time pill + title, nothing else (no badges); hero in `FeaturedRecipeCard.tsx` |
| `FavoriteButton` | `components/recipes/FavoriteButton.tsx` | Heart toggle |
| `MimoProvider` | `components/mimo/MimoProvider.tsx` | App-wide Mimo state (`useMimo`), mounted in `app/layout.tsx`; renders the button and the panel; `open({ draft })` opens it with the message started (cursor at the end) |
| `FichaShell` (+ `FactRow`, `OriginBadge`, `FichaSection`) | `components/ficha/FichaUI.tsx` | «Tu ficha» pages: Fraunces 400 title with a Cormorant accent, paper fact lists, origin badges |
| `MimoPanel` | `components/mimo/MimoPanel.tsx` | Bottom sheet < lg / 400 px column at lg+; chat, mic, «Manos libres», voice picker, AI caption |
| `AuthShell` (+ `AuthField`, `AuthHeading`, `AuthError`) | `components/auth/AuthShell.tsx` | Access screens (/login, /register, /reset, /invites): photo + overlapping paper card, 50/50 at `lg+` |
| `FieldLabel` (+ `FieldMark`, `RequiredNote`) | `components/FieldLabel.tsx` | Every form label: « \*» required / « (opcional)» optional, and the «\* Obligatorio» foot line (see Constraints) |
| `MimoButton` | `components/mimo/MimoButton.tsx` | Floating Mimo button (brand spoon on terracotta); position per page (`mimoButtonPosition`). In cook mode it floats over the step, so `StepCard` leaves `pb-24` below its content (since 2026-11-23: it used to cover the «Siguiente paso» preview) |

## Related specs

- All other specs reference UI components and tokens here
- [PWA](./pwa.md) — installable shell, safe-area variables, dynamic per-section `theme-color`, View Transitions, swipe gestures, "Sin conexión" banner

## Responsive towards desktop

Mimoia supports a desktop layout at `md+` (≥768 px) and bespoke multi-column pages at `lg+` (≥1024 px). Mobile behaviour is unchanged.

### Breakpoint matrix

| Range | Layout |
|---|---|
| `< md` (≤767 px) | Bottom-nav fixed at viewport bottom, content in `max-w-[430px] mx-auto` column. |
| `md` (768–1023 px) | `<DesktopSidebar />` appears (200 px wide), bottom-nav hidden, `<main>` shifted right via `md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))]`. Pages still cap at `max-w-[430px]` inside `<main>` at this breakpoint — the bespoke per-page widening kicks in at `lg+`. |
| `lg+` (≥1024 px) | Per-page bespoke layouts (filter rows, split views, multi-col grids). Each page documents its desktop layout in its own spec. |
| Big screens (≥1680 px) | Miguel 2026-10-21 («con pantallas muy grandes no aprovecha bien el espacio»): every app page's container is `max-w-[var(--page-max)]`, which grows with the monitor — 1180 px up to 1679 px, **1440 px** from 1680, **1680 px** from 2100, **1920 px** from 2400 (`:root` media queries in `globals.css`); the recipe detail is `--page-max` + 100 px; the recipe catalogue goes to 5 columns from 1680 px and 6 from 2100 px. Print sheets (`/menu/imprimir`), cook mode and the auth / onboarding shells keep their own widths. |

### Tokens (globals.css `@theme`)

- `--public-max: 1200px;` · `--public-gutter: 24px;` · `--public-gutter-md: 40px;` — the public grid, used through `@utility public-container` (see Layout)
- `--page-max` (`:root`, not `@theme`: it changes with media queries) — the app page width, see the table above
- `--sidebar-width: 200px;` · `--sidebar-gap: 8px;` · `--container-max: 1400px;` · `--mimo-panel-width` (`0px`, or `400px` while the Mimo panel is open; set at runtime by `MimoProvider`, read by `<main>` at `lg+`)

### Components

- `<DesktopSidebar />` at `apps/web/src/components/shared/DesktopSidebar.tsx` — persistent left nav at `md+`; its `MimoiaLogo` (`app-wordmark`) links to `/menu` (2026-10-18; before it led nowhere); **«Salir»** at its bottom left (`sidebar-logout`, Miguel 2026-10-21: «que no esté tan rebuscado en el perfil»), same `logout` as Perfil's, which stays for mobile; the sidebar scrolls if an admin's menu is long. Items: Menú, Compra, Recetas, Perfil (Mimo is the floating button). Admins also get an «Admin» block below a hairline: Catálogo, Recetas pendientes, Usuarios, Invitaciones, Lista de espera, Opiniones, Auditoría (`lib/adminNav.ts`, see [Admin Dashboard](./admin-dashboard.md)). Hides on `/recipes/[id]/cook` routes.
- `<Navbar />` (mobile bottom-nav) carries `md:hidden` on its outer `<nav>`.

### Exceptions (no responsive treatment)

- `/offline` — single-column at all breakpoints. The access pages (`/login`, `/register`, `/reset`, `/invites/[token]`) go 50/50 photo + form at `lg+`. `/onboarding` stays one 560 px column, plus a dish photo beside it at `lg+`. `/recipes/[id]/cook` keeps its own full-screen shell (no sidebar) but splits the step into two columns at `lg+` (max 1180 px).
- Error boundaries `app/error.tsx` ("Algo se ha torcido", inside the app chrome) and `app/global-error.tsx` (replaces the root layout, own `<html>`) — centred single column, editorial tokens (cream, ink, terracotta "Vaya", Fraunces heading), same look as `/offline`. See [errors.md](./errors.md).
- Public site (marketing pages, and `/recipes`, `/recipes/[id]`, `/whatsapp/conectar` signed out) uses its own `PublicNavbar` + `Footer`, full width (no sidebar margin), content on the public grid `public-container`.
- **Page shells** (`components/shared/RootShell.tsx`, picked in the root layout from the lists in `lib/routeAccess.ts`): bare routes (`isBareRoute`: marketing, auth, `/onboarding`, `/offline`, `/lista/*`, `/invites/*`, `/blog/*`, `/newsletter/*`) → bare `<main>` (marketing pages add PublicNavbar + Footer via `app/(public)/layout.tsx`); **signed out** on `/recipes`, `/recipes/[id]` and `/whatsapp/conectar` → PublicNavbar + `<main>` + Footer (on `/recipes/[id]`, + a sand spacer under the footer below `lg` for the sticky cook bar), `/recipes/[id]/cook` → bare `<main>`; **signed out on any other page** → nothing but an empty cream page while it redirects to `/login?next=…` ([Auth](./auth.md)); everything else → app shell (MimoProvider, DesktopSidebar, bottom Navbar, InstallSheet, HealthConsentGate, sidebar margin at `md+`). Every page whose access or chrome depends on the session paints an empty cream page while the session (localStorage) resolves, so the wrong chrome never flashes. The pages that switch chrome put their content on `public-container` when signed out (`/recipes`: editorial header + filters + grid; `/recipes/[id]` at `lg+`: the two columns; `/whatsapp/conectar`: no own brand header, the navbar carries the logo).

### Pragmatic scope vs original plan

The migration (June 2026) shipped the chasis (sidebar at `md+`, container caps) + a `/recipes` catalogue shell (replaced by the "D" filter row on 2026-10-08) + the Vista Semana 7-col grid + page-by-page container widening at `lg+`. The original plan ([docs/superpowers/specs/2026-06-01-responsive-desktop-design.md](../docs/superpowers/specs/2026-06-01-responsive-desktop-design.md)) also called for bespoke per-page splits (38/62 recipe detail with sticky hero, 40/60 form layouts, vertical day-strip + preview rail, sidebar + 3-col aisle grid on `/shopping`, `/profile` tabs shell, `/advisor` side panel — superseded on 2026-10-09 by the Mimo desktop column on every page). The recipe-detail split **shipped on 2026-10-08** as a 50/50 grid with a sticky photo (redesign "D", see `/recipes/[id]` above); the other bespoke layouts are still deferred to follow-up polish PRs — the foundational responsive win is delivered without them, and the editorial splits can land iteratively as taste decisions allow.

## Source

- [apps/web/src/app/globals.css](../apps/web/src/app/globals.css) — `@theme` tokens, all editorial classes, `public-container`
- [apps/web/e2e/public-grid.spec.ts](../apps/web/e2e/public-grid.spec.ts) — the public grid at 1440/1920/390
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — fonts, viewport, root layout
- [apps/web/src/app/(public)/page.tsx](../apps/web/src/app/(public)/page.tsx) — editorial reference (landing)
- [apps/web/src/app/(public)/como-funciona/page.tsx](../apps/web/src/app/(public)/como-funciona/page.tsx)
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — editorial in-app
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx) — editorial "D · Luz y foto"
- [apps/web/src/components/onboarding/OnboardingShell.tsx](../apps/web/src/components/onboarding/OnboardingShell.tsx) — onboarding layout (560 px column + photo at lg+), header and accent
- [apps/api/src/tests/helpers/legacyPalette.ts](../apps/api/src/tests/helpers/legacyPalette.ts) — `legacyPaletteHits`, the no-old-green guard used by every `redesignD*.test.ts`
- [apps/web/src/app/shopping/page.tsx](../apps/web/src/app/shopping/page.tsx) — editorial "D · Luz y foto" (+ `components/shopping/ShoppingExtensions.tsx`)
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — "D · Luz y foto" profile front page (five sections, PRO-1202); cards in [sections/ProfileCards.tsx](../apps/web/src/app/profile/sections/ProfileCards.tsx)
- [apps/web/src/app/profile/ajustes/page.tsx](../apps/web/src/app/profile/ajustes/page.tsx) — Ajustes behind the gear (PRO-1202)
- [apps/web/src/components/recipes/form/RecipeFormUI.tsx](../apps/web/src/components/recipes/form/RecipeFormUI.tsx) — recipe forms in "D · Luz y foto" (cards, inputs, ingredient rows, sticky save pill)
- [apps/web/src/app/menu/history/page.tsx](../apps/web/src/app/menu/history/page.tsx) + [apps/web/src/lib/menuHistory.ts](../apps/web/src/lib/menuHistory.ts) · [apps/web/src/app/cookbooks/[id]/page.tsx](../apps/web/src/app/cookbooks/[id]/page.tsx) — "D" (PRO-43); guarded by `apps/api/src/tests/redesignDHistorialRecetarios.test.ts`
- [apps/web/src/components/cooking/](../apps/web/src/components/cooking/) — cook mode in "D · Luz y foto"
- [apps/web/src/app/admin/[[...seccion]]/page.tsx](../apps/web/src/app/admin/%5B%5B...seccion%5D%5D/page.tsx) + `admin/sections/`, [apps/web/src/app/debug-advisor/page.tsx](../apps/web/src/app/debug-advisor/page.tsx) — internal pages in "D · Luz y foto"
- [apps/api/src/tests/redesignDInternas.test.ts](../apps/api/src/tests/redesignDInternas.test.ts) — legacy-palette guard (helper `tests/helpers/legacyPalette.ts`)
- [apps/web/src/components/shared/Navbar.tsx](../apps/web/src/components/shared/Navbar.tsx) — labelled tab bar
- [apps/web/src/components/shared/PublicNavbar.tsx](../apps/web/src/components/shared/PublicNavbar.tsx)
- [apps/web/src/components/shared/Footer.tsx](../apps/web/src/components/shared/Footer.tsx)
- [apps/web/src/components/auth/AuthShell.tsx](../apps/web/src/components/auth/AuthShell.tsx) — "D · Luz y foto" access screens shell
- [apps/web/src/components/profile/SubPage.tsx](../apps/web/src/components/profile/SubPage.tsx) — "D" shell for the /profile sub-pages (header, "···" button, card/input/pill classes)
- [apps/web/src/components/profile/SubLoadError.tsx](../apps/web/src/components/profile/SubLoadError.tsx) — «No hemos podido cargar esto» + «Reintentar», `useQueryLoad`, `useSlowLoad` (PRO-143)
- [apps/web/src/components/ficha/](../apps/web/src/components/ficha/) — «Tu ficha» shell, rows, badges, sheets, and the learning switch (PRO-318; the Perfil strip lives in `app/profile/page.tsx` since PRO-1202); pages [apps/web/src/app/profile/ficha/](../apps/web/src/app/profile/ficha/)
- [apps/web/src/app/whatsapp/conectar/page.tsx](../apps/web/src/app/whatsapp/conectar/page.tsx) · [apps/web/src/app/offline/page.tsx](../apps/web/src/app/offline/page.tsx) — "D · Luz y foto" (PRO-44)
