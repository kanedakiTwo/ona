/**
 * PRO-387 (D-158, «camino recto»): /menu shows **one** next step at a time
 * above the menu, never a stack. `pickNextStepCard` is the only place that
 * decides which one (specs/menus.md → «Un solo paso siguiente»):
 *
 *   1. safety: no health data (NoHealthDataNotice), the «Afina tu menú»
 *      allergy notice and the account on the Gratis plan (AccountAccessNotice);
 *   2. billing: last days of the trial, founder offer, first-charge notice
 *      or pending payment (AccountAccessNotice);
 *   3. «Manda la lista a quien hace la compra», while this week's list
 *      hasn't been sent or used; before it, «Mimo os ha dejado hecha la
 *      semana» (PRO-381), whose «Ver la lista» is the same step for the
 *      week Mimo made;
 *   4. «¿Qué tal la cena de ayer?», while the household has nothing cooked;
 *   5. the rest, in their old order: the rest of the sign-up, «Afina tu
 *      menú», WhatsApp, the Sean Ellis survey.
 *
 * The «Primeros pasos» guide goes after safety: it covers the screen, so
 * nothing else shows while it is open. The price survey and the install
 * prompt are sheets: they only open when nothing above is picked.
 */
import type { BillingState } from "@ona/shared"
import { TRIAL_ENDING_NOTICE_DAYS } from "@ona/shared"

export type NextStepCard =
  | "no_health_data"
  | "afina_notice"
  | "plan_gratis"
  | "first_steps"
  | "billing"
  | "autoplan"
  | "send_list"
  | "last_night"
  | "pending_sign_up"
  | "taste_card"
  | "whatsapp_nudge"
  | "sean_ellis"
  | "price_survey"
  | "install"

/** What each candidate would show right now (each flag already means «it wants to show»). */
export interface NextStepState {
  noHealthData: boolean
  afinaNotice: boolean
  planGratis: boolean
  firstSteps: boolean
  billing: boolean
  autoplan: boolean
  sendList: boolean
  lastNight: boolean
  pendingSignUp: boolean
  tasteCard: boolean
  whatsappNudge: boolean
  seanEllis: boolean
  priceSurvey: boolean
  install: boolean
}

const ORDER: ReadonlyArray<[keyof NextStepState, NextStepCard]> = [
  ["noHealthData", "no_health_data"],
  ["afinaNotice", "afina_notice"],
  ["planGratis", "plan_gratis"],
  ["firstSteps", "first_steps"],
  ["billing", "billing"],
  ["autoplan", "autoplan"],
  ["sendList", "send_list"],
  ["lastNight", "last_night"],
  ["pendingSignUp", "pending_sign_up"],
  ["tasteCard", "taste_card"],
  ["whatsappNudge", "whatsapp_nudge"],
  ["seanEllis", "sean_ellis"],
  ["priceSurvey", "price_survey"],
  ["install", "install"],
]

/** Pure: the one card /menu shows, or null when none wants to. */
export function pickNextStepCard(state: Partial<NextStepState>): NextStepCard | null {
  for (const [flag, card] of ORDER) if (state[flag]) return card
  return null
}

/** The cards that sit in the page above the menu (the rest are overlays or sheets). */
export const INLINE_NEXT_STEP_CARDS: ReadonlySet<NextStepCard> = new Set<NextStepCard>([
  "no_health_data",
  "afina_notice",
  "plan_gratis",
  "billing",
  "autoplan",
  "send_list",
  "last_night",
  "pending_sign_up",
  "taste_card",
  "whatsapp_nudge",
  "sean_ellis",
])

/**
 * Which tier AccountAccessNotice (variant "page") is in: "gratis" (trial
 * over, PRO-385; the old paused account) is safety, "billing" any other card
 * it renders. A pending payment wins over Gratis, as in the card.
 * Mirrors its branches; a state it doesn't know (e.g. a pending payment) is
 * treated as billing, so the card is never hidden behind a later step.
 */
export function accountNoticeTier(state: BillingState | undefined | null): "gratis" | "billing" | null {
  const access = state?.access
  if (!state || !access) return null
  const status = state.subscription?.status
  if (status === "past_due" || status === "unpaid") return "billing"
  if (access.state === "gratis") return "gratis"
  if (state.subscription?.upcomingCharge) return "billing"
  if (state.founder?.offer) return "billing"
  if (access.state === "trial" && access.daysLeft !== null && access.daysLeft <= TRIAL_ENDING_NOTICE_DAYS) return "billing"
  const known: ReadonlyArray<string> = ["beta", "trial", "subscribed"]
  return known.includes(access.state) ? null : "billing"
}

/** The selector the sheets (price survey, install) check before opening. */
export const NEXT_STEP_SELECTOR = "[data-next-step]"
