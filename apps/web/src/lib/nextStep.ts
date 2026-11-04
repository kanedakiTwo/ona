/**
 * PRO-387 (D-158, «camino recto»): /menu shows **one** next step at a time
 * above the menu, never a stack. `pickNextStepCard` is the only place that
 * decides which one (specs/menus.md → «Un solo paso siguiente»):
 *
 *   1. safety: no health data (NoHealthDataNotice), the «Afina tu menú»
 *      allergy notice and the paused account (AccountAccessNotice);
 *   2. billing: last days of the trial, founder offer, first-charge notice
 *      or pending payment (AccountAccessNotice);
 *   3. «Manda la lista a quien hace la compra», while this week's list
 *      hasn't been sent or used;
 *   4. «¿Qué tal la cena de ayer?», while the household has nothing cooked;
 *   5. the rest, in their old order: «Afina tu menú», WhatsApp.
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
  | "account_paused"
  | "first_steps"
  | "billing"
  | "send_list"
  | "last_night"
  | "taste_card"
  | "whatsapp_nudge"
  | "price_survey"
  | "install"

/** What each candidate would show right now (each flag already means «it wants to show»). */
export interface NextStepState {
  noHealthData: boolean
  afinaNotice: boolean
  accountPaused: boolean
  firstSteps: boolean
  billing: boolean
  sendList: boolean
  lastNight: boolean
  tasteCard: boolean
  whatsappNudge: boolean
  priceSurvey: boolean
  install: boolean
}

const ORDER: ReadonlyArray<[keyof NextStepState, NextStepCard]> = [
  ["noHealthData", "no_health_data"],
  ["afinaNotice", "afina_notice"],
  ["accountPaused", "account_paused"],
  ["firstSteps", "first_steps"],
  ["billing", "billing"],
  ["sendList", "send_list"],
  ["lastNight", "last_night"],
  ["tasteCard", "taste_card"],
  ["whatsappNudge", "whatsapp_nudge"],
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
  "account_paused",
  "billing",
  "send_list",
  "last_night",
  "taste_card",
  "whatsapp_nudge",
])

/**
 * Which tier AccountAccessNotice (variant "page") is in: "paused" is safety
 * (the account can't make menus), "billing" any other card it renders.
 * Mirrors its branches; a state it doesn't know (e.g. a pending payment) is
 * treated as billing, so the card is never hidden behind a later step.
 */
export function accountNoticeTier(state: BillingState | undefined | null): "paused" | "billing" | null {
  const access = state?.access
  if (!state || !access) return null
  if (access.state === "paused") return "paused"
  if (state.subscription?.upcomingCharge) return "billing"
  if (state.founder?.offer) return "billing"
  if (access.state === "trial" && access.daysLeft !== null && access.daysLeft <= TRIAL_ENDING_NOTICE_DAYS) return "billing"
  const known: ReadonlyArray<string> = ["beta", "trial", "subscribed"]
  return known.includes(access.state) ? null : "billing"
}

/** The selector the sheets (price survey, install) check before opening. */
export const NEXT_STEP_SELECTOR = "[data-next-step]"
