# Newsletter «El menú de los viernes»

The weekly email for people who ticked «Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia» (until 2026-10-17: «Quiero recibir cada viernes el menú de la semana por email») on the [waitlist](./waitlist.md) (PRO-94), at `/register` or in the profile (PRO-95). Very visual: the star recipe's photo opens it. Content and cadence are set by marketing; every real send is approved and launched by an admin. Sent through Resend (see [Email](./email.md)).

## User Capabilities

- People who ticked the box get, each Friday, one email from **Mimoia <hola@mimoia.com>**, in the brand (cream, ink, one touch of terracotta, a forest button; Fraunces, Inter and a Cormorant italic accent), in this order:
  - masthead: the Mimoia logo (links to mimoia.com), «El menú de los viernes» and the issue's edition line (e.g. «N.º 1 · 16 de octubre de 2026»);
  - an optional short **greeting** above the headline (`preface`, e.g. «Hola a todos…»), an optional **headline** (a `*word*` goes in the terracotta italic) and an opening **letter** — since issue 1 written and signed by Miguel, in a personal, family tone;
  - **the star recipe**: its photo full width (links to the recipe), «La receta de la semana», title, an optional one-line meta, two short paragraphs and the issue's single call to action (a forest pill button);
  - up to four free **sections** (e.g. «Por qué existe Mimoia» on a cream-deep panel with a big italic quote, «Qué es esta carta» after a thin rule);
  - optionally a **«Novedad en Mimoia»** card and an **«Un truco con Mimo»** card, each with an image when there is one and «Ver más»;
  - the signoff and, when a person signs, their name in the italic accent with their role underneath;
  - a cream-deep footer: for **waitlist** recipients first their own invite link (PRO-130): «Invita a tu hogar y entráis antes: mimoia.com/?invita=<their code>» until 15-nov, and from 16-nov (Madrid) «Invita a tu hogar a Mimoia: mimoia.com/?invita=<their code>» (PRO-311; the same code as on the waitlist, see [Waitlist](./waitlist.md); in the text version too); accounts get no invite line, and neither does an admin proof. Then Mimo's round symbol, small print (e.g. how the photos are made), «Te llega porque pediste el menú de los viernes de Mimoia.», «No quiero recibir más el menú de los viernes» · «Salir de la lista de espera», and «Mimoia · mimoia.com».
- **Newsletter-only opt-out** `/newsletter/baja?t=<token>`: «¿Dejamos de mandarte el menú de los viernes?», explains the place on the list stays, one button «No quiero recibirlo más». Works on click, not on load (mail scanners). Then «Hecho. Ya no te mandaremos el menú de los viernes.»; a second time «Ya no recibías el menú de los viernes.»; a bad link «Este enlace de baja no es válido.». Inboxes that support it (Gmail, Apple Mail) show their own «Cancelar suscripción» (RFC 8058 one-click).
- The waitlist box carries the hint «Te lo recomendamos: te va a sorprender. Es opcional y aparte de la lista; te das de baja con un clic.»
- **Beta households (PRO-95)**: the same box, unticked, at `/register` (see [Auth](./auth.md)), and a switch in **Perfil → Recordatorios** («Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia», `NEWSLETTER_OPT_IN_LABEL`, the same words in the three places; off: «Te lo recomendamos: te va a sorprender.», on: «Activado · te llega cada viernes»). The switch saves on tap (`GET`/`PUT /newsletter/me { optIn }`, JWT); turning it on records the date and `WAITLIST_NEWSLETTER_CONSENT_VERSION`.
- **One person, one switch**: turning it off (profile, `/newsletter/baja` or the inbox) turns it off for every row with that email — the account and the waitlist entry.

## Sending (admins)

`POST /admin/newsletter/send` (admin JWT) with `{ issueId, subject, preheader?, content, testTo?, dryRun? }`:
- `issueId`: lowercase slug (`2026-10-16`), the idempotency key.
- `content`: `{ edition?, preface?, headline?, intro?, star { title, body, imageUrl, imageAlt, url, meta? }, sections?, news?, tip?, cta { label, url }, note?, signoff?, from? }`; `news`/`tip` = `{ title, body, imageUrl?, imageAlt?, url? }`; `sections` = up to 4 × `{ label?, title?, quote?, body, tone?: 'band' | 'plain' }`; `from` = `{ name, role? }`. Image and link URLs must be absolute (`http(s)://`), the star needs `alt`. The template lays it out; nobody sends raw HTML.
- `dryRun: true` → `{ mode: 'dry_run', recipients, alreadySent, bySource { waitlist, user }, includes? }`, sends nothing; `includes: <email>` says whether that address would get it.
- `testTo` → one proof, subject prefixed «[Prueba] », only to the email of an **admin** account (else 400 `NEWSLETTER_TEST_NOT_ADMIN`); its opt-out links are dummies; nothing recorded but the issue's links (its tracked links carry `?prueba=1` and never count).
- Otherwise → `{ mode: 'send', sent, failed, skipped, alreadySent }`, through Resend's batch API (≤ 100 per call), audited as `newsletter.send` (counts only).

