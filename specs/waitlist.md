# Waitlist (pre-launch, Mimoia)

The public waitlist that comes before the launch. The product launches publicly as **Mimoia** (decision D-012; `BRAND_NAME` in `@ona/shared`, and since the coordinated rename of 2026-10-08 the name users see everywhere, logged-in app included; "Mimoia" stays only the internal name). Closed beta from 2026-10-21 (D-041; 10–30 households, invite-only); people are let in **by batches every 2–4 weeks**. There is no visible queue position and no fake scarcity. The honest line is: "entramos por tandas porque cada hogar lo acompañamos de cerca".

## User Capabilities

- Visitors on the landing (`/`) can join from the **"Lista de espera" section** (`#lista-de-espera`). The hero CTA, the landing's final CTA, `PublicNavbar` ("Lista de espera"), `/como-funciona`, the public catalogue `/recipes` (signed out) and the recipe page `/recipes/[id]` seen signed out (`RecipeWaitlistCta`, `?ref=receta`) all lead there with "Únete a la lista de espera". `/register` still works for invited households, but no public CTA links to it — until registration opens (below).
- **Open registration (PRO-167, D-057; from 2026-11-16):** the web follows the API's `REGISTRATION_MODE` by itself, read from **`GET /public/config`** → `{ registration: "invite" | "open" }` (public, `Cache-Control: max-age=60`; `routes/publicConfig.ts`, hook `useRegistrationMode` / `useSignupCta`, components `SignupCtaLink`, `WaitlistOnly` in `components/shared/SignupCta.tsx`). With **`open`**: the landing has no waitlist section, and every public call to action — the hero and final CTA, `PublicNavbar` (desktop and mobile menu), `/como-funciona`, `/precios` signed out, the catalogue and recipe CTAs, the blog — says **«Crea tu cuenta gratis»** (`OPEN_SIGNUP_CTA_LABEL`; Marketing reviews) and goes to `/register`, keeping the page's own `?ref` (else the placement: `como-funciona`, `precios`, `recetas`, `receta`, `blog`), `?invita` and `utm_*` (`openRegistrationHref`, `@ona/shared`); the landing still remembers them for a later sign-up. Waitlist-only lines («Entramos por tandas…», «Lista de espera ·» eyebrows) are hidden. `/lista/<código>`, `/lista/baja` and the invitation links keep working. With **`invite`** (or if the call fails, or until it answers) everything is as before. On 2026-11-16 Miguel sends «Invitar tanda» to everyone still waiting. Tests: `registrationMode.test.ts`, `publicConfig.smoke.ts`, e2e `open-registration.spec.ts` (390×844, `open` mocked on the route).
- Beside the form, the copy says why to join (2026-10-15): «Entrando en la beta nos ayudas a hacer Mimoia: cada semana que la usáis nos dice qué funciona en una casa de verdad y qué tenemos que cambiar. A cambio, tu casa será **Hogar fundador**, y lo verás en tu perfil para siempre» (`data-testid="waitlist-why-beta"`; the badge is real: [household.md](./household.md)).
- The form asks for:
  - email (required) and first name (optional);
  - **four one-tap questions** (all required): household size (`Solo yo / Dos / 3 o 4 / 5 o más`), who plans and shops (`Yo / Otra persona / Lo compartimos`), how they organise today (`Improviso / Lista en papel o en notas / Con una app / Menú fijo / Casi no cocino en casa`) and phone (`iPhone / Android / Otro`; it decides the Android app on 2026-11-16, D-042, and which install instructions to send);
  - optional: where they usually shop, and "Quiero usar Mimoia por WhatsApp cuando entre";
  - a **separate, optional, unchecked** «Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia» (newsletter opt-in; `NEWSLETTER_OPT_IN_LABEL`, PRO-132), with the hint «Te lo recomendamos: te va a sorprender. Es opcional y aparte de la lista; te das de baja con un clic.» (PRO-94; it is sent as described in [Newsletter](./newsletter.md));
  - the **required** consent checkbox, which links to `/privacidad#lista-de-espera`.
  - No health data, ever.
