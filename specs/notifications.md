# Notifications

Server-side Web Push notifications that survive a closed tab — the foundation for prep-time alerts ("saca el pescado del congelador 24h antes"), menu reminders, and any future event the assistant decides is worth waking the user up for.

## User Capabilities

- Users can opt in to push notifications from `/profile` → chapter "Recordatorios" → "Activar notificaciones". The browser asks for permission; on grant, the subscription is registered server-side.
- Users can send a test push from the same card ("Enviar prueba") to confirm the pipe end-to-end without waiting for a real event.
- Users can opt out with "Desactivar"; the row is deleted in the API and the browser subscription unregistered.
- On iOS, push only works when the user has installed the PWA to the home screen first. The card surfaces a tip when the browser reports no support.

## Architecture

```
Browser                                 ONA API                                  Browser push service
                                                                                   (FCM / Mozilla / APNs)
                                                                                            │
useWebPush hook                                                                             │
  └ pushManager.subscribe(VAPID public key)                                                 │
       │                                                                                    │
       │  endpoint + p256dh + auth                                                          │
       ▼                                                                                    │
  POST /push/subscribe ─────────────► push_subscriptions table (one row per browser)        │
                                                                                            │
                              [event fires somewhere — e.g. menu generator]                 │
                                          │                                                 │
                                          ▼                                                 │
                                  sendPushToUser(userId, payload)                           │
                                          │                                                 │
                                          ▼  web-push.sendNotification + VAPID claim        │
                                          ──────────────────────────────────────────────────▶
                                                                                            │
SW push event ◄──────────────────────────────────────────────────────────────────────────────
  └ self.registration.showNotification(title, body, url, ...)
```

- **VAPID keys**: one keypair per environment, generated once with `npx web-push generate-vapid-keys`. Public key is shipped to the browser via `NEXT_PUBLIC_VAPID_PUBLIC_KEY` (web env) AND exposed at `GET /push/public-key` for runtime feature detection. Private key (`VAPID_PRIVATE_KEY` on the API) never leaves the server.

- **Subscriptions table** (`apps/api/src/db/schema.ts` → `pushSubscriptions`):
  one row per `(user, endpoint)`. Endpoint is the natural key (browsers identify themselves by the unique URL returned from `pushManager.subscribe`). Each row holds the ECDH public key + auth secret needed to encrypt the payload. `lastUsedAt` updates on every successful dispatch. Dead rows (404/410 from the push service) are reaped automatically by `sendPushToUser`.

- **Dispatch** (`apps/api/src/services/pushNotifier.ts` → `sendPushToUser`):
  best-effort wrapper around `web-push.sendNotification`. Never throws — partial failures are reported in the return value (`{ sent, failed, removedDeadSubscriptions }`). When VAPID env vars are absent the call throws `PushNotConfiguredError`; route handlers turn that into a 503 with a friendly message.

- **Service worker** (`apps/web/worker/index.ts`, injected by `next-pwa`):
  handles two events:
  - `push` → renders `self.registration.showNotification(title, { body, icon, badge, data: { url }, tag })`. The payload is JSON the API ships; the SW degrades gracefully if it isn't.
  - `notificationclick` → closes the notification and either focuses an open ONA tab matching the embedded URL, or opens a new one.

## API Endpoints

- `GET /push/public-key` (no auth) — returns `{ publicKey }`. 503 when VAPID is not configured. Used as a runtime feature-detection fallback (the canonical source for the frontend is the `NEXT_PUBLIC_VAPID_PUBLIC_KEY` build env).
- `POST /push/subscribe` (auth) — body `{ subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }`. Upserts on the endpoint. Returns 200/201 + `subscriptionId`.
- `DELETE /push/subscribe` (auth) — body `{ endpoint }`. 204 on success. Used on logout and explicit user opt-out.
- `POST /push/test` (auth) — sends an "Ona · Test" notification to every active subscription of the caller. Returns the `{ sent, failed, removedDeadSubscriptions }` from `sendPushToUser`. 503 when VAPID is missing.

## Notification scheduler (heartbeat)

