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

## Pages currently in Editorial Mode

- `/` (landing) — hero with parallax, magnetic CTA ("Quiero mi semana pensada", smooth-scrolls in place to the waitlist so `?invita=`/`?ref=` stay in the URL), masonry steps, marquee, a **waitlist section** before the final CTA (`components/waitlist/WaitlistSection.tsx`, `#lista-de-espera`: cream bg, eyebrow "Lista de espera · Mimoia", `text-editorial-lg` headline with terracotta italic, form in a `rounded-[28px]` paper card with `.input-editorial` fields, `.chip-filter` one-tap answers as `role="radio"` buttons, accent-forest checkboxes, ink pill submit; success state with `ReferralShare` — link field + "Copiar enlace" ink pill + "Enviar por WhatsApp" outline pill — see [Waitlist](./waitlist.md)), and a counter showing the **real** size of the public catalogue (`X-Total-Count` of anonymous `GET /recipes`; hidden if unreadable). Until 2026-10-07 it animated to a made-up "2.847 personas"
- `/como-funciona` — accordion FAQ, step images
- `/recipes` — "D · Luz y foto" (2026-10-08): h1 "Recetas" in Fraunces semibold (`DISPLAY_UI` = `[font-family:var(--font-display)] font-[650]`, auto optical size — not the 144-opsz `.font-display` hero cut) + ink "+"; pill search (paper, `border`, "Busca una receta") with the "Más filtros" button inside on mobile; ONE chip row (36 px ink/paper pills with `aria-pressed`, hit area stretched to 44 px; horizontal scroll on mobile, wraps at `lg+` ending in an underlined "Más filtros" link — no filter column); "De temporada" hero (full-bleed 220 px on mobile, two 290 px radius-22 cards at `lg+`) with a paper caption card whose eyebrow uses `#B5432A` (terracotta darkened for AA on small text; `#C65D38` is 4.1:1 on paper); grid of photo cards (photo + time pill + title only; radius 16/18, 2-col masonry on mobile, 4-col 220 px at `lg+`); advanced filters in a dialog (bottom sheet / centred panel). See [Recipes](./recipes.md)
- `/recipes/[id]` — "D · Luz y foto" (2026-10-08): 390 px hero with back/share/favorite on 44 px `bg-paper` circles, cream sheet (`rounded-t-[24px]`, −28 px overlap), 11 px uppercase eyebrow + Fraunces title (30 px, semibold), underline tablist `RecipeTabs` (15 px, ink 2 px bar on the selected tab, sticky), pill servings stepper (`ServingsScaler variant="pill"`), dashed 16 px ingredient rows with JetBrains 13 px quantities, solid terracotta step numbers, and a sticky paper action bar `RecipeActionBar` (84 px, `border-border-soft` top, ink pill "Empezar a cocinar"). At `lg+`: 50/50 split, sticky `rounded-[24px]` photo with a "← Recetas" paper pill, 48 px title, ink pill + outline 50 px circles, Fraunces/Cormorant italic section heads with `border-t` dividers. No more "Capítulo NN" eyebrows on the private detail (the public `/recipes-ona/[id]` keeps them)
- `Footer` — the **one** public footer (since 2026-10-08), rendered by `app/(public)/layout.tsx` on the landing and every public page: the landing's sand strip (`#F2EDE0`, hairline `#DDD6C5` top rule inside `max-w-5xl`), the `MimoiaLogo` lockup, links Cómo funciona · Recetas · Privacidad · Términos, contact `CONTACT_EMAIL` (`lib/contact.ts`: `NEXT_PUBLIC_SUPPORT_EMAIL`, else hola@mimoia.com) and "© 2026 Mimoia". The old dark footer (ink band with a CTA, "hola@ona.app", "Issue №01") is gone; the landing's final CTA section no longer embeds its own footer. Pinned by `e2e/brand.spec.ts`
- `PublicNavbar` — transparent over hero, beige/blur after scroll, mobile menu uses `font-display` 3xl; its primary pill is "Lista de espera" (mobile: "Únete a la lista de espera") → `/#lista-de-espera` (scrolls in place on `/`)
- `/lista/[code]` (waitlist owner page) and `/lista/baja` (opt-out) — cream page, eyebrow with `BRAND_NAME`, `text-editorial-lg` headline, paper card
- `Navbar` (bottom tab bar, 2026-10-08) — fixed full width, `bg-paper` + `border-border-soft` top border, four tabs with icon **and visible label** (Menú, Compra, Recetas, Perfil; 11 px; no «Asesor» tab since D-023, 2026-10-09: Mimo is the floating button), active = ink, semibold, stroke 2.2 + `aria-current="page"` (Compra is also active on `/compra/*`); 60 px + safe-area inset. Hidden on full-screen routes listed in `HIDDEN_ON` (cook mode)
- `/menu` — "D · Luz y foto": compact header (eyebrow + Fraunces 650 h1 with terracotta-deep italic day), day strip (ink pill), full-bleed photo hero with overlapping paper caption card + ink "Empezar a cocinar" pill, horizontal meal rows, every action behind "···" sheets (`MenuSheet`: bottom sheet on mobile, centred dialog at lg+, portalled, Esc closes, fades only under reduced motion); desktop hero row + "La semana" photo columns. Photo-less: the hero becomes a compact card (meal icon on a bone square, name once); thumbnails and tiles use `RecipeCover` (bone block + small meal icon, no name). See [Menus](./menus.md)
- **Mimo companion** (D-023, 2026-10-09; see [Advisor](./advisor.md)) — `MimoButton`: 56 px terracotta circle, cream ring, the brand spoon (`MimoiaSymbol`: Mimo's face), terracotta-deep on hover, a pulsing forest dot while the wake word listens; sits above the tab bar (mobile), the recipe action bar (< `lg`) or the cook-mode controls (`z-110`). `MimoPanel`: cream bottom sheet (88dvh, `rounded-t-[28px]`, ink/30 backdrop) below `lg`, a 400 px right column with a left hairline at `lg+` (the page moves aside via `--mimo-panel-width`); `MimoAvatar` + Fraunces «Mimo» title, 11 px uppercase status line, ink user bubbles / bone assistant bubbles, terracotta level bars while listening, forest «Manos libres» pill when on
- `/compra` + `/compra/tiendas` — "Pide a tus *tiendas*." editorial header, one cream card per shop order with a status chip (ink = enviado, terracotta = ha contestado, forest = confirmado), ink pill CTAs, verdict labels OK (forest) / Revisar (terracotta) / No hay (muted); `/shopping` gets an outlined "Pedir a mis tiendas" card
- "D · Luz y foto" (2026-10-10, PRO-43) — `/menu/history` and `/cookbooks/[id]`: cream page capped at 1180 px, 44 px paper back circle / "Recetarios" link, `DISPLAY_UI` h1. History = one paper week card per menu (`border-border-soft`, radius 20, `weekRangeLabel` title, "Creado el…" in ink-muted, 4 square `RecipeCover` thumbnails with a "+N" tile; 3 columns at `lg+`). Cookbook = compact header (emoji on a cream-deep tile, title, count) + "···" `MenuSheet` (Editar recetario, Borrar recetario) + the `/recipes` `CatalogGrid` with a 44 px "Quitar del recetario" button over each photo

## Pages still in App Mode (legacy, green palette)

These have not been migrated to the editorial system yet:
- `/shopping` — green/mint palette, `[#2D6A4F]` accents, `[#EAF3DE]` chips
- `/profile` — same
- `/login` — photo background with white form sheet (transitional; uses the `MimoiaLogo` lockup but green submit button)

## Layout

- App routes: `<main className="mx-auto max-w-[430px] pb-[calc(5rem+var(--safe-bottom))]">` (mobile-only canvas; reserves the fixed bottom nav plus the iOS home-indicator inset — identical to `pb-20` without an inset)
- Public routes: full-width with internal `max-w-7xl` (~1280px) editorial composition
- Public routes have their own top `PublicNavbar`; the bottom `Navbar` only renders for authenticated app routes, and hides itself on `/recipes/[id]` (that page's sticky action bar takes its place; the page pads its bottom for it)

## Iconography

- All icons from `lucide-react`
- Default sizes: 13–22px
- Strokes: 1.5–1.6 (inactive), 2–2.5 (active)

## Constraints

- **The brand is Mimoia everywhere users see it** (decision D-012 in ONA HQ, 2026-10-07; coordinated rename 2026-10-08): the public site, the logged-in app (**imagotipo** since 2026-10-09, `components/brand/Mimoia.tsx`: a wooden spoon with a heart cut out of the bowl, "comida con cariño", + lowercase "mimoia" in Fraunces 650 — `MimoiaLogo` in the public navbar, footer, desktop sidebar `app-wordmark` and auth screens; `MimoiaSymbol` is also Mimo's face; offline/error wordmarks, "Mimoia · Receta" eyebrow, "Selección Mimoia"), the PWA manifest and splash screens, share texts and WhatsApp copy. The AI assistant is **Mimo** (chat, voice, WhatsApp: "Soy Mimo…"). Landing copy is written from the customer's mental load ("Lo cansado no es cocinar. Es decidir."), not from features, and never uses health data in examples (no doctors, diets or intolerances in the sample chats).
- The `inStock` field is camelCase end-to-end (frontend, API, DB JSONB) — never `in_stock`
- Spanish-language only (no i18n setup)
- Mobile-first (test at 390×844 — iPhone 14 — before declaring UI work done)
- Tailwind v4 with `@theme` block; no `tailwind.config.js`
- Several pages still mix arbitrary `[#hex]` values and `--color-*` tokens; prefer the tokens for new code
- `PublicNavbar` links to `/recetas` (Spanish) but the actual route is `/recipes` — known broken link
- **Brand names**: user-facing copy uses `BRAND_NAME` ("Mimoia") and `ASSISTANT_NAME` ("Mimo") from `@ona/shared`; "ONA" is internal only (packages, env vars, DB, localStorage keys, routes such as `/recipes-ona`, code, comments). `apps/api/src/tests/brandName.test.ts` fails on any string literal or JSX text saying ONA/Ona in the web app, `@ona/shared` or the API copy (allow-list: the "Hola Ona" wake phrase, see [Voice (Mimo)](./voice-mode.md)). Pre-launch, every public CTA leads to the waitlist (`/#lista-de-espera`, with `?ref=` where useful), never to `/register`
- **No health claims in public copy** (landing, footer, `/como-funciona`, the waitlist components…): no "antiinflamatorio", "previene", "cura", "adelgaza", "controla la glucosa", microbioma, cardiólogo as endorsement, etc. ONA's nutrition philosophy guides the product, not the marketing (ONA HQ constitution §6; RD 1907/1996 art. 4). Describe the cooking style instead ("casera, variada, de temporada, con buen aceite de oliva"). Guarded in CI by `apps/api/src/tests/publicHealthClaims.test.ts` (scans `app/(public)`, the `Footer` and `components/waitlist/`); legal pages (`/privacidad`, `/terminos`) are exempt.

## Common Components

| Component | File | Notes |
|-----------|------|-------|
| `Navbar` (bottom tab bar) | `components/shared/Navbar.tsx` | Fixed, labelled tabs, `HIDDEN_ON` route list |
| `PublicNavbar` | `components/shared/PublicNavbar.tsx` | Transparent → blur on scroll |
| `WaitlistSection` | `components/waitlist/WaitlistSection.tsx` | Landing waitlist form + success state |
| `ReferralShare` | `components/waitlist/ReferralShare.tsx` | Referral link, copy (clipboard fallback), wa.me share |
| `Footer` | `components/shared/Footer.tsx` | One public footer, landing included; contact from `lib/contact.ts` |
| `WeekStrip` / `MenuSheet` / `RecipeCover` | `components/menu/` | /menu day strip · sheet primitive · photo or bone block + meal icon |
| `RecipeCard` | `components/recipes/RecipeCard.tsx` | `/recipes` card: photo + time pill + title, nothing else (no badges); hero in `FeaturedRecipeCard.tsx` |
| `FavoriteButton` | `components/recipes/FavoriteButton.tsx` | Heart toggle |
| `MimoProvider` | `components/mimo/MimoProvider.tsx` | App-wide Mimo state (`useMimo`), mounted in `app/layout.tsx`; renders the button and the panel |
| `MimoPanel` | `components/mimo/MimoPanel.tsx` | Bottom sheet < lg / 400 px column at lg+; chat, mic, «Manos libres», voice picker, AI caption |
| `MimoButton` | `components/mimo/MimoButton.tsx` | Floating Mimo button (brand spoon on terracotta); position per page (`mimoButtonPosition`) |

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
| `lg+` (≥1024 px) | Per-page bespoke layouts (filter rows, split views, multi-col grids). Each page documents its desktop layout in its own spec. |

### Tokens (globals.css `@theme`)

- `--sidebar-width: 200px;` · `--sidebar-gap: 8px;` · `--container-max: 1400px;` · `--mimo-panel-width` (`0px`, or `400px` while the Mimo panel is open; set at runtime by `MimoProvider`, read by `<main>` at `lg+`)

### Components

- `<DesktopSidebar />` at `apps/web/src/components/shared/DesktopSidebar.tsx` — persistent left nav at `md+`. Items: Menú, Compra, Recetas, Perfil (Mimo is the floating button). Hides on `/recipes/[id]/cook` routes.
- `<Navbar />` (mobile bottom-nav) carries `md:hidden` on its outer `<nav>`.

### Exceptions (no responsive treatment)

- `/onboarding`, `/auth/*`, `/offline`, `/recipes/[id]/cook` — single-column at all breakpoints.
- Error boundaries `app/error.tsx` ("Algo se ha torcido", inside the app chrome) and `app/global-error.tsx` (replaces the root layout, own `<html>`) — centred single column, editorial tokens (cream, ink, terracotta "Vaya", Fraunces heading), same look as `/offline`. See [errors.md](./errors.md).
- Public site (`/recipes-ona`) uses its own `PublicNavbar` and is unaffected.

### Pragmatic scope vs original plan

The migration (June 2026) shipped the chasis (sidebar at `md+`, container caps) + a `/recipes` catalogue shell (replaced by the "D" filter row on 2026-10-08) + the Vista Semana 7-col grid + page-by-page container widening at `lg+`. The original plan ([docs/superpowers/specs/2026-06-01-responsive-desktop-design.md](../docs/superpowers/specs/2026-06-01-responsive-desktop-design.md)) also called for bespoke per-page splits (38/62 recipe detail with sticky hero, 40/60 form layouts, vertical day-strip + preview rail, sidebar + 3-col aisle grid on `/shopping`, `/profile` tabs shell, `/advisor` side panel — superseded on 2026-10-09 by the Mimo desktop column on every page). The recipe-detail split **shipped on 2026-10-08** as a 50/50 grid with a sticky photo (redesign "D", see `/recipes/[id]` above); the other bespoke layouts are still deferred to follow-up polish PRs — the foundational responsive win is delivered without them, and the editorial splits can land iteratively as taste decisions allow.

## Source

- [apps/web/src/app/globals.css](../apps/web/src/app/globals.css) — `@theme` tokens, all editorial classes
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — fonts, viewport, root layout
- [apps/web/src/app/(public)/page.tsx](../apps/web/src/app/(public)/page.tsx) — editorial reference (landing)
- [apps/web/src/app/(public)/como-funciona/page.tsx](../apps/web/src/app/(public)/como-funciona/page.tsx)
- [apps/web/src/app/recipes/page.tsx](../apps/web/src/app/recipes/page.tsx) — editorial in-app
- [apps/web/src/app/recipes/[id]/page.tsx](../apps/web/src/app/recipes/[id]/page.tsx)
- [apps/web/src/app/menu/page.tsx](../apps/web/src/app/menu/page.tsx) — editorial "D · Luz y foto"
- [apps/web/src/app/menu/history/page.tsx](../apps/web/src/app/menu/history/page.tsx) + [apps/web/src/lib/menuHistory.ts](../apps/web/src/lib/menuHistory.ts) · [apps/web/src/app/cookbooks/[id]/page.tsx](../apps/web/src/app/cookbooks/[id]/page.tsx) — "D" (PRO-43); guarded by `apps/api/src/tests/redesignDHistorialRecetarios.test.ts`
- [apps/web/src/components/shared/Navbar.tsx](../apps/web/src/components/shared/Navbar.tsx) — labelled tab bar
- [apps/web/src/components/shared/PublicNavbar.tsx](../apps/web/src/components/shared/PublicNavbar.tsx)
- [apps/web/src/components/shared/Footer.tsx](../apps/web/src/components/shared/Footer.tsx)
