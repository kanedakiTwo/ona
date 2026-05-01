# PWA — Native-feeling Mobile

Premium Progressive Web App layer that makes ONA feel like a native iOS/Android app: installable, offline-capable, with haptic feedback, page transitions, swipe gestures, and local notifications.

> **Status: PLANNED — not yet implemented.** Nothing PWA-related currently exists in the repo. This spec documents the target behavior. Source-file links point to **planned** paths.

## User Capabilities

### Installation

- Users can install ONA to their home screen on Android (Chrome) and iOS (Safari) and launch it as a standalone app
- After 3 visits, OR the second time the user reaches `/menu`, a bottom sheet appears: "Añade ONA a tu inicio"
- On Android the prompt uses the browser's native install flow (`beforeinstallprompt`)
- On iOS Safari the bottom sheet shows visual instructions ("Toca compartir → Añadir a pantalla de inicio") since iOS doesn't fire `beforeinstallprompt`
- If the user dismisses the prompt, it isn't shown again for 30 days
- Once installed, the app launches in standalone mode (no browser chrome), with a custom splash screen, and the status bar tinted to match the active section

### Offline behavior (hybrid)

- The app shell (all routes, components, fonts, CSS, JS) is always available offline
- Recipes the user has opened are available offline (image, ingredients, steps)
- The current week's menu and shopping list are available offline (last cached version)
- A "Sin conexión" banner appears at the top when the device is offline
- Mutations made offline (favorite a recipe, check a shopping item, mark stock, regenerate a meal) are **queued** and replayed automatically when connectivity returns
- The user sees an inline "Pendiente de sincronizar" indicator on items still in the queue
- Viewing recipes that haven't been opened before doesn't work offline (shows a friendly fallback)

### Native gestures and transitions

- Users can **swipe horizontally** between the 5 bottom-tab routes (menu ↔ compra ↔ recetas ↔ asesor ↔ perfil) with a pan gesture
- The gesture has edge-resistance, a 30% width threshold to confirm, and snaps back if released before threshold
- The active-tab pill on the bottom nav animates between tabs using `layoutId`
- All page navigation uses the View Transitions API (fade between routes) when supported, falling back to `motion/react` cross-fade

### Haptic feedback

- Light vibration (10ms) on: tab change, chip filter selection, expand/collapse
- Medium vibration (20ms) on: item check in shopping list, favorite toggle, meal regeneration confirmed
- Strong (30ms double-tap pattern) on: destructive confirmation (delete recipe)
- Falls back to no-op silently if `navigator.vibrate` is unavailable (iOS Safari ignores it)

### Sharing

- Users can share a recipe via the native share sheet (`navigator.share`) — sends recipe URL + name
- Users can share their shopping list as text via the native share sheet
- The "Exportar" button in shopping uses Web Share when available, falls back to clipboard

### Cooking mode (Wake Lock)

- When the recipe detail's "Empezar a cocinar" button is tapped, the screen stays awake (`navigator.wakeLock.request('screen')`)
- A small badge appears: "Pantalla activa"
- The lock is released when the user navigates away or taps the badge to disable

### Local notifications

- Users can opt in to meal-time reminders from the profile page
- After permission is granted, the app schedules **local** notifications based on the user's `mealTemplate` and meal-time preferences
- A notification fires at the configured times (e.g., "Es hora de comer · Pollo al limón con verduras")
- Tapping a notification opens the corresponding recipe
- Notifications are scheduled client-side via `setTimeout` and re-armed each time the app is opened
- The user can disable reminders globally or per meal type from profile

## Constraints

- **iOS Safari** does not support: `beforeinstallprompt`, `Vibration API`, `Notifications API` (in non-installed PWAs prior to iOS 16.4 — only the installed PWA supports them on 16.4+), Web Share for arbitrary file types
- **Background Sync API** is Chromium-only; on other browsers, queued mutations replay on the next app open instead of in the background
- **Wake Lock API** is supported on Chromium and Safari 16.4+; falls back to no-op
- **Notifications scheduled with `setTimeout`** only fire while the page is alive — they're a best-effort approximation, not a substitute for server-side push (deferred to a future spec)
- **View Transitions API** is Chromium-only as of writing; the `motion/react` fallback covers the rest
- The service worker only caches GET requests; all mutations go through the network or the offline queue
- Recipe images are cached up to 200 entries / 50 MB with LRU eviction
- The app shell precache is invalidated on every deploy (Workbox versioning)

