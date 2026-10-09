# PWA — Native-feeling Mobile

Premium Progressive Web App layer that makes Mimoia feel like a native iOS/Android app: installable, offline-capable, with haptic feedback, page transitions, swipe gestures, and local notifications.

## User Capabilities

### Installation

- Users can install Mimoia to their home screen on Android (Chrome) and iOS (Safari) and launch it as a standalone app
- After 3 visits, OR the second time the user reaches `/menu`, a bottom sheet appears: "Añade Mimoia a tu inicio" ("…abre Mimoia con un toque desde tu pantalla de inicio")
- On Android the prompt uses the browser's native install flow (`beforeinstallprompt`)
- On iOS Safari the bottom sheet shows visual instructions ("Toca compartir → Añadir a pantalla de inicio") since iOS doesn't fire `beforeinstallprompt`
- If the user dismisses the prompt, it isn't shown again for 30 days; if the user installs the app, the prompt isn't shown again for 365 days
- Once installed, the app launches in standalone mode (no browser chrome), with the OS static splash image (cream, see Asset Requirements), and the status bar tinted to match the active section

### Offline behavior (hybrid)

- The app shell (components, fonts, CSS, JS) is precached; pages the user has visited are cached network-first (`pages` cache) and available offline
- Recipes the user has opened, the menu and the shopping list are available offline (last cached version). API responses use **network-first** (5 s timeout) in `api-cache`: online you always get fresh data for your own session; the cache is only the offline fallback
- **Cached data never outlives the session**: login, register, logout and a rejected token (`INVALID_TOKEN` / `TOKEN_EXPIRED` / `USER_NOT_FOUND`) wipe `api-cache` and the offline queue (`lib/pwa/sessionData.ts`), so the next person on the same device can't read the previous user's menu offline or replay their queued mutations
- A "Sin conexión" banner slides in at the top when the device is offline (sits above main content, respects `safe-area-inset-top`)
- Mutations made offline (favorite a recipe, check a shopping item, mark stock, regenerate a meal, lock a meal) are **queued** in IndexedDB and replayed automatically when the `online` event fires
- The user sees an inline "Pendiente de sincronizar" Clock indicator on items still in the queue
- Viewing recipes that haven't been opened before doesn't work offline (shows a friendly fallback)

### Native gestures and transitions

- Users can **swipe horizontally** between the 4 bottom-tab routes (menu ↔ compra ↔ recetas ↔ perfil; Mimo is the floating button, not a tab — D-023) with a pan gesture (`SwipeNavigator`, `motion/react` `onPan`). Not on the recipe detail `/recipes/[id]` (it has its own tabs) nor in cook mode `/recipes/[id]/cook`: a horizontal swipe there stays on the page
- The gesture has rubber-band edge resistance, a 30% width threshold to confirm, and snaps back if released before threshold (300ms `--ease-out-expo`)
- Vertical scroll is preserved via `touchAction: pan-y`
- The bottom nav marks the active tab in ink with a heavier icon stroke and `aria-current="page"`; every tab shows its text label (no animated pill since 2026-10-08)
- All page navigation uses the View Transitions API (cross-fade between routes) when supported, with a `motion/react` `AnimatePresence` fallback for non-Chromium browsers

### Loading

- No animated splash: a full load (new tab, reload, PWA launch, link from WhatsApp) shows the page as soon as it's ready
- While a route is still loading (`app/loading.tsx`), a 2 px terracotta bar sweeps along the top, just under the status bar. It only appears if loading takes more than 300 ms, so quick navigations show nothing; the page area stays cream and the nav stays visible and tappable. With reduced motion it's a static bar

### Haptic feedback

- Light vibration (10ms) on: tab change, share invocation
- Medium vibration (20ms) on: shopping check / stock toggle, favorite toggle, meal regeneration confirmed
- Falls back to no-op silently if `navigator.vibrate` is unavailable (iOS Safari ignores it)

