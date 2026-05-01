# PWA Manual Test Plan

This file lists the device-dependent tests for the PWA implementation. Each test must be run on a real device — the test cannot be automated from the controller environment.

## Prerequisites

- [ ] Icon assets dropped into `apps/web/public/icons/` per the spec asset table
- [ ] Production build runs (`pnpm -F @ona/web build`) — the pre-existing typecheck errors must be fixed first OR the build must be done with `next build --no-lint` (which next.config doesn't currently support; the typecheck must pass)
- [ ] App accessible at a public URL or via local network (PWAs require HTTPS or localhost)

## Tests

### 1. Android Chrome — install
- Open the deployed URL on Android Chrome
- Visit the app at least 3 times to trigger the install prompt threshold
- Confirm the InstallSheet bottom sheet appears with "Añade ONA a tu inicio"
- Tap "Añadir a inicio" → native install dialog appears
- Accept; confirm app launches in standalone mode (no browser chrome) with cream theme color
- Tap the splash icon on home screen; confirm splash uses the configured colors

### 2. iOS Safari — install
- Open the deployed URL on iOS Safari
- Reach the install threshold (3 visits or 2nd /menu)
- Confirm the InstallSheet shows the iOS-specific 3-step instructions (share → Añadir a pantalla de inicio → Añadir)
- Follow them
- Launch from home screen; confirm splash screen renders, status bar is translucent, content respects safe-area-inset-top (no overlap with notch)

### 3. Lighthouse PWA score (Chromium)
- DevTools → Lighthouse → PWA category
- Score must be 100 (or address remaining audits)

### 4. Offline behavior
- DevTools → Network → Offline
- Confirm OfflineBanner slides down from top with "Sin conexión"
- Navigate to a recipe previously viewed → loads from cache (no errors)
- Check a shopping item → optimistic UI updates; Clock pending icon appears
- Toggle off Offline → confirm Clock icon disappears (queued mutation replays); banner slides up

### 5. Wake Lock cooking mode
- On a recipe detail page, tap "Empezar a cocinar"
- "Pantalla activa" badge appears (top-left, below back button)
- Lock the device with the power button → screen stays on for at least 30 seconds
- Tap badge → lock releases; tap "Salir de cocina" → same
- Navigate away → lock auto-releases (next idle the screen sleeps as normal)

### 6. Local notifications
- Profile → Capítulo 05 → toggle "Recibir recordatorios de comidas"
- Set the next meal time to 1 minute from now
- Leave the tab open
- After 1 minute, the notification fires
- Tap it → opens /menu

### 7. Haptics
- On Android (iOS Safari ignores Vibration API silently):
  - Tap a tab → light haptic
  - Toggle a favorite → medium haptic
  - Check a shopping item → medium haptic
  - Toggle stock → medium haptic
  - Tap regenerate menu → medium haptic
  - Tap share on a recipe → light haptic

### 8. Web Share
- On a recipe detail, tap the Share2 button in the hero overlay
- Native share sheet appears with the recipe URL + title
- On desktop (no native share): the URL is copied to clipboard

### 9. Page transitions
- Tap any tab in the bottom nav
- A subtle cross-fade plays between routes
- The active-pill animates from the previous tab to the new one (layoutId="nav-pill")

### 10. Swipe between tabs
- On any app route, swipe horizontally on the main content area
- Past 30% of viewport width, the page slides off and the next/previous tab loads
- At first/last tab, swipe-out direction has rubber-band resistance
- Vertical scrolling is preserved (e.g., scrolling the recipes list works normally)

## Known limitations / out of scope

- Pre-existing typecheck errors in `apps/web/src/app/recipes/*` and related files block `pnpm -F @ona/web build`. These are unrelated to the PWA work and must be fixed before a production build can succeed. Once fixed, all the above tests can run.
- Picovoice / OpenAI Realtime keys are required for the voice-mode feature on the same branch but are not part of the PWA scope.
- Icons and 8 splash screens must be supplied externally per the spec asset table — without them, manifest references will 404.
