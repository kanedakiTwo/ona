/**
 * Smoke (Postgres de verdad) de PRO-395, specs/newsletter.md → «El vino de
 * cada persona»: el repo carga la base y la lee, lee de cada cuenta lo que
 * mira `wineAllowed` (su edad, las restricciones de toda la casa, la ficha y
 * la memoria de cada miembro), apunta los vinos enviados y se borra con la
 * cuenta. Los vinos son inventados.
 */
import { describe, expect, it } from 'vitest'
import { eq, inArray } from 'drizzle-orm'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, ingredients, newsletterWineLog, profileFacts, recipeIngredients, recipes, users } from '../db/schema.js'
import { createDbNewsletterWineRepo, parseWineBase, wineAllowed } from '../services/newsletterWine.js'

async function register(username: string) {
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, email: `${username}@test.local`, password: 'smokepass123', ageConfirmed: true }),
  })
  expect(r.status).toBe(201)
  const id = ((await r.json()) as any).user.id as string
  const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, id))
  return { id, householdId: me.householdId! }
}

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`

const BASE = `## Firma

- nombre: Laura Smoke
- acepta: sí

## Sus reglas para todos los vinos

- picante-fuera → nunca tinto

## Vino del vídeo de esta semana

- vinoId: v002

## Vinos

### v001 · Tinto Smoke · Bodega Uno
- estado: ok
- tipo: tinto
- precio: 9
- enlace: https://tienda.example/tinto
- categorias: legumbres-guisos
- noVa: [vinagre]
- frase: «Para la cuchara.»

### v002 · Blanco Smoke · Bodega Dos
- estado: ok
- tipo: blanco
- categorias: pescado-blanco
- frase: «Para el pescado.»
`

describe.skipIf(!reachable)('el vino de cada persona (PRO-395)', () => {
  it('carga la base, lee a quién nunca de toda la casa, apunta lo enviado y se borra con la cuenta', async () => {
    const repo = createDbNewsletterWineRepo(db)
    const before = await repo.base()

    // La base: cargada y leída tal cual.
    await repo.replace(parseWineBase(BASE), { legalApproved: true, legalRef: 'LEG-505', moderationLine: 'Con moderación.' })
    const base = await repo.base()
    expect(base?.settings).toMatchObject({ signatureName: 'Laura Smoke', signatureAccepted: true, videoWineId: 'v002', legalApproved: true, moderationLine: 'Con moderación.' })
    expect(base?.settings.rules).toEqual([{ category: 'picante-fuera', never: 'tinto' }])
    expect(base?.wines.map((w) => [w.id, w.type, w.categories, w.noGo])).toEqual([
      ['v001', 'tinto', ['legumbres-guisos'], ['vinagre']],
      ['v002', 'blanco', ['pescado-blanco'], []],
    ])
    expect(await repo.link('v001')).toBe('https://tienda.example/tinto')
    expect(await repo.link('v002')).toBeNull()
    // Otra carga reemplaza la base entera.
    await repo.replace(parseWineBase(BASE.split('### v002')[0]), { legalApproved: false, legalRef: null, moderationLine: null })
    expect((await repo.base())?.wines.map((w) => w.id)).toEqual(['v001'])
    expect((await repo.base())?.settings).toMatchObject({ legalApproved: false, videoWineId: null })

    // Las recetas: título e ingredientes.
    const [lenteja] = await db.insert(ingredients).values({ name: `lentejas smoke ${run}` }).returning({ id: ingredients.id })
    const ana = await register(`nw_ana_${run}`)
    const [r] = await db.insert(recipes).values({ name: `Lentejas smoke ${run}`, servings: 2, authorId: ana.id }).returning({ id: recipes.id })
    await db.insert(recipeIngredients).values({ recipeId: r.id, ingredientId: lenteja.id, quantity: 200 })
    expect((await repo.recipes([r.id])).get(r.id)).toEqual({ title: `Lentejas smoke ${run}`, ingredients: [`lentejas smoke ${run}`] })

    // A quién nunca: Ana, adulta, sí. Sin edad, no. «Sin alcohol» u halal de otro miembro, no. Embarazo en la ficha de otro miembro, no.
    const sinEdad = await register(`nw_sinedad_${run}`)
    const bea = await register(`nw_bea_${run}`)
    const pareja = await register(`nw_pareja_${run}`)
    const dani = await register(`nw_dani_${run}`)
    const eva = await register(`nw_eva_${run}`)
    const gus = await register(`nw_gus_${run}`)
    await db.update(users).set({ age: 40 }).where(inArray(users.id, [ana.id, bea.id, dani.id, gus.id]))
    await db.update(users).set({ age: null }).where(eq(users.id, sinEdad.id))
    await db.update(users).set({ restrictions: ['Sin alcohol'] }).where(eq(users.id, pareja.id))
    await db.update(users).set({ restrictions: ['Halal'] }).where(eq(users.id, gus.id))
    await db.insert(householdMembers).values([
      { householdId: bea.householdId, userId: pareja.id, role: 'member' },
      { householdId: dani.householdId, userId: eva.id, role: 'member' },
    ])
    await db.insert(profileFacts).values({
      householdId: dani.householdId,
      subjectUserId: eva.id,
      type: 'temporary_situation',
      value: { description: 'Eva está embarazada' },
      origin: 'user',
    })
    const ids = [ana.id, sinEdad.id, bea.id, dani.id, gus.id]
    const audiences = await repo.audiences(ids)
    expect(ids.map((id) => wineAllowed(audiences.get(id)))).toEqual([true, false, false, false, false])
    // Una cuenta que no existe: no está (sin vino).
    expect((await repo.audiences(['00000000-0000-4000-8000-000000000000'])).size).toBe(0)

    // Lo enviado: una fila por número y persona.
    await repo.record('n5', [{ userId: ana.id, householdId: ana.householdId, wineId: 'v001' }])
    await repo.record('n5', [{ userId: ana.id, householdId: ana.householdId, wineId: 'v002' }])
    await repo.record('n6', [{ userId: ana.id, householdId: ana.householdId, wineId: 'v002' }])
    expect(((await repo.shown([ana.id])).get(ana.id) ?? []).map((s) => [s.issueId, s.wineId]).sort()).toEqual([
      ['n5', 'v001'],
      ['n6', 'v002'],
    ])

    // Se borra con la cuenta.
    await db.delete(recipes).where(eq(recipes.id, r.id))
    await db.delete(users).where(inArray(users.id, [ana.id, sinEdad.id, bea.id, pareja.id, dani.id, eva.id, gus.id]))
    await db.delete(ingredients).where(eq(ingredients.id, lenteja.id))
    expect(await db.select().from(newsletterWineLog).where(eq(newsletterWineLog.userId, ana.id))).toEqual([])

    // La base, como estaba.
    if (before) await repo.replace({ settings: before.settings, wines: before.wines, skipped: [], unparsedRules: [] }, before.settings)
    else await repo.replace(parseWineBase(''), { legalApproved: false, legalRef: null, moderationLine: null })
  })
})
