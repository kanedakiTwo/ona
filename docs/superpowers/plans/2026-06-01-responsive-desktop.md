# ONA — Responsive Towards Desktop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate the ONA web app from mobile-only chrome (`max-w-[430px]` + bottom-nav) to a responsive layout with a desktop sidebar at `md+` and bespoke multi-column layouts at `lg+`, without regressing the mobile experience.

**Architecture:** Five incremental PRs, each independently shippable. PR 1 lands the chasis (sidebar + tokens + page-shell). PRs 2–4 migrate page clusters in order of user-visible value: catalogue → menu → detail/edit/shopping. PR 5 wires `/profile` tabs + `/advisor` side panel and cleans up edge routes.

**Tech Stack:** Next.js 15 App Router · React 19 · Tailwind v4 (`@theme` tokens) · motion/react · @dnd-kit · TanStack Query v5 · TypeScript strict.

**Reference spec:** [`docs/superpowers/specs/2026-06-01-responsive-desktop-design.md`](../specs/2026-06-01-responsive-desktop-design.md)

---

## Conventions used in this plan

- **Breakpoints** (Tailwind defaults): `md=768`, `lg=1024`, `xl=1280`, `2xl=1536`.
- **Mobile invariant**: anything below `md` must remain pixel-identical to today. Every Tailwind class added uses a `md:` or `lg:` prefix; unprefixed classes are mobile and must not change behaviour.
- **Sidebar offset**: `md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))]` — never hardcode `208px`. The token combo lets the gap change without hunting through pages.
- **Typecheck before commit**: every task that touches `.ts`/`.tsx` runs `pnpm --filter @ona/web exec tsc --noEmit` before commit.
- **Manual smoke** at 390 / 768 / 1024 / 1440 px viewports for each touched page. Screenshots at 390 + 1440 pasted into the commit message body.
- **Commit cadence**: one commit per task unless the task explicitly batches related steps. Push at the end of each PR's task chain; deploy via `git push` (Railway auto-deploys `master`).
- **Spec gate**: every PR closes with a spec update (the spec rows live inside each PR's last task).

---

## File structure

### New files

| Path | Responsibility |
|---|---|
| `apps/web/src/components/shared/DesktopSidebar.tsx` | Persistent left nav at `md+`. 5 items (Menú, Compra, Recetas, Asesor, Perfil) + Ona wordmark + isotype. |
| `apps/web/src/components/menu/WeekStripVertical.tsx` | Vertical day-strip variant for `/menu` Vista Día at `lg+`. Renders L M X J V S D top-to-bottom in the page sidebar. |
| `apps/web/src/components/menu/DayPreviewRail.tsx` | Right-rail preview of the next 2 days at `lg+` Vista Día. |
| `apps/web/src/components/recipes/CatalogGrid.tsx` | Extracted card grid sub-tree shared between `/recipes` and `/cookbooks`. |
| `apps/web/src/components/recipes/CatalogFilters.tsx` | Extracted filter chips + search + scope segmenter. Modal on `<lg`, sidebar on `lg+`. |
| `apps/web/src/components/shopping/AisleGrid.tsx` | 3-col aisle grid for `/shopping` at `lg+`. |
| `apps/web/src/components/shopping/ShoppingSidebar.tsx` | Sidebar for `/shopping` at `lg+` (date range, progress, total). |
| `apps/web/src/components/advisor/AdvisorSidePanel.tsx` | Persistent right-side context panel at `lg+` (nutrition summary + memory). |
| `apps/web/src/components/profile/ProfileTabsSidebar.tsx` | Tabs nav for `/profile*` at `lg+`. |
| `apps/web/src/app/profile/layout.tsx` | Detects `lg+`, wraps sub-routes in the tab shell. Falls through to children on `<lg`. |

### Modified files

| Path | Modifications |
|---|---|
| `apps/web/src/app/layout.tsx` | Add `<DesktopSidebar />` next to `<main>` in the authed branch. Add `md:ml-[…]`, `md:pb-0`, `md:max-w-none` to `<main>`. Wrap body in `max-w-[1400px]` container. Add `md:hidden` to bottom-nav (via Navbar). Exclude `/recipes/[id]/cook` from rendering sidebar. |
| `apps/web/src/components/shared/Navbar.tsx` | Add `md:hidden` to the outer `<nav>` element. |
| `apps/web/src/app/globals.css` | Add tokens `--sidebar-width`, `--sidebar-gap`, `--container-max` under `@theme`. Add `.page-shell` regular CSS class (not Tailwind `@layer components`) so it's importable without modifying tailwind.config. |
| `apps/web/src/app/recipes/page.tsx` | Replace inline filter modal + grid with `<CatalogFilters>` + `<CatalogGrid>`. At `lg+`, render 3-col shell (filters sidebar 220 px + grid 4-col). |
| `apps/web/src/app/cookbooks/[id]/page.tsx` | Same as `/recipes` — use the shared `<CatalogGrid>` and `<CatalogFilters>` at `lg+`. |
| `apps/web/src/app/menu/page.tsx` | Vista Semana: 7-col grid at `lg+`. Vista Día: split with `<DayPreviewRail>` + `<WeekStripVertical>` at `lg+`. |
| `apps/web/src/app/recipes/[id]/page.tsx` | At `lg+`, split 38/62 (left: hero + meta + CTAs; right: ingredients 3-col + steps). |
| `apps/web/src/app/recipes/new/page.tsx` | At `lg+`, split 40/60 (left: photo + chips/tags; right: name, times, ingredients, steps, notes). |
| `apps/web/src/app/recipes/[id]/edit/page.tsx` | Same split as `/recipes/new` at `lg+`. |
| `apps/web/src/app/shopping/page.tsx` | At `lg+`, sidebar 200 + 3-col aisle grid + tabs above grid + manual-add full-width below. |
| `apps/web/src/app/advisor/page.tsx` | At `lg+`, chat 60% / `<AdvisorSidePanel>` 40%. |
| `apps/web/src/app/profile/page.tsx` | At `lg+`, hand off chrome to `layout.tsx` (which renders tab sidebar). Mobile unchanged. |
| `apps/web/src/app/profile/memoria/page.tsx`, `apps/web/src/app/profile/creencias/page.tsx`, plus `casa/`, `pantry/`, `staples/`, `cookbooks/`, `sections/` | At `lg+`, render inside the tabs shell (provided by `app/profile/layout.tsx`). Drop their own back-link nav at `lg+`. |
| `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/curator/page.tsx` | Container widens; filter sidebar at `lg+` if 3+ filters. |
| `apps/web/src/app/recipes/[id]/cook/page.tsx` | Add escape hatch: layout-level check excludes `<DesktopSidebar />`. Renders full-screen as today. |

### Spec files updated

- `specs/design-system.md` (PR 1)
- `specs/recipes.md` (PRs 2, 4)
- `specs/menus.md` (PR 3)
- `specs/shopping.md` (PR 4)
- `specs/advisor.md` (PR 5)
- `specs/auth.md` (PR 5 — only if `/profile` shell affects onboarding flow doc)

---

## PR 1 — Chasis (sidebar + tokens + layout)

Lands the global chrome without widening any page. Mobile users see zero change; desktop users see the sidebar appear and the bottom-nav vanish at `md+`, but page content still sits in the 430 px column. This is intentional: it lets us validate the chasis in isolation.

### Task 1.1: Add CSS tokens for sidebar + container

**Files:**
- Modify: `apps/web/src/app/globals.css` (under `@theme { … }`)

- [ ] **Step 1: Add the three tokens**

Edit `apps/web/src/app/globals.css`, locate the `@theme` block. Add right after the `--radius-full: 9999px;` line:

```css
  /* ── Layout ───────────────────────────────── */
  --sidebar-width: 200px;
  --sidebar-gap: 8px;
  --container-max: 1400px;
```

- [ ] **Step 2: Add `.page-shell` utility class**

After the closing `@theme` brace, add (outside any `@layer`):

```css
/* Per-page wrapper — page-shell standardises the auth-route container.
   Each page sets its own max-w via inline class. */
.page-shell {
  width: 100%;
  margin-inline: auto;
  padding-inline: 20px;
  padding-bottom: 48px;
}
```

- [ ] **Step 3: Typecheck**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS (no .ts changes; sanity check only).

- [ ] **Step 4: Visual smoke**

Run dev server (`pnpm --filter @ona/web dev`), open `http://localhost:3000/menu`. Confirm: cream background, no visible change. The new tokens are unused yet — purely additive.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/globals.css
git commit -m "feat(layout): tokens for responsive desktop chasis (--sidebar-width, --sidebar-gap, --container-max, .page-shell)"
```

### Task 1.2: Build `<DesktopSidebar />`

**Files:**
- Create: `apps/web/src/components/shared/DesktopSidebar.tsx`

- [ ] **Step 1: Scaffold the component**

Create `apps/web/src/components/shared/DesktopSidebar.tsx` with:

```tsx
"use client"

import { usePathname } from "next/navigation"
import { useAuth } from "@/lib/auth"
import { haptic } from "@/lib/pwa/haptics"
import { TransitionLink } from "@/components/pwa/TransitionLink"
import { CalendarDays, ShoppingCart, BookOpen, MessageCircle, User } from "lucide-react"

const NAV_ITEMS = [
  { href: "/menu", label: "Menú", icon: CalendarDays },
  { href: "/shopping", label: "Compra", icon: ShoppingCart },
  { href: "/recipes", label: "Recetas", icon: BookOpen },
  { href: "/advisor", label: "Asesor", icon: MessageCircle },
  { href: "/profile", label: "Perfil", icon: User },
]

export default function DesktopSidebar() {
  const { user } = useAuth()
  const pathname = usePathname()

  if (!user) return null
  if (pathname?.includes("/cook")) return null

  return (
    <aside
      className="fixed inset-y-0 left-0 z-40 hidden w-[var(--sidebar-width)] flex-col border-r border-[#DDD6C5] bg-[#FFFEFA]/95 px-3 py-6 backdrop-blur-md md:flex"
      aria-label="Navegación principal"
    >
      <div className="mb-8 px-3">
        <span
          className="font-[family-name:var(--font-italic)] text-[26px] italic leading-none text-[#1A1612]"
        >
          Ona
        </span>
      </div>
      <nav className="flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon
          const isActive = pathname?.startsWith(item.href) ?? false
          return (
            <TransitionLink
              key={item.href}
              href={item.href}
              onClick={() => { if (!isActive) haptic.light() }}
              className={`flex items-center gap-3 rounded-full px-3 py-2 text-[13px] transition-colors ${
                isActive
                  ? "bg-[#1A1612] text-[#FAF6EE]"
                  : "text-[#4A4239] hover:bg-[#F2EDE0]"
              }`}
              aria-current={isActive ? "page" : undefined}
            >
              <Icon size={16} strokeWidth={isActive ? 2 : 1.6} />
              <span>{item.label}</span>
            </TransitionLink>
          )
        })}
      </nav>
    </aside>
  )
}
```

Notes for the implementer:
- The component mirrors `Navbar.tsx`: same auth gate, same haptic, same TransitionLink. Don't introduce a new abstraction.
- `pathname.includes("/cook")` is the escape hatch for full-screen cook mode — the spec calls this out.
- No isotype yet — we add the ink-drop SVG as a later polish task once a stable inline SVG is available.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/shared/DesktopSidebar.tsx
git commit -m "feat(layout): DesktopSidebar component (md+ persistent left nav)"
```

