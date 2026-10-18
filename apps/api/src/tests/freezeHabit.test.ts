/**
 * PRO-221 (specs/user-memory.md, specs/notifications.md): «¿Congeláis la carne
 * o el pescado cuando compráis?» — the answers, the habit each one writes in
 * `prep_habits`, and when the thaw alert is conditional. The alert itself,
 * scheduled from a real menu with merluza, is freezeHabit.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  FREEZE_ANSWERS,
  FREEZE_ANSWER_LABELS,
  FREEZE_HABIT_ALWAYS,
  FREEZE_HABIT_SOMETIMES,
  FREEZE_QUESTION,
  THAW_CONDITIONAL_TEXT,
  applyFreezeAnswer,
  freezeAnswerFromHabits,
  onboardingDraftSchema,
  onboardingSchema,
  thawIsConditional,
} from '@ona/shared'

describe('«¿Congeláis la carne o el pescado?» (PRO-221)', () => {
  it('the question, its three answers and the conditional alert, word for word', () => {
    expect(FREEZE_QUESTION).toBe('¿Congeláis la carne o el pescado cuando compráis?')
    expect(FREEZE_ANSWERS.map((a) => FREEZE_ANSWER_LABELS[a])).toEqual(['Sí, casi siempre', 'A veces', 'No'])
    expect(FREEZE_HABIT_ALWAYS).toBe('Congelo la carne y el pescado')
    expect(THAW_CONDITIONAL_TEXT).toBe('Si lo tienes congelado, sácalo hoy.')
  })

  it('«Sí» and «A veces» save their sentence, «No» saves nothing; other habits stay', () => {
    expect(applyFreezeAnswer([], 'yes')).toEqual([FREEZE_HABIT_ALWAYS])
    expect(applyFreezeAnswer(undefined, 'sometimes')).toEqual([FREEZE_HABIT_SOMETIMES])
    expect(applyFreezeAnswer([], 'no')).toEqual([])
    const remojo = 'Pongo las legumbres en remojo la noche antes'
    expect(applyFreezeAnswer([remojo, FREEZE_HABIT_ALWAYS], 'sometimes')).toEqual([remojo, FREEZE_HABIT_SOMETIMES])
    // «No» also removes what Mimo had saved about freezing (it would keep the alert on).
    expect(applyFreezeAnswer([remojo, 'Siempre congelo el pescado'], 'no')).toEqual([remojo])
  })

  it('reads back what the alerts do', () => {
    expect(freezeAnswerFromHabits([])).toBeNull()
    expect(freezeAnswerFromHabits([FREEZE_HABIT_ALWAYS])).toBe('yes')
    expect(freezeAnswerFromHabits([FREEZE_HABIT_SOMETIMES])).toBe('sometimes')
    expect(freezeAnswerFromHabits(['siempre congelo el pescado'])).toBe('yes')
  })

  it('the alert is conditional only when every freezing habit says «a veces»', () => {
    expect(thawIsConditional([FREEZE_HABIT_SOMETIMES])).toBe(true)
    expect(thawIsConditional([FREEZE_HABIT_ALWAYS])).toBe(false)
    expect(thawIsConditional([FREEZE_HABIT_SOMETIMES, 'Siempre congelo el pescado'])).toBe(false)
    expect(thawIsConditional(['Pongo las legumbres en remojo'])).toBe(false)
  })

  it('the sign-up sends it (optional) and the draft keeps it', () => {
    const base = { adults: 2, kidsCount: 0, cookingFreq: 'daily', restrictions: [], priority: 'healthy' }
    expect(onboardingSchema.parse({ ...base, freezesMeatFish: 'sometimes' }).freezesMeatFish).toBe('sometimes')
    expect(onboardingSchema.parse(base).freezesMeatFish).toBeUndefined()
    expect(onboardingSchema.safeParse({ ...base, freezesMeatFish: 'quizá' }).success).toBe(false)
    const draft = { step: 3, adults: 2, kidsCount: 0, cookingFreq: 'daily', cookingStyle: null, freezesMeatFish: 'yes', weekdayCooking: null, cookingNote: '', priority: null }
    expect(onboardingDraftSchema.parse(draft).freezesMeatFish).toBe('yes')
  })
})
