/**
 * Smoke (Postgres de verdad) de PRO-1123, specs/newsletter.md → «Carta
 * personal» y «Editor en Admin»: lo que la carta sabe de una casa (el nombre
 * de la lista de espera, cuántos sois, lo cocinado sin lo que delata salud) y
 * el ciclo de un número en `newsletter_drafts` (recomendación, plantilla,
 * prueba, programación, un solo envío).
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { cookLogs, newsletterDrafts, recipes, users, waitlistEntries } from '../db/schema.js'
import { createDbNewsletterLetterRepo } from '../services/newsletterLetter.js'
import { createDbNewsletterDraftsRepo } from '../services/newsletterDrafts.js'

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

const TEMPLATE = {
  subject: '{nombre}, tu receta',
  content: {
    preface: 'Hola, {nombre}:',
    star: {
      title: 'Lentejas',
      body: 'De cuchara.',
      imageUrl: 'https://mimoia.com/l.jpg',
      imageAlt: 'Lentejas',
      url: 'https://mimoia.com/recipes/l',
    },
    cta: { label: 'Abrir', url: 'https://mimoia.com/menu' },
  },
}

describe.skipIf(!reachable)('la carta personal y el editor (PRO-1123)', () => {
  it('lee la casa de cada cuenta sin su salud', async () => {
    const ana = await register(`nl_ana_${run}`)
    const bea = await register(`nl_bea_${run}`)
    await db.update(users).set({ adults: 2, kidsCount: 1, restrictions: ['Sin gluten'] }).where(eq(users.id, ana.id))
    await db.insert(waitlistEntries).values({
      email: ana.email,
      firstName: 'ana',
      householdSize: '3-4',
      plannerRole: 'yo',
      currentMethod: 'lista',
      platform: 'ios',
      referralCode: `nl${run}`.slice(0, 16),
      consentVersion: 'smoke',
      consentAt: new Date(),
      unsubscribeToken: `nl-smoke-${run}-token-0000`,
    })
    const [pollo, lasana] = await db
      .insert(recipes)
      .values([
        { name: `Pollo smoke ${run}`, servings: 2, authorId: ana.id, seasons: ['autumn'] },
        { name: `Lasaña sin gluten ${run}`, servings: 2, authorId: ana.id },
      ])
      .returning({ id: recipes.id })
    const now = new Date()
    await db.insert(cookLogs).values([
      { userId: ana.id, householdId: ana.householdId, recipeId: pollo.id, cookedAt: new Date(now.getTime() - 3 * 86_400_000) },
      { userId: ana.id, householdId: ana.householdId, recipeId: lasana.id, cookedAt: new Date(now.getTime() - 86_400_000) },
    ])
    try {
      const repo = createDbNewsletterLetterRepo()
      const facts = await repo.accountFacts([ana.id, bea.id], now)
      expect(facts.get(ana.id)).toMatchObject({ firstName: 'Ana', people: 3, kids: 1, lastCooked: `Pollo smoke ${run}` })
      // Bea: no name (her username isn't one), nothing cooked.
      expect(facts.get(bea.id)).toMatchObject({ firstName: null, lastCooked: null })
      expect(JSON.stringify([...facts.values()])).not.toMatch(/gluten/i)
      expect((await repo.recipeSeasons([pollo.id])).get(pollo.id)).toEqual(['autumn'])
    } finally {
      await db.delete(waitlistEntries).where(eq(waitlistEntries.email, ana.email))
      await db.delete(users).where(inArray(users.id, [ana.id, bea.id]))
    }
  })

  it('un número: recomendación, plantilla, prueba, programación y un solo envío', async () => {
    const admin = await register(`nl_adm_${run}`)
    const issueId = `smoke-${run}`
    const repo = createDbNewsletterDraftsRepo()
    try {
      const t0 = new Date('2026-11-04T10:00:00.123Z')
      await repo.saveRecommendation(issueId, TEMPLATE, t0)
      const saved = (await repo.saveTemplate(issueId, { ...TEMPLATE, subject: 'Corregido' }, admin.id, t0))!
      expect(saved).toMatchObject({ savedBy: admin.id, proofSentAt: null, recommendation: { subject: '{nombre}, tu receta' }, template: { subject: 'Corregido' } })
      // The proof of an older save doesn't count.
      await repo.markProof(issueId, new Date(t0.getTime() - 1), new Date())
      expect((await repo.get(issueId))!.proofSentAt).toBeNull()
      await repo.markProof(issueId, saved.savedAt!, new Date('2026-11-04T10:05:00Z'))
      expect((await repo.get(issueId))!.proofSentAt).not.toBeNull()

      const at = new Date('2026-11-06T08:00:00Z')
      await repo.schedule(issueId, at, admin.id, 'https://api.mimoia.com')
      expect((await repo.due(new Date('2026-11-06T07:59:00Z'))).some((d) => d.issueId === issueId)).toBe(false)
      expect((await repo.due(new Date('2026-11-06T08:01:00Z'))).some((d) => d.issueId === issueId)).toBe(true)
      expect(await repo.claimSend(issueId, at)).toBe(true)
      expect(await repo.claimSend(issueId, at)).toBe(false)
      expect(await repo.saveTemplate(issueId, TEMPLATE, admin.id, new Date())).toBeNull()
      await repo.recordResult(issueId, { sent: 3 })
      expect((await repo.get(issueId))!.sendResult).toEqual({ sent: 3 })
      expect((await repo.list(50)).some((d) => d.issueId === issueId)).toBe(true)
      // The account goes, the issue stays (who saved it, set null).
      await db.delete(users).where(eq(users.id, admin.id))
      expect((await repo.get(issueId))!.savedBy).toBeNull()
    } finally {
      await db.delete(newsletterDrafts).where(eq(newsletterDrafts.issueId, issueId))
      await db.delete(users).where(eq(users.id, admin.id))
    }
  })
})
