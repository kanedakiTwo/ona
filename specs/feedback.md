# Feedback (beta opinions box)

**Status:** shipped 2026-10-15 (Miguel: «un sitio rápido donde dejar tu feedback, desde WhatsApp y desde la app», before inviting the closed beta).

One box for what users want to tell the team about Mimoia itself: suggestions, things that don't work, what they miss or don't understand, complaints and thanks. Three ways in, same table, read by Miguel in Admin and by the agents in the morning brief.

## User Capabilities

- **«Opinión» button** (`FeedbackButton`, `data-testid="feedback-button"`): a small paper pill with a terracotta heart-message icon, fixed **bottom-left** on every signed-in page (Mimo's button is bottom-right): above the tab bar on mobile, next to the desktop sidebar at `md+`, above the recipe detail's action bar. Hidden in cook mode and during `/onboarding`, and — like Mimo's button — while a sheet is open or the keyboard is up (PRO-122, see [design-system.md](./design-system.md)). It opens a sheet «Danos tu opinión» («Lo que te sobra, lo que te falta, algo que no funciona o no entiendes… Cuéntanoslo con tus palabras. También puedes decírselo a Mimo, aquí o por WhatsApp.»), a text box (2–2000 characters) and «Enviar»; then «¡Gracias! Lo leemos todo. Nos ayuda muchísimo a hacer Mimoia.» and it closes by itself. The page it was sent from is saved.
- **Telling Mimo**, in the web chat or on WhatsApp («quiero dejar una sugerencia», «esto no funciona…», «deberíais…», «decidle al equipo…»): the `leave_feedback` tool saves the user's words verbatim (several messages joined), channel `chat` or `whatsapp`, and Mimo thanks them in a line. Recipe notes and food preferences are not feedback (memory).
- **Answering one of Mimo's questions** (PRO-285): the message right after Mimo's one leftovers question on WhatsApp is saved verbatim with the tag `sobras` (once per user; see [Advisor](./advisor.md) → «La pregunta de las sobras»).
- **Answering the «pregunta única»** (PRO-1091): the next WhatsApp message after the question sent from Admin → «Pregunta por WhatsApp» is saved verbatim with the tag `pregunta_unica` (once per send; see [WhatsApp](./whatsapp.md) → «Pregunta única por WhatsApp»). Admin → Opiniones labels it «Pregunta única por WhatsApp»; the read token counts it in `byTag`.
- **The Sean Ellis survey** (PRO-334, CS-07; text v0.2 reviewed by Legal, LEG-508): «Si mañana Mimoia dejara de existir, ¿cómo te sentirías?» — «Muy decepcionado/a» · «Algo decepcionado/a» · «Nada decepcionado/a (no me resulta tan útil)» · «Ya no la uso», plus an optional «¿Por qué?». **Once per person**, during the beta (until launch day), to an adult account (not a household `child`) with 14 days or more since sign-up, a menu (own or the household's) and Mimoia used on **2 different Madrid days in the last 14** (`usage_events` or a WhatsApp message); never if anyone in their household is internal (role admin or `ADMIN_EMAILS`) or a test account (reserved test domains or `EMAIL_SINK_DOMAINS`, same rules as the «pregunta única»). Where:
  - **WhatsApp**, when the person wrote to Mimo there in the last 7 days: at the end of one of Mimo's replies (inside the 24 h window, so no template), last in `appendReplyOffers` (never with another offer), word for word: «Una cosa rápida, si te apetece: si mañana Mimoia dejara de existir, ¿cómo te sentirías? 1) Muy decepcionado/a · 2) Algo · 3) Nada · 4) Ya no la uso. Contesta con el número; nos ayuda a decidir qué mejorar.» The next message is saved verbatim with the tag `sean_ellis` and the option read from it (`1`–`4` or the words; none → no option), and still reaches Mimo.
  - Otherwise a **card on /menu** (`SeanEllisCard`, `data-testid="sean-ellis"`, below the WhatsApp nudge): eyebrow «Una pregunta rápida», the question, the four answers as a radio group, «¿Por qué? (opcional)» once one is picked, «Enviar» (off until one is picked) → «¡Gracias! Nos ayuda a decidir qué mejorar.» + «Cerrar»; «Ahora no» closes it for good. Saved with channel `app` and the text «<answer>. <why>».
  - **Telling Mimo** (web chat, voice or WhatsApp, D-051): the `answer_sean_ellis` tool (`answer` = `muy | algo | nada | ya_no`, optional `why`) files it the same way, only for whoever was asked or is due (409 otherwise → Mimo suggests `leave_feedback`).
  - Stamped in `users.sean_ellis_at` when Mimo asks it on WhatsApp, the card is closed or it is answered; one `sean_ellis` opinion per person. Admin → Opiniones labels it «Encuesta «si Mimoia dejara de existir»» and shows the counts by option at the top.
- **Admin → Opiniones** (`/admin/opiniones`, sidebar item with the same icon): newest first, with the text, who (username + email), the channel («Botón de la app», «Mimo en la web», «Mimo por WhatsApp»), the page, the tag («Pregunta de las sobras») and the date, and at the top how many answers to the leftovers question there are; filters 7 / 30 / 90 days.
- **Morning brief:** a nightly routine reads the last day with the agents' read token, which only returns counts (by channel and by page, plus possible allergies with their Madrid date) — never the text or who wrote it. The text stays in Admin → Opiniones.

## API

- `POST /feedback` (auth) `{ text, page?, channel? = 'app' }` → 201. 400 for empty, > 2000 characters or an unknown channel (`app | chat | whatsapp`).
- `GET /admin/feedback?days=30&limit=200` (admin JWT, or `x-metrics-token` for the agents). Admin: `{ days, count, byTag, seanEllis, items[] }`, newest first, with `username`, `email`, `tag` and `answer`. Read token: counts only — `{ days, count, byChannel, byPage, byTag, seanEllis, possibleAllergies[] { date, channel } }`; `byTag` counts tagged rows only (`{ sobras: n, sean_ellis: n }`, PRO-285 / PRO-334; an unknown tag counts as `otra`); `seanEllis` counts the survey's answers by option (`{ muy, algo, nada, ya_no, sin_opcion }`, PRO-334; the nightly `data/opiniones/` snapshot reads it) — no text, no identity (`services/agentView.ts`). `byPage` keys go through the same page normaliser as the error tracker (the client sets `page`): lowercased, no query string, and only in the shape of a real page of the web with every parameter as `:x` (`/recipes/:x`, `/entrar/:x`); `none` when there is no page, `otra` when it matches no page. A possible allergy is an opinion whose text, once normalised (NFKC, no invisible characters, lowercase, no accents, Cyrillic and Greek look-alikes as Latin letters), matches `al[eé]rg|cel[ií]a(?:c|qu)|intoleran|anafil|gluten|lactosa` — allergies and allergens, coeliac disease, intolerances, anaphylaxis, gluten, lactose; it is reported as its Madrid date and channel only. Since 2026-10-20 this replaces the masked text the token got with PRO-180. Tests: `feedback.test.ts`, `agentView.test.ts`.

- `GET /sean-ellis` (auth) → `{ show: false }` or, when the /menu card is due, `{ show: true, question, options[] { key, label }, why }`. `POST /sean-ellis` `{ answer, why?, channel? = 'app' }` → `{ ok, saved }` (`saved: false` when already answered); 400 for an unknown answer, 409 `NOT_ASKED` for someone neither asked nor due. `POST /sean-ellis/dismiss` → «Ahora no». Tests: `seanEllisSurvey.test.ts`, `seanEllisSurvey.smoke.ts`, `apps/web/e2e/sean-ellis.spec.ts`.

## Data

- `user_feedback` (migration `0051_user_feedback`): `user_id` (cascades when the account is deleted), `channel`, `text`, `page`, `created_at` (indexed); `tag` (migration `0092_leftovers_question`, PRO-285): what it answers (`sobras`, `pregunta_unica`, `sean_ellis`) or null; `answer` (migration `0111_sean_ellis`, PRO-334): the survey's option or null.
- `users.sean_ellis_at` (migration `0111_sean_ellis`): when the survey was asked on WhatsApp, closed or answered.

## Constraints

- No reply to the user beyond the thanks; no status (new / read) yet.
- No email or WhatsApp alert to Miguel when one arrives (he chose the admin list + the brief).
- The Friday newsletter has no «Cuéntanos qué mejorarías» link yet.
- Sean Ellis survey, out of this version: CS-07's follow-up questions (what Mimoia gives you most, what you'd change first, what you'd use instead), the counts by campaign of origin and weeks of use, the email, and «activated» read as just «has a menu». The /menu card samples the most active people (CS-07 notes the bias).

## Source

- [apps/api/src/routes/feedback.ts](../apps/api/src/routes/feedback.ts)
- [apps/api/src/services/agentView.ts](../apps/api/src/services/agentView.ts) — what the read token sees
- [apps/api/src/services/assistant/appSkills.ts](../apps/api/src/services/assistant/appSkills.ts) — `leave_feedback`
- [apps/api/src/db/migrations/0051_user_feedback.sql](../apps/api/src/db/migrations/0051_user_feedback.sql)
- [apps/web/src/components/feedback/FeedbackButton.tsx](../apps/web/src/components/feedback/FeedbackButton.tsx), mounted in the app shell [apps/web/src/components/shared/RootShell.tsx](../apps/web/src/components/shared/RootShell.tsx)
- [apps/web/src/app/admin/sections/FeedbackSection.tsx](../apps/web/src/app/admin/sections/FeedbackSection.tsx), [apps/web/src/lib/adminNav.ts](../apps/web/src/lib/adminNav.ts)
- [apps/api/src/services/leftoversQuestion.ts](../apps/api/src/services/leftoversQuestion.ts) — the answers tagged `sobras` (PRO-285)
- [apps/api/src/services/seanEllisSurvey.ts](../apps/api/src/services/seanEllisSurvey.ts), [apps/api/src/routes/seanEllis.ts](../apps/api/src/routes/seanEllis.ts), [apps/web/src/components/menu/SeanEllisCard.tsx](../apps/web/src/components/menu/SeanEllisCard.tsx) — the Sean Ellis survey (PRO-334)
- Tests: `apps/api/src/tests/feedback.test.ts`, `apps/api/src/tests/agentView.test.ts`, `apps/api/src/tests/leftoversQuestion.test.ts`, `apps/web/e2e/feedback.spec.ts`
