# Feedback (beta opinions box)

**Status:** shipped 2026-10-15 (Miguel: «un sitio rápido donde dejar tu feedback, desde WhatsApp y desde la app», before inviting the closed beta).

One box for what users want to tell the team about Mimoia itself: suggestions, things that don't work, what they miss or don't understand, complaints and thanks. Three ways in, same table, read by Miguel in Admin and by the agents in the morning brief.

## User Capabilities

- **«Opinión» button** (`FeedbackButton`, `data-testid="feedback-button"`): a small paper pill with a terracotta heart-message icon, fixed **bottom-left** on every signed-in page (Mimo's button is bottom-right): above the tab bar on mobile, next to the desktop sidebar at `md+`, above the recipe detail's action bar. Hidden in cook mode and during `/onboarding`. It opens a sheet «Danos tu opinión» («Lo que te sobra, lo que te falta, algo que no funciona o no entiendes… Cuéntanoslo con tus palabras. También puedes decírselo a Mimo, aquí o por WhatsApp.»), a text box (2–2000 characters) and «Enviar»; then «¡Gracias! Lo leemos todo. Nos ayuda muchísimo a hacer Mimoia.» and it closes by itself. The page it was sent from is saved.
- **Telling Mimo**, in the web chat or on WhatsApp («quiero dejar una sugerencia», «esto no funciona…», «deberíais…», «decidle al equipo…»): the `leave_feedback` tool saves the user's words verbatim (several messages joined), channel `chat` or `whatsapp`, and Mimo thanks them in a line. Recipe notes and food preferences are not feedback (memory).
- **Admin → Opiniones** (`/admin/opiniones`, sidebar item with the same icon): newest first, with the text, who (username + email), the channel («Botón de la app», «Mimo en la web», «Mimo por WhatsApp»), the page and the date; filters 7 / 30 / 90 days.
- **Morning brief:** the nightly Ejecución routine (ona-hq `loops/ejecucion.md`) reads the last day with the agents' token and summarises it, grouped by theme, without names.

## API

- `POST /feedback` (auth) `{ text, page?, channel? = 'app' }` → 201. 400 for empty, > 2000 characters or an unknown channel (`app | chat | whatsapp`).
- `GET /admin/feedback?days=30&limit=200` (admin JWT, or `x-metrics-token` for the agents) → `{ days, count, items[] }`, newest first. With the token, items carry no `username`/`email` and, since PRO-180 (2026-10-19), the text goes through the same anonymiser as the Mimo reviewer (`services/anonymise.ts`, `anonymiseFeedback` in `routes/feedback.ts`): names (every username and email handle in the batch, plus any name a text reveals after a cue such as «mi marido Antonio», masked in every item of the batch), emails, phones, addresses, DNI and IBAN → «[nombre]», «[email]», «[teléfono]»… (ona-hq: no personal data; the nightly snapshot can copy it to `data/`). The admin JWT still sees the text as written. Test: `feedback.test.ts`.

## Data

- `user_feedback` (migration `0051_user_feedback`): `user_id` (cascades when the account is deleted), `channel`, `text`, `page`, `created_at` (indexed).

## Constraints

- No reply to the user beyond the thanks; no status (new / read) yet.
- No email or WhatsApp alert to Miguel when one arrives (he chose the admin list + the brief).
- The Friday newsletter has no «Cuéntanos qué mejorarías» link yet (Marketing; noted in ona-hq).

## Source

- [apps/api/src/routes/feedback.ts](../apps/api/src/routes/feedback.ts)
- [apps/api/src/services/assistant/appSkills.ts](../apps/api/src/services/assistant/appSkills.ts) — `leave_feedback`
- [apps/api/src/db/migrations/0051_user_feedback.sql](../apps/api/src/db/migrations/0051_user_feedback.sql)
- [apps/web/src/components/feedback/FeedbackButton.tsx](../apps/web/src/components/feedback/FeedbackButton.tsx), mounted in the app shell [apps/web/src/components/shared/RootShell.tsx](../apps/web/src/components/shared/RootShell.tsx)
- [apps/web/src/app/admin/sections/FeedbackSection.tsx](../apps/web/src/app/admin/sections/FeedbackSection.tsx), [apps/web/src/lib/adminNav.ts](../apps/web/src/lib/adminNav.ts)
- Tests: `apps/api/src/tests/feedback.test.ts`, `apps/web/e2e/feedback.spec.ts`