- The submit button stays disabled until the email, the four answers and the consent are in.
- The form sends the landing URL's `?ref=` (source slug: menu, receta, recetas, como-funciona, blog — the CTA at the end of every article, see [Blog](./blog.md)…), `?utm_source/medium/campaign` and `?invita=<code>` (referral).
- **Success state**: "Ya estás en la lista[, Nombre]." «Te escribimos por email cuando le toque a tu tanda. Cuando entréis, tu casa será Hogar fundador.» On sending, the card scrolls so its top is on screen (`scrollIntoView`, smooth unless reduced motion; on a phone you used to land mid-card). Then **«Ayúdanos a llegar a más casas»** (`SocialFollow`, `data-testid="waitlist-social"`): Instagram @conmimoia and Facebook Mimoia (`BRAND_SOCIAL_LINKS`), opened in a new tab. Below it, "**Invita a tu hogar y entráis antes**" shows the personal link `<origin>/?invita=<code>` with:
  - "Copiar enlace" (Clipboard API, then `execCommand` fallback, then select-the-text-and-say-so);
  - "Enviar por WhatsApp" (`https://wa.me/?text=…`, the first-person share text from `waitlistShareText`);
  - "Ver a cuántas personas has invitado" (→ `/lista/<code>`);
  - "Date de baja aquí" (only on the submission that created the entry).
- The same personal link goes at the foot of every Friday newsletter the person receives («Invita a tu hogar y entráis antes: …», PRO-130, see [Newsletter](./newsletter.md)).
- **No price questions on the waitlist (since 2026-10-15).** Until then the success state asked four Van Westendorp questions and offered a founder reservation (PRO-26, D-020/D-021). Miguel moved the questions to beta users after a week of use ([billing.md](./billing.md) → Beta price survey) and dropped the reservation: people hadn't tried Mimoia yet. `POST /waitlist/pricing` and `POST /waitlist/reservation` still exist and the admin report still reads the answers already stored, but no screen calls them.
- **Owner page `/lista/[code]`**: "Aún no has invitado a nadie." / "Has invitado a 1 persona." / "Has invitado a N personas.", plus the link to share again. It shows a count only: never who those people are, nor the owner's own status. Unknown or left codes say "Este enlace no existe (o ya no está en la lista)".
- **Opt-out `/lista/baja?t=<token>`**: one button, "Darme de baja". It works on click, not on page load, so mail scanners can't unsubscribe anyone. Leaving deletes the email, name and supermarket, turns the newsletter off, deletes the newsletter's send traces for that email (PRO-132, see [Newsletter](./newsletter.md)), and the person's link stops working. The same email can sign up again later as a fresh entry.
- **Admins / Mimoia HQ agents** read `GET /admin/waitlist?days=30&batchSize=20` with an admin JWT **or** `x-metrics-token` (the same read-only token as [metrics](./metrics.md)). The report has:
  - `totals`: entries, active, last7Days, wantsWhatsapp, newsletterOptIns, inTargetSegment, referredSignups;
  - `status` counts;
  - `byDay`: signups per Madrid day, zero-filled;
  - `segments`: marginals plus the household × planner × method cross with a `target` flag;
  - `sources`: bySource and byUtm;
  - `referrals`: top referrers by **code only**;
  - `batches`: size / joined / unsubscribed per batch;
  - `suggestedNextBatch`: ids + counts;
  - `pricing` (PRO-26): `answeredPriceQuestions`, per question `{ answers, min, p25, median, p75, max, histogram[{eur,count}] }`, `reservations { total, byPlan }`, `none { total, byReason }` — aggregates of active entries only;
  - `definitions`.
  - It never includes an email, name or supermarket.
