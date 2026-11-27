/**
 * Smoke (real API + Postgres) for PRO-1305 (Seguridad de la dieta, D-1025):
 * an allergy said to Mimo in the chat is never lost.
 *
 *   - WhatsApp, no permission, the household never taps anything: the code
 *     reads «soy alérgica al marisco», asks once with two buttons, and the
 *     menus of the two weeks after (one asked to Mimo, one of the autopilot)
 *     have no shellfish; nothing goes to the ficha; on day 31 it stops.
 *   - «Sí, doy mi permiso» tapped → saved, with the permission's record and
 *     one row per item (the notice's id, the person's message id).
 *   - A typed «sí» → the buttons again, nothing saved.
 *   - With the web's box: said by WhatsApp → saved without a question, with
 *     the notice (and, the first time, the «Lo guardo porque…» line); a
 *     second allergy → no question either.
 *   - «Borra lo del gluten» → deleted (C.7); «retira el permiso» → the
 *     confirmation buttons → everything deleted, as the web.
 *   - No permission and «No, gracias» → nothing saved, never asked again;
 *     the next allergy is kept out of the menus for 30 days, with the hint once.
 *   - A child of the house → under the same permission; another adult → C.3.
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/chatAllergies.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { and, eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { menus, userMemories, users } from '../db/schema.js'
import { skills } from '../services/assistant/skills.js'
import { appSkills } from '../services/assistant/appSkills.js'
import { compileRestrictions, violatesRestrictions } from '../services/dietaryRestrictions.js'
import { loadMatchableRecipes } from '../services/matchableRecipes.js'
import {
  answerConsentButton,
  finishChatTurn,
  parseConsentButton,
  repeatAskButtons,
  withChatAllergyOutbox,
  type FlushMessage,
} from '../services/chatAllergies.js'
import { answerDeps, noteSaidByCode, ownRestrictions } from '../services/chatAllergySave.js'
import { withHouseholdRestrictions } from '../services/householdAllergies.js'
import { addPerson } from '../services/profile/fichaStore.js'
import { defaultAutoplanDeps } from '../services/weeklyAutoplan.js'
import { madridWeekStart } from '../services/madridTime.js'

const tag = `chatal${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const generateWeeklyMenu = skills.find((s) => s.name === 'generate_weekly_menu')!
const updateProfile = appSkills.find((s) => s.name === 'update_profile')!
const noteFichaFact = skills.find((s) => s.name === 'note_ficha_fact')!
const forgetAllergy = skills.find((s) => s.name === 'forget_allergy')!
const withdrawPermission = skills.find((s) => s.name === 'withdraw_health_permission')!

async function register(i: number) {
  const u = `${tag}${i}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(201)
  return body.user.id as string
}

/** One chat turn: `body` runs inside the turn's outbox; what the code sends comes back. */
async function turn(userId: string, channel: 'whatsapp' | 'web', body: () => Promise<unknown>, messageId = `wamid.${Math.random().toString(36).slice(2)}`) {
  const { outbox, run } = withChatAllergyOutbox({ userId, channel, messageId }, async () => body())
  await run
  const sent: (FlushMessage & { id: string })[] = []
  await finishChatTurn(outbox, {
    lang: 'es',
    send: async (m) => {
      const id = `wamid.out.${sent.length}.${Math.random().toString(36).slice(2)}`
      sent.push({ ...m, id })
      return id
    },
  })
  return sent
}

async function tap(userId: string, buttonId: string, title: string) {
  const sent: FlushMessage[] = []
  const button = parseConsentButton(buttonId)
  expect(button).not.toBeNull()
  await answerConsentButton(userId, button!, { channel: 'whatsapp', wamid: `wamid.tap.${Math.random().toString(36).slice(2)}`, title, lang: 'es' }, answerDeps(userId, 'whatsapp', async (m) => {
    sent.push(m)
    return `wamid.notice.${sent.length}`
  }))
  return sent
}

const memoryRestrictions = async (userId: string) =>
  ((await db.select({ value: userMemories.value }).from(userMemories).where(and(eq(userMemories.userId, userId), eq(userMemories.key, 'restrictions'))))[0]?.value as string[] | undefined) ?? []

const events = async (userId: string) => (await db.execute(sql`SELECT * FROM health_chat_consents WHERE user_id = ${userId} ORDER BY created_at`)).rows as any[]
const saves = async (userId: string) => (await db.execute(sql`SELECT * FROM health_chat_saves WHERE user_id = ${userId} ORDER BY created_at`)).rows as any[]

