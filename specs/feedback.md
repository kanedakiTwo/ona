# Feedback (beta opinions box)

**Status:** shipped 2026-10-15 (Miguel: «un sitio rápido donde dejar tu feedback, desde WhatsApp y desde la app», before inviting the closed beta).

One box for what users want to tell the team about Mimoia itself: suggestions, things that don't work, what they miss or don't understand, complaints and thanks. Three ways in, same table, read by Miguel in Admin and by the agents in the morning brief.

## User Capabilities

- **«Opinión» button** (`FeedbackButton`, `data-testid="feedback-button"`): a small paper pill with a terracotta heart-message icon, fixed **bottom-left** on every signed-in page (Mimo's button is bottom-right): above the tab bar on mobile, next to the desktop sidebar at `md+`, above the recipe detail's action bar. Hidden in cook mode and during `/onboarding`, and — like Mimo's button — while a sheet is open or the keyboard is up (PRO-122, see [design-system.md](./design-system.md)). It opens a sheet «Danos tu opinión» («Lo que te sobra, lo que te falta, algo que no funciona o no entiendes… Cuéntanoslo con tus palabras. También puedes decírselo a Mimo, aquí o por WhatsApp.»), a text box (2–2000 characters) and «Enviar»; then «¡Gracias! Lo leemos todo. Nos ayuda muchísimo a hacer Mimoia.» and it closes by itself. The page it was sent from is saved.
- **Telling Mimo**, in the web chat or on WhatsApp («quiero dejar una sugerencia», «esto no funciona…», «deberíais…», «decidle al equipo…»): the `leave_feedback` tool saves the user's words verbatim (several messages joined), channel `chat` or `whatsapp`, and Mimo thanks them in a line. Recipe notes and food preferences are not feedback (memory).
- **Admin → Opiniones** (`/admin/opiniones`, sidebar item with the same icon): newest first, with the text, who (username + email), the channel («Botón de la app», «Mimo en la web», «Mimo por WhatsApp»), the page and the date; filters 7 / 30 / 90 days.
- **Morning brief:** a nightly routine reads the last day with the agents' read token, which only returns counts (by channel and by page, plus possible allergies with their Madrid date) — never the text or who wrote it. The text stays in Admin → Opiniones.

## API

- `POST /feedback` (auth) `{ text, page?, channel? = 'app' }` → 201. 400 for empty, > 2000 characters or an unknown channel (`app | chat | whatsapp`).
- `GET /admin/feedback?days=30&limit=200` (admin JWT, or `x-metrics-token` for the agents). Admin: `{ days, count, items[] }`, newest first, with `username` and `email`. Read token: counts only — `{ days, count, byChannel, byPage, possibleAllergies[] { date, channel } }` — no text, no identity (`services/agentView.ts`). `byPage` keys go through the same page normaliser as the error tracker (the client sets `page`): lowercased, no query string, and only in the shape of a real page of the web with every parameter as `:x` (`/recipes/:x`, `/entrar/:x`); `none` when there is no page, `otra` when it matches no page. A possible allergy is an opinion whose text, once normalised (NFKC, no invisible characters, lowercase, no accents, Cyrillic and Greek look-alikes as Latin letters), matches `al[eé]rg|cel[ií]a(?:c|qu)|intoleran|anafil|gluten|lactosa` — allergies and allergens, coeliac disease, intolerances, anaphylaxis, gluten, lactose; it is reported as its Madrid date and channel only. Since 2026-10-20 this replaces the masked text the token got with PRO-180. Tests: `feedback.test.ts`, `agentView.test.ts`.

## Data

- `user_feedback` (migration `0051_user_feedback`): `user_id` (cascades when the account is deleted), `channel`, `text`, `page`, `created_at` (indexed).

## Constraints

- No reply to the user beyond the thanks; no status (new / read) yet.
- No email or WhatsApp alert to Miguel when one arrives (he chose the admin list + the brief).
- The Friday newsletter has no «Cuéntanos qué mejorarías» link yet.

## Source

- [apps/api/src/routes/feedback.ts](../apps/api/src/routes/feedback.ts)
- [apps/api/src/services/agentView.ts](../apps/api/src/services/agentView.ts) — what the read token sees
- [apps/api/src/services/assistant/appSkills.ts](../apps/api/src/services/assistant/appSkills.ts) — `leave_feedback`
- [apps/api/src/db/migrations/0051_user_feedback.sql](../apps/api/src/db/migrations/0051_user_feedback.sql)
- [apps/web/src/components/feedback/FeedbackButton.tsx](../apps/web/src/components/feedback/FeedbackButton.tsx), mounted in the app shell [apps/web/src/components/shared/RootShell.tsx](../apps/web/src/components/shared/RootShell.tsx)
- [apps/web/src/app/admin/sections/FeedbackSection.tsx](../apps/web/src/app/admin/sections/FeedbackSection.tsx), [apps/web/src/lib/adminNav.ts](../apps/web/src/lib/adminNav.ts)
- Tests: `apps/api/src/tests/feedback.test.ts`, `apps/api/src/tests/agentView.test.ts`, `apps/web/e2e/feedback.spec.ts`