- **Admins** (JWT only, not the token) mark a batch invited with `POST /admin/waitlist/invite { ids, batch? }`, which uses the next batch number when omitted. Only `waiting` entries change. Each newly invited person gets a **personal one-time link** `/entrar/<token>` (PRO-97) and is **emailed the invitation** through Resend (PRO-93, see [Email](./email.md)): «¡Te toca, <nombre>! Ya puedes entrar en Mimoia», a «Crear mi cuenta» button to that link, what to expect, a WhatsApp line if they asked for it, their own opt-out link and a `List-Unsubscribe` header. Miguel does it from **`/admin/lista-espera`** ([Admin](./admin-dashboard.md)): suggested batch with names and emails (`GET /admin/waitlist/next-batch?size=`, admin JWT only), remove people, «Invitar a estas N personas» with a confirmation. `sendEmail: false` marks the batch without emailing; without `RESEND_API_KEY` nothing is sent (`skipped`). The invite response and `next-batch` are the only places emails leave the DB: email, name, platform, wantsWhatsapp, `statusUrl`, `unsubscribeUrl`, `entryUrl` (the one-time link), plus `emailStatus` per person and `email { sent, skipped, failed }`, so Miguel can see who got it and write to the rest. It is audited as `waitlist.invite` (ids, never emails).
- **The one-time link** (PRO-97): `/entrar/<token>` → `/register?entrada=<token>` with the email fixed; `GET /waitlist/invite/:token` (public, the token is the credential, limiter 60/min) → `{ email, firstName }`, 410 `WAITLIST_INVITE_USED` once used (or the person already joined), 404 `WAITLIST_INVITE_NOT_FOUND` otherwise. Opening it never uses it up; creating the account does. During the closed beta (`REGISTRATION_MODE=invite`, PRO-27) the link is how an invited person gets in; **the invited email without the link is rejected** (403 `WAITLIST_INVITE_LINK_REQUIRED`), except entries invited before PRO-97 (see [Auth](./auth.md) → Closed beta).
- **One reminder** 3 days after the invitation, if they haven't registered, by the notification scheduler (never twice; see [Email](./email.md)). Registering with an email that's on the list marks that entry `joined` (waiting or invited).
- `GET /admin/metrics` carries a small `waitlist` block (see [metrics](./metrics.md)).

## Who gets in first (`suggestNextBatch`)

Only `waiting` entries. The ranking:
1. **Target segment** first: household of 2 or more, plans alone or shared (`yo` / `compartido`), and doesn't answer "casi no cocino".
2. Within a tier, people who **brought someone** (an active signup with their link) or whose **own referrer is already invited/joined** — or is an account: a waitlist signup with an account's «Invitar a otro hogar» code (PRO-162) counts as «their referrer is in» (`POST /waitlist` accepts account codes as `referredByCode`).
3. Earliest signup (ties by id).

Each picked person **pulls in** the waiting people who signed up with their link, and theirs down the chain, right after them, until the batch is full. That is how "entráis antes, y juntos" is kept. Only ids and counts are returned.

## Constraints

- **Endpoints** (public ones mounted before the catch-all auth routers, after `express.json()`):
  - `POST /waitlist` → `200 { code, referralUrl, referredCount, unsubscribeToken? }` for new and repeat emails alike;
  - `GET /waitlist/:code` → `{ code, referralUrl, referredCount }` or 404 (`WAITLIST_CODE_NOT_FOUND`);
  - `POST /waitlist/unsubscribe { token }` → `{ ok, alreadyUnsubscribed }` or 404 (`WAITLIST_TOKEN_NOT_FOUND`).
  - `POST /waitlist/pricing { token, tooCheap?, good?, expensive?, tooExpensive? }` (€/month, 0–500, null = unanswered) and `POST /waitlist/reservation { token, choice }` (`esencial-mensual | plus-anual | plus-mensual`, `ninguno` + `reason`, or `anular`) → `200 { ok }`, 400 on bad input, 404 (`WAITLIST_TOKEN_NOT_FOUND`) for an unknown or left entry. The opt-out token is the credential (PRO-26). Limiter 60/hour per IP.
