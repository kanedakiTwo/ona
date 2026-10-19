/**
 * PRO-244: a WhatsApp sign-up on Saturday 17-oct got the shopping reminder
 * (31 things) in the same minute it accepted the avisos. No shopping reminder
 * in the first 24 h after the first steps.
 */
import { describe, expect, it } from 'vitest'
import { quietAfterSignUp, SIGN_UP_QUIET_MS } from '../services/whatsapp/signUpQuiet.js'

const now = new Date('2026-10-17T09:30:00Z') // Saturday 11:30 Madrid, reminder window

describe('quietAfterSignUp', () => {
  it('holds the shopping reminder back right after the sign-up', () => {
    expect(quietAfterSignUp('shopping_reminder', new Date('2026-10-17T09:29:00Z'), now)).toBe(true)
    expect(quietAfterSignUp('shopping_reminder', new Date(now.getTime() - SIGN_UP_QUIET_MS + 60_000), now)).toBe(true)
  })

  it('lets it go a day later, or when the sign-up date is unknown', () => {
    expect(quietAfterSignUp('shopping_reminder', new Date(now.getTime() - SIGN_UP_QUIET_MS), now)).toBe(false)
    expect(quietAfterSignUp('shopping_reminder', new Date('2026-10-10T09:00:00Z'), now)).toBe(false)
    expect(quietAfterSignUp('shopping_reminder', null, now)).toBe(false)
  })

  it('only affects the shopping reminder', () => {
    const justNow = new Date('2026-10-17T09:29:00Z')
    expect(quietAfterSignUp('weekly_nudge', justNow, now)).toBe(false)
    expect(quietAfterSignUp('daily_brief', justNow, now)).toBe(false)
  })
})