### Task 1.3: Mount sidebar + adjust `<main>` in root layout

**Files:**
- Modify: `apps/web/src/app/layout.tsx` (authed branch, around line 116)

- [ ] **Step 1: Import the sidebar**

Add to the imports at the top:

```tsx
import DesktopSidebar from "@/components/shared/DesktopSidebar"
```

- [ ] **Step 2: Wrap auth branch with the chasis**

Replace the authed branch (currently `<VoiceProvider> … </VoiceProvider>`) with:

```tsx
<VoiceProvider>
  <OfflineBanner />
  <div className="mx-auto max-w-[var(--container-max)]">
    <DesktopSidebar />
    <main className="standalone-pt mx-auto max-w-[430px] pb-20 md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))] md:max-w-none md:mr-0 md:pb-0">
      <SwipeNavigator>
        <PageTransition>{children}</PageTransition>
      </SwipeNavigator>
    </main>
    <Navbar />
    <InstallSheet />
  </div>
</VoiceProvider>
```

Notes:
- `md:max-w-none` undoes the mobile 430 px cap once the sidebar appears.
- `md:ml-[calc(...)]` uses the token combo — never `md:ml-[208px]`.
- `md:mr-0` cancels the `mx-auto` so the page reads from sidebar edge → right.
- The mobile branches (`mx-auto`, `max-w-[430px]`, `pb-20`) stay unprefixed and are untouched at `< md`.

- [ ] **Step 3: Hide bottom-nav at `md+`**

Edit `apps/web/src/components/shared/Navbar.tsx` line 25:

```diff
-    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-[max(env(safe-area-inset-bottom),12px)]">
+    <nav className="fixed bottom-0 left-0 right-0 z-50 pb-[max(env(safe-area-inset-bottom),12px)] md:hidden">
```

- [ ] **Step 4: Typecheck**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual smoke at 4 viewports**

`pnpm --filter @ona/web dev`, navigate to `/menu`:

- 390 × 844: no sidebar, bottom-nav present, content in 430 px column. **Must look identical to today.**
- 768 × 1024: sidebar appears on the left, bottom-nav gone, content still 430 px column shifted right.
- 1024 × 768: same as 768 but more empty space to the right of the content column.
- 1440 × 900: sidebar + content, ample empty cream to the right of the column (expected — pages widen in their own PRs).

Take screenshots at 390 + 1440 for the commit message.

- [ ] **Step 6: Verify `/cook` opts out**

Navigate to any recipe → "Empezar a cocinar". The sidebar must not appear at any viewport. The cook view is full-bleed.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/layout.tsx apps/web/src/components/shared/Navbar.tsx
git commit -m "feat(layout): mount DesktopSidebar at md+, hide bottom-nav, shift main"
```

### Task 1.4: Update `specs/design-system.md` with the responsive section

**Files:**
- Modify: `specs/design-system.md`

- [ ] **Step 1: Add a new section "Responsive towards desktop"**

Append to `specs/design-system.md` (before the `## Source` section, if present, otherwise at the end):

```markdown
## Responsive towards desktop

ONA supports a desktop layout at `md+` (≥768 px) and bespoke multi-column pages at `lg+` (≥1024 px). Mobile behaviour is unchanged.

### Breakpoint matrix

| Range | Layout |
|---|---|
| `< md` (≤767 px) | Bottom-nav fixed at viewport bottom, content in `max-w-[430px] mx-auto` column. |
| `md` (768–1023 px) | `<DesktopSidebar />` appears (200 px wide), bottom-nav hidden, `<main>` shifted right via `md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))]`. Pages stay single-column. |
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
```

