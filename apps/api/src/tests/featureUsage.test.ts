/**
 * PRO-1023: la pasada nocturna del uso de cada función por hogar
 * (specs/feature-usage.md), sobre un repo en memoria que imita el SQL. El
 * SQL de verdad y el borrado con el hogar, en featureUsage.smoke.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))

import { FEATURE_CATALOG, type FeatureCatalogEntry } from '@ona/shared'
import {
  featureUsageWindow,
  mergeFeatureUsage,
  resetFeatureUsageMemo,
  runFeatureUsagePass,
  runFeatureUsagePassIfDue,
  type FeatureActivity,
  type FeatureUsageRepo,
  type FeatureUsageRow,
} from '../services/featureUsage.js'
import { madridWeekStart } from '../services/madridTime.js'
import { USAGE_CHANNELS, USAGE_EVENTS } from '../services/usageEvents.js'

interface FakeEvent {
  householdId: string | null
  userId: string | null
  name: string
  channel?: string | null
  props?: Record<string, string | number | boolean> | null
  at: Date
}

const H1 = 'h1'
const H2 = 'h2'
const U1 = 'u1'
const U2 = 'u2'

const accion: FeatureCatalogEntry = { id: 'menu_semanal', nombre: 'Menú', kind: 'accion', per: 'hogar', events: [{ name: 'menu_generated' }] }
const ajuste: FeatureCatalogEntry = { id: 'avisos', nombre: 'Avisos', kind: 'ajuste', per: 'persona', events: [{ name: 'push_opened' }] }
const foto: FeatureCatalogEntry = {
  id: 'receta_foto',
  nombre: 'Foto',
  kind: 'accion',
  per: 'hogar',
  events: [{ name: 'recipe_imported', props: { source: ['photo', 'whatsapp_photo'] } }],
}
const whatsapp: FeatureCatalogEntry = { id: 'mimo_whatsapp', nombre: 'WA', kind: 'accion', per: 'persona', events: [{ name: 'mimo_message', channel: 'whatsapp' }] }

function matches(f: FeatureCatalogEntry, e: FakeEvent): boolean {
  return f.events.some(
    (r) =>
      r.name === e.name &&
      (!r.channel || r.channel === e.channel) &&
      Object.entries(r.props ?? {}).every(([k, v]) => (Array.isArray(v) ? v : [v]).map(String).includes(String(e.props?.[k]))),
  )
}

/** Repo en memoria: misma regla que el SQL (por hogar o persona, [since, until), semanas de Madrid). */
function fakeRepo() {
  const events: FakeEvent[] = []
  const rows = new Map<string, { rows: FeatureUsageRow[]; countedUntil: Date }>()
  const repo: FeatureUsageRepo = {
    async load(f) {
      const saved = rows.get(f.id)
      return { rows: saved ? saved.rows.map((r) => ({ ...r })) : [], countedUntil: saved?.countedUntil ?? null }
    },
    async activity(f, since, until) {
      const by = new Map<string, FeatureActivity>()
      for (const e of events) {
        if (!matches(f, e) || !e.householdId || e.at >= until || (since && e.at < since)) continue
        if (f.per === 'persona' && !e.userId) continue
        const userId = f.per === 'persona' ? e.userId : null
        const key = `${e.householdId}|${userId ?? ''}`
        const a = by.get(key) ?? { householdId: e.householdId, userId, firstAt: e.at, lastAt: e.at, count: 0, weeks: [] }
        if (e.at < a.firstAt) a.firstAt = e.at
        if (e.at > a.lastAt) a.lastAt = e.at
        a.count++
        const w = madridWeekStart(e.at)
        if (!a.weeks.includes(w)) a.weeks.push(w)
        by.set(key, a)
      }
      return [...by.values()]
    },
    async save(f, out, countedUntil) {
      rows.set(f.id, { rows: out.map((r) => ({ ...r })), countedUntil })
    },
    async exclusive(fn) {
      return fn(repo)
    },
  }
  const row = (f: FeatureCatalogEntry, householdId: string, userId: string | null = null) =>
    rows.get(f.id)?.rows.find((r) => r.householdId === householdId && r.userId === userId)
  return { repo, events, rows, row }
}

/** Una pasada «la noche del» día dado (03:00 Madrid, invierno = 02:00 UTC). */
const nightOf = (isoDate: string) => new Date(`${isoDate}T02:00:00Z`)