Recommended order (D-027 style): `dryRun` → `testTo` to Miguel → send.

## Clicks and opt-outs per issue (PRO-191, 2026-10-19)

Resend's open and click tracking stay **off** on mimoia.com (the open pixel needs consent; Resend's click tracking keeps who clicked). Instead, our own aggregated counter:
- At send, the content's links (star recipe, call to action, news, tip; the same URL twice is one link, numbered from 1: `contentLinks`) are saved in `newsletter_clicks (issue_id, link_index, destination, clicks)` and every email carries `https://mimoia.com/n/<issue>/<n>` instead (`withTrackedLinks`). The footer's personal links (opt-out, invite) are never rewritten.
- `mimoia.com/n/<issue>/<n>` (web route `app/n/[issue]/[n]/route.ts`) asks `GET /newsletter/click/:issueId/:n` (public), which adds 1 and answers `{ url }` with the destination **saved at send**; the web redirects there with a 302. Never to a URL that comes in the request (no open redirect). An unknown issue or link → 404, no redirect.
- Not clicks: `HEAD` requests, proofs (`?prueba=1`) and known mail scanners or link previewers by user-agent (`countsAsClick`). The metric is clicks, not people. No IP, browser or recipient is stored.
- Opt-outs: the opt-out page and the one-click URL carry `i=<issue>`; a successful opt-out adds a row to `newsletter_unsubscribes (issue_id, source user|waitlist, created_at)` — counts only. Earlier emails have no issue and count under `unsubscribesWithoutIssue`.
- The `i` comes in the request, so it is only trusted when that issue was **sent to that very address**: `repo.unsubscribe` returns the address's `recipientHash` and `wasSentTo(issueId, hash)` looks for its `newsletter_sends` row with `status = 'sent'` (unique index `uq_newsletter_sends_issue_recipient`). Otherwise — an invented issue, a real issue that person never got (e.g. a waitlist signup made after it went out), or the check failing — the opt-out still happens and its row is saved with `issue_id` null. Without this, anyone with an opt-out token (a public waitlist signup gives one) could add made-up issues, with any text, to `/admin/newsletter/stats`, or inflate a real issue's opt-outs.
- The stats only show **known** issues: those with sends or saved links (`newsletter_clicks`). Only an admin's send or proof creates them, and links are never deleted, so forgetting an address's sends (PRO-132) doesn't move earlier opt-outs. An opt-out row naming any other issue (rows saved before this check) counts under `unsubscribesWithoutIssue`.
- `GET /admin/newsletter/stats` (admin JWT or the read-only metrics token `x-metrics-token` used by internal reporting) → `{ issues: [{ issueId, firstSentAt, sent { total, user, waitlist }, clicks { total, links [{ index, destination, clicks }] }, unsubscribes { total, user, waitlist } }], unsubscribesWithoutIssue, definitions }`. Internal reporting reads it with that token.
- Migration `0083_newsletter_clicks` (adds the two tables). `/privacidad` changes only if Legal asks (proposed line: «contamos cuántas veces se pulsa cada enlace, sin saber quién»).

## Constraints

