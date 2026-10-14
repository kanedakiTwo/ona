# Newsletter «El menú de los viernes»

The weekly email for people who ticked «Quiero recibir cada viernes el menú de la semana por email» on the [waitlist](./waitlist.md) (PRO-94). Very visual: the star recipe's photo opens it. Content and cadence are Marketing's (`ona-hq/departments/marketing/newsletter.md`); every real send is approved by Miguel and done by a session of his (L3). Sent through Resend (see [Email](./email.md)).

## User Capabilities

- People who ticked the box get, each Friday, one email from **Mimoia <hola@mimoia.com>**:
  - header «Mimoia · El menú de los viernes» and an optional opening line from Mimo;
  - **the star recipe**: its photo full width (links to the recipe), «La receta de la semana», title, two lines and the issue's single call to action (a pill button);
  - optionally a **«Novedad en Mimoia»** card and an **«Un truco con Mimo»** card, each with an image when there is one and «Ver más»;
  - small print (e.g. how the photos are made), «Te llega porque pediste el menú de los viernes de Mimoia.», and two links: «No quiero recibir más el menú de los viernes» and «Salir de la lista de espera».
- **Newsletter-only opt-out** `/newsletter/baja?t=<token>`: «¿Dejamos de mandarte el menú de los viernes?», explains the place on the list stays, one button «No quiero recibirlo más». Works on click, not on load (mail scanners). Then «Hecho. Ya no te mandaremos el menú de los viernes.»; a second time «Ya no recibías el menú de los viernes.»; a bad link «Este enlace de baja no es válido.». Inboxes that support it (Gmail, Apple Mail) show their own «Cancelar suscripción» (RFC 8058 one-click).
- The waitlist box carries the hint «Te lo recomendamos: te va a sorprender. Es opcional y aparte de la lista; te das de baja con un clic.»

## Sending (admins)

`POST /admin/newsletter/send` (admin JWT) with `{ issueId, subject, preheader?, content, testTo?, dryRun? }`:
- `issueId`: lowercase slug (`2026-10-16`), the idempotency key.
- `content`: `{ intro?, star { title, body, imageUrl, imageAlt, url }, news?, tip?, cta { label, url }, note?, signoff? }`; `news`/`tip` = `{ title, body, imageUrl?, imageAlt?, url? }`. Image and link URLs must be absolute (`http(s)://`), the star needs `alt`. The template lays it out; nobody sends raw HTML.
- `dryRun: true` → `{ mode: 'dry_run', recipients, alreadySent }`, sends nothing.
- `testTo` → one proof, subject prefixed «[Prueba] », only to the email of an **admin** account (else 400 `NEWSLETTER_TEST_NOT_ADMIN`); its opt-out links are dummies; nothing recorded.
- Otherwise → `{ mode: 'send', sent, failed, skipped, alreadySent }`, through Resend's batch API (≤ 100 per call), audited as `newsletter.send` (counts only).

Recommended order (D-027 style): `dryRun` → `testTo` to Miguel → send.

## Constraints

- **Recipients**: waitlist entries with `newsletter_opt_in = true`, status not `unsubscribed` (waiting, invited or joined) and an email; one per email (`selectNewsletterRecipients`). Users with their own box come with PRO-95.
- **Idempotent per issue**: before sending, each recipient is claimed in `newsletter_sends (issue_id, recipient_hash)` (unique; `recipient_hash` = sha256 of the lowercased email, so no second copy of the address). Re-running the same issue emails nobody twice; a concurrent run gets only what it claimed. A `failed` or `skipped` (no `RESEND_API_KEY`) send releases its claim, so a re-run retries just those. A claim left `pending` by a crash counts as sent (no double email; check Resend's dashboard).
- **Opt-out token**: `w.<the entry's waitlist opt-out token>`. `POST /newsletter/unsubscribe` takes `{ token }` (from the page) or `?t=<token>` with the form body `List-Unsubscribe=One-Click` (from the inbox); it sets `newsletter_opt_in = false` and nothing else → `200 { ok, alreadyUnsubscribed }`, 404 `NEWSLETTER_TOKEN_NOT_FOUND`. Limiter 30/hour per IP.
- Headers on every issue: `List-Unsubscribe: <API one-click URL>, <web opt-out page>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The one-click URL uses the origin the admin call came in on (the API's own public URL).
- Template: tables + inline styles, 600 px column, cream/ink/terracotta, Fraunces with Georgia/serif fallbacks, every string escaped, text version with the same content and links.
- `/newsletter/baja` is a public route (`PUBLIC_ROUTES` in `app/layout.tsx`).
- No health claims in any issue (constitution §6); the wine idea waits for Legal.

## Known limitations

- Same issue for everyone; no personalisation by diet or usage yet (v2 in Marketing's approach).
- No open/click tracking in the product; Resend's dashboard has the numbers.
- Unsubscribing from the newsletter has no "subscribe again" button: write to the contact in `/privacidad`.
- `newsletter_sends` keeps the hashes after someone leaves the list.

## Related specs

- [Email](./email.md) — Resend, `sendEmailBatch`
- [Waitlist](./waitlist.md) — the opt-in box, the full opt-out
- [Privacy](./privacy.md) — «11. Lista de espera»
- [Admin audit log](./admin-audit-log.md) — `newsletter.send`

## Source

- [apps/api/src/services/newsletter.ts](../apps/api/src/services/newsletter.ts) — schema, template, recipients, repo, `sendNewsletter`
- [apps/api/src/routes/newsletter.ts](../apps/api/src/routes/newsletter.ts) — `POST /admin/newsletter/send`, `POST /newsletter/unsubscribe`
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`newsletterSends`), [apps/api/src/db/migrations/0046_newsletter_sends.sql](../apps/api/src/db/migrations/0046_newsletter_sends.sql)
- [apps/web/src/app/(public)/newsletter/baja/page.tsx](../apps/web/src/app/(public)/newsletter/baja/page.tsx)
- Tests: `apps/api/src/tests/newsletter.test.ts` (recipients, idempotency, opt-out keeps the entry, template, routes), `newsletter.smoke.ts` (real API + DB), `apps/web/e2e/newsletter-unsubscribe.spec.ts`