### Sharing

- Users can share a recipe via the native share sheet (`navigator.share`) — a Share2 button in the recipe detail hero overlay (desktop: the action row) sends recipe URL + name
- Users can share their shopping list as text via the native share sheet — the "Exportar" button uses Web Share when available and falls back to clipboard (the clipboard copy keeps text **and** link)
- Users can share the week's menu ("Compartir" in the /menu week "···" sheet, both views; "Compartir semana" at lg+) as text, one line per meal, ending "— Hecho con Mimoia, el menú semanal…" + link (`menuShareText`, `/?ref=menu`)

### Cooking mode (Wake Lock)

- When the recipe detail's "Empezar a cocinar" button is tapped, the screen stays awake (`navigator.wakeLock.request('screen')`)
- A small badge appears: "Pantalla activa"
- The button toggles to "Salir de cocina"; the lock is released when the user taps it or navigates away

### Local notifications

- Users can opt in to meal-time reminders from the profile page ("Recordatorios" card)
- The chapter exposes 4 time inputs (breakfast / lunch / snack / dinner) plus a master toggle
- After permission is granted, the app schedules **local** notifications based on the saved meal-time preferences
- A notification fires at the configured times (e.g., "Es hora de comer · Pollo al limón con verduras")
- Tapping a notification opens the app
- Notifications are scheduled client-side via `setTimeout` and re-armed on every app open (root layout `useEffect`)
- The user can disable reminders globally from the same chapter

## Constraints

- **iOS Safari** does not support: `beforeinstallprompt`, `Vibration API`, `Notifications API` (in non-installed PWAs prior to iOS 16.4 — only the installed PWA supports them on 16.4+), Web Share for arbitrary file types
- **Background Sync API** is Chromium-only; on other browsers, queued mutations replay on the next `online` event instead of in the background
- **Wake Lock API** is supported on Chromium and Safari 16.4+; falls back to no-op
- **Notifications scheduled with `setTimeout`** only fire while the page is alive — they're a best-effort approximation, not a substitute for server-side push (deferred to a future spec)
- **View Transitions API** is Chromium-only as of writing; the `motion/react` fallback covers the rest
- The service worker only caches GET requests; all mutations go through the network or the offline queue
- `api-cache` keys responses by URL only (no `Authorization`), which is why its routes must be network-first and anchored on the API origin (`^<NEXT_PUBLIC_API_URL>/recipes|menu|shopping-list`). Workbox silently ignores a cross-origin regex that doesn't match at index 0, which is why the pre-2026-10-07 `/\/menu\/.*$/` rule cached only page shells and no API data. `scripts/verify-sw.mjs` runs in `postbuild` and fails the build if any `api-cache` route breaks either rule
- Recipe images are cached cache-first with LRU eviction (200 entries / 30 days)
- The app shell precache is invalidated on every deploy (Workbox versioning via `next-pwa`)
- Until 2026-10-08 every full load showed a ~2.4 s ink-drop splash (`ClientSplash`, with the old "Ona" wordmark, also on the public Mimoia site) and `app/loading.tsx` was a full-screen takeover that hid the app and the nav on route changes; both removed, guarded by `e2e/no-splash.spec.ts` (no fixed full-viewport layer at z ≥ 100 on load or navigation)

## Brand assets (generated)

Every icon comes from the imagotipo's single path, `MIMOIA_SYMBOL_PATH` in `components/brand/Mimoia.tsx` (spoon with a heart cut-out, 2026-10-09). `node scripts/generate-brand-icons.mjs` (from `apps/web`) rewrites all of these; rerun it whenever the symbol changes:

| File | Size | Purpose |
|------|------|---------|
| `public/icons/icon-192.png` | 192×192 | Android home screen, manifest |
| `public/icons/icon-512.png` | 512×512 | Android splash, manifest |
| `public/icons/icon-192-maskable.png` | 192×192 | Android adaptive icon (safe area in center 80%) |
| `public/icons/icon-512-maskable.png` | 512×512 | Android adaptive icon |
| `public/icons/icon-monochrome.png` | 512×512 | Android themed icon (alpha mask, single-color) |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home screen |
| `public/favicon.ico` | 16/32/48, real ICO | Browser tab (`<link rel="icon" sizes="any">`) |
| `public/icon.svg` | vector | SVG favicon for modern browsers |
| `public/brand/mimoia-perfil.png`, `mimoia-simbolo.svg` | 1080×1080 / vector | Profile photo for Instagram and WhatsApp; the symbol for external use |
| `public/icons/splash-2048x2732.png` | iPad Pro 12.9 portrait | iOS splash |
| `public/icons/splash-1668x2388.png` | iPad Pro 11 portrait | iOS splash |
| `public/icons/splash-1536x2048.png` | iPad mini/Air portrait | iOS splash |
| `public/icons/splash-1290x2796.png` | iPhone 14 Pro Max | iOS splash |
| `public/icons/splash-1179x2556.png` | iPhone 14 Pro / 15 | iOS splash |
| `public/icons/splash-1170x2532.png` | iPhone 13/14/15 | iOS splash |
| `public/icons/splash-1125x2436.png` | iPhone X/11 Pro/12 mini | iOS splash |
| `public/icons/splash-1242x2688.png` | iPhone 11 Pro Max / XS Max | iOS splash |