- **Idempotent on email** (lowercased + trimmed by the shared schema). A repeat submission with any answers changes nothing and returns the same link and count, but **never the opt-out token**, so knowing someone's email isn't enough to remove them. That token difference is the only way a caller can tell "already on the list" (accepted trade-off). A concurrent duplicate (unique violation) answers like a repeat.
- **Validation** (`waitlistSignupSchema`, shared with the form): bad email, missing consent, unknown answers and a filled **honeypot** (`website`, off-screen, no tab stop) all give 400 `INVALID_WAITLIST_SIGNUP`. People get a field-specific Spanish message; the honeypot gets a generic one. Unknown keys (e.g. allergies) are dropped. Attribution never fails a signup: a bad `ref` becomes `directo`, an unknown or malformed `invita` becomes `null`, and utm values are trimmed to 100 chars without control characters.
- `source` = the `?ref` slug, else `invita` when only `?invita=` came, else `directo`.
- `referred_by_code` is kept only when that code belongs to an entry that hasn't unsubscribed. Referral counts exclude unsubscribed entries.
- **Rate limits** (per IP, `middleware/rateLimit.ts`): signup 20/hour, status 60/min, opt-out 20/hour. The `RATE_LIMIT_DISABLED` rules are the same as [auth](./auth.md).
- **Codes**:
  - invitation link token: HMAC-SHA256 of the entry id keyed with `JWT_SECRET` (43 base64url chars), so the reminder rebuilds the same link; only its SHA-256 is stored (`invite_token_hash`, unique), with `invite_token_used_at` and `invite_reminder_sent_at` (migration 0048). Rotating `JWT_SECRET` breaks unused links;
  - referral code: 8 chars of lowercase Crockford base32 (40 random bits, no i/l/o/u), retried on collision;
  - opt-out token: 24 random bytes, base64url;
  - both are unique in the DB.
