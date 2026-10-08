# Waitlist (pre-launch, Mimoia)

The public waitlist that comes before the launch. The product launches publicly as **Mimoia** (decision D-012; `BRAND_NAME` in `@ona/shared`, and since the coordinated rename of 2026-10-08 the name users see everywhere, logged-in app included; "ONA" stays only the internal name). Closed beta from 2026-10-28 (10–30 households, invite-only); people are let in **by batches every 2–4 weeks**. There is no visible queue position and no fake scarcity. The honest line is: "entramos por tandas porque cada hogar lo acompañamos de cerca".

## User Capabilities

- Visitors on the landing (`/`) can join from the **"Lista de espera" section** (`#lista-de-espera`). The hero CTA, the landing's final CTA, `PublicNavbar` ("Lista de espera"), `/como-funciona` and both `/recipes-ona` pages all lead there with "Únete a la lista de espera". `/register` still works for invited households, but no public CTA links to it.
- The form asks for:
  - email (required) and first name (optional);
  - **four one-tap questions** (all required): household size (`Solo yo / Dos / 3 o 4 / 5 o más`), who plans and shops (`Yo / Otra persona / Lo compartimos`), how they organise today (`Improviso / Lista en papel o en notas / Con una app / Menú fijo / Casi no cocino en casa`) and phone (`iPhone / Android / Otro`);
  - optional: where they usually shop, and "Quiero usar Mimoia por WhatsApp cuando entre";
  - a **separate, optional, unchecked** "Quiero recibir cada viernes el menú de la semana por email" (newsletter opt-in);
  - the **required** consent checkbox, which links to `/privacidad#lista-de-espera`.
  - No health data, ever.
- The submit button stays disabled until the email, the four answers and the consent are in.
- The form sends the landing URL's `?ref=` (source slug: menu, receta, recetas, como-funciona…), `?utm_source/medium/campaign` and `?invita=<code>` (referral).
- **Success state**: "Ya estás en la lista[, Nombre]." The text explains the batches honestly. Below it, "**Invita a tu hogar y entráis antes**" shows the personal link `<origin>/?invita=<code>` with:
  - "Copiar enlace" (Clipboard API, then `execCommand` fallback, then select-the-text-and-say-so);
  - "Enviar por WhatsApp" (`https://wa.me/?text=…`, the first-person share text from `waitlistShareText`);
  - "Ver a cuántas personas has invitado" (→ `/lista/<code>`);
  - "Date de baja aquí" (only on the submission that created the entry).
- **Owner page `/lista/[code]`**: "Aún no has invitado a nadie." / "Has invitado a 1 persona." / "Has invitado a N personas.", plus the link to share again. It shows a count only: never who those people are, nor the owner's own status. Unknown or left codes say "Este enlace no existe (o ya no está en la lista)".
- **Opt-out `/lista/baja?t=<token>`**: one button, "Darme de baja". It works on click, not on page load, so mail scanners can't unsubscribe anyone. Leaving deletes the email, name and supermarket, turns the newsletter off, and the person's link stops working. The same email can sign up again later as a fresh entry.
- **Admins / ONA HQ agents** read `GET /admin/waitlist?days=30&batchSize=20` with an admin JWT **or** `x-metrics-token` (the same read-only token as [metrics](./metrics.md)). The report has:
  - `totals`: entries, active, last7Days, wantsWhatsapp, newsletterOptIns, inTargetSegment, referredSignups;
  - `status` counts;
  - `byDay`: signups per Madrid day, zero-filled;
  - `segments`: marginals plus the household × planner × method cross with a `target` flag;
  - `sources`: bySource and byUtm;
  - `referrals`: top referrers by **code only**;
  - `batches`: size / joined / unsubscribed per batch;
  - `suggestedNextBatch`: ids + counts;
  - `definitions`.
  - It never includes an email, name or supermarket.
- **Admins** (JWT only, not the token) mark a batch invited with `POST /admin/waitlist/invite { ids, batch? }`, which uses the next batch number when omitted. Only `waiting` entries change. The response is the one place emails leave the DB: email, name, platform, wantsWhatsapp, `statusUrl`, `unsubscribeUrl`, so Miguel can write the invitations. It is audited as `waitlist.invite` (ids, never emails).
- Registering (`POST /register`) with an email that's on the list marks that entry `joined` (waiting or invited; never blocks registration).
- `GET /admin/metrics` carries a small `waitlist` block (see [metrics](./metrics.md)).

## Who gets in first (`suggestNextBatch`)

Only `waiting` entries. The ranking:
1. **Target segment** first: household of 2 or more, plans alone or shared (`yo` / `compartido`), and doesn't answer "casi no cocino".
2. Within a tier, people who **brought someone** (an active signup with their link) or whose **own referrer is already invited/joined**.
3. Earliest signup (ties by id).

Each picked person **pulls in** the waiting people who signed up with their link, and theirs down the chain, right after them, until the batch is full. That is how "entráis antes, y juntos" is kept. Only ids and counts are returned.

## Constraints

- **Endpoints** (public ones mounted before the catch-all auth routers, after `express.json()`):
  - `POST /waitlist` → `200 { code, referralUrl, referredCount, unsubscribeToken? }` for new and repeat emails alike;
  - `GET /waitlist/:code` → `{ code, referralUrl, referredCount }` or 404 (`WAITLIST_CODE_NOT_FOUND`);
  - `POST /waitlist/unsubscribe { token }` → `{ ok, alreadyUnsubscribed }` or 404 (`WAITLIST_TOKEN_NOT_FOUND`).
