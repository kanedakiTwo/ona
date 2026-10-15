# Billing (plans, pricing page, subscriptions)

**Status:** shipped 2026-10-15 in Stripe **test mode**. Payments are switched on per environment by `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`; without them every pay button says payments aren't open yet. Production gets live keys only once there's a business to invoice (Todo Miguel).

Mimoia is paid per **household**, with two plans, each monthly or yearly. **Esencial is the plan we recommend** (Miguel, 2026-10-15): it goes first and carries «Recomendado» everywhere. Stripe Checkout with **Managed Payments** takes the money: Stripe, through **Link**, is the merchant of record (VAT, receipts, disputes, refunds). The statement reads `LINK.COM* MIMOIA`.

| Plan | Monthly | Yearly | What it adds |
|---|---|---|---|
| **Esencial** (featured) | 4,99 € | 49,99 € («Sale a 4,17 €/mes») | Menu, list, pantry, shop orders, recipes and imports (capped), Mimo by chat in the app **and on WhatsApp** (capped) |
| **Plus** | 8,99 € | 59,99 € («Sale a 5 €/mes») | Everything in Esencial + **voice**, **Mimo writes to you on WhatsApp** (today's menu, what to thaw, the list), higher caps |

Prices include VAT. Caps have no figures yet (PRO-15 sets them on 2026-11-24 with real beta costs); the copy says «tienen un tope de uso al mes; en Plus es más alto».

## User Capabilities

- **`/precios`** (public, in the nav and footer): the two plans with a **Mensual / Anual** switch, Esencial first with «Recomendado», a table of **everything each plan includes** grouped by Planificar · Comprar · Cocinar · Mimo · Tu hogar (✓ / — / «Con tope mensual» / «Tope más alto»), the price row, and five questions (whole household, when you're charged, changing or cancelling, Esencial vs Plus, who charges). The call to action depends on who looks:
  - logged out → «Apúntate a la lista de espera» (`/#lista-de-espera`);
  - logged in, payments off → «Muy pronto podrás pagarlo aquí» (disabled);
  - logged in, not the household owner → «Lo contrata quien gestiona tu hogar»;
  - household owner → «Elegir Esencial · pagas el 12 de enero» (beta) or «Elegir Esencial», which opens Stripe Checkout;
  - household already subscribed → «Es tu plan · ver suscripción» / «Cambiar a este plan» → `/profile/suscripcion`.
- **Perfil → Suscripción** (`/profile/suscripcion`; hub tile shows «Beta: Plus gratis», «Sin plan» or «Esencial · 4,99 €/mes»):
  - no subscription and payments on, owner: the two plans as a radio group (Esencial preselected, monthly) and «Suscribirme a Esencial · pago el 12 de enero»;
  - with a subscription: the plan and price, then «Lo has dejado pagado. No se cobra nada hasta el 12 de enero de 2027», «Próximo cobro: …», «Cancelada: sigue hasta el … y no se renueva» or the failed-payment line, and **«Gestionar mi suscripción»** (owner only), which opens Stripe's customer portal: change card, receipts, switch plan or period, cancel (at the end of the period, with a reason);
  - back from Checkout with `?estado=ok` it polls `GET /billing` every 2 s until the webhook has written the subscription («Estamos confirmando tu pago…»); `?estado=cancelado` says nothing was charged.
- **Pay during the beta, charged on launch day.** Before `LAUNCH_DATE` (2027-01-12, 00:00 Madrid) Checkout creates the subscription with `trial_end` = launch day: the card is saved now and the first charge is that day. Stripe/Link email a trial-start note and a reminder before it ends. Cancelling before then costs nothing. Less than 49 h before launch, or after it, there's no trial: the first charge is immediate.
- **The beta runs with Plus for everyone** until launch day (`BillingState.beta`), paid or not.
- **Founder reservation** on the waitlist uses the same cards (see [waitlist.md](./waitlist.md)).
- **«Borrar mi cuenta»** first cancels, at once, every live subscription the user pays; if Stripe can't be reached the account is not deleted (502 `SUBSCRIPTION_CANCEL_FAILED`, «inténtalo en un momento»).

## API

- `GET /billing` (auth) → `BillingState`: `enabled`, `beta`, `launchDate`, `canManage` (the caller owns their primary household), `subscription` (`plan`, `period`, `status`, `nextChargeAt`, `cancelAtPeriodEnd`, `endsAt`) or null. A subscription counts while its status is `trialing`, `active`, `past_due`, `unpaid`, `incomplete` or `paused`.
- `POST /billing/checkout` (auth) `{ plan, period }` → `{ url }` (Stripe Checkout). 503 `BILLING_DISABLED`, 400 bad body, 403 `NOT_HOUSEHOLD_OWNER`, 409 `ALREADY_SUBSCRIBED`, 502 when Stripe fails. Reuses the household's previous Stripe customer if there is one.
- `POST /billing/portal` (auth, owner) → `{ url }` (customer portal, returns to `/profile/suscripcion`). 404 `NO_SUBSCRIPTION`.
- `POST /billing/webhook` (Stripe, signed with `STRIPE_WEBHOOK_SECRET`, raw body, mounted before `express.json()`). Handles `checkout.session.completed` and `customer.subscription.created|updated|deleted|paused|resumed`; for each it **re-reads the subscription from Stripe** (events can arrive late or out of order) and upserts it. Bad signature 400; payments off 503; a failure 500 so Stripe retries.

## Data

- `subscriptions` (migration `0049_billing_subscriptions`): one row per Stripe subscription — `household_id`, `user_id` (payer, `SET NULL` on delete), `stripe_customer_id`, `stripe_subscription_id` (unique), `plan`, `period`, `status` (Stripe's), `current_period_end`, `trial_end`, `cancel_at_period_end`, `canceled_at`. Written only by the webhook (and by the account-deletion cancel). Plan and period come from the price's **lookup key**, so a plan change in the portal is picked up; checkout metadata (`householdId`, `userId`, `plan`, `period`) is the fallback and the link to the household.
- No card data ever reaches us.

## Configuration

- Env (API): `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`; links use `WEB_PUBLIC_URL`.
- `apps/api/scripts/stripeSetup.ts` (idempotent) creates in the Stripe account: products «Mimoia Esencial» / «Mimoia Plus» with tax code `txcd_10103000` (SaaS, personal use; required by Managed Payments), four EUR prices with `tax_behavior: inclusive` and lookup keys `esencial_mensual`, `esencial_anual`, `plus_mensual`, `plus_anual` (a changed price gets a new Price and the lookup key moves to it), the webhook endpoint (`--webhook-url`; its secret is written to `--secret-out`, never printed) and the default customer portal configuration.
- Managed Payments must be accepted in the Stripe Dashboard. Checkout never sends what it refuses (`automatic_tax`, `tax_id_collection`, `payment_method_types`, `invoice_creation`, `custom_text`…: Stripe answers 400 «You cannot use custom_text with Managed Payments», found in staging 2026-10-15). The «no se cobra nada hasta el 12 de enero» line lives on our pages; Stripe's checkout shows the trial until that date.

## Constraints / known limitations

- **Plans aren't enforced yet.** Everybody gets everything (the beta is Plus); from launch day the trial without card, the paused account at its end and the per-plan caps are still to build (TODO in `services/billing.ts`).
- Only the household **owner** can subscribe or manage; the plan covers the whole household.
- One live subscription per household (409 otherwise); changes go through the portal.
- Terms §8–9 and the privacy policy describe this; both still need the legal review on Miguel's list.

## Source

- [packages/shared/src/types/plans.ts](../packages/shared/src/types/plans.ts) — plans, prices, comparison table, `BillingState`
- [packages/shared/src/types/founderPricing.ts](../packages/shared/src/types/founderPricing.ts) — founder ids derived from the plans
- [apps/api/src/services/billing.ts](../apps/api/src/services/billing.ts) — Checkout params, webhook mapping, repo, Stripe gateway, cancel on deletion
- [apps/api/src/routes/billing.ts](../apps/api/src/routes/billing.ts)
- [apps/api/src/routes/users.ts](../apps/api/src/routes/users.ts) — deletion cancels the subscription first
- [apps/api/src/db/migrations/0049_billing_subscriptions.sql](../apps/api/src/db/migrations/0049_billing_subscriptions.sql)
- [apps/api/scripts/stripeSetup.ts](../apps/api/scripts/stripeSetup.ts)
- [apps/web/src/components/billing/PlanCards.tsx](../apps/web/src/components/billing/PlanCards.tsx), [PricingPage.tsx](../apps/web/src/components/billing/PricingPage.tsx)
- [apps/web/src/app/(public)/precios/page.tsx](../apps/web/src/app/(public)/precios/page.tsx), [apps/web/src/app/profile/suscripcion/page.tsx](../apps/web/src/app/profile/suscripcion/page.tsx)
- [apps/web/src/hooks/useBilling.ts](../apps/web/src/hooks/useBilling.ts)
- Tests: `apps/api/src/tests/billing.test.ts`, `apps/web/e2e/pricing-page.spec.ts`, `apps/web/e2e/profile-subscription.spec.ts`, `apps/web/e2e/waitlist-founder-pricing.spec.ts`
