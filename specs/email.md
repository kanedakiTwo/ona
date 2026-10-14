# Email

How Mimoia sends email. One provider, **Resend** (REST API, EU sending region, `mimoia.com` verified; D-050), called with a plain `fetch` from the API. The first and, for now, only email is the **waitlist invitation**; the newsletter (PRO-94) and the rest come on top of this service.

## User Capabilities

- People on the [waitlist](./waitlist.md) invited in a batch get an email from **Mimoia <hola@mimoia.com>**:
  - subject «¡Te toca, <nombre>! Ya puedes entrar en Mimoia» (without a name: «¡Te toca! Ya puedes entrar en Mimoia»);
  - they can register with that same email (the invite is what lets it through the closed beta, see [Auth](./auth.md));
  - a «Crear mi cuenta» button to `<WEB_PUBLIC_URL>/register`;
  - if they said they're interested in WhatsApp, one line on connecting it from their profile to talk to Mimo;
  - small print «Te escribimos porque te apuntaste a la lista de espera de Mimoia.» and a «Darme de baja» link to their own `/lista/baja?t=<token>`.
- Every email has an HTML version (brand shell) and a plain-text version with the same content and the links written out.

## How it works

- `services/email.ts`:
  - `sendEmail(msg)` → `POST {RESEND_BASE_URL}/emails` with `Authorization: Bearer RESEND_API_KEY`, body `{ from: EMAIL_FROM, to: [to], subject, html, text, headers? }`.
  - `sendEmailBatch(msgs)` → `POST /emails/batch`, at most 100 per call (`RESEND_BATCH_LIMIT`), results in input order; for the newsletter.
  - Both resolve `{ status: 'sent', id } | { status: 'skipped', reason: 'not_configured' } | { status: 'failed', error }`. **They never throw**: a failed email never breaks the action that sent it.
  - `renderBrandEmail({ preheader?, heading, paragraphs, button?, footer?, unsubscribeUrl? })` → `{ html, text }`: cream background, 600 px column, «Mimoia» in terracotta, Fraunces heading with Georgia/serif fallbacks, Inter/system body, a pill button; tables + inline styles (Gmail and Apple Mail on a phone). Every string is HTML-escaped.
  - `listUnsubscribeHeaders(url)` → `List-Unsubscribe: <url>` for list emails. The URL is the opt-out page, which unsubscribes on a click, not on load (so no `List-Unsubscribe-Post` one-click yet).
- `services/waitlistEmails.ts` → `waitlistInviteEmail()` builds the invitation.
- `POST /admin/waitlist/invite { ids, batch?, sendEmail? }` (admin JWT) marks the batch invited and then emails each newly invited person, one call each. The response adds `emailStatus` per person (`sent | skipped | failed | not_requested`) and `email { sent, skipped, failed }`. `sendEmail: false` marks the batch without emailing (Miguel writes by hand). Entries that were not `waiting` are skipped and not emailed again.

## Constraints

- **No key, no email.** Without `RESEND_API_KEY` every send logs `[email] not configured …` and resolves `skipped` (like WhatsApp unconfigured). CI, staging and local never have the key; tests stub `fetch`. The key is set in production by a session of Miguel, only after Legal reviews `/privacidad` (D-050).
- Env: `RESEND_API_KEY` (unset = off), `EMAIL_FROM` (default `Mimoia <hola@mimoia.com>`; must be on a verified domain), `RESEND_BASE_URL` (default `https://api.resend.com`, for a mock).
- **Logs never carry an address**: only the masked form `m***@g***.com` (`maskEmail`) and the subject.
- Timeout 20 s per call. No retries: a `failed` person shows in the invite response and Miguel can write by hand.
- Resend is a processor in the US (EU sending region); listed in `/privacidad` «5. Con quién los compartimos» and in «11. Lista de espera» (see [Privacy](./privacy.md)).

## Known limitations

- No waitlist confirmation email (double opt-in), no password-reset email (an admin still makes the link), no reminders, and no newsletter sender yet (PRO-94).
- The invitation links to `/register` with no personal token; the closed beta lets in any `invited` email without proving it's theirs (PRO-97 adds a one-time link).
- No bounce/complaint webhook: Resend's dashboard is the only place to see them.

## Related specs

- [Waitlist](./waitlist.md) — batches, `POST /admin/waitlist/invite`, opt-out
- [Privacy](./privacy.md) — Resend as a processor
- [Auth](./auth.md) — closed beta, invited emails

## Source

- [apps/api/src/services/email.ts](../apps/api/src/services/email.ts)
- [apps/api/src/services/waitlistEmails.ts](../apps/api/src/services/waitlistEmails.ts)
- [apps/api/src/routes/waitlist.ts](../apps/api/src/routes/waitlist.ts) — `POST /admin/waitlist/invite`
- [apps/api/src/config/env.ts](../apps/api/src/config/env.ts) — `RESEND_API_KEY`, `EMAIL_FROM`, `RESEND_BASE_URL`
- Tests: `apps/api/src/tests/email.test.ts` (fetch stubbed: body, headers, no key, masked logs, batch split, template, invitation), `apps/api/src/tests/waitlistRoute.test.ts` (the invite sends one email per person)