## Asset Requirements (user-supplied)

The user will provide a single source logo. From it, the following must be generated **externally** (Figma / Canva / a script) and dropped into the paths listed:

| File | Size | Purpose |
|------|------|---------|
| `public/icons/icon-192.png` | 192×192 | Android home screen, manifest |
| `public/icons/icon-512.png` | 512×512 | Android splash, manifest |
| `public/icons/icon-192-maskable.png` | 192×192 | Android adaptive icon (safe area in center 80%) |
| `public/icons/icon-512-maskable.png` | 512×512 | Android adaptive icon |
| `public/icons/icon-monochrome.png` | 512×512 | Android themed icon (alpha mask, single-color) |
| `public/icons/apple-touch-icon.png` | 180×180 | iOS home screen |
| `public/favicon.ico` | 16/32 multi-res | Browser tab |
| `public/icons/splash-2048x2732.png` | iPad Pro 12.9 portrait | iOS splash |
| `public/icons/splash-1668x2388.png` | iPad Pro 11 portrait | iOS splash |
| `public/icons/splash-1536x2048.png` | iPad mini/Air portrait | iOS splash |
| `public/icons/splash-1290x2796.png` | iPhone 14 Pro Max | iOS splash |
| `public/icons/splash-1179x2556.png` | iPhone 14 Pro / 15 | iOS splash |
| `public/icons/splash-1170x2532.png` | iPhone 13/14/15 | iOS splash |
| `public/icons/splash-1125x2436.png` | iPhone X/11 Pro/12 mini | iOS splash |
| `public/icons/splash-1242x2688.png` | iPhone 11 Pro Max / XS Max | iOS splash |

Maskable icons must keep the logo within the central 80% safe-zone. Splash screens use the editorial cream `#FAF6EE` background with the centered logo. The monochrome icon is a single-color silhouette with alpha.

## Theme Colors

- App routes (`/menu`, `/shopping`, etc.): `theme-color = #FAF6EE` (cream)
- Public/landing routes: `theme-color = #1A1612` (ink) when scrolled past hero, cream above
- Status bar style: `black-translucent` (content draws under it; `safe-area-inset-top` reserves space)

## Manifest

`public/manifest.webmanifest` (planned) with:
- `name: "ONA — El placer de cocinar sin pensar"`
- `short_name: "ONA"`
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

## Related specs

- [Design System](./design-system.md) — theme colors, fonts, safe-area conventions
- [Auth](./auth.md) — `start_url` behavior depends on auth state
- [Recipes](./recipes.md) — cooking mode wake lock attaches to recipe detail
- [Shopping](./shopping.md) — share via Web Share, offline mutation queue
- [Menus](./menus.md) — meal-time notifications use `mealTemplate`

## Source (planned paths — do not exist yet)

- `apps/web/next.config.ts` — `next-pwa` plugin wiring
- `apps/web/public/manifest.webmanifest` — manifest
- `apps/web/public/icons/` — icon and splash asset set
- `apps/web/src/app/layout.tsx` — manifest link, viewport, apple-touch meta tags, status bar style, theme-color (already partly set up)
- `apps/web/src/lib/pwa/installPrompt.ts` — `beforeinstallprompt` capture, visit-count gating, dismissal persistence (localStorage)
- `apps/web/src/components/pwa/InstallSheet.tsx` — bottom sheet with Android + iOS instructions
- `apps/web/src/components/pwa/OfflineBanner.tsx` — connection-status banner
- `apps/web/src/lib/pwa/haptics.ts` — `navigator.vibrate` wrapper with named patterns (light/medium/strong)
- `apps/web/src/lib/pwa/share.ts` — `navigator.share` wrapper with clipboard fallback
- `apps/web/src/lib/pwa/wakeLock.ts` — Wake Lock acquire/release helpers
- `apps/web/src/lib/pwa/notifications.ts` — permission flow, scheduling from `mealTemplate`, re-arm on app open
- `apps/web/src/lib/pwa/offlineQueue.ts` — IndexedDB-backed mutation queue, replay on `online` event
- `apps/web/src/components/pwa/PageTransition.tsx` — View Transitions API + `motion/react` fallback
- `apps/web/src/components/shared/Navbar.tsx` — extend with swipe gesture between tabs
