/**
 * 19-nov (Miguel): the WhatsApp sign-up's health link and avisos question no
 * longer arrive in the same second as the first menu: ~10 min later, one at
 * a time, never mid-conversation (services/whatsapp/signupFollowUps.ts).
 */
import { describe, expect, it } from 'vitest'
import { dueSignupFollowUp, signupFollowUpMessage } from '../services/whatsapp/signupFollowUps.js'
import { COPY } from '../services/whatsapp/inbound.js'

const NOW = new Date('2026-11-18T20:00:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000)
const due = (completedMin: number, kinds: Array<[string, number]>, lastMin: number | null) =>
  dueSignupFollowUp({ completedAt: ago(completedMin), kinds: new Map(kinds.map(([k, m]) => [k, ago(m)])), lastActivityAt: lastMin === null ? null : ago(lastMin), now: NOW })

describe('dueSignupFollowUp', () => {
  it('nothing in the first 10 minutes; then the health link; 5 quiet minutes later, the avisos question', () => {
    expect(due(9, [['onboarding', 15], ['reply', 9]], 9)).toBeNull()
    expect(due(11, [['onboarding', 15], ['reply', 9]], 9)).toBe('health_link')
    expect(due(13, [['onboarding', 20], ['reply', 12], ['health_link', 2]], 2)).toBeNull()
    expect(due(17, [['onboarding', 20], ['reply', 12], ['health_link', 6]], 6)).toBe('optin_prompt')
  })
  it('never while the conversation is going', () => {
    expect(due(30, [['onboarding', 40], ['reply', 1]], 1)).toBeNull()
  })
  it('only the WhatsApp sign-up, once, not after BAJA, ALTA or the old flow, not after 20 h', () => {
    expect(due(30, [['reply', 20]], 20)).toBeNull()
    expect(due(30, [['onboarding', 40], ['optin_prompt', 25]], 25)).toBeNull()
    expect(due(30, [['onboarding', 40], ['optout', 25]], 25)).toBeNull()
    expect(due(30, [['onboarding', 40], ['health_link', 20], ['optin', 15]], 15)).toBeNull()
    expect(due(21 * 60, [['onboarding', 22 * 60]], 21 * 60)).toBeNull()
  })
  it('the messages: the health link to the web, then the avisos question with its two buttons', () => {
    expect(signupFollowUpMessage('health_link', 'https://mimoia.com/')).toEqual([{ type: 'text', text: COPY.healthOnWeb('https://mimoia.com/profile') }])
    expect(signupFollowUpMessage('optin_prompt', 'https://mimoia.com')[0]).toMatchObject({ type: 'buttons', text: COPY.optInPrompt })
  })
})