- **Consent**: `consent_version` + `consent_at` on every entry (`WAITLIST_CONSENT_VERSION`, `2026-10-19` since the retention date in `/privacidad` (PRO-171; `2026-10-17` for Legal's precisions, PRO-132); the newsletter's `WAITLIST_NEWSLETTER_CONSENT_VERSION` is `2026-10-17` too, for the box's new words; consents already given keep the version they were given with). The newsletter is a separate consent (LSSI art. 21–22): `newsletter_opt_in` defaults to false, and `newsletter_consent_at` + `newsletter_consent_version` are stored only when ticked. Bump the versions when the copy or `/privacidad` changes.
- **Opt-out anonymises in place**: `status='unsubscribed'`, email/name/supermarket set to NULL, newsletter off. The anonymous answers stay for the counts (`email` is nullable; the unique index tolerates NULLs).
- **Retention (PRO-171, LEG-17)**: entries are kept until **2027-05-16** (six months after registration opened to everyone on 2026-11-16) or until opt-out, whichever comes first; `/privacidad` says so word for word. From that day (Madrid), once a day, the scheduler (`purgeWaitlistPersonalDataIfDue`, `services/waitlistRetention.ts`) sets email/name/supermarket to NULL on every entry that still has an email and **doesn't** have the Friday newsletter on, and deletes that email's newsletter send traces; answers, status and codes stay for the counts. Newsletter readers keep their email while subscribed; if they turn it off later, the next daily run anonymises them. Tested in `waitlistRetention.test.ts`.
- Referral links point to `WEB_PUBLIC_URL` in API responses; the web shows `window.location.origin`, so the link matches the domain the person used.
- `/lista/*` renders with the public chrome (`PUBLIC_PREFIXES` in `app/layout.tsx`).
- Public copy in `components/waitlist/` is scanned by `publicHealthClaims.test.ts`.

## Known limitations

- **Emails sent**: the invitation (PRO-93) and the Friday newsletter (PRO-94, [newsletter.md](./newsletter.md); its own opt-out turns off only the newsletter). There is no confirmation email (no double opt-in).
- No phone number is collected, so "por WhatsApp" is a stated preference, honoured by sending the invitation with the WhatsApp link (since 2026-10-14 Mimo is on a real number, so the 5-recipient limit of Meta's test number no longer applies; access is still gated by `WHATSAPP_ALLOWED_EMAILS`, see [WhatsApp](./whatsapp.md)).
- The opt-out link is shown only on the device and submission that created the entry. Otherwise it comes in Miguel's emails, or via the contact in `/privacidad` (which needs `NEXT_PUBLIC_SUPPORT_EMAIL`, see CLAUDE.md → Todo Miguel).

## Related specs

- [Privacy](./privacy.md): `/privacidad` "11. Lista de espera"
- [Business metrics](./metrics.md): `waitlist` block, `metricsAuth`
- [Design system](./design-system.md): landing section, `/lista/*`
- [Auth](./auth.md): `/register` marks the entry joined
- [Admin audit log](./admin-audit-log.md): `waitlist.invite`
- [Email](./email.md): the invitation email, Resend
- [Newsletter](./newsletter.md): the Friday email to entries with the box ticked

## Source

- [packages/shared/src/types/founderPricing.ts](../packages/shared/src/types/founderPricing.ts), [apps/api/src/services/waitlistPricing.ts](../apps/api/src/services/waitlistPricing.ts) — founder pricing signal (PRO-26; migration 0041)
- [packages/shared/src/types/waitlist.ts](../packages/shared/src/types/waitlist.ts): enums, labels, `waitlistSignupSchema`, form state + `buildWaitlistPayload`, `readWaitlistAttribution`, link/share helpers
- [packages/shared/src/constants/brand.ts](../packages/shared/src/constants/brand.ts): `BRAND_NAME`
- [apps/api/src/services/waitlist.ts](../apps/api/src/services/waitlist.ts): code/token generators, `isTargetSegment`, `suggestNextBatch`, `buildWaitlistReport`, `signupToWaitlist`, DB repo, `loadWaitlistReport`, `loadWaitlistSummary`, `loadNextBatchPeople` + `nextBatchPeople`, `inviteWaitlistEntries`, `markWaitlistJoined`
- [packages/shared/src/types/registration.ts](../packages/shared/src/types/registration.ts): `RegistrationMode`, `PublicConfig`, `OPEN_SIGNUP_CTA_LABEL`, `openRegistrationHref` (PRO-167)
- [apps/api/src/routes/publicConfig.ts](../apps/api/src/routes/publicConfig.ts): `GET /public/config`
- [apps/web/src/hooks/useRegistrationMode.ts](../apps/web/src/hooks/useRegistrationMode.ts) + [apps/web/src/components/shared/SignupCta.tsx](../apps/web/src/components/shared/SignupCta.tsx): the web following the mode
- [apps/api/src/services/waitlistRetention.ts](../apps/api/src/services/waitlistRetention.ts): `WAITLIST_RETENTION_DATE` (2027-05-16) and the daily anonymisation from that day (PRO-171)
- [apps/api/src/routes/waitlist.ts](../apps/api/src/routes/waitlist.ts): public + admin routers (mounted in `index.ts`)
- [apps/api/src/services/waitlistEmails.ts](../apps/api/src/services/waitlistEmails.ts): `waitlistInviteEmail`, `waitlistInviteReminderEmail`
- [apps/api/src/services/waitlistInvites.ts](../apps/api/src/services/waitlistInvites.ts): one-time link (token, hash, check, use up), reminder; [migration 0048](../apps/api/src/db/migrations/0048_waitlist_invite_token.sql)
- [apps/web/src/app/entrar/[token]/route.ts](../apps/web/src/app/entrar/%5Btoken%5D/route.ts), [apps/web/src/app/admin/sections/WaitlistAdminSection.tsx](../apps/web/src/app/admin/sections/WaitlistAdminSection.tsx)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`waitlistEntries`), [apps/api/src/db/migrations/0037_waitlist.sql](../apps/api/src/db/migrations/0037_waitlist.sql)
- [apps/web/src/components/waitlist/WaitlistSection.tsx](../apps/web/src/components/waitlist/WaitlistSection.tsx), [ReferralShare.tsx](../apps/web/src/components/waitlist/ReferralShare.tsx)
- [apps/web/src/app/(public)/page.tsx](../apps/web/src/app/(public)/page.tsx), [lista/[code]/page.tsx](../apps/web/src/app/(public)/lista/[code]/page.tsx), [lista/baja/page.tsx](../apps/web/src/app/(public)/lista/baja/page.tsx)
- Tests:
  - `apps/api/src/tests/waitlist.test.ts`: generators, ranking, report, schema + form contract, signup service;
  - `waitlistRoute.test.ts`: routes, rate limit, auth, the invite emails each person;
  - `email.test.ts`: the invitation and reminder emails;
  - `waitlistInvites.test.ts`: link token/state, reminder (3 days yes, 2 no, never twice), `nextBatchPeople`, `GET /waitlist/invite/:token`;
  - `apps/web/e2e/waitlist-invite.spec.ts`: admin invites a batch, simulated email, link, reuse, no link;
  - `waitlistRoute.smoke.ts`: real API + Postgres;
  - `fixtures/memoryWaitlistRepo.ts`;
  - `apps/web/e2e/waitlist.spec.ts`.
