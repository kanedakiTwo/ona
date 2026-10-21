/**
 * PRO-316 (D-064, D-110) — the ficha is the one source: every memory write
 * also writes the ficha, through one writer with its history row.
 */
import { describe, expect, it } from 'vitest'
import { profileChanges, profileFacts } from '../db/schema.js'
import {
  channelOf,
  memorySubject,
  mirrorMemoryWrite,
  retireProfileFacts,
  sameFactValue,
  signalEvidence,
  upsertProfileFact,
  type FactWrite,
} from '../services/profile/writer.js'

/** A drizzle-like transaction: selects return `rows` in order; updates and inserts are recorded. */
function fakeTx(...rows: any[][]) {
  const queue = [...rows]
  const updates: any[] = []
  const inserts: Array<{ table: unknown; values: any }> = []
  const next = () => Promise.resolve(queue.shift() ?? [])
  const query: any = {
    from: () => query,
    where: () => query,
    orderBy: () => query,
    limit: () => next(),
    then: (res: any, rej: any) => next().then(res, rej),
  }
  const tx = {
    select: () => query,
    update: () => ({ set: (v: any) => ({ where: async () => { updates.push(v) } }) }),
    insert: (table: unknown) => ({
      values: (values: any) => {
        inserts.push({ table, values })
        const p: any = Promise.resolve()
        p.returning = async () => [{ id: 'new-fact' }]
        return p
      },
    }),
  }
  return { tx, updates, inserts }
}

const NOW = new Date('2026-10-21T10:00:00Z')
const write = (over: Partial<FactWrite> = {}): FactWrite => ({
  householdId: 'h1', subjectUserId: 'u1', subjectPersonId: null, type: 'dislikes', value: ['cilantro'],
  origin: 'user', confidence: 1, evidence: signalEvidence('profile', 'dislikes', ['cilantro'], NOW),
  reason: 'Lo escribiste en Perfil', actorUserId: 'u1', now: NOW, ...over,
})
const fact = (over: Record<string, unknown> = {}) => ({
  id: 'f1', value: ['cilantro'], origin: 'user', confidence: 1, evidence: [], validUntil: null, sourceMemoryId: null, ...over,
})

describe('upsertProfileFact', () => {
  it('adds a fact with its «fact_added» history row', async () => {
    const { tx, inserts } = fakeTx([])
    const out = await upsertProfileFact(tx, write())
    expect(out).toEqual({ factId: 'new-fact', action: 'added' })
    expect(inserts.map((i) => i.table)).toEqual([profileFacts, profileChanges])
    expect(inserts[1].values).toMatchObject({ action: 'fact_added', factType: 'dislikes', origin: 'user', actorUserId: 'u1' })
  })

  it('a single-valued type updates the fact there is, with before and after', async () => {
    const { tx, updates, inserts } = fakeTx([fact({ value: ['cilantro'], origin: 'ai_realtime', confidence: 0.8 })])
    const out = await upsertProfileFact(tx, write({ value: ['cilantro', 'hígado'] }))
    expect(out.action).toBe('updated')
    expect(updates[0]).toMatchObject({ value: ['cilantro', 'hígado'], origin: 'user', confidence: 1 })
    expect(inserts[0].values).toMatchObject({ action: 'fact_updated', before: { value: ['cilantro'], origin: 'ai_realtime' }, after: { value: ['cilantro', 'hígado'] } })
  })

  it('the same value again only appends its evidence (no history row)', async () => {
    const { tx, updates, inserts } = fakeTx([fact({ value: ['hígado', 'cilantro'] })])
    const out = await upsertProfileFact(tx, write({ value: ['cilantro', 'hígado'] }))
    expect(out.action).toBe('unchanged')
    expect(updates[0].evidence).toHaveLength(1)
    expect(inserts).toEqual([])
  })

  it('a multi-valued type adds a second fact (two fixed dishes)', async () => {
    const { tx, inserts } = fakeTx([fact({ value: { dish: 'pizza', days: ['viernes'] } })])
    const out = await upsertProfileFact(tx, write({ type: 'fixed_dish', value: { dish: 'paella', days: ['domingo'] } }))
    expect(out.action).toBe('added')
    expect(inserts.map((i) => i.table)).toEqual([profileFacts, profileChanges])
  })

  it('points the fact at the memory row it mirrors (so the boot copy never duplicates it)', async () => {
    const { tx, updates } = fakeTx([fact({ sourceMemoryId: 'old-memory' })])
    await upsertProfileFact(tx, write({ value: ['ajo'], sourceMemoryId: 'mem-2' }))
    expect(updates[0].sourceMemoryId).toBe('mem-2')
  })
})

