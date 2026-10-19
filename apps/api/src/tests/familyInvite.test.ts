/**
 * «Invitar al hogar por WhatsApp» (PRO-260, D-088; specs/household.md):
 * the link lasts 30 days (was 7) and the message «Enviar por WhatsApp»
 * opens carries it.
 */
import { describe, expect, it } from 'vitest'
import {
  HOUSEHOLD_INVITE_TTL_DAYS,
  familyInviteShareText,
  householdInviteExpiresAt,
  householdInvitePath,
  isHouseholdInviteSource,
  whatsappShareHref,
} from '@ona/shared'

describe('household invitation link', () => {
  it('expires 30 days after it is created', () => {
    expect(HOUSEHOLD_INVITE_TTL_DAYS).toBe(30)
    const now = new Date('2026-10-20T10:00:00Z')
    expect(householdInviteExpiresAt(now).toISOString()).toBe('2026-11-19T10:00:00.000Z')
  })

  it('the WhatsApp message carries the link and says how long it lasts', () => {
    const url = `https://mimoia.com${householdInvitePath('abc123')}`
    const text = familyInviteShareText(url)
    expect(text).toContain('Mimoia')
    expect(text).toContain('menú de la semana y la lista de la compra')
    expect(text).toContain('30 días')
    expect(text.endsWith(url)).toBe(true)
    expect(whatsappShareHref(text)).toBe(`https://wa.me/?text=${encodeURIComponent(text)}`)
  })

  it('knows the four moments an invitation comes from', () => {
    for (const s of ['casa', 'alta', 'compra', 'mimo']) expect(isHouseholdInviteSource(s)).toBe(true)
    expect(isHouseholdInviteSource('otro')).toBe(false)
    expect(isHouseholdInviteSource(undefined)).toBe(false)
  })
})
