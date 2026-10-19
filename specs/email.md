# Email

How Mimoia sends email. One provider, **Resend** (REST API, EU sending region, `mimoia.com` verified; D-050), called with a plain `fetch` from the API. It sends eight emails: the **waitlist invitation** and its **reminder**, the **welcome** when an account is created, the **password reset** link, the **«te quedan 2 días de prueba»** notice (PRO-135), the **day-7 founder-price offer** and the **legal notice before the first charge** (PRO-136), and the **Friday newsletter** ([newsletter.md](./newsletter.md), PRO-94). All share one brand shell (`services/emailBrand.ts`): the Mimoia logo, a Fraunces headline with one word in the terracotta Cormorant italic, a forest button, the signature and a cream-deep footer band with Mimo's round symbol.

## User Capabilities

- People on the [waitlist](./waitlist.md) invited in a batch get an email from **Miguel de Mimoia <hola@mimoia.com>** (PRO-190: the display name on `EMAIL_FROM`'s address, with `reply_to` on that same address; the other emails keep `EMAIL_FROM` as it is):
  - subject «¡Te toca, <nombre>! Ya puedes entrar en Mimoia» (without a name: «¡Te toca! Ya puedes entrar en Mimoia»);
  - written and **signed by Miguel** («Miguel · Fundador de Mimoia»; constitution §5), eyebrow «Lista de espera», headline «Ya puedes *entrar*», preheader «Tu invitación a Mimoia está lista.»; «Entramos por tandas pequeñas porque quiero acompañar de cerca a cada casa»;
  - **what to expect**: create the account, five questions about the household, and the first weekly menu with its shopping list in about 2 minutes;
  - a «Crear mi cuenta» button to their **personal one-time link** `<WEB_PUBLIC_URL>/entrar/<token>` (PRO-97): it opens `/register` with their email fixed, and it's the only way an invited email gets through the closed beta (see [Auth](./auth.md)); the email says the link is theirs and works once;
  - if they said they're interested in WhatsApp, **right under the button** (PRO-190), how to talk to Mimo there: «Nos dijiste que te interesa WhatsApp: cuando tengas la cuenta, ve a tu perfil, pulsa «Conectar WhatsApp» y pídele a Mimo el menú como a cualquier contacto.»;
  - last line before the signature: «Si tienes cualquier duda, responde a este correo: me llega a mí.» (PRO-190; Legal: not «lo leo yo», the inbox is also read by agents);
  - in the footer band «Te escribo porque te apuntaste a la lista de espera de Mimoia.», that they can leave and we delete their email, and a «Darme de baja» link to their own `/lista/baja?t=<token>`.
- **One reminder** 3 days after the invitation if they haven't created the account (PRO-97): «<Nombre>, tu invitación a Mimoia sigue aquí», headline «Tu invitación sigue *aquí*» (PRO-190: «invitación», never «plaza», which hints at scarcity), the same link, the WhatsApp line under the button, «El enlace sigue funcionando: úsalo cuando te venga bien.» (Legal: not «no caduca»), «Es el único recordatorio que te mando.», the reply line, signed by Miguel, same sender and opt-out. No expiry of the invitation (it would be false urgency, constitution §5). Never a second one; not to anyone who registered or left.
- **Welcome** right after `POST /register` creates an account, signed by Miguel, greeting with the first name they gave on the waitlist if any («Hola, Laura:», else «Hola:»), an «Abrir Mimoia» button to `/menu` and «Te escribo porque acabas de crear tu cuenta en Mimoia.». Three versions (`welcomeKind`):
  - **beta** (came in through the closed beta: waitlist link, beta invitation link or an admin email) — «Ya estás dentro de Mimoia», eyebrow «Beta privada»: thanks for being among the first homes, «Estamos en beta», things may fail, reply to the email and Miguel reads it; four first steps (questions about the home, first menu, shopping list, connect WhatsApp); «Gracias por estar aquí desde el principio.»;
  - **household** (registered with someone's household invitation) — «Ya tienes cuenta en Mimoia», «Ya estás en *casa*»: someone at home invited them, they share menu, list and pantry; three steps (the menu is the whole home's, tick what you buy, connect WhatsApp);
  - **general** (open registration) — «Te doy la bienvenida a Mimoia»: where Mimoia comes from, what it does, reply to the email; the same four first steps.
- **Password reset** after «¿Has olvidado la contraseña?» (`/recuperar`, see [Auth](./auth.md)): «Cambia tu contraseña de Mimoia», an «Elegir contraseña nueva» button to `<WEB_PUBLIC_URL>/reset?token=<token>`, «El enlace sirve una vez y caduca en 1 hora.» and «Si no lo has pedido tú, no hagas nada: tu contraseña sigue igual.» Unsigned.
- **«Te quedan 2 días de prueba en Mimoia»** (PRO-135, [Billing](./billing.md)): from launch day, on day 12 of a household's 14-day trial without a plan, **once**, to the household owner, between 09:00 and 21:00 Madrid (beta households: 26 December). Signed by Miguel, eyebrow «Tu prueba», headline «Te quedan *2 días*» (or «1 día» / «Hoy es tu último día» if it goes late): the trial lasts until <day>, included; to keep generating menus and talking to Mimo, choose a plan (Esencial and Plus monthly prices, from `PLANS`); without one nothing is charged, the account is paused and nothing is deleted. Button «Ver los planes» → `/profile/suscripcion`; footer «Te escribo porque tu prueba de Mimoia acaba pronto.» Not to a household with a paid plan or a suspended owner. Text for Legal to review.
- **«Quédate el precio de fundador de Mimoia»** (PRO-136): from launch day, on day 7 of the trial without a plan, once, to the owner (09:00–21:00 Madrid). Signed by Miguel, eyebrow «Tu prueba», headline «Quédate el precio de *fundador*»: a week in; leave the card before the trial ends (until <day>, included) and keep the founder price for good, it doesn't go up while subscribed; nothing is charged until <first charge>, 15 days before it we tell them date and amount, and they can cancel before without paying; Esencial and Plus monthly prices. Button «Elegir mi plan» → `/profile/suscripcion`. Footer «Te escribo porque estás en la prueba de Mimoia.» `services/founderOffer.ts` (`households.founder_offer_at`).
- **«Tu primer cobro de Mimoia: <fecha>»** (PRO-136, legal notice): from the Madrid day 15 days before a subscription's first charge, once, to the payer. Unsigned, eyebrow «Tu suscripción», headline «Tu primer *cobro*»: on <date> we'll charge <amount> (VAT included) for Mimoia <plan> (<period>) on the card they left; if they don't cancel it renews every month/year for that amount; cancelling before that date costs nothing; founder price if they have it. Button **«Cancelar mi suscripción»** → `/profile/suscripcion?cancelar=1` (opens Stripe's cancel flow); after it, plan/card changes in Perfil → Suscripción and «LINK.COM* MIMOIA» on the statement. `services/chargeNotice.ts` (`subscriptions.charge_notice_at`, the recorded date). Not tied to launch day.
- Both, like the day-12 email, are marked before sending; `failed` stays marked, `skipped` (no key) is unmarked. Texts for Legal to review.
- Every email has an HTML version (brand shell) and a plain-text version with the same content and the links written out.