The push transport above is the *delivery* mechanism; the *timing* lives in `notification_schedule` + a periodic tick. The pipeline:

  1. **Enqueue** at the moment something interesting happens — today the only event source is the recipe planner (`POST /menu/generate` and the manual `swap_meal` path in `PUT /menu/:menuId/day/:day/meal/:meal`). The route calls `enqueuePrepAlertsForMenu(menuId)` after the persist returns. The function:
     - loads the user's `prep_habits` from `user_memories` — **if empty, returns immediately** (opt-in by design: no habit → no alert),
     - loads the meal-time defaults (`user_memories.meal_times`, falling back to 09:00 / 14:00 / 17:00 / 21:00 Spanish defaults),
     - flattens the menu's `days` into `(dayIndex, meal, recipeId)` tuples (leftover slots skipped — they share their source's alerts),
     - joins each recipe's ingredients against `ingredients.prep_requirements` to find rows with a non-null requirement,
     - matches each method against the user's habits via `HABIT_KEYWORDS_BY_METHOD` (regex per method — `congel|descongel` triggers thaw, `remoj` triggers soak, etc),
     - computes `fireAt = cookTime − PREP_METHOD_HOURS_BEFORE[method]`,
     - inserts one `notification_schedule` row per surviving (slot × ingredient × method) with a `dedup_key` = `menu:<id>:day:<n>:meal:<m>:ing:<id>:method:<x>` so re-enqueuing after a swap is idempotent. `INSERT … ON CONFLICT DO NOTHING` semantics via the unique constraint.
  2. **Swap path** also calls `clearPendingForMenu(menuId)` before the re-enqueue — pending rows tied to the menu are dropped so old-recipe alerts disappear cleanly. Already-sent rows are kept for audit.
  3. **Tick** — `startScheduler()` is called from `apps/api/src/index.ts` at boot. It runs a `setInterval` every 5 min (configurable). On each tick `tickScheduler()` does `SELECT * FROM notification_schedule WHERE status='pending' AND fire_at <= now()`, dispatches each via `sendPushToUser`, and updates `status` to `'sent'` or `'failed'` with `sent_at` and an optional `error_message`.

Migration `0017_notification_schedule.sql` adds the table + the `(fire_at, status)` index used by the poll. Failure modes: a missing VAPID configuration causes the dispatch to fail and the row to land in `status='failed'` with `error_message='push-not-configured'`; the user can opt in later and a manual re-run is trivial. The tick never throws — DB errors are logged and the loop continues.

This spec covers the transport AND the heartbeat. Event sources beyond the prep-alert pipeline (assistant reflection, menu reminders, etc) plug in by calling `db.insert(notificationSchedule)` directly with a `fireAt` + `payload` + a stable `dedupKey`.

## Required env vars

API (`ona-api` on Railway):
- `VAPID_PUBLIC_KEY` — base64url public key from `web-push generate-vapid-keys`.
- `VAPID_PRIVATE_KEY` — matching base64url private key.
- `VAPID_SUBJECT` — defaults to `mailto:hola@ona.app`. Must be a `mailto:` or `https://` URL per RFC 8292.

Web (`ona-web` on Railway):
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the same public key as the API. Baked into the client bundle at build time.

When any of these is missing the pipe degrades to "not configured" instead of crashing the server; the Profile card hides the button.

## Known Limitations

- iOS Safari ships push only inside an installed PWA (home-screen icon). The Profile card surfaces a hint when `isWebPushSupported()` returns false.
- The current `setTimeout`-based local notifications (see [pwa.md](./pwa.md)) remain — they're cheaper to fire from inside an already-open tab and don't need server round-trips. Web Push is the durable channel; local timers are the convenience layer.
- Payload size limit ~4 KB per RFC 8030. ONA's payloads (`{ title, body, url, tag }`) sit well under that.

## Related specs

- [User Memory](./user-memory.md) — `prep_habits` memory key (PR-A) drives which prep alerts fire for which user.
- [Recipes](./recipes.md) — `ingredients.prep_requirements` (PR-C) is the input table for "needs to be defrosted 24h before".
- [Menus](./menus.md) — `POST /menu/generate` and `swap_meal` are the events that enqueue prep alerts via the scheduler (PR-D).

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `pushSubscriptions` + `notificationSchedule` tables
- [apps/api/src/db/migrations/0015_push_subscriptions.sql](../apps/api/src/db/migrations/0015_push_subscriptions.sql)
- [apps/api/src/db/migrations/0017_notification_schedule.sql](../apps/api/src/db/migrations/0017_notification_schedule.sql)
- [apps/api/src/services/pushNotifier.ts](../apps/api/src/services/pushNotifier.ts) — VAPID-configured dispatcher with dead-endpoint reaping
- [apps/api/src/services/notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts) — enqueue / clear / tick / start
- [apps/api/src/routes/push.ts](../apps/api/src/routes/push.ts) — `/push/*` endpoints
- [apps/api/src/routes/menus.ts](../apps/api/src/routes/menus.ts) — calls `enqueuePrepAlertsForMenu` after `POST /menu/generate` and the manual swap path
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- [apps/api/src/index.ts](../apps/api/src/index.ts) — `startScheduler()` boot wiring
- [apps/web/worker/index.ts](../apps/web/worker/index.ts) — `push` + `notificationclick` handlers (compiled into the generated SW by `next-pwa`)
- [apps/web/src/lib/webPush.ts](../apps/web/src/lib/webPush.ts) — `isWebPushSupported`, `urlBase64ToUint8Array`, `getOrCreatePushSubscription`
- [apps/web/src/hooks/useWebPush.ts](../apps/web/src/hooks/useWebPush.ts) — React hook used by the Profile card
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — `PushNotificationsCard` component
