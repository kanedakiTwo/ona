import { describe, expect, it } from 'vitest'
import { cookNowChooseSchema, cookNowProposalSchema } from '@ona/shared'
import { chooseBody, pantryMatchBody, proposalBody } from '../../../web/src/lib/cookNowPayload'
import { menuDiners } from '../../../web/src/lib/menuDiners'

describe('«Cocinar ahora» web payloads match the API schemas', () => {
  it('proposal, for every time button', () => {
    for (const minutes of [15, 30, 45, null] as const) {
      expect(cookNowProposalSchema.safeParse(proposalBody({ minutes, servings: 3, canBuy: true })).success).toBe(true)
    }
    expect(cookNowProposalSchema.safeParse(pantryMatchBody(2)).success).toBe(true)
  })
  it('choose sends null servings only when they are the household default', () => {
    const same = chooseBody({ recipeId: '00000000-0000-4000-8000-000000000001', servings: 2, householdDiners: 2, displacedTo: null })
    const other = chooseBody({ recipeId: '00000000-0000-4000-8000-000000000001', servings: 3, householdDiners: 2, displacedTo: 4 })
    expect(same.servings).toBeNull()
    expect(other.servings).toBe(3)
    expect(cookNowChooseSchema.safeParse(same).success).toBe(true)
    expect(cookNowChooseSchema.safeParse(other).success).toBe(true)
  })
})

describe('menuDiners', () => {
  it('counts a child as one person, like the menu', () => {
    expect(menuDiners({ adults: 2, kidsCount: 2 })).toBe(4)
    expect(menuDiners({ adults: 1, kidsCount: 0 })).toBe(1)
    expect(menuDiners({})).toBe(2)
  })
})
