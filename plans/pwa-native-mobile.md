# PWA — Native-feeling Mobile App Implementation Plan

## Summary

Convert ONA into a premium PWA that feels like a native iOS/Android app. Adds installability, offline shell + viewed-recipe caching, offline mutation queue, contextual install prompt, haptic feedback, Web Share, Wake Lock for cooking mode, local meal-time notifications, View Transitions, and swipe gestures between bottom tabs. Implements [specs/pwa.md](../specs/pwa.md) end-to-end. Currently nothing PWA-related exists in the repo — this plan starts from zero.

## Tasks

- [ ] Install and configure the PWA foundation
  - Add `next-pwa` and its types to `apps/web/package.json` (`pnpm add next-pwa` and `pnpm add -D @types/next-pwa`)
  - Wrap `apps/web/next.config.ts` with `next-pwa({ dest: 'public', register: true, skipWaiting: true, disable: process.env.NODE_ENV === 'development' })` and configure `runtimeCaching` (defaults are fine for now; refined in a later task)
  - Create `apps/web/public/manifest.webmanifest` with the exact fields listed in the spec (name, short_name, start_url, scope, display, orientation, theme_color, background_color, lang, categories, icons, shortcuts)
  - Add a `.gitignore` entry for the auto-generated `public/sw.js` and `public/workbox-*.js`
  + See [spec: Manifest](../specs/pwa.md#manifest) and [spec: Asset Requirements](../specs/pwa.md#asset-requirements-user-supplied)
  + Prerequisite: the user must drop the icon set into `apps/web/public/icons/` (any-purpose 192/512, maskable 192/512, monochrome 512, apple-touch 180, splash screens). The build will succeed without them but install + splash won't work until they're present.

- [ ] Wire manifest, theme color, splash screens, and safe-area into the layout
  - Edit `apps/web/src/app/layout.tsx` to add: `<link rel="manifest" href="/manifest.webmanifest">`, `<meta name="theme-color">` (cream `#FAF6EE` for app, ink `#1A1612` for landing — driven by pathname), `<meta name="apple-mobile-web-app-capable" content="yes">`, `<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">`, `<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">`, the 8 `<link rel="apple-touch-startup-image">` entries (one per device, with `media` queries for size/orientation/dpr)
  - Add `viewport-fit=cover` to the existing viewport meta (already set)
  - Add CSS variables `--safe-top: env(safe-area-inset-top)`, `--safe-bottom: env(safe-area-inset-bottom)`, `--safe-left`, `--safe-right` to `:root` in `apps/web/src/app/globals.css`
  - Update bottom `Navbar` to use `pb-[max(env(safe-area-inset-bottom),12px)]` so it respects the home indicator on iOS
  - Update `<main>` wrapper to use `pt-[env(safe-area-inset-top)]` on app routes when `display-mode: standalone` (so content doesn't go under the status bar)
  + See [spec: Theme Colors](../specs/pwa.md#theme-colors) and [spec: iOS PWA optimization](../specs/pwa.md#user-capabilities)

- [ ] Configure runtime caching, /_offline fallback, and the offline banner
  - Refine the `runtimeCaching` config in `next.config.ts`: stale-while-revalidate for `/recipes` and `/menu/*` API calls (cache name `api-cache`, max 100 entries, 24h TTL), cache-first for `/images/recipes/*` (cache name `recipe-images`, LRU 200 entries / ~50MB, 30d TTL), network-only for all `POST/PUT/DELETE`
  - Create `apps/web/src/app/_offline/page.tsx` — minimal cream-bg fallback page with logo, "Sin conexión" message, retry button (`window.location.reload()`); used as the navigation fallback by Workbox
  - Create `apps/web/src/components/pwa/OfflineBanner.tsx` — fixed top banner (under the status bar), listens to `online`/`offline` events, slides in with `motion/react` when offline, uses warn tokens (`bg-[#FDEEE8]`, text `#B5451B`)
  - Mount `<OfflineBanner />` in `apps/web/src/app/layout.tsx` for app routes only (not public)
  + See [spec: Offline behavior (hybrid)](../specs/pwa.md#offline-behavior-hybrid)
  + Verification: open DevTools → Application → Service Workers, confirm `sw.js` registered. Toggle offline in Network tab; the banner appears and a previously visited recipe still loads.

- [ ] Build the offline mutation queue with idb-keyval
  - Add `idb-keyval` to `apps/web/package.json`
  - Create `apps/web/src/lib/pwa/offlineQueue.ts` — exports `enqueue(mutation: { id, url, method, body, timestamp })`, `replayAll()`, `getPending()`. Stores in IndexedDB under key `ona-offline-queue`. On `window.online` event, calls `replayAll()` and clears successful entries
  - Create `apps/web/src/lib/pwa/useOnlineStatus.ts` hook — exposes `{ online: boolean, pendingCount: number }` for UI to consume
  - Wrap the React Query mutations in `apps/web/src/hooks/useShopping.ts` (`useCheckItem`, `useStockItem`), `apps/web/src/hooks/useRecipes.ts` (`useToggleFavorite`), and `apps/web/src/hooks/useMenu.ts` (`useRegenerateMeal`, `useLockMeal`) so that when `!navigator.onLine`, they: optimistically update React Query cache, enqueue the mutation, and return a synthetic success
  - Add a small "pendiente de sincronizar" indicator (3px clock icon on the affected items) — use `getPending()` IDs to mark which items are queued. Wire into `ShoppingList.tsx`, `StockManager.tsx`, and `FavoriteButton.tsx`
  + See [spec: Offline behavior (hybrid)](../specs/pwa.md#offline-behavior-hybrid)
  + Verification: go offline, check a shopping item, see the clock icon. Go online; the icon disappears and the API gets the call.

- [ ] Create native API helpers (haptics, share, wake lock)
  - Create `apps/web/src/lib/pwa/haptics.ts` — exports `haptic.light()` (10ms), `haptic.medium()` (20ms), `haptic.strong()` (`[15, 30, 15]` pattern). All wrap `navigator.vibrate?.()` with safe no-op fallback
  - Create `apps/web/src/lib/pwa/share.ts` — exports `share({ title, text, url })`. Uses `navigator.share` when available; falls back to copying `text` (or `url`) to clipboard with a toast-like return value `{ method: 'native' | 'clipboard' }`
  - Create `apps/web/src/lib/pwa/wakeLock.ts` — exports `acquireWakeLock()` (returns `WakeLockSentinel | null`), `releaseWakeLock(sentinel)`. Handles `visibilitychange` to re-acquire after tab return. Returns `null` cleanly if API is unavailable
  + See [spec: Haptic feedback](../specs/pwa.md#haptic-feedback), [spec: Sharing](../specs/pwa.md#sharing), [spec: Cooking mode (Wake Lock)](../specs/pwa.md#cooking-mode-wake-lock)
  + These three files are independent — can be built in parallel.

- [ ] Wire native API helpers into existing components
  - In `apps/web/src/components/shared/Navbar.tsx`, call `haptic.light()` on tab change (inside the `Link` onClick handler — note this needs migrating from a plain `Link` to a click handler that also navigates programmatically OR a wrapper that fires haptic before native nav)
  - In `apps/web/src/components/recipes/FavoriteButton.tsx`, call `haptic.medium()` on toggle
  - In `apps/web/src/components/shopping/ShoppingList.tsx` and `StockManager.tsx`, call `haptic.medium()` on check / stock toggle
  - In `apps/web/src/app/menu/page.tsx`, call `haptic.medium()` when regenerate button confirms
  - In `apps/web/src/app/recipes/[id]/page.tsx`, add a Share icon next to the favorite button in the hero overlay; clicking it calls `share({ title: recipe.name, url: window.location.href })`
  - In `apps/web/src/app/shopping/page.tsx`, replace the existing `handleExport` clipboard-only code with `share({ title: 'Lista de compra ONA', text: ... })`; falls back to clipboard automatically
  + See [spec: Haptic feedback](../specs/pwa.md#haptic-feedback) and [spec: Sharing](../specs/pwa.md#sharing)

- [ ] Implement cooking mode with Wake Lock
  - In `apps/web/src/app/recipes/[id]/page.tsx`, wire the existing "Empezar a cocinar" button: on first click, call `acquireWakeLock()`, show a small "Pantalla activa" badge (cream pill with a sun/zap icon, top-right corner under the back button), the button changes to "Cocinando…" / "Salir de cocina" toggle on subsequent clicks
  - Release the wake lock on: navigation away (route change), badge tap, second button click
  - Use `useEffect` cleanup + Next.js `usePathname` to detect navigation
  + See [spec: Cooking mode (Wake Lock)](../specs/pwa.md#cooking-mode-wake-lock)
  + Verification: open a recipe on a real device, tap "Empezar a cocinar", lock the device — the screen stays on. Navigate away — the badge disappears and the screen sleeps as normal.

- [ ] Build the contextual install prompt
  - Create `apps/web/src/lib/pwa/installPrompt.ts` — captures `beforeinstallprompt` event into a module-level ref, exposes `getInstallPromptState()`, `triggerInstall()`, `dismissForDays(n)`. Uses `localStorage` keys `ona-pwa-visits` (incremented on each app load), `ona-pwa-menu-visits` (incremented on `/menu`), `ona-pwa-dismissed-until` (timestamp)
  - Create `apps/web/src/components/pwa/InstallSheet.tsx` — bottom sheet (uses the existing `motion/react` slide-up pattern from `AltModal`-style). Two branches:
    - Android: "Añade ONA a tu inicio" + button → triggers stashed `beforeinstallprompt`
    - iOS Safari: visual instructions with the share icon and "Añadir a pantalla de inicio" — detected via `/iPhone|iPad|iPod/.test(navigator.userAgent) && !window.matchMedia('(display-mode: standalone)').matches`
  - Mount `<InstallSheet />` in `apps/web/src/app/layout.tsx` for app routes. Sheet only renders if (visits >= 3 OR menu-visits >= 2) AND not installed AND not dismissed
  - "Más tarde" sets a 30-day dismissal; "No mostrar otra vez" sets a 365-day dismissal
  + See [spec: Installation](../specs/pwa.md#installation)
  + Verification: clear localStorage, navigate the app 3 times, the sheet appears. Click "Más tarde", confirm `ona-pwa-dismissed-until` is set 30 days out and the sheet doesn't reappear.

- [ ] Implement local meal-time notifications
  - Create `apps/web/src/lib/pwa/notifications.ts` — exports `requestPermission()`, `scheduleMealReminders(template, mealTimes)`, `clearAllReminders()`. Uses `setTimeout` to schedule the next 24h of meal-time notifications. Stores meal-time preferences in `userSettings.template` (extend type if needed) plus a new `mealTimes: { breakfast: '08:00', lunch: '14:00', dinner: '21:00', snack: '17:00' }` field in localStorage
  - Re-arm on every app open (in a `useEffect` mounted in `layout.tsx`)
  - Each notification, on click, opens `/menu` (or `/recipes/<id>` if the slot has a recipe assigned today)
  - Add an opt-in section to `apps/web/src/app/profile/page.tsx`: a toggle "Recibir recordatorios de comidas" + 4 time inputs (breakfast / lunch / dinner / snack) when enabled
  + See [spec: Local notifications](../specs/pwa.md#local-notifications)
  + Verification: enable in profile, set lunch time to 1 minute from now, leave the tab open. The notification fires.

- [ ] Add page transitions (View Transitions API + motion/react fallback)
  - Create `apps/web/src/components/pwa/PageTransition.tsx` — a client wrapper that detects View Transitions API support. If supported, wraps `router.push` / `Link` clicks with `document.startViewTransition(() => navigate())`. If not, wraps children in `motion.div` with `key={pathname}` and a fade-up `AnimatePresence mode="wait"` from `motion/react`
  - Create a custom `<TransitionLink>` to replace `<Link>` in the bottom Navbar and other in-app navigations (or hook into Next.js's router via a `RouterEventsListener`)
  - Add CSS for the View Transitions: `::view-transition-old(root)` / `::view-transition-new(root)` with cross-fade in `globals.css`
  + See [spec: Native gestures and transitions](../specs/pwa.md#native-gestures-and-transitions)

- [ ] Add swipe-between-tabs gesture to the bottom navbar
  - Extend `apps/web/src/components/shared/Navbar.tsx` (or wrap it in a parent gesture handler) using `motion/react`'s `useDragControls` + `useMotionValue`. The gesture surface is the entire `<main>` content area
  - On horizontal pan: track delta, apply `transform: translateX()` to the page container with edge resistance (rubber-band when at first/last tab or hitting edges of the bound area)
  - On release: if `|delta| > viewport.width * 0.30`, navigate to next/prev tab in the `NAV_ITEMS` order; otherwise spring back. Use `ease-out-expo` 300ms
  - The active-pill `motion.div` (already uses `layoutId="nav-pill"`) automatically animates into the new position because it's already in the bottom nav
  - Vertical scrolling must NOT be hijacked — only act on gestures where `|deltaX| > |deltaY| * 1.5`
  + See [spec: Native gestures and transitions](../specs/pwa.md#native-gestures-and-transitions)
  + Verification: open `/menu` on mobile, swipe left → should navigate to `/shopping`. Swipe with vertical motion → page scrolls normally, no nav.

- [ ] Update spec to reflect implemented state
  - Edit `specs/pwa.md` to remove the "Status: PLANNED" banner now that the system exists
  - Per-section, replace any "planned" / "to be" wording with present tense
  - Update the `## Source` paths to remove the "(planned — do not exist yet)" caveat
  - Update `specs/index.md` to remove the "Status: planned, not implemented yet" prefix on the PWA entry
  - Cross-reference: update [specs/design-system.md](../specs/design-system.md) to mention the safe-area variables and theme-color section behavior
  - Cross-reference: update [specs/shopping.md](../specs/shopping.md), [specs/recipes.md](../specs/recipes.md), [specs/menus.md](../specs/menus.md) to mention offline-queue behavior and Web Share where relevant

- [ ] Verify implementation
  - Build for production: `pnpm build` in `apps/web/` — confirm no errors and that `sw.js` + `workbox-*.js` are emitted to `public/`
  - Open the app on an Android device in Chrome, navigate the app, confirm the install prompt appears after 3 visits, install it, launch from the home screen — should open in standalone mode with cream theme color and no browser chrome
  - Open the app on an iOS device in Safari, navigate to the install sheet, confirm the iOS-specific instructions render, follow them to add to home screen, launch — confirm the splash screen renders, the status bar is translucent, and `safe-area-inset` is respected (no content hidden behind notch/home indicator)
  - DevTools → Lighthouse → PWA category — score must be 100. Address any audit failures (typically: manifest fields, icons, service worker scope, viewport)
  - Toggle DevTools "Offline" — confirm the OfflineBanner appears, navigate to a previously viewed recipe (loads from cache), check a shopping item (queues), go online, confirm the queue replays and the API is hit
  - On the device, tap "Empezar a cocinar" in a recipe; lock the screen with the power button — the screen stays on for at least 30 seconds (Wake Lock active). Navigate away — confirm the screen sleeps normally on next idle
  - Enable meal reminders in profile, set the next meal 1 minute ahead, leave tab open — notification fires
  - Tap each tab in the bottom nav; haptic vibration is felt on every tap (Android only). Toggle a favorite, check a shopping item — haptics fire
  - Swipe horizontally on the main content area — page transitions to the adjacent tab; the active pill animates with `layoutId`
  - Use Web Share on a recipe detail — native share sheet appears; on desktop it falls back to clipboard
