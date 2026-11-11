/** Bodies the web sends to /cook-now/* (contract test: apps/api/src/tests/cookNowContract.test.ts). */
import type { CookNowChooseRequest, CookNowProposalRequest } from "@ona/shared"

export function proposalBody(a: { minutes: 15 | 30 | 45 | null; servings: number; canBuy: boolean }): CookNowProposalRequest {
  return { minutes: a.minutes, servings: a.servings, canBuy: a.canBuy }
}

/** «Con lo que tienes»: default answers, only what uses the pantry. */
export function pantryMatchBody(servings: number): CookNowProposalRequest {
  return { minutes: null, servings, canBuy: false, requirePantryUse: true }
}

/** Servings go as null when they are the household's default diners (the slot then keeps no override). */
export function chooseBody(a: { recipeId: string; servings: number; householdDiners: number; displacedTo: number | null }): CookNowChooseRequest {
  return { recipeId: a.recipeId, servings: a.servings === a.householdDiners ? null : a.servings, displacedTo: a.displacedTo }
}
