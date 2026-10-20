/**
 * Smoke (real API + Postgres) for PRO-248, the avisos answer:
 *   - «dijo que no» vs «no contestó» (`optInDeclinedSql`, read by /admin/usage);
 *   - the one extra offer is claimed only when due, only once (both channels).
 *
 *   API_URL=… DATABASE_URL=… pnpm --filter @ona/api exec vitest run src/tests/optInOffer.smoke.ts
 */
import { describe, expect, it } from 'vitest'
import { eq, sql } from 'drizzle-orm'
import { API_URL, reachable } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdMembers, usageEvents, whatsappLinks, whatsappMessages } from '../db/schema.js'
import { claimOptInReoffer, markOptInDeclined, optInDeclinedSql } from '../services/whatsapp/optInOffer.js'

const tag = `optin${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const DAY = 24 * 60 * 60 * 1000
const NOW = new Date()

async function register(i: number): Promise<{ id: string; phone: string; householdId: string | null }> {
  const u = `${tag}${i}`
  const r = await fetch(`${API_URL}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: u, email: `${u}@test.local`, password: 'e2epass123', ageConfirmed: true }),
  })
  const body = await r.json()
  expect(r.status, JSON.stringify(body)).toBe(201)
  const id = body.user.id as string
  const phone = `34${String(Date.now()).slice(-7)}${i}${Math.floor(Math.random() * 10)}`
  await db.insert(whatsappLinks).values({ userId: id, phone, notify: false })
  const [m] = await db.select({ householdId: householdMembers.householdId }).from(householdMembers).where(eq(householdMembers.userId, id)).limit(1)
  return { id, phone, householdId: m?.householdId ?? null }
}

async function out(phone: string, userId: string, kind: string) {
  await db.insert(whatsappMessages).values({ phone, userId, direction: 'out', kind, body: kind, status: 'sent' })
}
async function event(userId: string, householdId: string | null, name: string, daysAgo: number) {
  await db.insert(usageEvents).values({ userId, householdId, name, createdAt: new Date(NOW.getTime() - daysAgo * DAY) })
}
/** Asked, a menu 8 days old and the list opened: everything the extra offer needs. */
async function due(i: number) {
  const u = await register(i)
  await out(u.phone, u.id, 'optin_prompt')
  await event(u.id, u.householdId, 'menu_generated', 8)
  await event(u.id, u.householdId, 'shopping_list_viewed', 6)
  return u
}
async function declined(userId: string): Promise<boolean> {
  const res = await db.execute(sql`SELECT ${optInDeclinedSql()} AS d FROM whatsapp_links wl WHERE wl.user_id = ${userId}`)
  return (res.rows as any[])[0]?.d === true
}

describe.skipIf(!reachable)('avisos: said no vs no answer, and the one extra offer (PRO-248)', () => {
  it('«No, gracias», BAJA or the recorded answer count as «dijo que no»; silence does not', async () => {
    const silent = await register(1)
    await out(silent.phone, silent.id, 'optin_prompt')
    expect(await declined(silent.id)).toBe(false)

    const saidNo = await register(2)
    await db.insert(whatsappMessages).values({ phone: saidNo.phone, userId: saidNo.id, direction: 'in', kind: 'text', body: 'No, gracias', status: 'ignored' })
    expect(await declined(saidNo.id)).toBe(true)

    const baja = await register(3)
    await out(baja.phone, baja.id, 'optout')
    expect(await declined(baja.id)).toBe(true)

    const marked = await register(4)
    await markOptInDeclined(marked.id, NOW)
    expect(await declined(marked.id)).toBe(true)
  })

  it('claimed once when due, then never again (web or WhatsApp)', async () => {
    const u = await due(5)
    expect(await claimOptInReoffer(u.id, NOW)).toBe(true)
    expect(await claimOptInReoffer(u.id, NOW)).toBe(false)
    const [row] = await db.select({ at: whatsappLinks.optInReofferedAt }).from(whatsappLinks).where(eq(whatsappLinks.userId, u.id))
    expect(row.at).not.toBeNull()
  })

  it('never to whoever said no, nor with avisos on, nor before the first week, nor without the list', async () => {
    const no = await due(6)
    await markOptInDeclined(no.id, NOW)
    expect(await claimOptInReoffer(no.id, NOW)).toBe(false)

    const on = await due(7)
    await db.update(whatsappLinks).set({ notify: true }).where(eq(whatsappLinks.userId, on.id))
    expect(await claimOptInReoffer(on.id, NOW)).toBe(false)

    const soon = await register(8)
    await out(soon.phone, soon.id, 'optin_prompt')
    await event(soon.id, soon.householdId, 'menu_generated', 3)
    await event(soon.id, soon.householdId, 'shopping_list_viewed', 2)
    expect(await claimOptInReoffer(soon.id, NOW)).toBe(false)

    const noList = await register(9)
    await out(noList.phone, noList.id, 'optin_prompt')
    await event(noList.id, noList.householdId, 'menu_generated', 9)
    expect(await claimOptInReoffer(noList.id, NOW)).toBe(false)

    const neverAsked = await register(10)
    await event(neverAsked.id, neverAsked.householdId, 'menu_generated', 9)
    await event(neverAsked.id, neverAsked.householdId, 'shopping_list_viewed', 9)
    expect(await claimOptInReoffer(neverAsked.id, NOW)).toBe(false)
  })
})
