/**
 * PRO-381 (D-158): piloto automático, paso 1 — every Thursday from 18:00
 * (Madrid) next week done for each household that had a menu, doesn't have
 * next week yet, has «La semana, hecha cada jueves» on and isn't on the free
 * plan. specs/menus.md «Piloto automático».
 */
import { describe, expect, it } from 'vitest'
import {
  AUTOPLAN_PER_TICK,
  autoplanCardLive,
  autoplanChangeCounts,
  autoplanDue,
  pickAutoplanHouseholds,
  runWeeklyAutoplanIfDue,
  type AutoplanDeps,
  type AutoplanPerson,
  type AutoplanScopeWeeks,
} from '../services/weeklyAutoplan.js'

// 2026-11-05 is a Thursday; Madrid is UTC+1 in November.
const THU_1800 = new Date('2026-11-05T17:00:00Z')
const THU_1759 = new Date('2026-11-05T16:59:00Z')
const NEXT = '2026-11-09'

const person = (o: Partial<AutoplanPerson> & { userId: string }): AutoplanPerson => ({
  scopeKey: `h-${o.userId}`,
  isOwner: true,
  since: new Date('2026-10-01T10:00:00Z'),
  prefs: [{}, null],
  freePlan: false,
  ...o,
})
const had: AutoplanScopeWeeks = { hadMenu: true, hasNextWeek: false }

describe('autoplanDue — Thursday from 18:00 Madrid, for the Monday after', () => {
  it('not before Thursday 18:00, yes from then until Sunday', () => {
    expect(autoplanDue(THU_1759)).toEqual({ due: false, weekStart: NEXT })
    expect(autoplanDue(THU_1800)).toEqual({ due: true, weekStart: NEXT })
    expect(autoplanDue(new Date('2026-11-07T09:00:00Z')).due).toBe(true) // Saturday
    expect(autoplanDue(new Date('2026-11-08T22:30:00Z'))).toEqual({ due: true, weekStart: NEXT }) // Sunday 23:30
    expect(autoplanDue(new Date('2026-11-09T08:00:00Z')).due).toBe(false) // Monday
    expect(autoplanDue(new Date('2026-11-04T20:00:00Z')).due).toBe(false) // Wednesday 21:00
  })
  it('follows the Madrid clock in summer time too (UTC+2)', () => {
    expect(autoplanDue(new Date('2026-06-04T15:59:00Z')).due).toBe(false)
    expect(autoplanDue(new Date('2026-06-04T16:00:00Z'))).toEqual({ due: true, weekStart: '2026-06-08' })
  })
})

