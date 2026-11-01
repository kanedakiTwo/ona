/**
 * Smoke (Postgres de verdad) de PRO-1023, specs/feature-usage.md: la pasada
 * nocturna con el SQL real sobre un hogar propio. Una acción suma un uso, un
 * ajuste una vez por semana, `uses_total` sobrevive a borrar los eventos y
 * borrar la cuenta (y con ella su hogar) borra las filas.
 *
 * Usa funciones con un id propio de esta ejecución, para que la pasada del
 * planificador de la API (si corre a la vez) no toque sus filas.
 */
import { describe, expect, it } from 'vitest'
import { and, eq, inArray } from 'drizzle-orm'
import type { FeatureCatalogEntry } from '@ona/shared'
import { reachable, API_URL } from './smokeEnv.js'
import { db } from '../db/connection.js'
import { householdFeatureUsage, usageEvents, users } from '../db/schema.js'
import { createDbFeatureUsageRepo, runFeatureUsagePass } from '../services/featureUsage.js'

async function call(method: string, path: string, payload?: unknown, token?: string) {
  const r = await fetch(`${API_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await r.text()
  return { status: r.status, body: text ? JSON.parse(text) : null }
}

const run = `${Date.now()}${Math.random().toString(36).slice(2, 6)}`
const accion: FeatureCatalogEntry = { id: `smoke_accion_${run}`, nombre: 'Smoke', kind: 'accion', per: 'hogar', events: [{ name: 'menu_generated' }] }
const ajuste: FeatureCatalogEntry = { id: `smoke_ajuste_${run}`, nombre: 'Smoke', kind: 'ajuste', per: 'persona', events: [{ name: 'push_opened' }] }
const nightOf = (isoDate: string) => new Date(`${isoDate}T02:00:00Z`)

describe.skipIf(!reachable)('uso de cada función por hogar (PRO-1023)', () => {
  it('cuenta acciones y ajustes, sobrevive a la purga y se borra con la cuenta', async () => {
    const u = `fu_${run}`
    const reg = await call('POST', '/register', { username: u, email: `${u}@test.local`, password: 'smokepass123', ageConfirmed: true })
    expect(reg.status).toBe(201)
    const userId = reg.body.user.id as string
    const [me] = await db.select({ householdId: users.primaryHouseholdId }).from(users).where(eq(users.id, userId))
    const householdId = me.householdId!
    expect(householdId).toBeTruthy()

    const repo = createDbFeatureUsageRepo(db, [householdId])
    const pass = (isoDate: string) => runFeatureUsagePass(nightOf(isoDate), repo, [accion, ajuste])
    const addEvent = (name: string, at: string) => db.insert(usageEvents).values({ householdId, userId, name, channel: 'web', createdAt: new Date(at) })
    const row = async (f: FeatureCatalogEntry) => {
      const rows = await db
        .select()
        .from(householdFeatureUsage)
        .where(and(eq(householdFeatureUsage.feature, f.id), eq(householdFeatureUsage.householdId, householdId)))
      expect(rows.length).toBeLessThanOrEqual(1)
      return rows[0]
    }

    // Una acción suma un uso; un ajuste, su semana.
    await addEvent('menu_generated', '2026-05-20T10:00:00Z')
    await addEvent('push_opened', '2026-05-18T08:00:00Z')
    await addEvent('push_opened', '2026-05-20T08:00:00Z')
    expect(await pass('2026-05-21')).not.toBeNull()
    expect(await row(accion)).toMatchObject({ userId: null, usesTotal: 1, uses30d: 1, firstUsedAt: new Date('2026-05-20T10:00:00Z') })
    expect(await row(ajuste)).toMatchObject({ userId, usesTotal: 1, uses30d: 1 })

    // La misma semana, otra noche: el ajuste no suma; la acción sí.
    await addEvent('push_opened', '2026-05-22T08:00:00Z')
    await addEvent('menu_generated', '2026-05-22T10:00:00Z')
    await pass('2026-05-23')
    expect(await row(ajuste)).toMatchObject({ usesTotal: 1 })
    expect(await row(accion)).toMatchObject({ usesTotal: 2, uses30d: 2 })

    // La purga borra los eventos: los totales se quedan, los 30 días bajan.
    await db.delete(usageEvents).where(and(eq(usageEvents.userId, userId), inArray(usageEvents.name, ['menu_generated', 'push_opened'])))
    await pass('2026-11-20')
    expect(await row(accion)).toMatchObject({ usesTotal: 2, uses30d: 0, firstUsedAt: new Date('2026-05-20T10:00:00Z') })
    expect(await row(ajuste)).toMatchObject({ usesTotal: 1, uses30d: 0 })

    // Una semana nueva suma.
    await addEvent('push_opened', '2026-11-23T08:00:00Z')
    await pass('2026-11-24')
    expect(await row(ajuste)).toMatchObject({ usesTotal: 2, uses30d: 1 })

    // Borrar la cuenta (y su hogar, del que era la única) borra las filas.
    const del = await call('DELETE', `/user/${userId}`, { password: 'smokepass123', ageConfirmed: true }, reg.body.token)
    expect(del.status).toBe(200)
    const left = await db.select().from(householdFeatureUsage).where(eq(householdFeatureUsage.householdId, householdId))
    expect(left).toEqual([])
  })
})
