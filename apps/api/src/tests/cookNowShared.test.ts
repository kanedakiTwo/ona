import { describe, expect, it } from 'vitest'
import { cookNowHitLine, cookNowMeal, cookNowProposalSchema, displaceTargets, plannedRecipeDishes } from '@ona/shared'

const recipe = (name: string, variant?: string) => ({ kind: 'recipe' as const, recipeId: name, recipeName: name, ...(variant ? { variant: variant as any } : {}) })

describe('cookNowMeal', () => {
  it('lunch until 16:00, then dinner', () => {
    expect(cookNowMeal({}, 13)).toBe('lunch')
    expect(cookNowMeal({}, 16)).toBe('dinner')
  })
  it('lunch already eaten → dinner; both eaten → none', () => {
    expect(cookNowMeal({ lunch: { dishes: [], eaten: true } }, 13)).toBe('dinner')
    expect(cookNowMeal({ dinner: { dishes: [], eaten: true } }, 20)).toBeNull()
  })
})

describe('plannedRecipeDishes', () => {
  it('leaves out leftovers, every táper (freezer, fridge, cooked) and notes', () => {
    const slot = {
      dishes: [
        recipe('Lentejas'),
        recipe('Táper', 'leftover'),
        recipe('Croquetas', 'freezer'),
        recipe('Táper de la nevera', 'fridge'),
        recipe('Sobras de otro día', 'cooked'),
        { kind: 'note' as const, text: 'pan' },
      ],
    }
    expect(plannedRecipeDishes(slot).map((d) => d.recipeName)).toEqual(['Lentejas'])
  })
})

describe('displaceTargets', () => {
  const days = [
    { lunch: { dishes: [recipe('Lentejas')] } },
    { lunch: { dishes: [recipe('Merluza')] } },
    {},
    { lunch: { dishes: [recipe('Pollo')] } },
    {}, {}, {},
  ]
  it('from tomorrow to Sunday, saying what each would replace', () => {
    const t = displaceTargets(days, 0, 'lunch', { '3': { lunch: true } }, [2])
    expect(t.map((x) => x.day)).toEqual([1, 2, 3, 4, 5, 6])
    expect(t[0]).toMatchObject({ replaces: 'Merluza', disabled: false })
    expect(t[1]).toMatchObject({ replaces: null, disabled: true }) // skipped day
    expect(t[2]).toMatchObject({ disabled: true }) // locked
  })
  it('Sunday has nowhere to go', () => expect(displaceTargets(days, 6, 'lunch', {}, [])).toEqual([]))
})

describe('cookNowHitLine', () => {
  it('says what is missing, what can be left out or swapped', () => {
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: [], substitutions: [] })).toBe('No te falta nada')
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: ['perejil', 'comino'], substitutions: [] })).toBe('Puedes hacerla sin perejil y comino')
    expect(cookNowHitLine({ missingEssential: ['pollo'], short: [], missingSecondary: [], substitutions: [] })).toBe('Te falta: pollo')
    expect(cookNowHitLine({ missingEssential: ['arroz'], short: ['arroz'], missingSecondary: [], substitutions: [] })).toBe('Te falta un poco de arroz')
    expect(cookNowHitLine({ missingEssential: [], short: [], missingSecondary: [], substitutions: [{ missing: 'nata', use: 'leche' }] })).toBe('Cambia la nata por leche')
  })
})

describe('cookNowProposalSchema', () => {
  it('accepts the four answers', () => {
    expect(cookNowProposalSchema.safeParse({ minutes: 30, servings: 2, canBuy: false }).success).toBe(true)
    expect(cookNowProposalSchema.safeParse({ minutes: null, servings: 4, canBuy: true }).success).toBe(true)
  })
  it('rejects odd minutes and zero people', () => {
    expect(cookNowProposalSchema.safeParse({ minutes: 20, servings: 2, canBuy: false }).success).toBe(false)
    expect(cookNowProposalSchema.safeParse({ minutes: 30, servings: 0, canBuy: false }).success).toBe(false)
  })
})