describe('featureUsage: la pasada nocturna', () => {
  let f: ReturnType<typeof fakeRepo>
  beforeEach(() => {
    f = fakeRepo()
  })

  it('una acción suma un uso por evento, sin repetir al volver a pasar', async () => {
    const at = new Date('2026-11-09T19:00:00Z')
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at })

    await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [accion])
    expect(f.row(accion, H1)).toEqual({ householdId: H1, userId: null, firstUsedAt: at, lastUsedAt: at, uses30d: 1, usesTotal: 1 })

    // La misma noche otra vez (otro proceso, un reinicio): nada cambia.
    await runFeatureUsagePass(new Date('2026-11-10T05:00:00Z'), f.repo, [accion])
    expect(f.row(accion, H1)?.usesTotal).toBe(1)

    // Un evento de hoy no cuenta hasta la noche siguiente.
    const later = new Date('2026-11-10T09:00:00Z')
    f.events.push({ householdId: H1, userId: U2, name: 'menu_generated', at: later })
    await runFeatureUsagePass(new Date('2026-11-10T22:00:00Z'), f.repo, [accion])
    expect(f.row(accion, H1)?.usesTotal).toBe(1)

    await runFeatureUsagePass(nightOf('2026-11-11'), f.repo, [accion])
    expect(f.row(accion, H1)).toMatchObject({ firstUsedAt: at, lastUsedAt: later, uses30d: 2, usesTotal: 2 })
  })

  it('un ajuste cuenta una vez por semana en que actuó', async () => {
    // Lunes y miércoles de la misma semana, en dos noches distintas.
    f.events.push({ householdId: H1, userId: U1, name: 'push_opened', at: new Date('2026-11-09T08:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [ajuste])
    expect(f.row(ajuste, H1, U1)?.usesTotal).toBe(1)

    f.events.push({ householdId: H1, userId: U1, name: 'push_opened', at: new Date('2026-11-11T08:00:00Z') })
    f.events.push({ householdId: H1, userId: U1, name: 'push_opened', at: new Date('2026-11-11T09:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-12'), f.repo, [ajuste])
    expect(f.row(ajuste, H1, U1)).toMatchObject({ usesTotal: 1, uses30d: 1 })

    // Domingo a las 23:30 de Madrid sigue siendo esa semana; el lunes, otra.
    f.events.push({ householdId: H1, userId: U1, name: 'push_opened', at: new Date('2026-11-15T22:30:00Z') })
    f.events.push({ householdId: H1, userId: U1, name: 'push_opened', at: new Date('2026-11-16T07:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-17'), f.repo, [ajuste])
    expect(f.row(ajuste, H1, U1)).toMatchObject({ usesTotal: 2, uses30d: 2 })
  })

  it('uses_total sobrevive a la purga de eventos; los 30 días bajan', async () => {
    const at = new Date('2026-05-20T10:00:00Z')
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at })
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at: new Date('2026-05-21T10:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-05-22'), f.repo, [accion])
    expect(f.row(accion, H1)).toMatchObject({ usesTotal: 2, uses30d: 2 })

    // 180 días después, la purga borra los eventos.
    f.events.length = 0
    await runFeatureUsagePass(nightOf('2026-11-20'), f.repo, [accion])
    expect(f.row(accion, H1)).toMatchObject({ firstUsedAt: at, usesTotal: 2, uses30d: 0 })

    // Y sigue sumando con lo nuevo.
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at: new Date('2026-11-20T10:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-21'), f.repo, [accion])
    expect(f.row(accion, H1)).toMatchObject({ firstUsedAt: at, usesTotal: 3, uses30d: 1 })
  })

  it('los 30 días cuentan solo la ventana', async () => {
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at: new Date('2026-10-01T10:00:00Z') })
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at: new Date('2026-11-05T10:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [accion])
    expect(f.row(accion, H1)).toMatchObject({ usesTotal: 2, uses30d: 1 })
  })

  it('cada hogar y cada persona tienen su fila; sin hogar o sin persona no cuenta', async () => {
    f.events.push({ householdId: H1, userId: U1, name: 'mimo_message', channel: 'whatsapp', at: new Date('2026-11-09T10:00:00Z') })
    f.events.push({ householdId: H1, userId: U2, name: 'mimo_message', channel: 'whatsapp', at: new Date('2026-11-09T11:00:00Z') })
    f.events.push({ householdId: H1, userId: U2, name: 'mimo_message', channel: 'web', at: new Date('2026-11-09T11:00:00Z') })
    f.events.push({ householdId: H1, userId: null, name: 'mimo_message', channel: 'whatsapp', at: new Date('2026-11-09T12:00:00Z') })
    f.events.push({ householdId: null, userId: U1, name: 'mimo_message', channel: 'whatsapp', at: new Date('2026-11-09T12:00:00Z') })
    f.events.push({ householdId: H2, userId: null, name: 'menu_generated', at: new Date('2026-11-09T12:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [whatsapp, accion])
    expect(f.rows.get('mimo_whatsapp')?.rows.map((r) => [r.householdId, r.userId, r.usesTotal])).toEqual([
      [H1, U1, 1],
      [H1, U2, 1],
    ])
    // Por hogar, un evento sin persona (una cuenta ya borrada) sí es del hogar.
    expect(f.row(accion, H2)?.usesTotal).toBe(1)
  })

  it('las props de la regla filtran', async () => {
    f.events.push({ householdId: H1, userId: U1, name: 'recipe_imported', props: { source: 'whatsapp_photo' }, at: new Date('2026-11-09T10:00:00Z') })
    f.events.push({ householdId: H1, userId: U1, name: 'recipe_imported', props: { source: 'url', kind: 'article' }, at: new Date('2026-11-09T10:00:00Z') })
    await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [foto])
    expect(f.row(foto, H1)?.usesTotal).toBe(1)
  })

  it('el resumen cuenta funciones, filas y usos nuevos; null si otra pasada corre', async () => {
    f.events.push({ householdId: H1, userId: U1, name: 'menu_generated', at: new Date('2026-11-09T10:00:00Z') })
    f.events.push({ householdId: H2, userId: U2, name: 'menu_generated', at: new Date('2026-11-09T10:00:00Z') })
    expect(await runFeatureUsagePass(nightOf('2026-11-10'), f.repo, [accion, ajuste])).toEqual({
      cutoff: new Date('2026-11-09T23:00:00Z'),
      features: 2,
      rows: 2,
      newUses: 2,
    })
    const busy: FeatureUsageRepo = { ...f.repo, exclusive: async () => null }
    expect(await runFeatureUsagePass(nightOf('2026-11-11'), busy, [accion])).toBeNull()
  })
})