- [ ] **Step 2: Typecheck (sanity)**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add specs/design-system.md
git commit -m "docs(spec): design-system gets responsive desktop section (PR 1)"
```

### Task 1.5: Ship PR 1

- [ ] **Step 1: Push and verify deploy**

```bash
git push origin master
```

Watch Railway dashboard for build success. Open production URL at 390 + 1440 to confirm chasis lands.

- [ ] **Step 2: Mark PR 1 done**

Move on to PR 2.

---

## PR 2 — `/recipes` and `/cookbooks` catalogue

Extracts the catalogue card grid + filters into shared components, then applies the 3-col shell at `lg+`. Mobile and `md` keep the existing modal-filter flow.

### Task 2.1: Extract `<CatalogFilters />` and `<CatalogGrid />`

**Files:**
- Create: `apps/web/src/components/recipes/CatalogGrid.tsx`
- Create: `apps/web/src/components/recipes/CatalogFilters.tsx`
- Modify: `apps/web/src/app/recipes/page.tsx`

- [ ] **Step 1: Identify the sub-trees to extract**

Open `apps/web/src/app/recipes/page.tsx`. Two sections will move out:
1. The cards-grid block (the `grid` element rendering `RecipeCard` items + skeletons + empty state) → `<CatalogGrid>`.
2. The filter UI block (search input + meal chips + season chips + frequency chips + tag list + scope segmenter Todas/Mis/ONA) → `<CatalogFilters>`.

The page currently composes these inline; the goal is a non-invasive extraction that preserves behaviour.

- [ ] **Step 2: Create `<CatalogGrid />`**

Before writing this component: open `apps/web/src/app/recipes/page.tsx` around line 365 — the existing inline card uses `{ recipe: any; userId?: string }`. The catalogue does not currently have a strict shared type for the recipe row. Match that shape: keep the prop loose (`any` for the recipe row is acceptable here since the existing page already uses it) or type it against `RecipeCardRecipe` defined inline at `apps/web/src/components/recipes/RecipeCard.tsx:22` if you prefer typed.

`apps/web/src/components/recipes/CatalogGrid.tsx`:

```tsx
"use client"

import { RecipeCard } from "@/components/recipes/RecipeCard"

type Props = {
  recipes: any[]                // matches the existing /recipes/page.tsx shape
  userId?: string
  isLoading?: boolean
  emptyState?: React.ReactNode
}

export default function CatalogGrid({ recipes, userId, isLoading, emptyState }: Props) {
  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="aspect-[3/4] animate-pulse rounded-xl bg-[#F2EDE0]" />
        ))}
      </div>
    )
  }
  if (!recipes.length) return <>{emptyState}</>
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {recipes.map((r) => (
        <RecipeCard key={r.id} recipe={r} userId={userId} />
      ))}
    </div>
  )
}
```

Note: `RecipeCard.tsx` exports a named `RecipeCard` (not default) — see line 42. The import is `import { RecipeCard }` not `import RecipeCard`.

- [ ] **Step 3: Create `<CatalogFilters />`**

`apps/web/src/components/recipes/CatalogFilters.tsx`:

Move the entire filter UI as-is from `/recipes/page.tsx` (including the search input, scope segmenter, chip rows). Receive state via props:

```tsx
"use client"

type Props = {
  search: string
  onSearch: (s: string) => void
  scope: "all" | "mine" | "ona"
  onScope: (s: "all" | "mine" | "ona") => void
  meal: string | null
  onMeal: (m: string | null) => void
  season: string | null
  onSeason: (s: string | null) => void
  frequency: string | null
  onFrequency: (f: string | null) => void
  tags: string[]
  selectedTags: string[]
  onToggleTag: (t: string) => void
  variant: "modal" | "sidebar"
}

export default function CatalogFilters({ variant, ... }: Props) {
  // Inline existing JSX from /recipes/page.tsx. The only difference
  // between variants is the outer wrapper:
  //   modal  → fixed-positioned bottom sheet (existing behaviour)
  //   sidebar → static block, no fixed positioning
  //
  // Do NOT replicate two JSX trees — render the same chips inside a
  // single tree, with a `variant` ternary on the wrapper className.
}
```

The implementer should: open `/recipes/page.tsx`, copy the filter JSX verbatim, identify the state setters used (already in the page), forward them as props.

- [ ] **Step 4: Refactor `/recipes/page.tsx` to use the new components**

In `/recipes/page.tsx`, replace the inline grid with:

```tsx
<CatalogGrid recipes={filtered} isLoading={isLoading} emptyState={<EmptyState />} />
```

Replace the inline filter UI with:

```tsx
<CatalogFilters variant="modal" {... all the state and setters ...} />
```

The page should now be ~100 lines shorter. State stays in the page; the components are presentational.

- [ ] **Step 5: Typecheck**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Manual smoke at 390 + 768**

Open `/recipes` at 390 × 844 and 768 × 1024. Behaviour MUST be identical to before: modal filter opens, chips toggle, cards render, scope segmenter switches. No layout change yet at `lg`.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/recipes/CatalogGrid.tsx \
        apps/web/src/components/recipes/CatalogFilters.tsx \
        apps/web/src/app/recipes/page.tsx
git commit -m "refactor(recipes): extract CatalogGrid + CatalogFilters from /recipes page"
```

### Task 2.2: Apply 3-col shell to `/recipes` at `lg+`

**Files:**
- Modify: `apps/web/src/app/recipes/page.tsx`

- [ ] **Step 1: Wrap the page body in a responsive shell**

Replace the page's outer `<div className="mx-auto max-w-[430px] px-5 pb-20">` (or equivalent) with:

```tsx
<div className="page-shell max-w-[430px] md:max-w-[720px] lg:max-w-none lg:px-8">
  <header>...</header>
  <div className="mt-6 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
    <aside className="hidden lg:block">
      <CatalogFilters variant="sidebar" {...filterProps} />
    </aside>
    <div>
      {/* The mobile filter modal trigger stays here, hidden on lg+ */}
      <div className="lg:hidden">
        <FilterModalTrigger ... />
      </div>
      <CatalogGrid recipes={filtered} isLoading={isLoading} emptyState={<EmptyState />} />
    </div>
  </div>
</div>
```

Notes:
- `lg:max-w-none` lets the grid use the full available width minus the sidebar.
- The filter sidebar is `hidden lg:block`; the modal trigger is the inverse.
- `CatalogFilters` is mounted twice in the JSX with different `variant` props — only one is visible at any breakpoint.

- [ ] **Step 2: Typecheck**

Run: `pnpm --filter @ona/web exec tsc --noEmit`
Expected: PASS.

- [ ] **Step 3: Manual smoke at 4 viewports**

- 390: modal filter unchanged, 2-col grid unchanged.
- 768: same content widened, still 2-col grid (lg: prefix means 4-col only above 1024).
- 1024: sidebar appears, filters always visible, grid becomes 4-col.
- 1440: same as 1024 with more horizontal real estate.

Verify: chip selection in the sidebar at 1024+ filters the grid in the same frame, no full-page reload, no jank.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/recipes/page.tsx
git commit -m "feat(recipes): 3-col shell at lg+ (filters sidebar + 4-col card grid)"
```

### Task 2.3: Apply the same shell to `/cookbooks/[id]`

**Files:**
- Modify: `apps/web/src/app/cookbooks/[id]/page.tsx`

- [ ] **Step 1: Identify reusable pieces**

`/cookbooks/[id]` already renders a recipe catalogue scoped to the cookbook. Open it and confirm it uses similar (or duplicated) filter + grid JSX. If yes, refactor to consume `<CatalogGrid>` (and `<CatalogFilters>` if filters are present here too).

- [ ] **Step 2: Wrap in the same responsive shell**

Reproduce the wrapper structure from `/recipes/page.tsx` (3-col at lg+, sidebar `hidden lg:block`, modal `lg:hidden`).

- [ ] **Step 3: Typecheck + smoke**

Same checks as Task 2.2 but at `/cookbooks/<a_real_id>`.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/cookbooks/[id]/page.tsx
git commit -m "feat(cookbooks): adopt CatalogGrid + 3-col shell at lg+"
```

### Task 2.4: Update `specs/recipes.md` for PR 2

**Files:**
- Modify: `specs/recipes.md`

- [ ] **Step 1: Add a desktop layout note**

Locate the section describing the catalogue page. Add a sub-section:

```markdown
### Desktop layout (lg+)

The catalogue page renders a 3-column shell: app sidebar (200 px) · filter sidebar (220 px) · card grid (4 cols). The filter modal flow remains on `< lg` viewports. The shared components `<CatalogGrid>` and `<CatalogFilters>` are also used by `/cookbooks/[id]`.
```

- [ ] **Step 2: Commit**

```bash
git add specs/recipes.md
git commit -m "docs(spec): recipes.md gets desktop layout note (PR 2)"
```

