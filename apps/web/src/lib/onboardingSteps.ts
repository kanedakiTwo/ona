/**
 * The web sign-up's questions by step number (OnboardingFlow). Pure, so the
 * API's vitest suite tests it (onboardingHowTheyCook.test.ts).
 *
 * The numbers stay as they were because drafts (PRO-178) and the usage funnel
 * (`onboardingStepKey`) count by them: 1 household, 3 how they cook, 4 weekday
 * time, 5 allergies. 2 («¿Cuántas veces a la semana cocinas?», now read from
 * how they cook) and 6 («¿Qué quieres que Mimoia priorice?») are gone since
 * 2026-11-03 (Miguel: they overlapped).
 */
import type { OnboardingDraft } from "@ona/shared"

/** The restrictions step (allergies): 5 since PRO-217 added «¿Cómo cocináis en casa?» as step 3. */
export const RESTRICTIONS_STEP = 5

export const WEB_STEPS = [1, 3, 4, RESTRICTIONS_STEP] as const

/** The steps shown: without allergies when they were answered before the cards. */
export function onboardingOrder(allergiesAnswered: boolean): number[] {
  return allergiesAnswered ? WEB_STEPS.filter((s) => s !== RESTRICTIONS_STEP) : [...WEB_STEPS]
}

/**
 * PRO-178: the step to resume on. Allergies are never in the draft (health
 * data, only stored with the consent at the end), so a sign-up left on the
 * last question resumes on «¿Hay algo que no comas?» instead of skipping it.
 * A draft saved on a step that is gone resumes on the next one.
 */
export function resumeStep(draft: Pick<OnboardingDraft, "step"> | null): number {
  if (!draft) return 1
  return WEB_STEPS.find((s) => s >= draft.step) ?? RESTRICTIONS_STEP
}