App icons are the cream spoon on terracotta (Mimo's face); maskable ones keep it within the central 80% safe-zone (the spoon runs corner to corner, so it takes 52% of the side). Splash screens are cream `#FAF6EE` with the terracotta spoon and no wordmark (the build machine has no Fraunces). The monochrome icon is the ink silhouette with alpha. Guarded by `e2e/brand.spec.ts` (real ICO, every manifest icon served). The root layout already wires 8 `apple-touch-startup-image` link tags expecting these files.

## Theme Colors

- App routes (`/menu`, `/shopping`, etc.): `theme-color = #FAF6EE` (cream), set per-section in `layout.tsx`
- Public/landing routes: `theme-color = #1A1612` (ink)
- Status bar style: `black-translucent` (content draws under it; `safe-area-inset-top` reserves space via the `.standalone-pt` utility)

## Manifest

`public/manifest.webmanifest` includes:
- `name: "Mimoia — El placer de cocinar sin pensar"`
- `short_name: "Mimoia"` (home-screen label; renamed from "ONA" on 2026-10-08 — Android Chrome applies it on its periodic WebAPK update; iOS keeps the name chosen at install until the user re-adds it)
- `start_url: "/menu"` (deep-link into the app for installed users; falls through to `/login` if unauthenticated)
- `scope: "/"`
- `display: "standalone"`
- `orientation: "portrait"`
- `theme_color: "#FAF6EE"`
- `background_color: "#FAF6EE"`
- `lang: "es"`
- `categories: ["food", "lifestyle", "health"]`
- All icons referenced (any-purpose, maskable, monochrome)
- `shortcuts`: "Menú de hoy" → `/menu`, "Lista de compra" → `/shopping`

## Safe-area variables

`:root` exposes the four iOS safe-area insets as CSS variables consumed across components:

- `--safe-top` → `env(safe-area-inset-top)`
- `--safe-bottom` → `env(safe-area-inset-bottom)`
- `--safe-left` → `env(safe-area-inset-left)`
- `--safe-right` → `env(safe-area-inset-right)`

The `.standalone-pt` utility class applies `padding-top: var(--safe-top)` so content drawn under the translucent iOS status bar is pushed below it.

## Related specs

- [Design System](./design-system.md) — theme colors, fonts, safe-area conventions
- [Auth](./auth.md) — `start_url` behavior depends on auth state
- [Recipes](./recipes.md) — cooking mode wake lock attaches to recipe detail; favorite toggle is queued offline
- [Shopping](./shopping.md) — share via Web Share, offline mutation queue
- [Menus](./menus.md) — meal-time notifications use the per-user meal-time preferences

## Source

- [apps/web/next.config.ts](../apps/web/next.config.ts) — `next-pwa` plugin wiring and runtime caching strategies
- [apps/web/public/manifest.webmanifest](../apps/web/public/manifest.webmanifest) — manifest
- `apps/web/public/icons/`, `public/brand/`, `public/favicon.ico`, `public/icon.svg` — generated by `apps/web/scripts/generate-brand-icons.mjs` (see Brand assets)
- `apps/web/src/components/brand/Mimoia.tsx` — the imagotipo (`MIMOIA_SYMBOL_PATH`, `MimoiaSymbol`, `MimoiaLogo`, `MimoAvatar`)
- [apps/web/src/app/layout.tsx](../apps/web/src/app/layout.tsx) — manifest link, viewport, apple-touch meta tags, status bar style, theme-color, splash-image link tags, notification re-arm hook
- [apps/web/src/lib/pwa/installPrompt.ts](../apps/web/src/lib/pwa/installPrompt.ts) — `beforeinstallprompt` capture, visit-count gating, dismissal persistence (localStorage)
- [apps/web/src/components/pwa/InstallSheet.tsx](../apps/web/src/components/pwa/InstallSheet.tsx) — bottom sheet with Android + iOS instructions
- [apps/web/src/components/pwa/OfflineBanner.tsx](../apps/web/src/components/pwa/OfflineBanner.tsx) — connection-status banner
- [apps/web/src/lib/pwa/useOnlineStatus.ts](../apps/web/src/lib/pwa/useOnlineStatus.ts) — `online`/`offline` event hook
- [apps/web/src/lib/pwa/haptics.ts](../apps/web/src/lib/pwa/haptics.ts) — `navigator.vibrate` wrapper with named patterns (light/medium)
- [apps/web/src/lib/pwa/share.ts](../apps/web/src/lib/pwa/share.ts) — `navigator.share` wrapper with clipboard fallback
- [apps/web/src/hooks/useWakeLock.ts](../apps/web/src/hooks/useWakeLock.ts) — Wake Lock acquire/release (cooking mode)
- [apps/web/src/lib/pwa/notifications.ts](../apps/web/src/lib/pwa/notifications.ts) — permission flow, scheduling from meal-time preferences, re-arm on app open
- [apps/web/src/lib/pwa/sessionData.ts](../apps/web/src/lib/pwa/sessionData.ts) — `clearSessionData()`: wipes `api-cache` + the offline queue on session change
- [apps/web/scripts/verify-sw.mjs](../apps/web/scripts/verify-sw.mjs) — post-build guard on the generated `sw.js`
- [apps/web/src/lib/pwa/offlineQueue.ts](../apps/web/src/lib/pwa/offlineQueue.ts) — IndexedDB-backed mutation queue (idb-keyval), replay on `online` event
- [apps/web/src/app/loading.tsx](../apps/web/src/app/loading.tsx) — global loading state: delayed 2 px top bar (`.route-loading-bar` in `globals.css`)
- [apps/web/src/components/pwa/PageTransition.tsx](../apps/web/src/components/pwa/PageTransition.tsx) — View Transitions API + `motion/react` fallback
- [apps/web/src/components/pwa/SwipeNavigator.tsx](../apps/web/src/components/pwa/SwipeNavigator.tsx) — pan-gesture swipe between bottom-tab routes
- [apps/web/src/components/pwa/TransitionLink.tsx](../apps/web/src/components/pwa/TransitionLink.tsx) — `<Link>` wrapper that triggers a view transition
- [apps/web/src/components/shared/Navbar.tsx](../apps/web/src/components/shared/Navbar.tsx) — bottom tab bar; haptic feedback on tab change