## How it works

- `services/email.ts`:
  - `sendEmail(msg)` → `POST {RESEND_BASE_URL}/emails` with `Authorization: Bearer RESEND_API_KEY`, body `{ from: EMAIL_FROM, reply_to?, to: [to], subject, html, text, headers? }`; a message's `fromName` swaps the display name on `EMAIL_FROM`'s address and `replyToSender` adds `reply_to` = that address (PRO-190, the waitlist invitation and reminder).
  - `sendEmailBatch(msgs)` → `POST /emails/batch`, at most 100 per call (`RESEND_BATCH_LIMIT`), results in input order; used by the newsletter.
  - Both resolve `{ status: 'sent', id } | { status: 'skipped', reason: 'not_configured' } | { status: 'failed', error }`. **They never throw**: a failed email never breaks the action that sent it.
  - `renderBrandEmail({ preheader?, eyebrow?, heading, paragraphs, steps?, button?, after?, signoff?, from?, footer?, unsubscribeUrl?, assets? })` → `{ html, text }` on the shared shell (`emailBrand.ts`: tokens, `masthead`, `headlineRow`, `button`, `signature`, `footerBand`, `emailDocument`; the newsletter uses the same pieces). `heading` takes `*word*` for the accent italic; `steps` is a numbered card; `from` signs with name and role (`MIGUEL`). Tables + inline styles, 600 px, Google Fonts link (Apple Mail shows the brand fonts, Gmail falls back to Georgia/Helvetica), `color-scheme: light`. Logo and symbol come from `<WEB_PUBLIC_URL>/email/` (`apps/web/public/email/`). Every string is HTML-escaped.
  - `listUnsubscribeHeaders(url)` → `List-Unsubscribe: <url>` for list emails. The URL is the opt-out page, which unsubscribes on a click, not on load (so no `List-Unsubscribe-Post` one-click yet).
