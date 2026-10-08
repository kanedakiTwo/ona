# Privacy & account deletion

How a user deletes their account, and what the public privacy policy promises. The policy must describe what the code does; when processing changes (new provider, new data), update both.

## User Capabilities

- Users can delete their account from **Perfil → Borrar mi cuenta**: a card explains what goes and asks for the password; "Borrar definitivamente" calls `DELETE /user/:id { password }`, then wipes local auth + the offline caches (`clearSessionData`) and lands on `/?cuenta=borrada`.
- Users can read the privacy policy at `/privacidad` (linked from the profile, above the delete card, and from the waitlist consent checkbox).
- People on the [waitlist](./waitlist.md) (no account) leave it with one click on `/lista/baja?t=<token>`: their email, name and supermarket are deleted, the weekly-menu newsletter is turned off, and only anonymous answers stay for the counts.

## What deletion does (`services/accountDeletion.ts`)

Runs in one transaction; image files are removed after the commit.
- **Own recipes are deleted first.** `recipes.author_id` is `ON DELETE SET NULL` and `authorId NULL` means "ONA catalogue": with a bare user delete, private recipes would have turned public.
- **Shared households survive.** For every household the user is in that has other members:
  - if the user owned it, ownership goes to the longest-standing non-child member (their member row becomes `owner`);
  - menus and shopping lists of that household created by the user are reassigned to the (new) owner, so the others keep their week.
  Households left with no one are deleted (cascade).
- **WhatsApp:** messages from the linked phone are deleted, including the ones received before linking (`user_id` null). The link cascades.
- Everything else keyed by the user cascades (memory, favourites, cook log, pantry rows of a deleted household, push subscriptions, notification schedule…). `cost_events` / `shop_orders` keep their rows with `user_id = NULL` (anonymous accounting); `app_errors` keeps its error groups with `last_user_id = NULL` ([Error tracking](./errors.md)).
- Image files on the volume (`IMAGE_STORAGE_DIR/<uuid>.jpg`) for the deleted recipes and for photos of deleted recipes/households. Seed images (`/images/recipes/<slug>.jpg`) are never touched.
- The old session stops working: its next request gets `401 USER_NOT_FOUND` (web logs out).

## Constraints

- `DELETE /user/:id`: caller must be `:id` (else **403**), password must match (else **401 `WRONG_PASSWORD`**). **409 `ADMIN_ACCOUNT`** for admins or anyone with `admin_audit_log` rows: that FK has no `ON DELETE` and the audit trail must survive.
- Deletion is immediate and irreversible (no grace period, no backup restore per user).
- No self-service data export yet: the policy offers portability "by email" to the support contact.
- The policy's contact is `NEXT_PUBLIC_SUPPORT_EMAIL` (web build var); unset → "la persona de Mimoia que te invitó a la beta" (true while the beta is invitation-only). The public footer and `/terminos` show the same address via `apps/web/src/lib/contact.ts`, which falls back to hola@mimoia.com instead (the old "hola@ona.app" / "legal@ona.app" were dead addresses). The controller's legal identity and the legal review are pending (CLAUDE.md → Todo Miguel).
- Policy facts to keep true: processors are Anthropic (assistant, imports, nutrition estimates, WhatsApp review), OpenAI (transcription, realtime voice), Meta (WhatsApp), Railway (hosting), AiKit (recipe images: name + ingredients only). Health data (physical profile, allergies) is processed on explicit consent (art. 9.2.a RGPD). Technical data includes the in-house error log (`app_errors`: scrubbed message/stack, page path, browser family, last user; no IP, no request bodies, never sent to a third party — see [errors.md](./errors.md)). No analytics or ad cookies; localStorage holds the session, UI prefs and the offline copy.

- **Waitlist section** ("11. Lista de espera"): collects email, optional name, four household/planning answers, optional supermarket and WhatsApp interest, how they arrived (`ref`/`utm`/referrer), consent time + version; **no health data**. Purpose: invite by batches and ask about habits to design the product. Basis: consent (art. 6.1.a RGPD); the "menú de los viernes" email is a separate, optional consent (art. 21 LSSI). Retention: until 6 months after the public launch or until opt-out, whichever comes first (purge not automated yet). Opt-out link given at signup and in every email; leaving anonymises the row. Stored on Railway only, never shared. The whole policy, like the rest of the product, says Mimoia.

## Related specs

- [Auth](./auth.md) — sessions, `USER_NOT_FOUND`
- [Household](./household.md) — ownership hand-over mirrors "leave"
- [Recipes](./recipes.md) — visibility (`authorId NULL` = catalogue)
- [WhatsApp](./whatsapp.md) — links, messages, BAJA
- [PWA](./pwa.md) — `clearSessionData`
- [Waitlist](./waitlist.md) — pre-launch list, its consent and opt-out

## Source

- [apps/api/src/services/accountDeletion.ts](../apps/api/src/services/accountDeletion.ts)
- [apps/api/src/routes/users.ts](../apps/api/src/routes/users.ts) — `DELETE /user/:id`
- [apps/web/src/components/profile/DeleteAccountCard.tsx](../apps/web/src/components/profile/DeleteAccountCard.tsx)
- [apps/web/src/app/(public)/privacidad/page.tsx](../apps/web/src/app/(public)/privacidad/page.tsx)
- Tests: `apps/api/src/tests/accountDeletion.smoke.ts` (real API + DB), `apps/api/src/tests/accountDeletion.test.ts`
