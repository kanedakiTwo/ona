# Notifications

Server-side Web Push notifications that survive a closed tab — the foundation for prep-time alerts ("saca el pescado del congelador 24h antes"), menu reminders, and any future event the assistant decides is worth waking the user up for.

## User Capabilities

- Users can opt in to push notifications from `/profile` → card "Recordatorios" → «Notificaciones del móvil» → "Activar notificaciones". The browser asks for permission; on grant, the subscription is registered server-side. Without WhatsApp, the prep alerts arrive here; with WhatsApp, only when a WhatsApp alert can't go out (see *Channels*).
- Users can send a test push from the same card (its "···" sheet → "Enviar prueba"; while not subscribed the sheet offers "Reparar service worker" instead) to confirm the pipe end-to-end without waiting for a real event.
- Users can opt out with "Desactivar"; the row is deleted in the API and the browser subscription unregistered.
- On iOS, push only works when the user has installed the PWA to the home screen first. The card surfaces a tip when the browser reports no support.

## Architecture

```
Browser                                 Mimoia API                                  Browser push service
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
  - `notificationclick` → closes the notification and either focuses an open Mimoia tab matching the embedded URL, or opens a new one.

## API Endpoints

- `GET /push/public-key` (no auth) — returns `{ publicKey }`. 503 when VAPID is not configured. Used as a runtime feature-detection fallback (the canonical source for the frontend is the `NEXT_PUBLIC_VAPID_PUBLIC_KEY` build env).
- `POST /push/subscribe` (auth) — body `{ subscription: { endpoint, keys: { p256dh, auth } }, userAgent? }`. Upserts on the endpoint. Returns 200/201 + `subscriptionId`.
- `DELETE /push/subscribe` (auth) — body `{ endpoint }`. 204 on success. Used on logout and explicit user opt-out.
- `GET /notifications/prefs` (auth) — the «Avisos» list: `{ whatsapp: { linked, notify }, push: { subscribed }, kinds: AlertRow[] }`. `PATCH /notifications/prefs` (auth) — body `{ prefs: { <kind>: boolean } }`, returns the same list (PRO-237).
- `POST /push/test` (auth) — sends a "Mimoia · Test" notification to every active subscription of the caller. Returns the `{ sent, failed, removedDeadSubscriptions }` from `sendPushToUser`. 503 when VAPID is missing.

## Notification scheduler (heartbeat)

The push transport above is the *delivery* mechanism; the *timing* lives in `notification_schedule` + a periodic tick. The pipeline:

  1. **Enqueue** at the moment something interesting happens — the recipe planner (`POST /menu/generate`, the assistant's `generate_weekly_menu`) and, since PRO-220, every hand pick of a dish (the swap in `PUT /menu/:menuId/day/:day/meal/:meal`, regenerating a meal, `POST …/dish`, `…/dish/random`, `…/dish/:position/regenerate`), which clear the menu's pending alerts and rebuild them (`refreshPrepAlerts`). The function `enqueuePrepAlertsForMenu(menuId, now?)`:
     - **first, the recipe's own «preparativos con antelación»** (`recipes.advance_prep`, PRO-220, D-069), **with no prep habits needed** (they belong to the recipe, not to the household): one row per preparativo, `fireAt = cookTime − hoursBefore`, key `menu:<id>:day:<n>:meal:<m>:recipe:<recipeId>:prep:<i>`, title «Acuérdate: <texto>», body «Para la cena del jueves: <receta>.». **Never in the past** (`planRecipePrep`): if that time already went by (the dish was picked late, e.g. at 13:00 for a 14:30 meal), a short preparativo (≤ 3 h, `LATE_PREP_MAX_HOURS`) with at least half its time left goes out **now** («Para la comida: saca el filete del frigorífico» / «Hazlo ya, que aún da tiempo (<receta>).»); a long one (a 10 h soak) schedules nothing. A recipe with preparativos only keeps its ingredients' **thaw** alerts below (thawing still needs to know the household freezes, PRO-221),
     - **every prep alert carries `payload.priority = 1`** (`PREP_ALERT_PRIORITY`): first in the weekly cap (PRO-215, D-069),
     - then the ingredient-based ones: loads the user's `prep_habits` from `user_memories` — **if empty, none of these** (opt-in by design: no habit → no ingredient alert),
     - loads the meal-time defaults (`user_memories.meal_times`, falling back to 09:00 / 14:00 / 17:00 / 21:00 Spanish defaults). These are **Europe/Madrid wall-clock** times, DST-aware (`resolveCookAt` → `madridWallTimeUtc`). Before 2026-10-07 they were applied in the server's UTC, so alerts fired 1–2 h late,
     - flattens the menu's `days` into `(dayIndex, meal, recipeId)` tuples (leftover slots skipped — they share their source's alerts),
     - joins each recipe's ingredients against `ingredients.prep_requirements` to find rows with a non-null requirement,
     - matches each method against the user's habits via `HABIT_KEYWORDS_BY_METHOD` (regex per method — `congel|descongel` triggers thaw, `remoj` triggers soak, etc). Since PRO-221 the sign-up asks «¿Congeláis la carne o el pescado cuando compráis?», so a new household can get «hoy toca descongelar» in its trial without having told Mimo; when every freezing habit says «a veces» (`thawIsConditional`), a thaw alert's text is «Si lo tienes congelado, sácalo hoy.» (`THAW_CONDITIONAL_TEXT`),
     - computes `fireAt = cookTime − PREP_METHOD_HOURS_BEFORE[method]`,
     - inserts one `notification_schedule` row per surviving (slot × ingredient × method), for the menu's owner or, on a day someone was named cook (`cook_of_day`, PRO-230), for that person, with a `dedup_key` = `menu:<id>:day:<n>:meal:<m>:ing:<id>:method:<x>` so re-enqueuing after a swap is idempotent. `INSERT … ON CONFLICT DO NOTHING` semantics via the unique constraint.
  2. **Swap path** also calls `clearPendingForMenu(menuId)` before the re-enqueue — pending rows tied to the menu are dropped so old-recipe alerts disappear cleanly. Already-sent rows are kept for audit.
  3. **Checked right before sending (since 2026-10-12).** Other changes don't re-enqueue (regenerating the week creates a new menu row; skipping a day, notes, moves and the assistant's REST paths don't touch alerts), so on 2026-10-10/11 alerts went out for dishes no longer in the menu. Each due prep alert (`dedup_key` `menu:…`, ingredient or recipe preparativo) is checked by `prepAlertStaleReasonFor` → pure `prepAlertStaleReason`: the menu must still be the newest for its week (same household or user, like the shopping list), the day must not be in `skippedDays`, and that slot must still hold a recipe using the alert's ingredient (for a recipe preparativo: that same recipe). Otherwise the row becomes `cancelled` with `error_message = "cancelado al enviar: <motivo>"` and nothing is sent. A failed check sends the alert as before. Tests in `mimoBrain.test.ts`.
  3. **Tick** — `startScheduler()` is called from `apps/api/src/index.ts` at boot. It runs a `setInterval` every 5 min (configurable). On each tick `tickScheduler()` does `SELECT * FROM notification_schedule WHERE status='pending' AND fire_at <= now()`, groups the live rows per user, passes them through the weekly budget (below) and dispatches them merged via `sendPushToUser`, then updates `status` to `'sent'` or `'failed'` with `sent_at` and an optional `error_message`.

Migration `0022_notification_schedule.sql` adds the table + the `(fire_at, status)` index used by the poll. Failure modes: a missing VAPID configuration causes the dispatch to fail and the row to land in `status='failed'` with `error_message='push-not-configured'`; the user can opt in later and a manual re-run is trivial. The tick never throws — DB errors are logged and the loop continues.

**One channel per alert** (PRO-234; see *Channels* below). The rows due for one person in a tick are one moment (PRO-215, below): the weekly budget picks which go, and they go merged, as one message, by WhatsApp when the person linked a phone with "Avisos por WhatsApp" and prep alerts on (`whatsAppAlertState` → `ready`); by Web Push only when WhatsApp fails or isn't there. A person who switched prep alerts off (`kind_off`, in WhatsApp's prefs or in Perfil → Avisos) gets nothing: the row becomes `cancelled` («aviso apagado») and spends nothing. The row is `sent` with the first channel that delivers, otherwise `failed` with each channel's reason (`whatsapp: outside-24h-window · push: no-push-subscription`). Web Push only counts as delivered when at least one device got it. The same tick also runs `runProactiveTick` (WhatsApp daily brief + Sunday menu nudge). Menus generated by the assistant (`generate_weekly_menu`, web chat or WhatsApp) now call `enqueuePrepAlertsForMenu` too, like `POST /menu/generate`.

Ticks never overlap. Within a process, `startScheduler` skips a tick while the previous one is still running, because WhatsApp sends can make a tick outlast the interval. **Across processes**, every tick runs under a Postgres session advisory lock (`withSchedulerLock`, key `SCHEDULER_LOCK_KEY`). Railway starts the new container before stopping the old one, so during a deploy two schedulers would otherwise send the same alert or brief; the one that doesn't get the lock skips that tick. If the process dies, Postgres releases the lock.

This spec covers the transport AND the heartbeat. Event sources beyond the prep-alert pipeline (assistant reflection, menu reminders, etc) plug in by calling `db.insert(notificationSchedule)` directly with a `fireAt` + `payload` + a stable `dedupKey`.

## Tope semanal de avisos (PRO-215, D-069)

Mimo writes little: every aviso it sends by itself (prep alerts by WhatsApp or push, and the WhatsApp proactive messages) goes through one budget per household (`services/notifications/budget.ts` rules, `budgetStore.ts` DB).

- **4 messages per household and ISO week** (Europe/Madrid; `WEEKLY_NOTICE_BUDGET`, one constant). **No daily cap:** a day where several coincide isn't penalised. The household is the user's primary household (each user alone without one).
- **Counts messages, not topics.** Everything due for one person in one scheduler tick goes out as **one message** (prep alerts: one message by one channel (see *Channels*), «Acuérdate: Merluza y Garbanzos» with a line each, `mergeAlertPayloads`; WhatsApp proactive messages: each written from its guide, then joined, the first one with buttons keeping them, `mergeMessages`) and spends one unit. Two people of the same house reached in the same tick spend one unit between them.
- **Never count:** the morning brief (`daily_brief`, only for whoever asked, see [WhatsApp](./whatsapp.md)), replies to what the person writes (they don't go through here), account emails, the day-7 offer and the 15-day charge notice (D-056) and the admins' daily review.
- **Priority** (`NOTICE_PRIORITY`): 1 = no fix if forgotten (`prep_alerts`, `cooking_reminder`); 2 = food that goes off (no kind yet); 3 = helps to plan (`shopping_reminder`, `weekly_nudge`); 4 = the rest (`dinner_checkin`, unknown kinds).
- **Reserve:** a moment with priority 1 goes while the week has a unit left. A moment with only priority 2–4 goes only if a unit is left **after** the priority-1 moments already known for the rest of the week: pending prep alerts of the household, and cooking reminders of this week's dinners of 40+ min when someone in the house gets them (`reservedP1For`; avisos less than 5 min apart are one moment).
- **Every candidate is logged** in `notice_candidates` (migration `0076_notice_candidates.sql`): household key, user, kind, priority, outcome (`enviado`, `fusionado` = went inside another's message, `descartado_tope`, `fuera_ventana` = Meta's 24 h window without a template, `fallido`), whether it spent the unit, channel and ISO week. The budget is counted from these rows. A dropped prep alert becomes `cancelled` with «tope semanal de avisos». A logged kind is in its cooldown like a sent one, so a dropped aviso isn't re-tried every 5 minutes.
- A prep alert with no push subscription reached and no WhatsApp is not delivered (before 2026-10-19 a user with no subscription counted as `sent`).
- **A fallback is the same message** (PRO-234): when WhatsApp can't carry the moment and it goes out as a phone notification instead, it is still one message — one `enviado` row, one unit, `channel = push` (`momentDelivery` in `outbound.ts`, `prepMomentDelivery` in the scheduler). A kind switched off in «Avisos» is not a candidate (no row, no unit).
- Limitation: a prep alert and a WhatsApp proactive message due in the same tick still go as two messages (they spend one unit).

## Horario y avisos del hogar (PRO-236, D-080)

- **Never before 08:00 nor after 22:30** (Europe/Madrid, `services/notifications/hours.ts`). The scheduler tick sends no prep alert and runs no WhatsApp proactive message outside those hours; due alerts wait for 08:00.
- **What can't come late moves earlier:** a prep alert whose time falls in the night (e.g. «en remojo toda la noche» for a 14:00 lunch → 02:00) is enqueued for **22:25 the evening before**; if that has already passed when the menu is made, for the next 08:00 if that's still before the meal; otherwise it isn't enqueued (`awakeFireAt`).
- **What can wait just waits** or moves inside the hours: «¿hiciste la cena?» goes 2–3 h after dinner but never after 22:30 — with dinner at 21:00 it's 22:00–22:30; with dinner after 21:00 there is none that day (it must be at least 1 h after dinner).
- **Household avisos to one person** (`recipient.ts`): with the household sharing menu and list (`SHARED_HOUSEHOLD_SCOPE`), the shopping reminder and the Sunday nudge go only to whoever manages the household (owner); if the owner turned that aviso off or gets no avisos, to the next person who gets it (by join date). To have it go to someone else, the owner asks Mimo to turn it off for them. The rest (cooking, check-in, prep alerts, the morning brief) stay per person.

## Channels: one alert, one channel

D-080 (PRO-234, `services/notifications/channels.ts`, tests in `notificationChannels.test.ts`). Before 2026-10-19 the prep alerts went by Web Push **and** WhatsApp at once.

| Alert | With WhatsApp linked and avisos on | Without WhatsApp |
|---|---|---|
| Morning menu (only if asked for), start cooking, «¿hiciste la cena?», Saturday shopping, Sunday planning, monthly freezer review | WhatsApp only | Doesn't go out |
| Prep alerts (freezer, soak…) | WhatsApp only | Phone notification (Web Push) |
| Welcome, password, invitations, newsletter, trial day 12, legal notice 15 days before the first charge | Email (the legal notice also in the app) | Email |
| Day-7 founder offer | In the app + Mimo on WhatsApp (inside the 24 h window) | In the app + email |

- **Fallback only if it fails** (`channelsFor` → `deliverInOrder`): outside the 24 h window without an approved template, or a Meta error, the alert goes by the phone notification if the person turned it on; otherwise it stays as not sent. The next channel is never tried when the first delivered, so nothing arrives twice. For Mimo's WhatsApp messages (`runProactiveTick` → `sendMoment`) the fallback is the whole merged moment as one notification, at most once per kind and Madrid day (`fallback:<kind>:<userId>:<YYYY-MM-DD>` row in `notification_schedule`).
- Channels and the weekly budget, the 08:00–22:30 hours and the household recipient work together: the budget decides which avisos of the moment go, the moment goes by one channel, and a fallback doesn't spend a second unit.
- A kind switched off (Perfil → Avisos, `users.alert_prefs`, or `whatsapp_links.prefs`) goes out by no channel.
- The local meal-time notification «Es hora de comer» (browser `setTimeout`, profile times) was **removed**: it repeated the morning menu with other hours and only rang with the app open.

## Avisos (Perfil → Avisos)

PRO-237 (D-080). `/profile/avisos`, linked from Perfil → Recordatorios → «Avisos». Users can:
- see every alert Mimo sends first — Menú del día (off until asked for, PRO-215), Hora de empezar a cocinar, Sacar del congelador y poner en remojo, ¿Hiciste la cena?, ¿Toca compra?, Domingo de planificar, Repaso del congelador — with one line on **where it arrives** («Por WhatsApp · si no sale, notificación del móvil», «Notificación del móvil», «Apagado», or why it doesn't: «Solo llega por WhatsApp.», «Conecta WhatsApp o activa las notificaciones del móvil.», «Activa los avisos por WhatsApp.»);
- switch each one on or off (saved on tap; off = off on every channel);
- see the state of WhatsApp and the phone notification (link back to Perfil), and that email only carries the account plus the Friday menu (its switch, the same as in Perfil).

The rows come from `buildAlertRows` (`@ona/shared`, `types/alerts.ts`), the same rules as *Channels*. Switches live in `users.alert_prefs` (migration `0081_alert_prefs`, missing key = on — except the morning menu `daily_brief`, which is opt-in (PRO-215: on only if some store says on, `ALERT_OPT_IN_KINDS`)) and are mirrored into `whatsapp_links.prefs` when WhatsApp is linked; a kind is off if either says off (`mergeAlertPrefs`, read by `runProactiveTick` and the prep-alert tick). Turning a kind on with WhatsApp linked also turns on «Avisos por WhatsApp». `PATCH /whatsapp/link { prefs }` goes through the same code.

**Mimo (D-051, web chat and WhatsApp):** `get_alerts` reads the same list («¿qué avisos tengo?», «¿por dónde me avisas?») and `set_alerts { kind | all, enabled }` flips the same switches («no me mandes el menú del día»); `all` with WhatsApp linked also flips «Avisos por WhatsApp»; `all` on never turns on the morning menu. `set_whatsapp_notifications` (before PRO-237 the only way) stays and goes through the same code. Switching a kind off here also logs `notifications_off` (PRO-216).

Tests: `alertPrefs.test.ts` (rows, merge, both skills on both channels), `apps/web/e2e/profile-avisos.spec.ts` (390×844).

## Required env vars

API (`ona-api` on Railway):
- `VAPID_PUBLIC_KEY` — base64url public key from `web-push generate-vapid-keys`.
- `VAPID_PRIVATE_KEY` — matching base64url private key.
- `VAPID_SUBJECT` — defaults to `mailto:hola@mimoia.com`. Must be a `mailto:` or `https://` URL per RFC 8292.