- `services/waitlistEmails.ts` → `waitlistInviteEmail()` builds the invitation, `waitlistInviteReminderEmail()` the reminder.
- `services/accountEmails.ts` → `welcomeKind()`, `welcomeEmail()`, `passwordResetEmail()`; `services/accountMailer.ts` sends them: `sendWelcomeEmail()` (fired without waiting from `POST /register`, never delays or fails it; looks up the waitlist first name) and `requestPasswordReset()` (from `POST /auth/forgot`: only for an existing, not suspended account, at most `RESET_EMAILS_PER_HOUR` = 3 per account per hour, a 1-hour token via `mintToken(…, SELF_RESET_TTL_MS)`).
- The reminder runs from the notification scheduler's tick (`sendWaitlistInviteRemindersIfDue`, at most once an hour per process, inside the scheduler's advisory lock). Due = `invited`, has a link, link unused, not reminded, invited ≥ 3 days ago. The row is marked (`invite_reminder_sent_at`) **before** sending, atomically, so two processes never send it twice; a `failed` send stays marked (no retry), a `skipped` one (no key) is unmarked so it goes out once email is configured.
- `services/trialEmails.ts` → `trialEndingEmail()` and `sendTrialEndingEmailsIfDue()` from the scheduler tick (at most once an hour, nothing before launch day). Same marking as the reminder: `households.trial_ending_email_at` is set before sending, atomically; `failed` stays marked, `skipped` (no key) is unmarked.
- `POST /admin/waitlist/invite { ids, batch?, sendEmail? }` (admin JWT) marks the batch invited and then emails each newly invited person, one call each. The response adds `emailStatus` per person (`sent | skipped | failed | not_requested`) and `email { sent, skipped, failed }`. `sendEmail: false` marks the batch without emailing (Miguel writes by hand). Entries that were not `waiting` are skipped and not emailed again.

## Buzón de pruebas (staging)

- With `EMAIL_SINK_DOMAINS` set (comma list, e.g. `example.com`), an email to an address in one of those domains is **not sent**: `sendEmail` / `sendEmailBatch` keep it in memory (the last 300, lost on restart) and resolve `sent` with an id `sink-…`; other addresses behave as always (Resend, or `skipped` without a key). A batch keeps the input order.
- `GET /email-sink?to=<address>` (public, 120/min per IP) → `{ messages: [{ id, at, to, subject, html, text, headers? }] }`, oldest first. 404 `EMAIL_SINK_OFF` when the sink is off; 400 `EMAIL_SINK_NOT_TEST_ADDRESS` for an address outside those domains, so it never shows a real person's email.
- **Never on production**: with `RAILWAY_ENVIRONMENT_NAME=production` the sink is off whatever the variable says. Set on staging (`EMAIL_SINK_DOMAINS=example.com`) so the test households (ona-hq `hogares-prueba`) can follow the invitation, welcome and password-reset emails.

## Constraints

