/**
 * PRO-107: the one WhatsApp reminder on /menu (specs/whatsapp.md).
 */
import { describe, expect, it } from 'vitest'
import { shouldShowWhatsAppNudge } from '../services/whatsapp/nudge.js'

const base = { available: true, linked: false, nudgeAt: null, firstWeekResolved: true }

describe('shouldShowWhatsAppNudge', () => {
  it('shows once the first week is resolved, for someone without WhatsApp connected', () => {
    expect(shouldShowWhatsAppNudge(base)).toBe(true)
  })
  it('never for someone connected', () => {
    expect(shouldShowWhatsAppNudge({ ...base, linked: true })).toBe(false)
  })
  it('never again once shown (or closed with «Ahora no»)', () => {
    expect(shouldShowWhatsAppNudge({ ...base, nudgeAt: new Date('2026-10-16T10:00:00Z') })).toBe(false)
  })
  it('not before a menu and the shopping list', () => {
    expect(shouldShowWhatsAppNudge({ ...base, firstWeekResolved: false })).toBe(false)
  })
  it('not where WhatsApp is not available', () => {
    expect(shouldShowWhatsAppNudge({ ...base, available: false })).toBe(false)
  })
})