describe('retireProfileFacts', () => {
  it('retires every active fact of the type, each with its «fact_retired» row', async () => {
    const { tx, updates, inserts } = fakeTx([fact({ id: 'f1' }), fact({ id: 'f2', value: ['ajo'] })])
    const n = await retireProfileFacts(tx, { householdId: 'h1', subjectUserId: 'u1', subjectPersonId: null, type: 'dislikes', reason: 'lo olvidó', origin: 'user', actorUserId: 'u1', now: NOW })
    expect(n).toBe(2)
    expect(updates.every((u) => u.status === 'retired')).toBe(true)
    expect(inserts.map((i) => i.values.action)).toEqual(['fact_retired', 'fact_retired'])
  })
})

describe('mirrorMemoryWrite — a memory write lands in the ficha', () => {
  const memoryWrite = { userId: 'u1', memoryId: 'mem-1', key: 'dislikes', value: ['cilantro'], source: 'inferred' as const, confidence: 0.8, signal: 'whatsapp' as const, hasHealthConsent: false, now: NOW }

  it('about the person, origin from the memory source, evidence saying where it was said', async () => {
    const { tx, inserts } = fakeTx([{ householdId: 'h1' }], [])
    const out = await mirrorMemoryWrite(tx, memoryWrite)
    expect(out?.action).toBe('added')
    expect(inserts[0].values).toMatchObject({ householdId: 'h1', subjectUserId: 'u1', type: 'dislikes', origin: 'ai_realtime', confidence: 0.8, sourceMemoryId: 'mem-1' })
    expect(inserts[0].values.evidence[0]).toMatchObject({ signal: 'whatsapp', date: '2026-10-21', summary: 'Se lo dijiste a Mimo por WhatsApp: No le gusta: cilantro' })
  })

  it('household-level keys are about the household', async () => {
    const { tx, inserts } = fakeTx([{ householdId: 'h1' }], [])
    await mirrorMemoryWrite(tx, { ...memoryWrite, key: 'household.adults', value: 2, source: 'manual', signal: 'profile' })
    expect(inserts[0].values).toMatchObject({ subjectUserId: null, origin: 'user' })
  })

  it('never mirrors health from WhatsApp, and skips a user without a household', async () => {
    const health = fakeTx([{ householdId: 'h1' }], [])
    expect(await mirrorMemoryWrite(health.tx, { ...memoryWrite, key: 'restrictions', value: ['sin gluten'], hasHealthConsent: true })).toBeNull()
    expect(health.inserts).toEqual([])
    const homeless = fakeTx([], [])
    expect(await mirrorMemoryWrite(homeless.tx, memoryWrite)).toBeNull()
  })
})

describe('helpers', () => {
  it('sameFactValue ignores list order and key order', () => {
    expect(sameFactValue(['a', 'b'], ['b', 'a'])).toBe(true)
    expect(sameFactValue({ dish: 'pizza', meal: 'dinner' }, { meal: 'dinner', dish: 'pizza' })).toBe(true)
    expect(sameFactValue(['a'], ['a', 'b'])).toBe(false)
  })
  it('channels and subjects', () => {
    expect(channelOf('whatsapp')).toBe('whatsapp')
    expect(channelOf('profile')).toBe('web')
    expect(memorySubject('equipment', 'u1').subjectUserId).toBeNull()
    expect(memorySubject('dislikes', 'u1').subjectUserId).toBe('u1')
  })
})
