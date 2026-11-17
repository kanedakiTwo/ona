/**
 * The web sign-up's questions by step number (OnboardingFlow). Pure, so the
 * API's vitest suite tests it (onboardingHowTheyCook.test.ts,
 * onboardingShopper.test.ts).
 *
 * The numbers stay as they were because drafts (PRO-178) and the usage funnel
 * (`onboardingStepKey`) count by them: 1 household, 3 how they cook, 4 weekday
 * time, 5 allergies. 2 («¿Cuántas veces a la semana cocinas?», now read from
 * how they cook) and 6 («¿Qué quieres que Mimoia priorice?») are gone since
 * 2026-11-03 (Miguel: they overlapped). 7 «¿Quién hace la compra?» and 8
 * «Invítale y le llegará la lista cada semana» (PRO-383) go right after the
 * household, so the order is not the numbers' order.
 */
import { asksShopper, shopperInvites, type OnboardingDraft, type Shopper } from "@ona/shared"

/** The restrictions step (allergies): 5 since PRO-217 added «¿Cómo cocináis en casa?» as step 3. */
export const RESTRICTIONS_STEP = 5

/** PRO-383: «¿Quién hace la compra?», only with 2 adults or more. */
export const SHOPPER_STEP = 7

/** PRO-383: the invitation, only after «Otra persona de casa» or «Nos turnamos». */
export const SHOPPER_INVITE_STEP = 8

/** Every step in the order shown. */
export const WEB_STEPS = [1, SHOPPER_STEP, SHOPPER_INVITE_STEP, 3, 4, RESTRICTIONS_STEP] as const

export interface OnboardingOrderInput {
  /** Allergies were answered before the cards: the step leaves the questions. */
  allergiesAnswered: boolean
  adults?: number
  shopper?: Shopper | null
  /** The sign-up's invitation may still be offered (owner, one account, not shown before). */
  inviteOffer?: boolean
}

/** The steps shown: the shopper question with 2 adults or more, its invitation when someone else buys, allergies unless answered before. */
export function onboardingOrder(input: boolean | OnboardingOrderInput): number[] {
  const i: OnboardingOrderInput = typeof input === "boolean" ? { allergiesAnswered: input } : input
  return WEB_STEPS.filter((s) => {
    if (s === RESTRICTIONS_STEP) return !i.allergiesAnswered
    if (s === SHOPPER_STEP) return asksShopper(i.adults ?? 1)
    if (s === SHOPPER_INVITE_STEP) return asksShopper(i.adults ?? 1) && shopperInvites(i.shopper) && i.inviteOffer === true
    return true
  })
}

/** Steps that are gone, and where a draft saved on them resumes. */
const GONE_STEPS: Record<number, number> = { 2: 3, 6: RESTRICTIONS_STEP }

/**
 * PRO-178: the step to resume on. Allergies are never in the draft (health
 * data, only stored with the consent at the end), so a sign-up left on the
 * last question resumes on «¿Hay algo que no comas?» instead of skipping it.
 * A draft saved on a step that is gone resumes on the next one; one saved on
 * the invitation resumes on «¿Quién hace la compra?» (the invitation is
 * offered once, PRO-261).
 */
export function resumeStep(draft: (Pick<OnboardingDraft, "step"> & { adults?: number }) | null): number {
  if (!draft) return 1
  if (draft.step === SHOPPER_STEP || draft.step === SHOPPER_INVITE_STEP) return asksShopper(draft.adults ?? 2) ? SHOPPER_STEP : 3
  if ((WEB_STEPS as readonly number[]).includes(draft.step)) return draft.step
  return GONE_STEPS[draft.step] ?? RESTRICTIONS_STEP
}