describe('pickAutoplanHouseholds — who gets the week', () => {
  const pick = (people: AutoplanPerson[], weeks: Record<string, AutoplanScopeWeeks>, now = THU_1800) =>
    pickAutoplanHouseholds({ now, people, weeks: new Map(Object.entries(weeks)) })

  it('a household with a past menu, no next week, switch on and paid or in trial: yes, for its owner', () => {
    const r = pick([person({ userId: 'a' })], { 'h-a': had })
    expect(r.weekStart).toBe(NEXT)
    expect(r.picks).toEqual([{ scopeKey: 'h-a', userId: 'a' }])
  })
  it('never had a menu: no', () => {
    const r = pick([person({ userId: 'a' })], { 'h-a': { hadMenu: false, hasNextWeek: false } })
    expect(r.picks).toEqual([])
    expect(r.skipped.never_had_menu).toBe(1)
    expect(pick([person({ userId: 'b' })], {}).skipped.never_had_menu).toBe(1)
  })
  it('next week already made (by hand or otherwise): untouched', () => {
    const r = pick([person({ userId: 'a' })], { 'h-a': { hadMenu: true, hasNextWeek: true } })
    expect(r.picks).toEqual([])
    expect(r.skipped.week_done).toBe(1)
  })
  it('the switch: missing = on; off in Perfil or in WhatsApp = off; anyone in the house switches it off for the house', () => {
    expect(pick([person({ userId: 'a', prefs: [{ weekly_nudge: false }, null] })], { 'h-a': had }).picks).toHaveLength(1)
    expect(pick([person({ userId: 'a', prefs: [{ weekly_autoplan: false }, null] })], { 'h-a': had }).skipped.switched_off).toBe(1)
    expect(pick([person({ userId: 'a', prefs: [{}, { weekly_autoplan: false }] })], { 'h-a': had }).skipped.switched_off).toBe(1)
    const house = [
      person({ userId: 'owner', scopeKey: 'h1' }),
      person({ userId: 'partner', scopeKey: 'h1', isOwner: false, prefs: [{ weekly_autoplan: false }, null] }),
    ]
    expect(pick(house, { h1: had }).picks).toEqual([])
  })
  it('free plan (or paused account): no', () => {
    const r = pick([person({ userId: 'a', freePlan: true })], { 'h-a': had })
    expect(r.picks).toEqual([])
    expect(r.skipped.free_plan).toBe(1)
  })
  it('one per household: the owner, or whoever joined first when the owner is not there', () => {
    const house = [
      person({ userId: 'late', scopeKey: 'h1', isOwner: false, since: new Date('2026-10-20T00:00:00Z') }),
      person({ userId: 'owner', scopeKey: 'h1' }),
    ]
    expect(pick(house, { h1: had }).picks).toEqual([{ scopeKey: 'h1', userId: 'owner' }])
    const noOwner = [
      person({ userId: 'late', scopeKey: 'h2', isOwner: false, since: new Date('2026-10-20T00:00:00Z') }),
      person({ userId: 'early', scopeKey: 'h2', isOwner: false, since: new Date('2026-10-02T00:00:00Z') }),
    ]
    expect(pick(noOwner, { h2: had }).picks).toEqual([{ scopeKey: 'h2', userId: 'early' }])
  })
  it('day and hour: nothing before Thursday 18:00', () => {
    const r = pick([person({ userId: 'a' })], { 'h-a': had }, THU_1759)
    expect(r).toMatchObject({ weekStart: null, picks: [] })
  })
})

/** A fake world: households, their weeks, claims and the generator. */
function fakeDeps(opts: { people: AutoplanPerson[]; weeks: Record<string, AutoplanScopeWeeks>; failFor?: string; madeMeanwhile?: string }) {
  const weeks = new Map(Object.entries(opts.weeks))
  const claims = new Map<string, { id: string; outcome?: unknown }>()
  const generated: Array<{ userId: string; weekStart: string }> = []
  const tracked: string[] = []
  const deps: AutoplanDeps = {
    async load() {
      return { people: opts.people, weeks: new Map(weeks) }
    },
    async claim(pick, weekStart) {
      const key = `${pick.scopeKey}:${weekStart}`
      if (claims.has(key)) return null
      const id = `c${claims.size + 1}`
      claims.set(key, { id })
      return id
    },
    async stillOpen(userId) {
      return userId !== opts.madeMeanwhile
    },
    async generate(userId, weekStart) {
      if (userId === opts.failFor) throw new Error('boom')
      generated.push({ userId, weekStart })
      // The household now has next week (as in the DB after the insert).
      const p = opts.people.find((x) => x.userId === userId)!
      weeks.set(p.scopeKey, { hadMenu: true, hasNextWeek: true })
      return { menuId: `m-${userId}` }
    },
    async finish(claimId, outcome) {
      for (const c of claims.values()) if (c.id === claimId) c.outcome = outcome
    },
    track(pick) {
      tracked.push(pick.userId)
    },
  }
  return { deps, claims, generated, tracked }
}

