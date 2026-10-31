/**
 * Smoke (Postgres de verdad) de PRO-1020, specs/newsletter.md → «Receta y
 * truco por persona»: el repo de la newsletter lee la persona (uso de
 * funciones, WhatsApp, casa) y las recetas que no puede recibir (alergias,
 * «Mejor no», ya enviadas), apunta lo enviado y se borra con la cuenta.
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdFeatureUsage, ingredients, newsletterTipLog, recipeIngredients, recipeNotes, recipes, users } from '../db/schema.js'
import { createDbNewsletterTipsRepo, pickTip } from '../services/newsletterTips.js'

async function register(username: string) {
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  expect(r.status).toBe(201)
  const id = ((await r.json()) as any).user.id as string
  const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, id))
  return { id, householdId: me.householdId!, email: `${username}@test.local` }
}

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`

describe.skipIf(!reachable)('receta y truco por persona (PRO-1020)', () => {
  it('lee a cada persona, bloquea lo que no puede comer o ya recibió, apunta lo enviado y se borra con la cuenta', async () => {
    const ana = await register(`nt_ana_${run}`)
    const bea = await register(`nt_bea_${run}`)
    await db.update(users).set({ restrictions: ['Sin gluten'] }).where(eq(users.id, ana.id))

    const [harina, calabaza, puerro] = await db
      .insert(ingredients)
      .values([
        { name: `harina smoke ${run}`, allergenTags: ['gluten'] },
        { name: `calabaza smoke ${run}` },
        { name: `puerro smoke ${run}` },
      ])
      .returning({ id: ingredients.id })
    const [conHarina, crema, sopa] = await db
      .insert(recipes)
      .values([
        { name: `Rebozado smoke ${run}`, servings: 2, authorId: ana.id },
        { name: `Crema smoke ${run}`, servings: 2, authorId: ana.id },
        { name: `Sopa smoke ${run}`, servings: 2, authorId: ana.id },
      ])
      .returning({ id: recipes.id })
    await db.insert(recipeIngredients).values([
      { recipeId: conHarina.id, ingredientId: harina.id, quantity: 100 },
      { recipeId: crema.id, ingredientId: calabaza.id, quantity: 300 },
      { recipeId: sopa.id, ingredientId: puerro.id, quantity: 300 },
    ])
    // Bea's household said «Mejor no» to the soup.
    await db.insert(recipeNotes).values({ householdId: bea.householdId, recipeId: sopa.id, rating: 1 })
    // Ana's household uses the shopping list (PRO-1023).
    const day = new Date('2026-10-20T10:00:00Z')
    await db.insert(householdFeatureUsage).values({
      householdId: ana.householdId,
      feature: 'lista_compra',
      firstUsedAt: day,
      lastUsedAt: day,
      uses30d: 3,
      usesTotal: 3,
      countedUntil: day,
    })

    const repo = createDbNewsletterTipsRepo(db)
    const people = await repo.personas([ana.id, bea.id])
    const pa = people.get(ana.id)!
    expect(pa).toMatchObject({ householdId: ana.householdId, accounts: 1, isOwner: true, push: false, shown: [], log: [] })
    expect(pa.whatsapp).toEqual({ linked: false, notify: false, declined: false })
    expect(pa.usage.lista_compra?.firstUsedAt).toEqual(day)
    expect(people.get(bea.id)!.usage).toEqual({})

    const ids = [conHarina.id, crema.id, sopa.id]
    const facts = await repo.recipeFacts([ana.id, bea.id], ids)
    expect([...facts.get(ana.id)!.blocked]).toEqual([conHarina.id])
    expect([...facts.get(bea.id)!.blocked]).toEqual([sopa.id])

    const issueId = `smoke-n4-${run}`
    const now = new Date()
    const tip = pickTip(pa, now)!.tip.id
    await repo.record(issueId, [
      { userId: ana.id, householdId: ana.householdId, tip, recipeId: crema.id },
      { userId: bea.id, householdId: bea.householdId, tip: null, recipeId: null },
    ])
    // The same issue twice keeps one row per person.
    await repo.record(issueId, [{ userId: ana.id, householdId: ana.householdId, tip: 'otro', recipeId: null }])
    const again = await repo.personas([ana.id])
    expect(again.get(ana.id)!.shown.map((s) => s.tip)).toEqual([tip])
    expect((await repo.recipeFacts([ana.id], ids)).get(ana.id)!.sentBefore).toEqual(new Set([crema.id]))
    // Resting now: not the same tip next week.
    expect(pickTip(again.get(ana.id)!, new Date(now.getTime() + 7 * 86_400_000))?.tip.id).not.toBe(tip)

    const logId = again.get(ana.id)!.log[0].id
    await repo.markAdopted([{ id: logId, adoptedAt: day }])
    const [row] = await db.select().from(newsletterTipLog).where(eq(newsletterTipLog.id, logId))
    expect(row.adoptedAt).toEqual(day)
    expect(await repo.userIdByEmail(ana.email.toUpperCase())).toBe(ana.id)

    // Deleting the account deletes its rows (the recipes first: without an author they'd become catalogue ones).
    await db.delete(recipes).where(inArray(recipes.id, ids))
    await db.delete(users).where(eq(users.id, ana.id))
    const left = await db.select({ userId: newsletterTipLog.userId }).from(newsletterTipLog).where(inArray(newsletterTipLog.userId, [ana.id, bea.id]))
    expect(left).toEqual([{ userId: bea.id }])
    await db.delete(users).where(eq(users.id, bea.id))
    await db.delete(ingredients).where(inArray(ingredients.id, [harina.id, calabaza.id, puerro.id]))
  })
})
