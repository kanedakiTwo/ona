/**
 * PRO-383 (D-158): «¿Quién hace la compra?» in the sign-up, only with 2
 * adults or more, and «Invítale y le llegará la lista cada semana» after
 * «Otra persona de casa» or «Nos turnamos». The answer is a `shopper` fact in
 * the household's ficha (D-064). Mimo's side is firstMenuWhatsApp.test.ts and
 * whatsappOnboarding.test.ts; the browser, e2e/onboarding-shopper.spec.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  PROFILE_FACT_VALUE_SCHEMAS,
  SHOPPER_LABELS,
  asksShopper,
  onboardingSchema,
  shopperInviteText,
  shopperInvites,
} from '@ona/shared'
import { factSentence, factTopic } from '../services/profile/view.js'
import { onboardingOrder, resumeStep, SHOPPER_INVITE_STEP, SHOPPER_STEP } from '../../../web/src/lib/onboardingSteps'

describe('the question', () => {
  it('three answers, word for word, and only for 2 adults or more', () => {
    expect(SHOPPER_LABELS).toEqual({ me: 'Yo', other: 'Otra persona de casa', shared: 'Nos turnamos' })
    expect(asksShopper(1)).toBe(false)
    expect(asksShopper(2)).toBe(true)
    expect(asksShopper(4)).toBe(true)
  })

  it('«Otra persona» and «Nos turnamos» lead to the invitation; «Yo» does not', () => {
    expect(shopperInvites('other')).toBe(true)
    expect(shopperInvites('shared')).toBe(true)
    expect(shopperInvites('me')).toBe(false)
    expect(shopperInvites(null)).toBe(false)
  })

  it('the invitation\'s message, with the link at the end', () => {
    expect(shopperInviteText('https://mimoia.com/invites/abc')).toBe(
      'Te he metido en nuestra casa de Mimoia: ahí tendrás el menú y la lista de la compra de cada semana. Entra aquí: https://mimoia.com/invites/abc',
    )
  })
})

describe('the web steps', () => {
  const base = { allergiesAnswered: false, inviteOffer: true }

  it('1 adult: no question, no invitation', () => {
    expect(onboardingOrder({ ...base, adults: 1, shopper: 'other' })).toEqual([1, 3, 4, 5])
  })

  it('2 adults: the question right after the household; the invitation only after «Otra persona» or «Nos turnamos»', () => {
    expect(onboardingOrder({ ...base, adults: 2, shopper: null })).toEqual([1, SHOPPER_STEP, 3, 4, 5])
    expect(onboardingOrder({ ...base, adults: 2, shopper: 'me' })).toEqual([1, SHOPPER_STEP, 3, 4, 5])
    expect(onboardingOrder({ ...base, adults: 2, shopper: 'other' })).toEqual([1, SHOPPER_STEP, SHOPPER_INVITE_STEP, 3, 4, 5])
    expect(onboardingOrder({ ...base, adults: 3, shopper: 'shared' })).toEqual([1, SHOPPER_STEP, SHOPPER_INVITE_STEP, 3, 4, 5])
  })

  it('the invitation is offered once (PRO-261): already shown or not the owner, it is skipped', () => {
    expect(onboardingOrder({ ...base, adults: 2, shopper: 'other', inviteOffer: false })).toEqual([1, SHOPPER_STEP, 3, 4, 5])
  })

  it('a draft left on the question or the invitation resumes on the question; with 1 adult, on how they cook', () => {
    expect(resumeStep({ step: SHOPPER_STEP, adults: 2 })).toBe(SHOPPER_STEP)
    expect(resumeStep({ step: SHOPPER_INVITE_STEP, adults: 2 })).toBe(SHOPPER_STEP)
    expect(resumeStep({ step: SHOPPER_STEP, adults: 1 })).toBe(3)
  })
})

describe('the answer', () => {
  it('goes in the sign-up payload, and nothing else is accepted', () => {
    const web = { adults: 2, kidsCount: 0, restrictions: [], cookingStyle: 'daily' }
    expect(onboardingSchema.parse({ ...web, shopper: 'shared' }).shopper).toBe('shared')
    expect(onboardingSchema.parse(web).shopper).toBeUndefined()
    expect(onboardingSchema.safeParse({ ...web, shopper: 'mi pareja' }).success).toBe(false)
  })

  it('is a fact of the ficha about the household, in «Tiempo y compra»', () => {
    expect(PROFILE_FACT_VALUE_SCHEMAS.shopper.safeParse({ who: 'other' }).success).toBe(true)
    expect(PROFILE_FACT_VALUE_SCHEMAS.shopper.safeParse({ who: 'nadie' }).success).toBe(false)
    expect(factSentence('shopper', { who: 'me' }, 'casa')).toBe('La compra la hace quien se dio de alta')
    expect(factSentence('shopper', { who: 'other' }, 'casa')).toBe('La compra la hace otra persona de casa')
    expect(factSentence('shopper', { who: 'shared' }, 'casa')).toBe('La compra la hacéis por turnos')
    expect(factTopic('shopper')).toBe('tiempo_y_compra')
  })
})