describe('runWeeklyAutoplanIfDue — the scheduler with the generator faked', () => {
  it('generates once per household and week, and does not repeat on the next tick', async () => {
    const f = fakeDeps({ people: [person({ userId: 'a' }), person({ userId: 'b' })], weeks: { 'h-a': had, 'h-b': had } })
    const first = await runWeeklyAutoplanIfDue(THU_1800, f.deps)
    expect(first).toMatchObject({ weekStart: NEXT, generated: 2, failed: 0 })
    expect(f.generated).toEqual([{ userId: 'a', weekStart: NEXT }, { userId: 'b', weekStart: NEXT }])
    expect(f.tracked).toEqual(['a', 'b'])
    expect([...f.claims.values()].map((c) => c.outcome)).toEqual([{ menuId: 'm-a' }, { menuId: 'm-b' }])

    const again = await runWeeklyAutoplanIfDue(new Date(THU_1800.getTime() + 5 * 60_000), f.deps)
    expect(again?.generated).toBe(0)
    expect(f.generated).toHaveLength(2)
  })
  it('the claim alone stops a repeat (another process, or the week emptied afterwards)', async () => {
    const f = fakeDeps({ people: [person({ userId: 'a' })], weeks: { 'h-a': had } })
    await runWeeklyAutoplanIfDue(THU_1800, f.deps)
    // The household emptied the week: it looks open again, but it was already done once.
    const f2 = { ...f.deps, load: async () => ({ people: [person({ userId: 'a' })], weeks: new Map([['h-a', had]]) }) }
    const r = await runWeeklyAutoplanIfDue(THU_1800, f2)
    expect(r?.skipped.claimed).toBe(1)
    expect(f.generated).toHaveLength(1)
  })
  it('never on top of a week made by hand: not picked, and re-checked right before generating', async () => {
    const f = fakeDeps({
      people: [person({ userId: 'hand' }), person({ userId: 'meanwhile' })],
      weeks: { 'h-hand': { hadMenu: true, hasNextWeek: true }, 'h-meanwhile': had },
      madeMeanwhile: 'meanwhile',
    })
    const r = await runWeeklyAutoplanIfDue(THU_1800, f.deps)
    expect(f.generated).toEqual([])
    expect(r?.skipped).toMatchObject({ week_done: 1, made_meanwhile: 1 })
    expect([...f.claims.values()][0].outcome).toEqual({ skipped: 'hecha a mano' })
  })
  it('a failed generation is marked and does not stop the others', async () => {
    const f = fakeDeps({ people: [person({ userId: 'bad' }), person({ userId: 'ok' })], weeks: { 'h-bad': had, 'h-ok': had }, failFor: 'bad' })
    const r = await runWeeklyAutoplanIfDue(THU_1800, f.deps)
    expect(r).toMatchObject({ generated: 1, failed: 1 })
    expect(f.generated.map((g) => g.userId)).toEqual(['ok'])
    expect([...f.claims.values()][0].outcome).toEqual({ error: 'boom' })
  })
  it('a few households per tick; the rest on the next one', async () => {
    const people = Array.from({ length: AUTOPLAN_PER_TICK + 3 }, (_, i) => person({ userId: `u${i}` }))
    const f = fakeDeps({ people, weeks: Object.fromEntries(people.map((p) => [p.scopeKey, had])) })
    expect((await runWeeklyAutoplanIfDue(THU_1800, f.deps))?.generated).toBe(AUTOPLAN_PER_TICK)
    expect((await runWeeklyAutoplanIfDue(THU_1800, f.deps))?.generated).toBe(3)
  })
  it('outside the window it does nothing (not even read)', async () => {
    const f = fakeDeps({ people: [person({ userId: 'a' })], weeks: { 'h-a': had } })
    f.deps.load = async () => {
      throw new Error('should not read')
    }
    expect(await runWeeklyAutoplanIfDue(THU_1759, f.deps)).toBeNull()
  })
})

describe('the /menu card and autoplan_changed — by the week’s Monday (Madrid)', () => {
  it('the card lives until Monday ends; a change counts only before Monday', () => {
    expect(autoplanCardLive(NEXT, new Date('2026-11-09T22:59:00Z'))).toBe(true) // Monday 23:59
    expect(autoplanCardLive(NEXT, new Date('2026-11-09T23:00:00Z'))).toBe(false) // Tuesday 00:00
    expect(autoplanChangeCounts(NEXT, new Date('2026-11-08T22:59:00Z'))).toBe(true) // Sunday 23:59
    expect(autoplanChangeCounts(NEXT, new Date('2026-11-08T23:00:00Z'))).toBe(false) // Monday 00:00
  })
})
