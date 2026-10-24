# Android app (TWA)

Mimoia on Android as an app from the home screen or, later, from Google Play. It is a **Trusted Web Activity** (TWA): an APK that opens the Mimoia web app full screen, with Chrome underneath and no code of its own. Everything the web does works the same inside it (sign-in, the menu, Mimo by text and voice, Web Push, offline, cook mode, sharing), and whatever ships to the web reaches the app without a new build. No new API: the app is the web, on its own domain, with its own session.

## User Capabilities

- **«Mimoia (pruebas)»** (`com.mimoia.app.pruebas`) is the internal build: installed by download, never through a store, it sits next to the real one without mixing them up and opens **staging** (`https://ona-web-staging.up.railway.app`) full screen on `/menu`, with the web's session and notifications
- **«Mimoia»** (`com.mimoia.app`) is the Google Play app: same app, opens **`https://mimoia.com`** on `/menu`
- Both start on `/menu?app=android`. Signed out, the web sends the person to `/login?next=…` as it always does ([Auth](./auth.md)); today the web ignores `app=android`
- Notifications are the web's Web Push ([Notifications](./notifications.md)), shown under the app's name with the white spoon as small icon; on Android 13+ the app asks for the notification permission the first time the web asks for it
- The web declares both apps (**Digital Asset Links**, `/.well-known/assetlinks.json`), so each opens full screen with no address bar on its own host, and a link to that host (a recipe shared on WhatsApp, a menu link) opens in the app (`autoVerify`)
- Portrait only; the status and navigation bars are cream `#FAF6EE`; the icon is the web's `icon-192.png` (cream spoon on terracotta)

## Constraints

- **It is a TWA**: the phone needs Chrome (or another browser that supports TWAs). If the host doesn't serve a valid `/.well-known/assetlinks.json` declaring the app with the fingerprint of the key that signed it, the app still opens, but as a Custom Tab with an address bar on top
- **Permissions: only `INTERNET` and `POST_NOTIFICATIONS`**, `allowBackup="false"`, no code of its own: `LauncherActivity`, `DelegationService` and `NotificationPermissionRequestActivity` from `android-browser-helper` 2.7.4. minSdk 26, target/compile SDK 36, JDK 17, Android Gradle Plugin 8.13.2, Gradle 8.14.6
- **The declaration** is a static file, `apps/web/public/.well-known/assetlinks.json`, served by the web itself (200, `application/json`, no redirect; `www.mimoia.com` redirects to the apex like every path, the app uses the apex). The **same file on every environment** declares `com.mimoia.app.pruebas` and `com.mimoia.app` with the upload key's SHA-256 fingerprint; staging declaring the store app, or production the internal one, opens nothing, because each app trusts only its own host. It works only once the file is live on the host the app opens. The store app will also need Google's Play App Signing fingerprint next to the upload one (known only once the app exists in Play Console); without it the store app opens with an address bar
- **Installed before the declaration is live, it stays unverified**: Android checks the app's link host at install time; if `assetlinks.json` isn't served yet, it marks the domain as failed (state 1024) and doesn't retry on its own, so the app keeps the address bar and Chrome doesn't hand it the notifications («No service exists for scope»). Install it after the file is live, or reinstall it (with a cable: `adb shell pm verify-app-links --re-verify <package>`)
- **The small notification icon is a PNG per density** (`drawable-{mdpi…xxxhdpi}/ic_aviso.png`, 24 dp, white spoon on transparent, written by `icono-aviso.mjs` from `MIMOIA_SYMBOL_PATH`): Chrome asks the app for it as a bitmap, and with a vector drawable the notification shows Chrome's icon. `LauncherActivity` also creates a «Site settings» shortcut that opens `ManageDataLauncherActivity`, which the manifest must declare (without it the app crashes on launch, `IllegalArgumentException`)
- **Two flavours, two packages**: `pruebas` adds `.pruebas` to the package and points name, start URL, declared site and link host at staging; `tienda` points them at `mimoia.com`. The package name can't change after the first upload to Google Play
- **Not compiled in CI** (no Android SDK there): `androidApp.test.ts` reads the files and pins the contract — package, permissions, `allowBackup`, each flavour's name, start URL, link host and declared site
- Built on an Apple Silicon Mac: `sdk.sh` downloads the Android SDK and Gradle into `~/.cache/mimoia` (checksums verified, idempotent, no Android Studio)
- **Signing**: `construir.sh` signs both flavours with one **upload key** (RSA 3072, PKCS#12) kept outside any repo, in `~/.config/mimoia/firmas/`; it creates the key the first time with a random password it never prints. The internal build installs as signed; the store app is re-signed by Google (**Play App Signing**), so a lost upload key is replaced through Play Console («Integridad de la app» → «Solicitar restablecimiento»), not the end of the app
- `versionCode` = minutes since 2026-01-01 (`versionName` `1.<versionCode>`): it always grows, which Google Play requires on every upload, without depending on git

## Known limitations

- **Not on Google Play yet.** Before the store app ships, the web must stop offering to pay inside it (`/precios`, `/profile/suscripcion`, the pay notices): Google requires its own billing for in-app purchases, and the first store version sells nothing inside
- The installed-app counter (`POST /usage/app-opened`, [Metrics](./metrics.md)) can't tell the app from the installed web yet
- No iPhone app

## Related specs

- [PWA](./pwa.md) — the installable web the app wraps (manifest, offline, install prompt)
- [Notifications](./notifications.md) — Web Push, which the app shows under its own name
- [Billing](./billing.md) — paying stays on the web

## Source

- `apps/android/` — the TWA: `settings.gradle.kts`, `build.gradle.kts`, `gradle.properties`, `app/build.gradle.kts` (flavours `pruebas` / `tienda`, upload signing from the environment), `app/src/main/AndroidManifest.xml` (link host `${host}` from the flavour), `app/src/main/res/` (cream colour, launcher icon, notification spoon)
- `apps/android/sdk.sh` — Android SDK and Gradle in `~/.cache/mimoia`
- `apps/android/icono-aviso.mjs` — writes the notification icon PNGs from the brand's spoon (sharp from `apps/web`)
- `apps/android/construir.sh` — builds and signs into `apps/android/dist/` (git-ignored): `mimoia-pruebas-<versionCode>.apk` + `mimoia-pruebas.json` (`{versionCode, apk, sha256}`, what the download page reads), `mimoia-tienda-<versionCode>.aab` (for Google Play) and `huella-subida.txt` (the upload key's SHA-256 fingerprint, public)
- `apps/web/public/.well-known/assetlinks.json` — the declaration of both apps; `apps/web/e2e/assetlinks.spec.ts` checks it is served as JSON with both packages
- `apps/api/src/tests/androidApp.test.ts` — the app's contract (and the declaration's fingerprints)
