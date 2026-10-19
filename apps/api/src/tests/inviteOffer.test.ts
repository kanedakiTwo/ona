/**
 * PRO-164 (D-059): Mimo offers to invite another household once, after the
 * first resolved week; a «no» turns it off; never the same week as the
 * WhatsApp card on /menu (PRO-107).
 */
import { describe, expect, it } from 'vitest'
import {
  INVITE_OFFER_MARKER,
  inviteOfferLine,
  isInviteOfferDeclined,
  resolvedWeeks,
  shouldOfferInvite,
  withInviteOffer,
  type InviteOfferInput,
} from '../services/inviteOffer.js'

// Wednesday 2026-10-21 12:00 Madrid; its week starts Monday 2026-10-19.
const NOW = new Date('2026-10-21T10:00:00Z')
const WEEK = '2026-10-19'

const base = (over: Partial<InviteOfferInput> = {}): InviteOfferInput => ({
  offeredAt: null,
  declinedAt: null,
  resolvedWeeks: [WEEK],
  whatsappNudgeAt: null,
  whatsappNudgePending: false,
  now: NOW,
  ...over,
})

describe('resolvedWeeks (the /admin/metrics definition)', () => {
  it('a week with a menu and the list used that week is resolved', () => {
    expect(resolvedWeeks([WEEK], ['2026-10-20'])).toEqual([WEEK])
  })
  it('a weekend shop counts for the menu that starts on Monday', () => {
    expect(resolvedWeeks([WEEK], ['2026-10-17'])).toEqual([WEEK]) // Saturday before
  })
  it('a menu without the list used, or the list without a menu, is not', () => {
    expect(resolvedWeeks([WEEK], [])).toEqual([])
    expect(resolvedWeeks([], ['2026-10-20'])).toEqual([])
    expect(resolvedWeeks(['2026-10-12'], ['2026-10-20'])).toEqual([])
  })
})

describe('shouldOfferInvite', () => {
  it('does not show before the household has a resolved week', () => {
    expect(shouldOfferInvite(base({ resolvedWeeks: [] }))).toBe(false)
    expect(shouldOfferInvite(base({ resolvedWeeks: ['2026-10-26'] }))).toBe(false) // a later week, not this one
  })

  it('shows in the resolved week', () => {
    expect(shouldOfferInvite(base())).toBe(true)
  })

  it('shows on a weekend when the coming week is already resolved', () => {
    const saturday = new Date('2026-10-24T10:00:00Z')
    expect(shouldOfferInvite(base({ now: saturday, resolvedWeeks: ['2026-10-26'] }))).toBe(true)
  })

  it('shows only once', () => {
    expect(shouldOfferInvite(base({ offeredAt: new Date('2026-10-20T10:00:00Z') }))).toBe(false)
  })

  it('never after a «no»', () => {
    expect(shouldOfferInvite(base({ declinedAt: new Date('2026-10-20T10:00:00Z') }))).toBe(false)
  })

  it('never the same week as the WhatsApp card (PRO-107): it waits for the next resolved week', () => {
    // The card is still to come: it goes first.
    expect(shouldOfferInvite(base({ whatsappNudgePending: true }))).toBe(false)
    // The card was shown this week.
    expect(shouldOfferInvite(base({ whatsappNudgeAt: new Date('2026-10-20T18:00:00Z') }))).toBe(false)
    // Next week, resolved too: now it goes.
    const nextWeek = new Date('2026-10-28T10:00:00Z')
    expect(
      shouldOfferInvite(base({ now: nextWeek, resolvedWeeks: [WEEK, '2026-10-26'], whatsappNudgeAt: new Date('2026-10-20T18:00:00Z') })),
    ).toBe(true)
    // Next week but not resolved: still waits.
    expect(shouldOfferInvite(base({ now: nextWeek, resolvedWeeks: [WEEK], whatsappNudgeAt: new Date('2026-10-20T18:00:00Z') }))).toBe(false)
  })
})

describe('the line and the «no»', () => {
  const link = 'https://mimoia.com/?invita=abcd2345'

  it('is Miguel’s text, at the end of the reply', () => {
    expect(inviteOfferLine(link)).toBe(
      'Esta semana ya la tienes resuelta. ¿Conoces a alguien que siempre está con el "¿qué cenamos?"? Te dejo tu enlace para invitarle: https://mimoia.com/?invita=abcd2345',
    )
    expect(withInviteOffer('Hecho: te he cambiado el jueves.', link)).toBe(`Hecho: te he cambiado el jueves.\n\n${inviteOfferLine(link)}`)
    expect(inviteOfferLine(link)).toContain(INVITE_OFFER_MARKER)
  })

  it('a «no» right after the offer declines it; other messages don’t', () => {
    const history = [
      { role: 'user' as const, content: 'gracias' },
      { role: 'assistant' as const, content: withInviteOffer('De nada.', link) },
    ]
    expect(isInviteOfferDeclined('No', history)).toBe(true)
    expect(isInviteOfferDeclined('no gracias!', history)).toBe(true)
    expect(isInviteOfferDeclined('No conozco a nadie', history)).toBe(true)
    expect(isInviteOfferDeclined('Sí, ahora se lo paso a mi hermana', history)).toBe(false)
    expect(isInviteOfferDeclined('No, cámbiame el jueves', history)).toBe(false)
    expect(isInviteOfferDeclined('no me pongas pescado el jueves y cámbiame la cena del viernes por algo con pollo', history)).toBe(false)
    // A «no» to something else is not a «no» to the offer.
    expect(isInviteOfferDeclined('No', [{ role: 'assistant', content: '¿Te cambio el jueves?' }])).toBe(false)
  })
})
