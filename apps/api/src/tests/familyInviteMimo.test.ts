/**
 * PRO-262 (D-088): Mimo offers to bring the couple or the family into the
 * household once, after the first resolved week; never to a household with
 * 2 people; never after a «no»; only when the weekly aviso budget allows.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const offers = vi.hoisted(() => ({
  input: null as any,
  stamped: [] as string[],
}))
vi.mock('../services/familyInviteOffers.js', async (orig) => {
  const real = await orig<typeof import('../services/familyInviteOffers.js')>()
  return {
    ...real,
    loadFamilyOfferInput: vi.fn(async () => offers.input),
    stampFamilyOffer: vi.fn(async (_u: string, key: string) => {
      if (offers.stamped.includes(key)) return false
      offers.stamped.push(key)
      return true
    }),
  }
})
vi.mock('../db/connection.js', () => ({ db: { execute: vi.fn(async () => ({ rows: [] })) } }))

import {
  FAMILY_INVITE_MIMO_LINE,
  FAMILY_INVITE_MIMO_MARKER,
  familyResolvedWeeks,
  isFamilyInviteDeclined,
  maybeAppendFamilyInviteOffer,
  shouldOfferFamilyInvite,
  withFamilyInviteLine,
  type FamilyMimoOfferInput,
} from '../services/familyInviteMimo.js'

// Wednesday 2026-10-21 12:00 Madrid; its week starts Monday 2026-10-19.
const NOW = new Date('2026-10-21T10:00:00Z')
const WEEK = '2026-10-19'

const base = (over: Partial<FamilyMimoOfferInput> = {}): FamilyMimoOfferInput => ({
  state: {},
  members: 1,
  isOwner: true,
  adults: 2,
  resolvedWeeks: [WEEK],
  now: NOW,
  ...over,
})

describe('familyResolvedWeeks', () => {
  it('a menu and the list used that week (or the weekend before) is a resolved week', () => {
    expect(familyResolvedWeeks([WEEK], ['2026-10-20'])).toEqual([WEEK])
    expect(familyResolvedWeeks([WEEK], ['2026-10-17'])).toEqual([WEEK])
    expect(familyResolvedWeeks([WEEK], [])).toEqual([])
    expect(familyResolvedWeeks([], ['2026-10-20'])).toEqual([])
  })
})

describe('shouldOfferFamilyInvite', () => {
  it('shows in the resolved week, not before', () => {
    expect(shouldOfferFamilyInvite(base())).toBe(true)
    expect(shouldOfferFamilyInvite(base({ resolvedWeeks: [] }))).toBe(false)
  })

  it('at the weekend, when the coming week is already resolved', () => {
    expect(shouldOfferFamilyInvite(base({ now: new Date('2026-10-24T10:00:00Z'), resolvedWeeks: ['2026-10-26'] }))).toBe(true)
  })

  it('only once', () => {
    expect(shouldOfferFamilyInvite(base({ state: { mimo: '2026-10-20T10:00:00Z' } }))).toBe(false)
  })

  it('never to a household with 2 people, nor to a member who is not the owner, nor with 1 adult', () => {
    expect(shouldOfferFamilyInvite(base({ members: 2 }))).toBe(false)
    expect(shouldOfferFamilyInvite(base({ isOwner: false }))).toBe(false)
    expect(shouldOfferFamilyInvite(base({ adults: 1 }))).toBe(false)
  })

  it('not while an invitation is pending (already inviting, e.g. this very turn)', () => {
    expect(shouldOfferFamilyInvite(base({ pendingInvites: 1 }))).toBe(false)
  })

  it('never to someone who said no', () => {
    expect(shouldOfferFamilyInvite(base({ state: { mimoDeclined: '2026-10-20T10:00:00Z' } }))).toBe(false)
  })
})

describe('the line and the «no»', () => {
  it('goes at the end of the reply', () => {
    expect(withFamilyInviteLine('Hecho: te he cambiado el jueves.')).toBe(`Hecho: te he cambiado el jueves.\n\n${FAMILY_INVITE_MIMO_LINE}`)
    expect(FAMILY_INVITE_MIMO_LINE).toContain(FAMILY_INVITE_MIMO_MARKER)
  })

  it('a «no» right after the offer declines it; other messages don’t', () => {
    const history = [{ role: 'assistant' as const, content: withFamilyInviteLine('De nada.') }]
    expect(isFamilyInviteDeclined('No', history)).toBe(true)
    expect(isFamilyInviteDeclined('no gracias!', history)).toBe(true)
    expect(isFamilyInviteDeclined('Vivo sola', history)).toBe(true)
    expect(isFamilyInviteDeclined('Sí, a mi marido', history)).toBe(false)
    expect(isFamilyInviteDeclined('No, cámbiame el jueves', history)).toBe(false)
    expect(isFamilyInviteDeclined('No', [{ role: 'assistant', content: '¿Te cambio el jueves?' }])).toBe(false)
  })
})

describe('maybeAppendFamilyInviteOffer (the scheduler of the offer)', () => {
  beforeEach(() => {
    offers.stamped = []
    // Resolved-week rows come from the mocked db (empty), so the input is
    // already complete when it says no; for a yes, inject the weeks via the gate test below.
  })

  it('appends once and never again', async () => {
    offers.input = { state: {}, members: 1, isOwner: true, adults: 2 }
    const { db } = await import('../db/connection.js')
    ;(db.execute as any).mockImplementation(async (q: any) => {
      const text = JSON.stringify(q)
      if (text.includes('primary_household_id AS h')) return { rows: [{ h: 'h1' }] }
      if (text.includes('menus x')) return { rows: [{ week: WEEK }] }
      if (text.includes('activity_events')) return { rows: [{ day: '2026-10-20' }] }
      return { rows: [] }
    })
    const first = await maybeAppendFamilyInviteOffer('u1', 'Hola', 'whatsapp', { now: NOW, gate: async () => true })
    expect(first).toBe(withFamilyInviteLine('Hola'))
    offers.input = { state: { mimo: NOW.toISOString() }, members: 1, isOwner: true, adults: 2 }
    expect(await maybeAppendFamilyInviteOffer('u1', 'Hola', 'whatsapp', { now: NOW, gate: async () => true })).toBe('Hola')
  })

  it('without room in the weekly aviso budget it waits (no stamp)', async () => {
    offers.input = { state: {}, members: 1, isOwner: true, adults: 2 }
    expect(await maybeAppendFamilyInviteOffer('u1', 'Hola', 'text', { now: NOW, gate: async () => false })).toBe('Hola')
    expect(offers.stamped).toEqual([])
  })

  it('never to a household with 2 people (the gate is not even asked)', async () => {
    offers.input = { state: {}, members: 2, isOwner: true, adults: 2 }
    const gate = vi.fn(async () => true)
    expect(await maybeAppendFamilyInviteOffer('u1', 'Hola', 'text', { now: NOW, gate })).toBe('Hola')
    expect(gate).not.toHaveBeenCalled()
  })
})