- **Recipients**: accounts with `users.newsletter_opt_in = true` that aren't suspended, plus waitlist entries with `newsletter_opt_in = true`, status not `unsubscribed` (waiting, invited or joined) and an email; one per email, the account first (`selectNewsletterRecipients`). Account emails have no «Salir de la lista de espera» link.
- **Idempotent per issue**: before sending, each recipient is claimed in `newsletter_sends (issue_id, recipient_hash)` (unique; `recipient_hash` = sha256 of the lowercased email, so no second copy of the address). Re-running the same issue emails nobody twice; a concurrent run gets only what it claimed. A `failed` or `skipped` (no `RESEND_API_KEY`) send releases its claim, so a re-run retries just those. A claim left `pending` by a crash counts as sent (no double email; check Resend's dashboard).
- **Invite link (PRO-130)**: `waitlistReferralUrl(<web origin>, waitlist_entries.referral_code)` per recipient, built in `buildNewsletterMessage`; each email carries only its own recipient's code (test in `newsletter.test.ts`). When an address is both an account and a waitlist entry, the account wins (no invite line). «entráis antes» only holds while people get in by batches: from the day registration opens (`NEWSLETTER_OPEN_REGISTRATION_DAY` = 2026-11-16, D-057, Madrid date of the send) `newsletterInviteLine` gives «Invita a tu hogar a Mimoia:» instead (PRO-311, Legal 2026-10-21: no false urgency). Pinned in `newsletter.test.ts` (13-nov says it, 20-nov doesn't; the switch at 00:00 Madrid).
- **Forgetting the traces (PRO-132)**: leaving the waitlist (`/lista/baja`) or deleting the account deletes every `newsletter_sends` row with that email's hash (`forgetNewsletterSends`, in the same transaction); the newsletter-only opt-out keeps them, so a re-run of the same issue still skips that address.
- **Opt-out tokens**: `w.<the entry's waitlist opt-out token>` for waitlist entries; `u.<userId>.<HMAC-SHA256(JWT_SECRET), 22 chars>` for accounts (`newsletterTokenForUser`; a forged or changed id fails). `POST /newsletter/unsubscribe` takes `{ token }` (from the page) or `?t=<token>` with the form body `List-Unsubscribe=One-Click` (from the inbox); it sets `newsletter_opt_in = false` on the account and the waitlist entry with that email, nothing else → `200 { ok, alreadyUnsubscribed }`, 404 `NEWSLETTER_TOKEN_NOT_FOUND`. Limiter 30/hour per IP.
- Headers on every issue: `List-Unsubscribe: <API one-click URL>, <web opt-out page>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`. The one-click URL uses the origin the admin call came in on (the API's own public URL).
- Template: tables + inline styles, 600 px column, brand tokens, Google Fonts link (Apple Mail shows Fraunces/Cormorant/Inter; Gmail falls back to Georgia/Helvetica), `color-scheme: light`, every string escaped (the headline's `*accent*` too), text version with the same content and links.
- Brand images are served by the web from `apps/web/public/email/` (`mimoia-logo.png`, `mimoia-simbolo.png`): the logo and symbol only show once that web build is live.
- `/newsletter/baja` is a public route (`PUBLIC_ROUTES` in `app/layout.tsx`).
- No health claims in any issue (constitution §6); the wine idea waits for Legal.

## Known limitations

- Same issue for everyone (apart from the per-recipient links); no personalisation by diet or usage yet (v2 in Marketing's approach).
- Accounts get no invite link in the footer yet, even though they have one (PRO-162, Perfil); its copy is still to be decided.
- No opens: only clicks per link (PRO-191) and opt-outs per issue. Scanners not in the user-agent list still count as clicks.
- Unsubscribing from the newsletter has no "subscribe again" button: write to the contact in `/privacidad`.

## Related specs

- [Email](./email.md) — Resend, `sendEmailBatch`
- [Waitlist](./waitlist.md) — the opt-in box, the full opt-out
- [Auth](./auth.md) — the box at `/register`
- [Privacy](./privacy.md) — «11. Lista de espera»
- [Admin audit log](./admin-audit-log.md) — `newsletter.send`

## Source

- [apps/api/src/services/newsletter.ts](../apps/api/src/services/newsletter.ts) — schema, template, recipients, repo, `sendNewsletter`; the shell pieces come from [emailBrand.ts](../apps/api/src/services/emailBrand.ts)
- [apps/api/src/routes/newsletter.ts](../apps/api/src/routes/newsletter.ts) — `POST /admin/newsletter/send`, `POST /newsletter/unsubscribe`, `GET /newsletter/click/:issueId/:n`, `GET /admin/newsletter/stats`
- [apps/api/src/services/newsletterStats.ts](../apps/api/src/services/newsletterStats.ts) — tracked links, what counts as a click, per-issue stats (PRO-191); [apps/web/src/app/n/[issue]/[n]/route.ts](../apps/web/src/app/n/[issue]/[n]/route.ts) — the redirect; migration [0083_newsletter_clicks.sql](../apps/api/src/db/migrations/0083_newsletter_clicks.sql)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`newsletterSends`), [apps/api/src/db/migrations/0046_newsletter_sends.sql](../apps/api/src/db/migrations/0046_newsletter_sends.sql)
- [apps/web/src/app/(public)/newsletter/baja/page.tsx](../apps/web/src/app/(public)/newsletter/baja/page.tsx)
- [apps/web/src/components/profile/NewsletterToggle.tsx](../apps/web/src/components/profile/NewsletterToggle.tsx) (profile), [apps/web/src/app/(auth)/register/page.tsx](../apps/web/src/app/(auth)/register/page.tsx) (box), [apps/api/src/routes/auth.ts](../apps/api/src/routes/auth.ts) (`newsletterOptIn`), migration [0047_users_newsletter.sql](../apps/api/src/db/migrations/0047_users_newsletter.sql)
- Tests: `apps/api/src/tests/newsletter.test.ts` (recipients, idempotency, opt-out keeps the entry, template, routes, `forgetNewsletterSends`, clicks: 2 links, one clicked twice → 2 and 0, unknown → 404, HEAD/scanner/proof not counted; opt-out with an invented issue or an issue not sent to that person → done, counted without issue, no such issue in the stats; with the issue sent to them → counted under it; a failing check → counted without issue; `buildIssueStats`: unknown issues count without issue, an issue with saved links but no sends keeps its opt-outs), `newsletter.smoke.ts` (real API + DB, incl. register with the box and the profile switch; `wasSentTo` (pending claim → no, sent → yes, other address or issue → no) and an opt-out from a later signup not counted under the issue while the address it was sent to is; traces kept after the newsletter opt-out and gone after `/lista/baja` and after deleting the account), `apps/web/e2e/newsletter-unsubscribe.spec.ts`, `apps/web/e2e/newsletter-optin.spec.ts` (390×844: register with the box → dry run includes them → profile switch off)