### Task 2.5: Ship PR 2

- [ ] **Step 1: Push + verify**

```bash
git push origin master
```

Open production `/recipes` at 1440. Confirm the filter sidebar appears, search + chips work, 4-col grid renders. Open at 390 to confirm mobile unchanged.

---

## PR 3 — `/menu` Vista Día + Vista Semana

Two desktop layouts inside the same page, gated by the existing view-mode toggle.

### Task 3.1: Vista Semana — 7-col grid at `lg+`

**Files:**
- Modify: `apps/web/src/components/menu/WeekGridView.tsx`

- [ ] **Step 1: Inspect current `WeekGridView` rendering**

The component currently renders one row per day, each row holding meal slots horizontally. At `lg+` we want it inverted: one column per day, slots stacked vertically.

- [ ] **Step 2: Add a `lg:` grid wrapper**

Find the outer container in `WeekGridView.tsx` (the wrapper around the 7 day rows). Replace its className with a structure like:

```tsx
<div className="space-y-4 lg:grid lg:grid-cols-7 lg:gap-3 lg:space-y-0">
  {days.map((day) => (
    <DayColumn key={day.iso} day={day} ... />
  ))}
</div>
```

The existing `DayColumn` (or whatever name the file uses for the per-day block) needs minor className adjustments:
- At `lg+` each column becomes vertical instead of horizontal: meal slots stack with `flex flex-col gap-2`.
- The day header (label "L 25") sits at the top of the column at `lg+`, with a subtle terracotta tint via `lg:bg-[#FDEEE8]` when `isToday`.

- [ ] **Step 3: DnD verification (advisor recommendation 3)**

The grid uses `@dnd-kit` with `useDroppable` on each slot row (see `WeekGridView.tsx:426`). Confirm that:
1. Droppable IDs are still scoped per `{day, mealType}` and not per "row" (so cross-column drops work).
2. `pointerWithin` collision detection still finds the right target when slots are in columns rather than rows.

Manual DnD test at 1440 × 900:
- Drag a meal from Monday lunch to Wednesday dinner. Expected: card moves, network request to `/menu/move-slot` fires, no flicker.
- Drag within the same column (Monday lunch → Monday breakfast). Expected: works as today.

If a regression appears, do NOT change the API. Adjust the front-end wiring (`useDroppable` arguments) only.

- [ ] **Step 4: Typecheck + smoke**

Run: `pnpm --filter @ona/web exec tsc --noEmit`

Manual smoke at:
- 390: existing horizontal day-stack unchanged.
- 768: same as 390 but widened.
- 1024: 7-col grid renders. Today's column tinted.
- 1440: same as 1024.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/menu/WeekGridView.tsx
git commit -m "feat(menu): Vista Semana 7-col grid at lg+ (DnD verified)"
```

### Task 3.2: Vista Día — split with preview rail + vertical day-strip

**Files:**
- Create: `apps/web/src/components/menu/WeekStripVertical.tsx`
- Create: `apps/web/src/components/menu/DayPreviewRail.tsx`
- Modify: `apps/web/src/app/menu/page.tsx`

- [ ] **Step 1: Build `<WeekStripVertical />`**

`apps/web/src/components/menu/WeekStripVertical.tsx`:

A vertical clone of `WeekStrip.tsx` — same props, same active-day indicator, but oriented top-to-bottom. Use `flex flex-col gap-2` and a left-pill active indicator instead of a bottom-bar one.

```tsx
"use client"

import { motion } from "motion/react"

type Day = { iso: string; weekday: string; dayNum: number; isToday: boolean }

type Props = {
  days: Day[]
  activeIso: string
  onSelect: (iso: string) => void
}