- **Idempotent on email** (lowercased + trimmed by the shared schema). A repeat submission with any answers changes nothing and returns the same link and count, but **never the opt-out token**, so knowing someone's email isn't enough to remove them. That token difference is the only way a caller can tell "already on the list" (accepted trade-off). A concurrent duplicate (unique violation) answers like a repeat.
- **Validation** (`waitlistSignupSchema`, shared with the form): bad email, missing consent, unknown answers and a filled **honeypot** (`website`, off-screen, no tab stop) all give 400 `INVALID_WAITLIST_SIGNUP`. People get a field-specific Spanish message; the honeypot gets a generic one. Unknown keys (e.g. allergies) are dropped. Attribution never fails a signup: a bad `ref` becomes `directo`, an unknown or malformed `invita` becomes `null`, and utm values are trimmed to 100 chars without control characters.
- `source` = the `?ref` slug, else `invita` when only `?invita=` came, else `directo`.
- `referred_by_code` is kept only when that code belongs to an entry that hasn't unsubscribed. Referral counts exclude unsubscribed entries.
- **Rate limits** (per IP, `middleware/rateLimit.ts`): signup 20/hour, status 60/min, opt-out 20/hour. The `RATE_LIMIT_DISABLED` rules are the same as [auth](./auth.md).
- **Codes**:
  - referral code: 8 chars of lowercase Crockford base32 (40 random bits, no i/l/o/u), retried on collision;
  - opt-out token: 24 random bytes, base64url;
  - both are unique in the DB.
- **Consent**: `consent_version` + `consent_at` on every entry (`WAITLIST_CONSENT_VERSION`). The newsletter is a separate consent (LSSI art. 21–22): `newsletter_opt_in` defaults to false, and `newsletter_consent_at` + `newsletter_consent_version` are stored only when ticked. Bump the versions when the copy or `/privacidad` changes.
- **Opt-out anonymises in place**: `status='unsubscribed'`, email/name/supermarket set to NULL, newsletter off. The anonymous answers stay for the counts (`email` is nullable; the unique index tolerates NULLs).
- Referral links point to `WEB_PUBLIC_URL` in API responses; the web shows `window.location.origin`, so the link matches the domain the person used.
- `/lista/*` renders with the public chrome (`PUBLIC_PREFIXES` in `app/layout.tsx`).
- Public copy in `components/waitlist/` is scanned by `publicHealthClaims.test.ts`.

## Known limitations

- **No emails are sent yet.** There is no confirmation email (no double opt-in) and no invitation sender: Miguel writes the invitations from `/admin/waitlist/invite`'s output. The weekly menu email has no sender yet either; we only collect the consent.
- No phone number is collected, so "por WhatsApp" is a stated preference, honoured by sending the invitation with the WhatsApp link (the beta's WhatsApp still runs on Meta's 5-recipient test number, see [WhatsApp](./whatsapp.md)).
- Retention (until 6 months after public launch) is not automated yet: the purge job is in the CLAUDE.md backlog.
- `?ref` / `?utm_*` are read only on the landing URL. They are not carried across pages, and `/register` doesn't record them.
- The opt-out link is shown only on the device and submission that created the entry. Otherwise it comes in Miguel's emails, or via the contact in `/privacidad` (which needs `NEXT_PUBLIC_SUPPORT_EMAIL`, see CLAUDE.md → Todo Miguel).

## Related specs

- [Privacy](./privacy.md): `/privacidad` "11. Lista de espera"
- [Business metrics](./metrics.md): `waitlist` block, `metricsAuth`
- [Design system](./design-system.md): landing section, `/lista/*`
- [Auth](./auth.md): `/register` marks the entry joined
- [Admin audit log](./admin-audit-log.md): `waitlist.invite`

## Source

- [packages/shared/src/types/waitlist.ts](../packages/shared/src/types/waitlist.ts): enums, labels, `waitlistSignupSchema`, form state + `buildWaitlistPayload`, `readWaitlistAttribution`, link/share helpers
- [packages/shared/src/constants/brand.ts](../packages/shared/src/constants/brand.ts): `BRAND_NAME`
- [apps/api/src/services/waitlist.ts](../apps/api/src/services/waitlist.ts): code/token generators, `isTargetSegment`, `suggestNextBatch`, `buildWaitlistReport`, `signupToWaitlist`, DB repo, `loadWaitlistReport`, `loadWaitlistSummary`, `inviteWaitlistEntries`, `markWaitlistJoined`
- [apps/api/src/routes/waitlist.ts](../apps/api/src/routes/waitlist.ts): public + admin routers (mounted in `index.ts`)
- [apps/api/src/db/schema.ts](../apps/api/src/db/schema.ts) (`waitlistEntries`), [apps/api/src/db/migrations/0037_waitlist.sql](../apps/api/src/db/migrations/0037_waitlist.sql)
- [apps/web/src/components/waitlist/WaitlistSection.tsx](../apps/web/src/components/waitlist/WaitlistSection.tsx), [ReferralShare.tsx](../apps/web/src/components/waitlist/ReferralShare.tsx)
- [apps/web/src/app/(public)/page.tsx](../apps/web/src/app/(public)/page.tsx), [lista/[code]/page.tsx](../apps/web/src/app/(public)/lista/[code]/page.tsx), [lista/baja/page.tsx](../apps/web/src/app/(public)/lista/baja/page.tsx)
- Tests:
  - `apps/api/src/tests/waitlist.test.ts`: generators, ranking, report, schema + form contract, signup service;
  - `waitlistRoute.test.ts`: routes, rate limit, auth;
  - `waitlistRoute.smoke.ts`: real API + Postgres;
  - `fixtures/memoryWaitlistRepo.ts`;
  - `apps/web/e2e/waitlist.spec.ts`.