Web (`ona-web` on Railway):
- `NEXT_PUBLIC_VAPID_PUBLIC_KEY` — the same public key as the API. Baked into the client bundle at build time.

When any of these is missing the pipe degrades to "not configured" instead of crashing the server; the Profile card hides the button.

## Known Limitations

- iOS Safari ships push only inside an installed PWA (home-screen icon). The Profile card surfaces a hint when `isWebPushSupported()` returns false.
- Payload size limit ~4 KB per RFC 8030. Mimoia's payloads (`{ title, body, url, tag }`) sit well under that.

## Related specs

- [User Memory](./user-memory.md) — `prep_habits` memory key (PR-A) drives which ingredient-based prep alerts fire for which user (the recipe's own preparativos don't need it, PRO-220).
- [Recipes](./recipes.md) — `ingredients.prep_requirements` (PR-C) is the input table for "needs to be defrosted 24h before"; `recipes.advance_prep` (PRO-220) holds the recipe's preparativos.
- [Menus](./menus.md) — `POST /menu/generate` and `swap_meal` are the events that enqueue prep alerts via the scheduler (PR-D).

## Source

- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) — `pushSubscriptions` + `notificationSchedule` tables
- [apps/api/src/db/migrations/0020_push_subscriptions.sql](../apps/api/src/db/migrations/0020_push_subscriptions.sql)
- [apps/api/src/db/migrations/0022_notification_schedule.sql](../apps/api/src/db/migrations/0022_notification_schedule.sql)
- [apps/api/src/services/pushNotifier.ts](../apps/api/src/services/pushNotifier.ts) — VAPID-configured dispatcher with dead-endpoint reaping
- [apps/api/src/services/notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts) — enqueue / clear / tick / start
- [apps/api/src/services/notifications/budget.ts](../apps/api/src/services/notifications/budget.ts), [budgetStore.ts](../apps/api/src/services/notifications/budgetStore.ts) — weekly budget (PRO-215); tests `noticeBudget.test.ts`
- [apps/api/src/services/notifications/hours.ts](../apps/api/src/services/notifications/hours.ts), [recipient.ts](../apps/api/src/services/notifications/recipient.ts) — 08:00–22:30 and household avisos to one person (PRO-236); tests `noticeHours.test.ts`
- [apps/api/src/db/migrations/0076_notice_candidates.sql](../apps/api/src/db/migrations/0076_notice_candidates.sql)
- [apps/api/src/services/notifications/alertPrefs.ts](../apps/api/src/services/notifications/alertPrefs.ts), [apps/api/src/routes/notifications.ts](../apps/api/src/routes/notifications.ts), [packages/shared/src/types/alerts.ts](../packages/shared/src/types/alerts.ts) — «Avisos» switches and rows (PRO-237)
- [apps/web/src/app/profile/avisos/page.tsx](../apps/web/src/app/profile/avisos/page.tsx), [apps/web/src/hooks/useAlerts.ts](../apps/web/src/hooks/useAlerts.ts) — the «Avisos» screen
- [apps/api/src/db/migrations/0081_alert_prefs.sql](../apps/api/src/db/migrations/0081_alert_prefs.sql)
- [apps/api/src/services/notifications/channels.ts](../apps/api/src/services/notifications/channels.ts) — one channel per kind, fallback, push stand-in for WhatsApp messages (PRO-234)
- [apps/api/src/routes/push.ts](../apps/api/src/routes/push.ts) — `/push/*` endpoints
- [apps/api/src/routes/menus.ts](../apps/api/src/routes/menus.ts) — calls `enqueuePrepAlertsForMenu` after `POST /menu/generate` and the manual swap path
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- [apps/api/src/index.ts](../apps/api/src/index.ts) — `startScheduler()` boot wiring
- [apps/web/worker/index.ts](../apps/web/worker/index.ts) — `push` + `notificationclick` handlers (compiled into the generated SW by `next-pwa`)
- [apps/web/src/lib/webPush.ts](../apps/web/src/lib/webPush.ts) — `isWebPushSupported`, `urlBase64ToUint8Array`, `getOrCreatePushSubscription`
- [apps/web/src/hooks/useWebPush.ts](../apps/web/src/hooks/useWebPush.ts) — React hook used by the Profile card
- [apps/web/src/app/profile/page.tsx](../apps/web/src/app/profile/page.tsx) — `PushNotificationsCard` component