export default function WeekStripVertical({ days, activeIso, onSelect }: Props) {
  return (
    <div className="flex flex-col gap-1">
      {days.map((d) => {
        const isActive = d.iso === activeIso
        return (
          <button
            key={d.iso}
            onClick={() => onSelect(d.iso)}
            className={`relative flex items-center gap-3 rounded-r-full px-3 py-2 text-left text-[12px] uppercase tracking-[0.1em] transition-colors ${
              isActive ? "bg-[#1A1612] text-[#FAF6EE]" : "text-[#7A7066] hover:bg-[#F2EDE0]"
            }`}
            aria-current={isActive ? "true" : undefined}
          >
            <span className="w-6 font-medium">{d.weekday}</span>
            <span className="font-[family-name:var(--font-italic)] text-[15px] italic">
              {d.dayNum}
            </span>
            {d.isToday && (
              <span className="ml-auto rounded-full bg-[#C65D38] px-2 py-[2px] text-[8px] uppercase tracking-[0.15em] text-[#FAF6EE]">
                hoy
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
```

- [ ] **Step 2: Build `<DayPreviewRail />`**

Before writing: inspect `apps/web/src/app/menu/page.tsx` for the day-plan shape feeding the Vista Día view. Find where the day list is built (the variable will be passed into the day-stack render, look for `.map(day =>`) and read the actual fields available — slot ids, recipe names, thumbnail paths. There is no `DayPlan` type exported from `@ona/shared`; the shape lives inline in the menu page or the `useMenu` hook. Reuse those property names verbatim in the component below.

`apps/web/src/components/menu/DayPreviewRail.tsx`:

```tsx
"use client"

type DayPreview = {
  iso: string
  weekday: string
  dateLabel: string
  slots: { id: string; recipeName?: string | null; thumbnailUrl?: string | null }[]
}

type Props = {
  days: DayPreview[]            // next 2 days
  onJumpToDay: (iso: string) => void
}

export default function DayPreviewRail({ days, onJumpToDay }: Props) {
  return (
    <aside className="flex flex-col gap-4">
      <h2 className="font-[family-name:var(--font-italic)] text-[18px] italic text-[#1A1612]">
        Próximos días
      </h2>
      {days.map((d) => (
        <button
          key={d.iso}
          onClick={() => onJumpToDay(d.iso)}
          className="flex flex-col gap-1 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-4 py-3 text-left transition-colors hover:bg-[#F2EDE0]"
        >
          <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
            {d.weekday} · {d.dateLabel}
          </span>
          <div className="mt-1 flex flex-col gap-1">
            {d.slots.map((s) => (
              <div key={s.id} className="flex items-center gap-2 text-[12px] text-[#1A1612]">
                {s.thumbnailUrl && (
                  <img src={s.thumbnailUrl} alt="" className="h-6 w-6 rounded-md object-cover" />
                )}
                <span className="truncate">{s.recipeName ?? "—"}</span>
              </div>
            ))}
          </div>
        </button>
      ))}
    </aside>
  )
}
```

If the real slot shape in `apps/web/src/app/menu/page.tsx` differs from `{id, recipeName, thumbnailUrl}`, either rename the `DayPreview` fields to match OR build an adapter in the consumer page that maps the real shape to `DayPreview`. Don't change the menu page's data shape upstream — keep the component the only thing that adapts.

- [ ] **Step 3: Wire the new components into Vista Día at `lg+`**

In `apps/web/src/app/menu/page.tsx`, locate the Vista Día render branch. Wrap it in a responsive shell:

```tsx
<div className="lg:grid lg:grid-cols-[60px_minmax(0,1fr)_320px] lg:gap-6">
  <aside className="hidden lg:block">
    <WeekStripVertical days={weekDays} activeIso={activeIso} onSelect={setActiveIso} />
  </aside>
  <div>
    {/* Existing scrollable day stack — unchanged */}
    {dayStack}
  </div>
  <div className="hidden lg:block">
    <DayPreviewRail days={previewDays} onJumpToDay={setActiveIso} />
  </div>
</div>
```

The existing top-sticky `WeekStrip` (horizontal) should keep rendering at `< lg` and hide at `lg+`:

```tsx
<div className="lg:hidden">
  <WeekStrip ... />
</div>
```

- [ ] **Step 4: Typecheck + smoke**

Manual at all 4 viewports. Critical checks:
- 390/768: existing scrollable day stack + sticky horizontal strip.
- 1024/1440: vertical strip on the left, scrollable day stack in the middle, preview rail on the right. Clicking strip OR preview scrolls the middle column to the picked day.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/menu/WeekStripVertical.tsx \
        apps/web/src/components/menu/DayPreviewRail.tsx \
        apps/web/src/app/menu/page.tsx
git commit -m "feat(menu): Vista Día gets vertical strip + day preview rail at lg+"
```

### Task 3.3: Update `specs/menus.md`

**Files:**
- Modify: `specs/menus.md`

- [ ] **Step 1: Add desktop layouts section**

Append to `specs/menus.md`:

```markdown
### Desktop layouts (lg+)

**Vista Semana**: 7-column grid, one column per day Mon-Sun. Today's column has a soft terracotta tint. DnD between any two cells works as before via `POST /menu/move-slot`.

**Vista Día**: three-column layout — vertical day-strip (60 px) · scrollable day stack (flex) · day-preview rail (320 px). The preview rail shows the next 2 days as compact cards; clicking a preview card scrolls the stack to that day.

Below `lg`, both views keep their existing single-column / horizontal-strip layouts.
```

- [ ] **Step 2: Commit**

```bash
git add specs/menus.md
git commit -m "docs(spec): menus.md gets desktop layouts (PR 3)"
```

### Task 3.4: Ship PR 3

- [ ] **Step 1: Push + verify production**

```bash
git push origin master
```

At 1440, switch between Vista Semana ↔ Vista Día and confirm both desktop layouts render. Drag a meal across columns in Vista Semana on prod to confirm DnD survives the deploy.

---

## PR 4 — `/recipes/[id]`, `/recipes/new`, `/recipes/[id]/edit`, `/shopping`

Four pages share the "split layout at lg+" pattern. Done in one PR so the visual consistency lands together.

### Task 4.1: `/recipes/[id]` — split 38/62

**Files:**
- Modify: `apps/web/src/app/recipes/[id]/page.tsx`

- [ ] **Step 1: Inspect the current single-column layout**

The page stacks: hero photo → header (title, meta) → comensales → tags → equipment → CTAs → ingredients → steps → notes. Identify the split point: everything from hero through CTAs goes left, everything from ingredients onward goes right.

- [ ] **Step 2: Apply the split wrapper**

Wrap the existing JSX such that at `lg+`:

```tsx
<div className="page-shell max-w-[430px] md:max-w-[840px] lg:max-w-[1100px]">
  <div className="lg:grid lg:grid-cols-[38fr_62fr] lg:gap-10">
    <div className="lg:sticky lg:top-6 lg:self-start">
      {/* hero + header + meta + comensales + tags + equipment + CTAs */}
    </div>
    <div>
      <section>
        <h2>Ingredientes</h2>
        <div className="lg:grid lg:grid-cols-3 lg:gap-x-6">
          {/* ingredient list — 3 internal columns at lg+ */}
        </div>
      </section>
      <section>
        <h2>Pasos</h2>
        {/* steps */}
      </section>
    </div>
  </div>
  {/* Notes / Substituciones / Storage stay full-width at the bottom */}
  <div className="mt-12">{notes}</div>
</div>
```

Notes:
- `lg:sticky lg:top-6` keeps the photo + CTAs visible as the user scrolls through ingredients/steps — desktop-only ergonomic win.
- The ingredient list must convert to 3 columns ONLY at `lg+` (`grid-cols-3`). At `md` it stays 1 column.

- [ ] **Step 3: Typecheck + smoke**

Manual at 4 viewports. Critical: the "Empezar a cocinar" button must remain reachable at all viewports (regression Miguel hit in an earlier session).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/recipes/[id]/page.tsx
git commit -m "feat(recipes): recipe detail 38/62 split at lg+ with sticky hero"
```

### Task 4.2: `/recipes/new` — split 40/60

**Files:**
- Modify: `apps/web/src/app/recipes/new/page.tsx`

- [ ] **Step 1: Plan the split**

Left (40%): Photo section + Tipo de comida chips + Temporada chips + Planificación chips + Tags.
Right (60%): Nombre, Tiempos/Comensales, Source URL, Ingredientes, Pasos, Notas, Dificultad.
Bottom (full width): "Guardar" + "Guardar igualmente" buttons.

- [ ] **Step 2: Apply the split wrapper**

```tsx
<div className="page-shell max-w-[430px] md:max-w-[780px] lg:max-w-[1100px]">
  <header>...</header>
  <form onSubmit={...}>
    <div className="lg:grid lg:grid-cols-[40fr_60fr] lg:gap-10">
      <div className="space-y-6">
        {/* photo + chips + tags */}
      </div>
      <div className="space-y-6">
        {/* name + times + ingredients + steps + notes */}
      </div>
    </div>
    <div className="mt-8 flex flex-col gap-2 lg:flex-row lg:justify-end">
      {/* submit buttons */}
    </div>
  </form>
</div>
```

- [ ] **Step 3: Typecheck + smoke**

Verify at 1440: photo upload works, chip toggles work, ingredient add/remove works, drag-and-drop steps still works (uses `@dnd-kit/sortable` — same dependency as Vista Semana, but a different sortable context).

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/recipes/new/page.tsx
git commit -m "feat(recipes): create-recipe form 40/60 split at lg+"
```

### Task 4.3: `/recipes/[id]/edit` — same split as `/new`

**Files:**
- Modify: `apps/web/src/app/recipes/[id]/edit/page.tsx`

- [ ] **Step 1: Mirror the split**

The edit form mirrors the create form (same fields). Apply the identical wrapper from Task 4.2.

- [ ] **Step 2: Typecheck + smoke**

Verify edit flow on an existing recipe at 1440. Confirm: save persists, "Guardar igualmente" force-save still works on lint warnings, drag-and-drop ingredients/steps still works.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/recipes/[id]/edit/page.tsx
git commit -m "feat(recipes): edit-recipe form 40/60 split at lg+ (mirrors /new)"
```

### Task 4.4: `/shopping` — sidebar + 3-col aisle grid

**Files:**
- Create: `apps/web/src/components/shopping/AisleGrid.tsx`
- Create: `apps/web/src/components/shopping/ShoppingSidebar.tsx`
- Modify: `apps/web/src/app/shopping/page.tsx`

- [ ] **Step 1: Build `<ShoppingSidebar />`**

`apps/web/src/components/shopping/ShoppingSidebar.tsx`:

```tsx
"use client"

type Props = {
  dateRangeControls: React.ReactNode  // existing range pickers as children
  progress: { checked: number; total: number }
  totalEstimated: string | null
}

export default function ShoppingSidebar({ dateRangeControls, progress, totalEstimated }: Props) {
  const pct = progress.total === 0 ? 0 : (progress.checked / progress.total) * 100
  return (
    <aside className="flex flex-col gap-6">
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">Rango</h3>
        <div className="mt-2">{dateRangeControls}</div>
      </section>
      <section>
        <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">Progreso</h3>
        <div className="mt-2 font-[family-name:var(--font-italic)] text-[28px] italic text-[#1A1612]">
          {progress.checked}/{progress.total}
        </div>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[#F2EDE0]">
          <div className="h-full bg-[#1A1612]" style={{ width: `${pct}%` }} />
        </div>
      </section>
      {totalEstimated && (
        <section>
          <h3 className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">Total estimado</h3>
          <div className="mt-2 font-[family-name:var(--font-italic)] text-[20px] italic text-[#C65D38]">
            {totalEstimated}
          </div>
        </section>
      )}
    </aside>
  )
}
```

- [ ] **Step 2: Build `<AisleGrid />`**

`apps/web/src/components/shopping/AisleGrid.tsx`:

```tsx
"use client"

import type { ShoppingItem } from "@ona/shared"

type AisleGroup = { aisle: string; items: ShoppingItem[] }

type Props = {
  groups: AisleGroup[]
  onToggle: (id: string) => void
  ItemRow: React.ComponentType<{ item: ShoppingItem; onToggle: () => void }>
}

export default function AisleGrid({ groups, onToggle, ItemRow }: Props) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      {groups.map((g) => (
        <section key={g.aisle}>
          <h3 className="mb-2 text-[11px] uppercase tracking-[0.15em] text-[#C65D38]">
            {g.aisle}
          </h3>
          <div className="space-y-1">
            {g.items.map((item) => (
              <ItemRow
                key={item.id}
                item={item}
                onToggle={() => onToggle(item.id)}
              />
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
```

`ItemRow` is injected (not hard-coded) so the page can reuse its existing row component without duplication.

- [ ] **Step 3: Refactor `/shopping/page.tsx` to use the new layout**

In `/shopping/page.tsx`, wrap the body:

```tsx
<div className="page-shell max-w-[430px] md:max-w-[840px] lg:max-w-[1240px]">
  <header>{tabsByCompradoEnCasa}</header>
  <div className="lg:grid lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-8">
    <div className="hidden lg:block">
      <ShoppingSidebar
        dateRangeControls={<DateRangeControls ... />}
        progress={{ checked, total }}
        totalEstimated={totalEstimated}
      />
    </div>
    <div>
      {/* Mobile-only range/progress strip — hidden at lg+ */}
      <div className="lg:hidden">{mobileRangeAndProgress}</div>
      <AisleGrid groups={groups} onToggle={handleToggle} ItemRow={ShoppingItemRow} />
      <div className="mt-8">{manualAddForm}</div>
    </div>
  </div>
</div>
```

- [ ] **Step 4: Typecheck + smoke**

Manual at 4 viewports. Critical: checking an item must NOT cause a page reload (regression Miguel hit before — stable IDs in shopping items). Use `setQueriesData` patching as today.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/shopping/AisleGrid.tsx \
        apps/web/src/components/shopping/ShoppingSidebar.tsx \
        apps/web/src/app/shopping/page.tsx
git commit -m "feat(shopping): sidebar + 3-col aisle grid at lg+"
```

### Task 4.5: Update specs for PR 4

**Files:**
- Modify: `specs/recipes.md`
- Modify: `specs/shopping.md`

- [ ] **Step 1: `specs/recipes.md` — add detail and edit layouts**

Append:

```markdown
### Detail page desktop layout (lg+)

The recipe detail page splits 38/62: left column holds the hero photo (sticky), header, meta, comensales, tags, equipment, CTAs (Editar, Cocinar). Right column holds Ingredientes (3 sub-columns) and Pasos. Notes / Substituciones / Storage sit full-width below.

### Create/Edit form desktop layout (lg+)

`/recipes/new` and `/recipes/[id]/edit` use a 40/60 split: left column for photo + Tipo de comida chips + Temporada chips + Planificación chips + Tags. Right column for Nombre, Tiempos/Comensales, Source URL, Ingredientes, Pasos, Notas, Dificultad. Submit buttons sit full-width at the bottom.
```

- [ ] **Step 2: `specs/shopping.md` — add desktop layout**

Append:

```markdown
### Desktop layout (lg+)

`/shopping` renders a 2-column shell: left sidebar (200 px) for date range pickers, progress widget (e.g. "12/44"), total estimated card. Main area shows a 3-column aisle grid where each column is one pasillo (Frutas y verduras, Despensa, Lácteos, etc). Tabs "Por comprar / Ya en casa" sit above the grid. Manual-add form sits below the grid, full width.
```

- [ ] **Step 3: Commit**

```bash
git add specs/recipes.md specs/shopping.md
git commit -m "docs(spec): recipes.md + shopping.md desktop layouts (PR 4)"
```

### Task 4.6: Ship PR 4

- [ ] **Step 1: Push + verify**

```bash
git push origin master
```

At 1440 prod: open a recipe detail, the create form, the edit form, and /shopping. Confirm each desktop layout renders correctly. Open at 390 to confirm no mobile regression.

---

## PR 5 — `/profile` tabs + `/advisor` side panel + cleanup

### Task 5.1: `/profile` tabs shell at `lg+`

**Files:**
- Create: `apps/web/src/app/profile/layout.tsx`
- Create: `apps/web/src/components/profile/ProfileTabsSidebar.tsx`
- Modify: each profile sub-route page (`page.tsx`, `memoria/page.tsx`, `creencias/page.tsx`, `casa/page.tsx`, `pantry/page.tsx`, `staples/page.tsx`, `cookbooks/page.tsx`, `sections/page.tsx`)

- [ ] **Step 1: Build `<ProfileTabsSidebar />`**

`apps/web/src/components/profile/ProfileTabsSidebar.tsx`:

```tsx
"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"

const TABS = [
  { href: "/profile", label: "Físico" },
  { href: "/profile/casa", label: "Hogar" },
  { href: "/profile/sections", label: "Plantilla semanal" },
  { href: "/profile/pantry", label: "Despensa" },
  { href: "/profile/staples", label: "Imprescindibles" },
  { href: "/profile/cookbooks", label: "Cookbooks" },
  { href: "/profile/memoria", label: "Memoria" },
  { href: "/profile/creencias", label: "Creencias" },
]

export default function ProfileTabsSidebar() {
  const pathname = usePathname()
  return (
    <aside className="flex flex-col gap-1">
      <h2 className="mb-4 font-[family-name:var(--font-italic)] text-[20px] italic text-[#1A1612]">
        Perfil
      </h2>
      {TABS.map((t) => {
        const isActive = pathname === t.href
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`rounded-full px-3 py-2 text-[13px] transition-colors ${
              isActive
                ? "bg-[#1A1612] text-[#FAF6EE]"
                : "text-[#4A4239] hover:bg-[#F2EDE0]"
            }`}
            aria-current={isActive ? "page" : undefined}
          >
            {t.label}
          </Link>
        )
      })}
    </aside>
  )
}
```

Note: `usePathname() === t.href` (exact match) not `startsWith` — `/profile/memoria` and `/profile` must not both light up.

- [ ] **Step 2: Create `/profile/layout.tsx`**

`apps/web/src/app/profile/layout.tsx`:

```tsx
import ProfileTabsSidebar from "@/components/profile/ProfileTabsSidebar"

export default function ProfileLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* Mobile + md: layout passes through, each page renders standalone. */}
      <div className="lg:hidden">{children}</div>

      {/* lg+: tabs sidebar + active page content side by side. */}
      {/* `page-shell` is a plain CSS class (defined in globals.css), not a Tailwind utility — it cannot take `lg:` prefixes. The outer `hidden lg:grid` already gates the whole block, so we apply `page-shell` and `max-w-[1100px]` unprefixed. */}
      <div className="page-shell hidden max-w-[1100px] lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <ProfileTabsSidebar />
        <div>{children}</div>
      </div>
    </>
  )
}
```

- [ ] **Step 3: Strip back-link nav from sub-routes at `lg+`**

In each profile sub-route page (e.g. `apps/web/src/app/profile/memoria/page.tsx`), find the back-link / breadcrumb at the top and wrap it in `lg:hidden`:

```tsx
<div className="lg:hidden">{backLinkNav}</div>
```

Repeat for `creencias`, `casa`, `pantry`, `staples`, `cookbooks`, `sections`.

Also: the main `/profile/page.tsx` should not need a separate "header" if the tab sidebar already shows "Perfil". On `lg+`, hide any redundant top-of-page "Perfil" h1.

- [ ] **Step 4: Verify URLs still work standalone**

The tab shell wraps children, but direct navigation to `/profile/memoria` must still render the memory page correctly at all viewports. Test by typing the URL directly at 1440 — the tab sidebar should highlight "Memoria" and the right column should show its content.

- [ ] **Step 5: Typecheck + smoke**

Run: `pnpm --filter @ona/web exec tsc --noEmit`

At 1440: click through every tab, confirm content swaps without page reload (Next.js client navigation), confirm URL updates, confirm refresh keeps the user on the right tab.

At 390: confirm each sub-route still renders as its own page with its back-link nav.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/profile/layout.tsx \
        apps/web/src/components/profile/ProfileTabsSidebar.tsx \
        apps/web/src/app/profile/page.tsx \
        apps/web/src/app/profile/memoria/page.tsx \
        apps/web/src/app/profile/creencias/page.tsx \
        apps/web/src/app/profile/casa/page.tsx \
        apps/web/src/app/profile/pantry/page.tsx \
        apps/web/src/app/profile/staples/page.tsx \
        apps/web/src/app/profile/cookbooks/page.tsx \
        apps/web/src/app/profile/sections/page.tsx
git commit -m "feat(profile): tabs shell at lg+ via /profile/layout.tsx"
```

### Task 5.2: `/advisor` side panel at `lg+`

**Files:**
- Create: `apps/web/src/components/advisor/AdvisorSidePanel.tsx`
- Modify: `apps/web/src/app/advisor/page.tsx`

- [ ] **Step 1: Confirm data sources are read-only**

Open `apps/web/src/hooks/useAssistant.ts` and `apps/web/src/hooks/useAdvisor.ts`. Confirm:
- `useAssistant` owns chat state (messages, send, etc).
- `useAdvisorSummary` (in `useAdvisor.ts`) is read-only — provides the nutrition summary.
- Memory facts are fetched via `useUserMemory` (in `apps/web/src/hooks/useUserMemory.ts`). The same hook powers `/profile/memoria/page.tsx`. The `MemoryFact` type is exported from `@ona/shared` (`packages/shared/src/types/userMemory.ts:120`) — it's an object with `source`, `value`, etc., not a plain string. Inspect `/profile/memoria/page.tsx:87` and line 209 to see the real shape rendered to the UI.

The side panel is **read-only**: no chat mutation, no memory edit. It links to `/profile/memoria` for edits.

- [ ] **Step 2: Build `<AdvisorSidePanel />`**

`apps/web/src/components/advisor/AdvisorSidePanel.tsx`:

```tsx
"use client"

import Link from "next/link"
import NutrientSummary from "@/components/advisor/NutrientSummary"
import type { MemoryFact, MemoryKey } from "@ona/shared"

// MemoryFact entries from useUserMemory come as [MemoryKey, MemoryFact] pairs.
// The side panel renders fact.value (or the human-readable field per the shape
// in /profile/memoria/page.tsx). Inspect the real render path there before
// committing.
type MemoryEntry = { key: MemoryKey; fact: MemoryFact }

type Props = {
  // The summary shape lives in `useAdvisorSummary` — re-use its return type
  // instead of duplicating fields. ReturnType<...> keeps this side panel
  // automatically in sync with hook changes.
  summary: ReturnType<typeof import("@/hooks/useAdvisor").useAdvisorSummary>
  memoryEntries: MemoryEntry[]
}

export default function AdvisorSidePanel({ summary, memoryEntries }: Props) {
  return (
    <aside className="flex flex-col gap-6">
      <section>
        <h2 className="mb-3 font-[family-name:var(--font-italic)] text-[18px] italic text-[#1A1612]">
          Resumen nutricional
        </h2>
        <NutrientSummary summary={summary} />
      </section>
      <section>
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-italic)] text-[18px] italic text-[#1A1612]">
            Lo que sé de ti
          </h2>
          <Link href="/profile/memoria" className="text-[11px] uppercase tracking-[0.15em] text-[#C65D38]">
            Editar
          </Link>
        </div>
        <ul className="space-y-2 text-[13px] text-[#4A4239]">
          {memoryEntries.map(({ key, fact }) => (
            <li key={key} className="border-b border-[#DDD6C5] pb-2">
              {/* TODO(implementer): pick the right human-readable field from
                  MemoryFact based on /profile/memoria/page.tsx — likely
                  `fact.value` rendered with the same formatter the memoria
                  page uses. Reuse that formatter as a shared util to avoid
                  divergence. */}
              <span className="text-[10px] uppercase tracking-[0.15em] text-[#7A7066]">
                {key}
              </span>
              <div>{String(fact.value)}</div>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  )
}
```

Before committing this task: verify in `/profile/memoria/page.tsx` (line 209 onwards) how `MemoryFact` is formatted for display. If the page already exports a `formatMemoryFact()` (or similar) function, lift it into a shared utility (e.g. `apps/web/src/lib/memoryFormat.ts`) and use it from both places — never duplicate the formatting logic. The `String(fact.value)` placeholder above is a last-resort fallback.

- [ ] **Step 3: Wire panel into `/advisor/page.tsx`**

In `/advisor/page.tsx`, wrap the existing chat body:

```tsx
<div className="page-shell max-w-[430px] md:max-w-[820px] lg:max-w-[1200px]">
  <div className="lg:grid lg:grid-cols-[minmax(0,60fr)_minmax(0,40fr)] lg:gap-8">
    <div>
      {/* existing chat + voice button + inline summary at < lg */}
      <div className="lg:hidden">{inlineSummary}</div>
      <AdvisorChat ... />
    </div>
    <div className="hidden lg:block">
      <AdvisorSidePanel summary={summary} memoryEntries={memoryEntries} />
    </div>
  </div>
</div>
```

The mobile inline summary keeps rendering at `< lg` via the `lg:hidden` gate; the side panel takes over at `lg+`.

- [ ] **Step 4: Typecheck + smoke**

At 1440: open `/advisor`, confirm chat on the left, summary + memory on the right, send a message → chat updates, summary stays put (not re-rendering loudly).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/advisor/AdvisorSidePanel.tsx \
        apps/web/src/app/advisor/page.tsx
git commit -m "feat(advisor): side panel at lg+ (summary + memory, read-only)"
```

### Task 5.3: `/admin` + `/curator` widening

**Files:**
- Modify: `apps/web/src/app/admin/page.tsx`, `apps/web/src/app/curator/page.tsx`

- [ ] **Step 1: Apply container widening**

Both pages currently use `max-w-[430px]`. Change to:

```tsx
<div className="page-shell max-w-[430px] md:max-w-none lg:max-w-[1400px]">
```

If either page has 3+ filter chips at the top, move them into a sidebar at `lg+`:

```tsx
<div className="lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-8">
  <aside className="hidden lg:block">{filterChips}</aside>
  <div>
    <div className="lg:hidden">{filterChips}</div>
    <Table ... />
  </div>
</div>
```

- [ ] **Step 2: Typecheck + smoke**

Open both routes at 1440 (admin user only). Confirm table widens, no horizontal scrollbar at the page level.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/admin/page.tsx apps/web/src/app/curator/page.tsx
git commit -m "feat(admin/curator): widen at md+, filter sidebar at lg+"
```

### Task 5.4: Audit exceptions

**Files (verify only — no edits unless flagged):**
- `apps/web/src/app/(auth)/login/page.tsx`
- `apps/web/src/app/(auth)/register/page.tsx`
- `apps/web/src/app/(auth)/reset/page.tsx`
- `apps/web/src/app/onboarding/page.tsx`
- `apps/web/src/app/onboarding/voz/page.tsx`
- `apps/web/src/app/offline/page.tsx`
- `apps/web/src/app/recipes/[id]/cook/page.tsx`

- [ ] **Step 1: Confirm each route is unaffected**

For each file:
- `/auth/login`, `/auth/register`: keep `max-w-[400px]`, no responsive treatment. The sidebar should NOT render — the auth branch of `app/layout.tsx` only mounts `<DesktopSidebar />` for authed users. Confirm at 1440 by visiting `/login` in an incognito window.
- `/onboarding`: same — the wizard runs before sidebar mount. Visit at 1440 after logging in (mid-onboarding state).
- `/offline`: single-column status screen. Visit at 1440 in airplane mode if possible, otherwise confirm by inspecting the source.
- `/recipes/[id]/cook`: confirm sidebar hides via the `pathname?.includes("/cook")` early return in `<DesktopSidebar />`.

- [ ] **Step 2: Add explicit no-op comment to `/cook/page.tsx`**

In `apps/web/src/app/recipes/[id]/cook/page.tsx`, add a brief comment at the top of the file:

```tsx
// Full-screen cook mode. <DesktopSidebar /> opts out via a pathname check.
```

- [ ] **Step 3: Commit (only if anything changed)**

```bash
git add apps/web/src/app/recipes/[id]/cook/page.tsx
git commit -m "chore(cook): mark cook route as desktop-sidebar-exempt"
```

If nothing changed (only audit confirmed), skip the commit.

### Task 5.5: Final pass — update remaining `max-w-[430px]` hot-spots

**Files:**
- Modify (as needed): any page or component still using `max-w-[430px]` without responsive override.

- [ ] **Step 1: Re-run the grep**

```bash
grep -rln "max-w-\[430px\]" apps/web/src/
```

Expected hot-spots from earlier survey: `apps/web/src/app/profile/memoria/page.tsx`, `apps/web/src/app/profile/creencias/page.tsx`, `apps/web/src/app/menu/page.tsx`, `apps/web/src/app/onboarding/voz/page.tsx`, `apps/web/src/components/shared/Navbar.tsx`, `apps/web/src/components/recipes/AddToCookbookButton.tsx`, `apps/web/src/components/pwa/OfflineBanner.tsx`, `apps/web/src/components/pwa/InstallSheet.tsx`.

- [ ] **Step 2: Decide per match**

For each match decide:
- **Component-level (`OfflineBanner`, `InstallSheet`, `AddToCookbookButton`, `Navbar`)** — these renderings are floating UI (banner, sheet, button). At `md+`, anchor them to the new chrome:
  - `Navbar`: already gated with `md:hidden`, nothing to change.
  - `OfflineBanner`, `InstallSheet`: these float at the bottom of the viewport in mobile. At `md+`, keep them centred on the mobile column — no change required if they already use `max-w-[430px]` for the sheet width.
  - `AddToCookbookButton`: if it renders a modal, the modal stays mobile-width centred. No change.
- **Page-level (`profile/memoria`, `profile/creencias`, `menu`, `onboarding/voz`)**:
  - `profile/memoria`, `profile/creencias`: change `max-w-[430px]` → `max-w-[430px] lg:max-w-none lg:px-0` so they fit inside the tabs shell at lg+.
  - `menu/page.tsx`: any inline `max-w-[430px]` left in the inner sheet/modal layout (e.g. line 1131 — the `RecipePickerSheet` bottom sheet) can stay — sheets remain mobile-width.
  - `onboarding/voz/page.tsx`: this is the onboarding voice step — exception per spec. Keep `max-w-[430px]` at all breakpoints.

- [ ] **Step 3: Typecheck + smoke**

After each change, verify the affected route at 390 + 1440.

- [ ] **Step 4: Commit per logical group**

```bash
git add <files>
git commit -m "fix(layout): unblock max-w-[430px] at lg+ on profile sub-routes"
```

### Task 5.6: Update remaining specs

**Files:**
- Modify: `specs/advisor.md`, `specs/auth.md` (only if `/profile` shell is documented there)

- [ ] **Step 1: `specs/advisor.md` — add side panel**

Append:

```markdown
### Desktop layout (lg+)

`/advisor` renders a 60/40 split: chat on the left (existing `<AdvisorChat>` + voice button), side panel on the right with the nutrition summary (`useAdvisorSummary`) and the memory facts list. The side panel is read-only; editing memory still happens at `/profile/memoria`. Below `lg`, the inline summary above the chat remains unchanged.
```

- [ ] **Step 2: `specs/auth.md` — add /profile tab shell (if profile is described there)**

Grep `specs/auth.md` for "profile". If profile sub-routes are mentioned, append:

```markdown
### Profile desktop shell (lg+)

`/profile` and its sub-routes (`/profile/memoria`, `/profile/creencias`, `/profile/casa`, etc.) share a tab-shell layout at `lg+`: left tabs sidebar (220 px) + right active panel. URLs stay route-based so direct linking works. On `< lg` each sub-route renders standalone.
```

If profile isn't covered in `auth.md`, skip this step (no spec orphan).

- [ ] **Step 3: Commit**

```bash
git add specs/advisor.md specs/auth.md
git commit -m "docs(spec): advisor.md side panel + auth.md profile shell (PR 5)"
```

### Task 5.7: Final visual regression sweep

- [ ] **Step 1: Manual smoke across all routes at all 4 viewports**

Walk through every authed route at 390 / 768 / 1024 / 1440:

- `/menu` (Vista Día + Vista Semana)
- `/shopping`
- `/recipes`
- `/recipes/<existing-id>`
- `/recipes/new`
- `/recipes/<existing-id>/edit`
- `/cookbooks/<existing-id>`
- `/advisor`
- `/profile` + `/profile/memoria` + `/profile/creencias` + `/profile/casa` + `/profile/pantry` + `/profile/staples` + `/profile/cookbooks` + `/profile/sections`
- `/admin` (admin user)
- `/curator` (admin user)
- `/recipes/<id>/cook` (full-screen, no sidebar)

Take a screenshot per route at 390 + 1440. Paste into the PR 5 commit message body.

- [ ] **Step 2: Push + verify production**

```bash
git push origin master
```

Repeat the spot-check at production URL.

- [ ] **Step 3: Final commit if any sweep fixes**

If the sweep surfaced small fixes (typos, oversized columns, etc.), commit:

```bash
git add <files>
git commit -m "fix(layout): post-sweep polish for responsive desktop"
git push origin master
```

### Task 5.8: Close out Todo Miguel

**Files:**
- Modify: `CLAUDE.md`

- [ ] **Step 1: Remove responsive-related items from "Todo Miguel" if any exist**

Grep `CLAUDE.md` for any item mentioning responsive / desktop / sidebar that's been resolved. Remove or update.

- [ ] **Step 2: Add a final note to the Backlog section**

Append to the backlog notes block:

```markdown
_Responsive desktop — shipped 2026-06-XX across 5 PRs. Sidebar at md+, multi-column at lg+, /profile tabs shell, /advisor side panel. Mobile experience unchanged. Spec: docs/superpowers/specs/2026-06-01-responsive-desktop-design.md._
```

- [ ] **Step 3: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(claude): mark responsive desktop shipped"
git push origin master
```

---

## Definition of done

- [ ] All 5 PRs merged and deployed.
- [ ] `pnpm --filter @ona/web exec tsc --noEmit` passes locally and on Railway build.
- [ ] All authed routes verified at 390 / 768 / 1024 / 1440.
- [ ] Mobile (390) screenshots match pre-migration baseline.
- [ ] Specs updated: `design-system.md`, `recipes.md`, `menus.md`, `shopping.md`, `advisor.md`, plus `auth.md` if applicable.
- [ ] No new dependencies added (the migration uses existing Tailwind v4 + motion/react + @dnd-kit).
- [ ] `CLAUDE.md` Todo Miguel cleaned.

## Notes for the implementer

- **Mobile invariant is sacred.** If you find yourself changing a class that has no `md:` or `lg:` prefix, stop and reconsider — almost every responsive change should add a prefixed variant, not modify the unprefixed base.
- **Sidebar offset arithmetic uses tokens.** Never hardcode `208px`. Use `md:ml-[calc(var(--sidebar-width)+var(--sidebar-gap))]`.
- **DnD in Vista Semana** (Task 3.1, Step 3) is the one place where a layout change can subtly break interaction. Test cross-column drags manually before committing.
- **`<CatalogFilters>` and `<CatalogGrid>`** are shared between `/recipes` and `/cookbooks` — keep them presentational; state stays in the consuming pages.
- **`<AdvisorSidePanel>` is read-only.** If you ever consider adding edit affordances, that's a follow-up — out of this plan's scope.
- **Use Playwright MCP (`mcp__playwright__*`)** to take the screenshots at 390 + 1440 for commit messages. The tool is already available in this session.

## Skills referenced

- `@superpowers:subagent-driven-development` — recommended execution path. Fresh subagent per task, two-stage review, fast iteration.
- `@superpowers:executing-plans` — alternative for batched inline execution with checkpoints.