- **No key, no email.** Without `RESEND_API_KEY` every send logs `[email] not configured …` and resolves `skipped` (like WhatsApp unconfigured). CI, staging and local never have the key; tests stub `fetch`. The key is set in production by a session of Miguel, only after Legal reviews `/privacidad` (D-050).
- Env: `RESEND_API_KEY` (unset = off), `EMAIL_FROM` (default `Mimoia <hola@mimoia.com>`; must be on a verified domain), `RESEND_BASE_URL` (default `https://api.resend.com`, for a mock).
- **Logs never carry an address**: only the masked form `m***@g***.com` (`maskEmail`) and the subject.
- Timeout 20 s per call. No retries: a `failed` person shows in the invite response and Miguel can write by hand.
- Resend is a processor in the US (EU sending region); listed in `/privacidad` «5. Con quién los compartimos» and in «11. Lista de espera» (see [Privacy](./privacy.md)).

## Known limitations

- No waitlist confirmation email (double opt-in).
- Replies go to `hola@mimoia.com` (Namecheap forwarding): the welcome asks people to reply, so that inbox has to reach Miguel.
- No bounce/complaint webhook: Resend's dashboard is the only place to see them.

## Related specs

- [Waitlist](./waitlist.md) — batches, `POST /admin/waitlist/invite`, opt-out
- [Newsletter](./newsletter.md) — the Friday email, its one-click opt-out
- [Privacy](./privacy.md) — Resend as a processor
- [Auth](./auth.md) — closed beta, invited emails

## Source

- [apps/api/src/services/email.ts](../apps/api/src/services/email.ts)
- [apps/api/src/services/emailBrand.ts](../apps/api/src/services/emailBrand.ts) — the shared brand shell
- [apps/api/src/services/emailSink.ts](../apps/api/src/services/emailSink.ts), [apps/api/src/routes/emailSink.ts](../apps/api/src/routes/emailSink.ts) — staging mail sink, `GET /email-sink`
- [apps/api/src/services/waitlistEmails.ts](../apps/api/src/services/waitlistEmails.ts)
- [apps/api/src/services/accountEmails.ts](../apps/api/src/services/accountEmails.ts), [apps/api/src/services/accountMailer.ts](../apps/api/src/services/accountMailer.ts) — welcome, password reset
- [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) — `POST /register` (welcome), `POST /auth/forgot`
- [apps/web/public/email/](../apps/web/public/email/) — logo and symbol the emails load
- [apps/api/src/services/trialEmails.ts](../apps/api/src/services/trialEmails.ts) — «te quedan 2 días de prueba» (PRO-135; tests in `accountAccess.test.ts`)
- [apps/api/src/services/founderOffer.ts](../apps/api/src/services/founderOffer.ts), [apps/api/src/services/chargeNotice.ts](../apps/api/src/services/chargeNotice.ts) — day-7 offer, legal notice before the first charge (PRO-136; tests in `founderOffer.test.ts`)
- [apps/api/src/services/waitlistInvites.ts](../apps/api/src/services/waitlistInvites.ts) — one-time link, reminder
- [apps/api/src/services/notificationScheduler.ts](../apps/api/src/services/notificationScheduler.ts) — runs the reminder
- [apps/api/src/routes/waitlist.ts](../apps/api/src/routes/waitlist.ts) — `POST /admin/waitlist/invite`
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_BASE_URL`
- Tests: `apps/api/src/tests/emailSink.test.ts` (sink on/off, never on production, batch order, the route), `apps/api/src/tests/email.test.ts` (fetch stubbed: body, headers, no key, masked logs, batch split, template, invitation), `apps/api/src/tests/waitlistRoute.test.ts` (the invite sends one email per person, each with its link), `waitlistInvites.test.ts` (reminder: at 3 days yes, at 2 no, never twice), `accountEmails.test.ts` (welcome kinds and texts, reset email, reset rules, brand shell), e2e `waitlist-invite.spec.ts` (also the beta welcome after registering) and `password-recovery.spec.ts` (/recuperar → reset email → new password works) against a fake Resend (`RESEND_BASE_URL` → the server `e2e/global-setup.ts` starts on `E2E_MAIL_URL`)
