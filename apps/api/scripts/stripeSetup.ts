/**
 * Creates (or brings up to date) everything Mimoia needs in a Stripe account
 * (specs/billing.md). Idempotent: run it again after changing a price in
 * `@ona/shared` PLANS and it moves the lookup key to a new price.
 *
 *   STRIPE_SECRET_KEY=sk_test_… pnpm --filter @ona/api exec tsx scripts/stripeSetup.ts \
 *     --webhook-url=https://ona-api-staging.up.railway.app/billing/webhook \
 *     --web-url=https://ona-web-staging.up.railway.app \
 *     --secret-out=$HOME/.config/mimoia/stripe-webhook-secret-staging
 *
 * - Products «Mimoia Esencial» / «Mimoia Plus» (SaaS tax code, required by
 *   Managed Payments) and 4 prices in EUR, VAT included, with lookup keys
 *   `esencial_mensual`, `esencial_anual`, `plus_mensual`, `plus_anual`.
 * - A webhook endpoint for the subscription events. Its signing secret is
 *   only shown when the endpoint is created: it goes to `--secret-out`
 *   (never to stdout) so it can be set as STRIPE_WEBHOOK_SECRET.
 * - The customer portal: change card, see receipts, switch plan or period,
 *   cancel at the end of the period.
 */
import { writeFileSync } from 'node:fs'
import Stripe from 'stripe'
import { BILLING_PERIODS, PLANS, stripeLookupKey } from '@ona/shared'

const arg = (name: string) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=')
const key = process.env.STRIPE_SECRET_KEY
if (!key) throw new Error('Set STRIPE_SECRET_KEY')
const live = key.startsWith('sk_live_')
const stripe = new Stripe(key)

/** SaaS, personal use (Managed Payments eligible). */
const TAX_CODE = 'txcd_10103000'
const WEBHOOK_EVENTS: Stripe.WebhookEndpointCreateParams.EnabledEvent[] = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'customer.subscription.paused',
  'customer.subscription.resumed',
]

async function product(plan: (typeof PLANS)[number]): Promise<Stripe.Product> {
  const found = await stripe.products.search({ query: `metadata['mimoia_plan']:'${plan.key}'` })
  const fields = {
    name: `Mimoia ${plan.name}`,
    description: plan.tagline,
    tax_code: TAX_CODE,
    metadata: { mimoia_plan: plan.key },
  }
  if (found.data[0]) return stripe.products.update(found.data[0].id, fields)
  return stripe.products.create(fields)
}

async function price(productId: string, lookupKey: string, cents: number, interval: 'month' | 'year'): Promise<Stripe.Price> {
  const { data } = await stripe.prices.list({ lookup_keys: [lookupKey], active: true, limit: 1 })
  const current = data[0]
  if (
    current &&
    current.unit_amount === cents &&
    current.currency === 'eur' &&
    current.recurring?.interval === interval &&
    current.tax_behavior === 'inclusive' &&
    current.product === productId
  ) {
    return current
  }
  const created = await stripe.prices.create({
    product: productId,
    currency: 'eur',
    unit_amount: cents,
    recurring: { interval },
    tax_behavior: 'inclusive',
    lookup_key: lookupKey,
    transfer_lookup_key: true,
  })
  if (current) await stripe.prices.update(current.id, { active: false })
  return created
}

async function webhook(url: string, secretOut: string | undefined): Promise<void> {
  const { data } = await stripe.webhookEndpoints.list({ limit: 100 })
  const existing = data.find((w) => w.url === url)
  if (existing) {
    await stripe.webhookEndpoints.update(existing.id, { enabled_events: WEBHOOK_EVENTS, disabled: false })
    console.log(`webhook: ${url} already existed (updated events). Its secret is in the Dashboard if you need it again.`)
    return
  }
  const created = await stripe.webhookEndpoints.create({ url, enabled_events: WEBHOOK_EVENTS, description: 'Mimoia subscriptions' })
  if (!secretOut) throw new Error('Webhook created but no --secret-out: get its secret from the Dashboard')
  writeFileSync(secretOut, `${created.secret}\n`, { mode: 0o600 })
  console.log(`webhook: created for ${url}; signing secret written to ${secretOut}`)
}

async function portal(webUrl: string, products: { product: string; prices: string[] }[]): Promise<void> {
  const config: Stripe.BillingPortal.ConfigurationCreateParams = {
    business_profile: {
      headline: 'Mimoia · tu suscripción',
      privacy_policy_url: `${webUrl}/privacidad`,
      terms_of_service_url: `${webUrl}/terminos`,
    },
    default_return_url: `${webUrl}/profile/suscripcion`,
    features: {
      payment_method_update: { enabled: true },
      invoice_history: { enabled: true },
      subscription_cancel: { enabled: true, mode: 'at_period_end', cancellation_reason: { enabled: true, options: ['too_expensive', 'unused', 'missing_features', 'other'] } },
      subscription_update: { enabled: true, default_allowed_updates: ['price'], products, proration_behavior: 'create_prorations' },
    },
  }
  const { data } = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 })
  if (data[0]) await stripe.billingPortal.configurations.update(data[0].id, config)
  else await stripe.billingPortal.configurations.create(config)
  console.log('portal: configured (card, receipts, switch plan, cancel at period end)')
}

async function main() {
  console.log(`Stripe account mode: ${live ? 'LIVE' : 'test'}`)
  const portalProducts: { product: string; prices: string[] }[] = []
  for (const plan of PLANS) {
    const p = await product(plan)
    const ids: string[] = []
    for (const period of BILLING_PERIODS) {
      const lk = stripeLookupKey(plan.key, period)
      const pr = await price(p.id, lk, plan.prices[period].cents, period === 'anual' ? 'year' : 'month')
      ids.push(pr.id)
      console.log(`price ${lk}: ${pr.id} · ${(pr.unit_amount ?? 0) / 100} € / ${pr.recurring?.interval}`)
    }
    portalProducts.push({ product: p.id, prices: ids })
  }
  const webUrl = (arg('web-url') ?? 'https://mimoia.com').replace(/\/+$/, '')
  const webhookUrl = arg('webhook-url')
  if (webhookUrl) await webhook(webhookUrl, arg('secret-out'))
  await portal(webUrl, portalProducts)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