describe('featureUsage: piezas puras', () => {
  it('la pasada cuenta hasta las 00:00 de Madrid (con el cambio de hora)', () => {
    expect(featureUsageWindow(new Date('2026-07-10T03:00:00Z'))).toEqual({
      cutoff: new Date('2026-07-09T22:00:00Z'),
      windowStart: new Date('2026-06-09T22:00:00Z'),
    })
    expect(featureUsageWindow(new Date('2026-11-10T02:00:00Z')).cutoff).toEqual(new Date('2026-11-09T23:00:00Z'))
  })

  it('sin uso guardado ni nuevo no hay fila', () => {
    expect(mergeFeatureUsage('accion', undefined, undefined, undefined)).toBeNull()
  })

  it('una vez al día, desde la 01:00 de Madrid', async () => {
    resetFeatureUsageMemo()
    const calls: string[] = []
    const repo = { exclusive: async () => (calls.push('run'), null) } as unknown as FeatureUsageRepo
    expect(await runFeatureUsagePassIfDue(new Date('2026-11-09T23:30:00Z'), repo)).toBeNull() // 00:30 Madrid
    expect(calls).toHaveLength(0)
    await runFeatureUsagePassIfDue(new Date('2026-11-10T00:10:00Z'), repo) // 01:10
    await runFeatureUsagePassIfDue(new Date('2026-11-10T03:00:00Z'), repo)
    expect(calls).toHaveLength(1)
    await runFeatureUsagePassIfDue(new Date('2026-11-11T00:10:00Z'), repo)
    expect(calls).toHaveLength(2)
    resetFeatureUsageMemo()
  })
})

describe('FEATURE_CATALOG', () => {
  it('ids únicos y solo eventos y canales que existen', () => {
    const ids = FEATURE_CATALOG.map((f) => f.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const f of FEATURE_CATALOG as readonly FeatureCatalogEntry[]) {
      expect(f.id).toMatch(/^[a-z][a-z0-9_]{1,40}$/)
      expect(f.events.length).toBeGreaterThan(0)
      for (const r of f.events) {
        expect(USAGE_EVENTS as readonly string[]).toContain(r.name)
        if (r.channel) expect(USAGE_CHANNELS as readonly string[]).toContain(r.channel)
      }
    }
  })
})