/** As if what is pending had been said `days` ago. */
const ageing = (userId: string, days: number) =>
  db.execute(sql`UPDATE said_allergies_pending SET said_at = said_at - make_interval(days => ${days}), expires_at = expires_at - make_interval(days => ${days}) WHERE user_id = ${userId}`)

/** The recipes of a menu that break `restriction`, by the generator's own rule. */
async function breaking(userId: string, menuIds: string[], restriction: string): Promise<{ count: number; bad: string[] }> {
  const rows = await db.select({ id: menus.id, days: menus.days }).from(menus).where(eq(menus.userId, userId))
  const ids = new Set<string>()
  for (const r of rows.filter((x) => menuIds.includes(x.id))) {
    for (const day of (r.days as any[]) ?? []) {
      for (const slot of Object.values(day ?? {}) as any[]) for (const dish of slot?.dishes ?? []) if (dish?.recipeId) ids.add(dish.recipeId)
    }
  }
  const rules = compileRestrictions([restriction])
  const inMenu = (await loadMatchableRecipes(userId, db)).filter((r: any) => ids.has(r.id))
  return { count: ids.size, bad: inMenu.filter((r: any) => violatesRestrictions(r, rules)).map((r: any) => r.name) }
}

describe.skipIf(!reachable)('allergies said in the chat (PRO-1305)', () => {
  it('no permission, no tap: asked once, and the next two weeks of menus (one asked, one autopilot) have no shellfish; day 31 it stops', async () => {
    const userId = await register(1)
    const sent = await turn(userId, 'whatsapp', () => noteSaidByCode(userId, 'Soy alérgica al marisco, que no se te olvide'))
    // The one-time question, with the two buttons the code reads.
    expect(sent).toHaveLength(1)
    expect(sent[0].kind).toBe('health_ask')
    expect(sent[0].text).toMatch(/^Me has dicho marisco\. Para que no se me olvide nunca, ¿me das permiso/)
    expect(sent[0].buttons?.map((b) => b.title)).toEqual(['Sí, doy mi permiso', 'No, gracias'])
    // Nothing in the ficha.
    expect(await ownRestrictions(userId)).toEqual([])

    // A week later Mimo makes this week's menu (no restrictions_said: a new turn) …
    await ageing(userId, 8)
    const asked = await generateWeeklyMenu.handler({}, { userId, db, channel: 'whatsapp' })
    expect(asked.summary).toContain('Menu generado')
    // … and the autopilot the next one.
    const next = madridWeekStart(new Date(), 1)
    const auto = await defaultAutoplanDeps.generate(userId, next)
    const ids = (await db.select({ id: menus.id }).from(menus).where(eq(menus.userId, userId))).map((m) => m.id)
    expect(ids).toContain(auto.menuId)
    const { count, bad } = await breaking(userId, ids, 'marisco')
    expect(count).toBeGreaterThan(0)
    expect(bad).toEqual([])
    expect(await withHouseholdRestrictions([], userId)).toContain('marisco')

    // Never asked again in a later turn (a reminder at most, once).
    await ageing(userId, 6)
    const later = await turn(userId, 'whatsapp', () => noteSaidByCode(userId, 'ya te dije que soy alérgica al marisco'))
    expect(later.filter((m) => m.text.startsWith('Me has dicho'))).toEqual([])
    // Day 31 since it was last said: no longer applied.
    await ageing(userId, 31)
    expect(await withHouseholdRestrictions([], userId)).not.toContain('marisco')
  }, 90_000)

  it('«Sí, doy mi permiso» tapped → saved, with the record; a typed «sí» gets the buttons again', async () => {
    const userId = await register(2)
    const said = 'wamid.said.2'
    const sent = await turn(userId, 'whatsapp', () => updateProfile.handler({ addRestrictions: ['sin gluten'] }, { userId, db, channel: 'whatsapp' }), said)
    const ask = sent.find((m) => m.kind === 'health_ask')!
    expect(ask.text).toMatch(/Me has dicho sin gluten\./)

    // Typed «sí»: the buttons again, nothing saved.
    const again = await repeatAskButtons(userId, 'es')
    expect(again?.text).toBe('Para guardarlo necesito que pulses uno de los dos botones: así queda constancia de tu permiso.')
    expect(again?.buttons?.map((b) => b.id)).toEqual(ask.buttons!.map((b) => b.id))
    expect(await ownRestrictions(userId)).toEqual([])

    const reply = await tap(userId, ask.buttons![0].id, 'Sí, doy mi permiso')
    expect(reply.map((m) => m.text)).toEqual(['Apuntado en la ficha de tu casa: sin gluten. No saldrá en tus menús. Si quieres que lo borre, dímelo.'])
    expect(await memoryRestrictions(userId)).toEqual(['sin gluten'])
    expect(await withHouseholdRestrictions([], userId)).toContain('sin gluten')

    const ev = await events(userId)
    const asked = ev.find((e) => e.event === 'asked')
    const granted = ev.find((e) => e.event === 'granted')
    expect(asked).toMatchObject({ version: 'salud-chat-v1-2026-11', channel: 'whatsapp', lang: 'es', wamid: ask.id })
    expect(asked.text_shown).toBe(ask.text)
    expect(granted).toMatchObject({ question_id: asked.id, button_title: 'Sí, doy mi permiso', channel: 'whatsapp' })
    expect(granted.button_id).toBe(ask.buttons![0].id)
    expect(granted.wamid).toMatch(/^wamid\.tap\./)
    const rows = await saves(userId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ action: 'saved', channel: 'whatsapp', consent_ref: granted.id, notice_id: 'wamid.notice.1', person_id: null })
    expect(rows[0].restrictions).toEqual(['sin gluten'])
    // The same button twice changes nothing.
    expect((await tap(userId, ask.buttons![0].id, 'Sí, doy mi permiso'))[0].text).toMatch(/ya está contestada/)
    // Later allergies: no question, saved with the notice.
    const second = await turn(userId, 'whatsapp', () => updateProfile.handler({ addRestrictions: ['marisco'] }, { userId, db, channel: 'whatsapp' }))
    expect(second.map((m) => m.text)).toEqual(['Apuntado en la ficha de tu casa: marisco. No saldrá en tus menús. Si quieres que lo borre, dímelo.'])
  }, 60_000)

  it('with the web box: said by WhatsApp → saved without asking, with the notice; «borra…» and withdrawing work from the chat', async () => {
    const userId = await register(3)
    await db.update(users).set({ healthConsentAt: new Date(), healthConsentVersion: 'salud-v2-2026-10', age: 40 }).where(eq(users.id, userId))
    const msg = 'wamid.said.3'
    const first = await turn(userId, 'whatsapp', () => updateProfile.handler({ addRestrictions: ['marisco'] }, { userId, db, channel: 'whatsapp' }), msg)
    expect(first.map((m) => m.text)).toEqual([
      'Apuntado en la ficha de tu casa: marisco. No saldrá en tus menús. Si quieres que lo borre, dímelo. Lo guardo porque diste tu permiso para tus datos de salud en tu perfil; puedes retirarlo cuando quieras.',
    ])
    expect(await memoryRestrictions(userId)).toEqual(['marisco'])
    const [row] = await saves(userId)
    expect(row).toMatchObject({ consent_ref: 'salud-v2-2026-10', message_id: msg, notice_id: first[0].id })
    expect(await events(userId)).toEqual([])

    const second = await turn(userId, 'whatsapp', () => updateProfile.handler({ addRestrictions: ['sin gluten'] }, { userId, db, channel: 'whatsapp' }))
    expect(second.map((m) => m.text)).toEqual(['Apuntado en la ficha de tu casa: sin gluten. No saldrá en tus menús. Si quieres que lo borre, dímelo.'])
    expect(await memoryRestrictions(userId)).toEqual(['marisco', 'sin gluten'])

    const deleted = await turn(userId, 'whatsapp', () => forgetAllergy.handler({ items: ['gluten'] }, { userId, db, channel: 'whatsapp' }))
    expect(deleted.map((m) => m.text)).toEqual(['Borrado: sin gluten ya no está en tu ficha. Ojo: desde ahora puede volver a salir en tus menús.'])
    expect(await memoryRestrictions(userId)).toEqual(['marisco'])
    expect((await saves(userId)).at(-1)).toMatchObject({ action: 'deleted' })

    const confirm = await turn(userId, 'whatsapp', () => withdrawPermission.handler({}, { userId, db, channel: 'whatsapp' }))
    expect(confirm[0].text).toMatch(/^Si retiro el permiso, borraré de tu ficha todas tus alergias/)
    expect(confirm[0].buttons?.map((b) => b.title)).toEqual(['Sí, retíralo', 'No'])
    // Nothing changes until the tap.
    expect(await memoryRestrictions(userId)).toEqual(['marisco'])
    const done = await tap(userId, confirm[0].buttons![0].id, 'Sí, retíralo')
    expect(done[0].text).toMatch(/^Hecho: he retirado tu permiso/)
    const [u] = await db.select({ age: users.age, withdrawnAt: users.healthConsentWithdrawnAt }).from(users).where(eq(users.id, userId))
    expect(u.age).toBeNull()
    expect(u.withdrawnAt).not.toBeNull()
    expect(await ownRestrictions(userId)).toEqual([])
    expect((await events(userId)).map((e) => e.event)).toEqual(['withdraw_asked', 'withdrawn'])
    // Withdrawn: never asked; what is said is kept out of the menus, not saved.
    const after = await turn(userId, 'whatsapp', () => updateProfile.handler({ addRestrictions: ['huevo'] }, { userId, db, channel: 'whatsapp' }))
    expect(after.map((m) => m.kind)).toEqual(['health_hint'])
    expect(await ownRestrictions(userId)).toEqual([])
    expect(await withHouseholdRestrictions([], userId)).toContain('huevo')
  }, 60_000)

  it('no permission and «No, gracias» → nothing saved, never asked again, the next one kept 30 days with the hint once', async () => {
    const userId = await register(4)
    const sent = await turn(userId, 'web', () => updateProfile.handler({ addRestrictions: ['frutos secos'] }, { userId, db, channel: 'text' }))
    const ask = sent.find((m) => m.kind === 'health_ask')!
    const no = await tap(userId, ask.buttons![1].id, 'No, gracias')
    expect(no[0].text).toMatch(/^Vale, no lo guardo\./)
    expect(await ownRestrictions(userId)).toEqual([])
    expect(await withHouseholdRestrictions([], userId)).not.toContain('frutos secos')

    const next = await turn(userId, 'web', () => updateProfile.handler({ addRestrictions: ['soja'] }, { userId, db, channel: 'text' }))
    expect(next.map((m) => m.kind)).toEqual(['health_hint'])
    expect(await withHouseholdRestrictions([], userId)).toContain('soja')
    const third = await turn(userId, 'web', () => updateProfile.handler({ addRestrictions: ['huevo'] }, { userId, db, channel: 'text' }))
    expect(third).toEqual([])
    expect(await ownRestrictions(userId)).toEqual([])
    expect((await events(userId)).filter((e) => e.event === 'asked')).toHaveLength(1)
  }, 60_000)

  it('a child of the house goes under the same permission; another adult gets C.3 once', async () => {
    const userId = await register(5)
    await db.update(users).set({ healthConsentAt: new Date(), healthConsentVersion: 'salud-v3-2026-11' }).where(eq(users.id, userId))
    await addPerson(userId, { alias: 'la peque', ageBand: '6-12' })
    await addPerson(userId, { alias: 'la abuela', ageBand: 'adulto' })
    const kid = await turn(userId, 'whatsapp', () => noteFichaFact.handler({ type: 'restrictions', value: ['huevo'], about: 'person', person: 'la peque' }, { userId, db, channel: 'whatsapp' }))
    expect(kid.map((m) => m.text)).toEqual(['Apuntado para la peque: huevo. No saldrá en vuestros menús. Si quieres que lo borre, dímelo.'])
    expect(await withHouseholdRestrictions([], userId)).toContain('huevo')

    const grandma = await turn(userId, 'whatsapp', () => noteFichaFact.handler({ type: 'restrictions', value: ['sin lactosa'], about: 'person', person: 'la abuela' }, { userId, db, channel: 'whatsapp' }))
    expect(grandma[0].text).toMatch(/^Para no olvidarlo: me has dicho que la abuela: sin lactosa\. Es un dato de salud de la abuela, así que solo lo guardo si está de acuerdo/)
    expect(grandma[0].buttons?.map((b) => b.title)).toEqual(['Sí, está de acuerdo', 'No lo guardes'])
    const yes = await tap(userId, grandma[0].buttons![0].id, 'Sí, está de acuerdo')
    expect(yes.map((m) => m.text)).toEqual(['Apuntado para la abuela: sin lactosa. No saldrá en vuestros menús. Si quieres que lo borre, dímelo.'])
    const more = await turn(userId, 'whatsapp', () => noteFichaFact.handler({ type: 'restrictions', value: ['marisco'], about: 'person', person: 'la abuela' }, { userId, db, channel: 'whatsapp' }))
    expect(more.map((m) => m.text)).toEqual(['Apuntado para la abuela: marisco. No saldrá en vuestros menús. Si quieres que lo borre, dímelo.'])
  }, 60_000)
})
