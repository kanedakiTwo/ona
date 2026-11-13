/**
 * PRO-385 (D-158, specs/billing.md): what each plan may do. A trial that ends
 * without a plan lands on Gratis «lo haces tú»: it generates its week and its
 * list, but has no Mimo (chat, voice, advisor), no autopilot, no alerts and no
 * shop orders. The pure rule, the plans `/precios` shows, and which API routes
 * carry the 402 `PLAN_GRATIS` guard (and which never do).
 *
 * Run: pnpm --filter @ona/api test src/tests/planGratis.test.ts
 */
import { describe, expect, it, vi } from 'vitest'
import {
  FREE_PLAN_KEY,
  GRATIS_EXCLUDED,
  PAID_PLANS,
  PLANS,
  PLAN_FEATURE_GROUPS,
  accountAccess,
  planAllows,
  type AccessState,
  type PlanFeatureKey,
} from '@ona/shared'

vi.mock('../db/connection.js', () => ({ db: {} }))

const NEW_HOUSEHOLD = new Date('2027-01-10T14:00:00Z')
const day = (n: number) => new Date(NEW_HOUSEHOLD.getTime() + n * 86_400_000)

describe('permissions by plan (pure rule)', () => {
  it('a trial that ends without a plan is Gratis: the week and the list yes; Mimo, autopilot and alerts no', () => {
    const access = accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: false, now: day(15) })
    expect(access.state).toBe('gratis')
    expect(planAllows(access.state, 'menu')).toBe(true)
    expect(planAllows(access.state, 'shopping')).toBe(true)
    expect(planAllows(access.state, 'newsletter')).toBe(true)
    expect(planAllows(access.state, 'mimo')).toBe(false)
    expect(planAllows(access.state, 'autopilot')).toBe(false)
    expect(planAllows(access.state, 'alerts')).toBe(false)
    expect(planAllows(access.state, 'shop_orders')).toBe(false)
    expect(planAllows(access.state, 'recipe_imports')).toBe(false)
  })

  it('a cancelled plan that has run out is Gratis too; a live one is not', () => {
    expect(accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: false, now: day(90) }).state).toBe('gratis')
    expect(accountAccess({ householdCreatedAt: NEW_HOUSEHOLD, paid: true, now: day(90) }).state).toBe('subscribed')
  })

  it('beta, trial and a paid plan can do everything', () => {
    const all: PlanFeatureKey[] = [...GRATIS_EXCLUDED, 'menu', 'shopping', 'newsletter']
    for (const state of ['beta', 'trial', 'subscribed'] as AccessState[]) for (const what of all) expect(planAllows(state, what)).toBe(true)
  })
})

describe('the three plans on /precios', () => {
  it('Gratis, Esencial (recommended) and Plus; Gratis has no price and is not a Stripe plan', () => {
    expect(PLANS.map((p) => p.key)).toEqual(['gratis', 'esencial', 'plus'])
    expect(PLANS.filter((p) => p.featured).map((p) => p.key)).toEqual(['esencial'])
    const gratis = PLANS[0]
    expect(gratis).toMatchObject({ key: FREE_PLAN_KEY, name: 'Gratis', prices: null })
    expect(gratis.tagline).toBe('Lo haces tú: tu menú de la semana y la lista, en la web.')
    expect(PAID_PLANS.map((p) => p.key)).toEqual(['esencial', 'plus'])
  })

  it('the comparison agrees with the rule: Gratis has the week and the list, not Mimo or the orders', () => {
    const row = (label: string) => PLAN_FEATURE_GROUPS.flatMap((g) => g.features).find((f) => f.label === label)!
    expect(row('Menú semanal a tu medida').gratis).toBeTruthy()
    expect(row('Cambiar, fijar y mover platos').gratis).toBe(true)
    expect(row('Lista de la compra automática').gratis).toBe(true)
    expect(row('Mandar la lista').gratis).toBe(true)
    for (const label of ['Chat con Mimo en la app', 'Chat con Mimo por WhatsApp', 'Hablar con Mimo por voz', 'Mimo te escribe por WhatsApp', 'Pedidos a tus tiendas de barrio', 'Recordatorios en el móvil']) {
      expect(row(label).gratis, label).toBe(false)
    }
  })
})

type Layer = { route?: { path: string; stack: { name: string }[] } }
/** Names of the handlers on a route of a real router: `paidPlanGuard` is the 402 `PLAN_GRATIS`. */
async function handlers(mod: string, path: string): Promise<string[]> {
  const router = (await import(mod)).default as { stack: Layer[] }
  const layers = router.stack.filter((l) => l.route?.path === path)
  expect(layers.length, path).toBeGreaterThan(0)
  return layers.flatMap((l) => l.route!.stack.map((s) => s.name))
}

describe('the API routes (402 PLAN_GRATIS)', () => {
  it('generating the week is open to Gratis', async () => {
    expect(await handlers('../routes/menus.js', '/menu/generate')).not.toContain('paidPlanGuard')
  })

  it('Mimo (chat, advisor, voice) and shop orders are not', async () => {
    expect(await handlers('../routes/assistant.js', '/assistant/:userId/chat')).toContain('paidPlanGuard')
    expect(await handlers('../routes/advisor.js', '/advisor/:userId/ask')).toContain('paidPlanGuard')
    expect(await handlers('../routes/stt.js', '/stt')).toContain('paidPlanGuard')
    expect(await handlers('../routes/shopOrders.js', '/shop-orders/prepare')).toContain('paidPlanGuard')
    expect(await handlers('../routes/shopOrders.js', '/shop-orders/:id/quote')).toContain('paidPlanGuard')
    expect(await handlers('../routes/recipes.js', '/recipes/extract-from-image')).toContain('paidPlanGuard')
    expect(await handlers('../routes/recipes.js', '/recipes/extract-from-url')).toContain('paidPlanGuard')
  })
})
