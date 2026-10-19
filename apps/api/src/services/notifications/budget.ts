/**
 * Weekly budget of the messages Mimo sends by itself (PRO-215, D-069;
 * specs/notifications.md → «Tope semanal de avisos»).
 *
 * Pure rules only (the DB side is `budgetStore.ts`), so every decision is
 * unit-tested (`noticeBudget.test.ts`):
 *   - each kind of aviso has a priority (`noticePriority`);
 *   - some kinds never spend budget (`countsAgainstBudget`): what the person
 *     asked for, replies, account and billing notices;
 *   - per household and ISO week (Europe/Madrid) at most
 *     `WEEKLY_NOTICE_BUDGET` messages; no daily cap;
 *   - it counts messages, not topics: the avisos of the same moment go out
 *     together and spend one (`planMoment`);
 *   - priority 1 has room reserved: with the week's menu made, the priority-1
 *     avisos already known are kept a seat, and priority 2–4 only spend what
 *     is left.
 *
 * Callers: `notificationScheduler.ts` (prep alerts, push + WhatsApp) and
 * `whatsapp/outbound.ts` (`runProactiveTick`). New kinds only need a line in
 * `NOTICE_PRIORITY` (or `BUDGET_EXEMPT_KINDS`).
 */

/** Messages per household and ISO week. Miguel, 2026-10-18 (D-069): start at 4. */
export const WEEKLY_NOTICE_BUDGET = 4

/**
 * 1 = no fix if forgotten (defrost, soak, temper, start cooking);
 * 2 = food that goes off (expiry dates, leftovers, freezer);
 * 3 = helps to plan (Sunday, shopping, questions before planning);
 * 4 = everything else.
 */
export type NoticePriority = 1 | 2 | 3 | 4

/**
 * Kind → priority. Kinds are the WhatsApp `prefs` keys (`PROACTIVE_KINDS`)
 * plus `prep_alerts` for the `notification_schedule` queue. Unknown kinds
 * are priority 4.
 */
export const NOTICE_PRIORITY: Readonly<Record<string, NoticePriority>> = {
  prep_alerts: 1,
  cooking_reminder: 1,
  // 2: caducidades, sobras, congelador (no proactive kind yet).
  shopping_reminder: 3,
  weekly_nudge: 3,
  dinner_checkin: 4,
  daily_brief: 4,
  family_invite: 4,
}

/**
 * Never spend budget: the morning brief (only sent to whoever asked for it),
 * replies to the person, account emails, the billing notices decided in
 * D-056 (day-7 offer, 15-day notice) and the admins' daily review.
 */
export const BUDGET_EXEMPT_KINDS: ReadonlySet<string> = new Set([
  'daily_brief',
  'reply',
  'founder_offer',
  'charge_notice',
  'paused',
  'review',
])

export function noticePriority(kind: string): NoticePriority {
  return NOTICE_PRIORITY[kind] ?? 4
}

export function countsAgainstBudget(kind: string): boolean {
  return !BUDGET_EXEMPT_KINDS.has(kind)
}

/** What happened to each candidate aviso (logged for PRO-216). */
export type NoticeOutcome = 'enviado' | 'fusionado' | 'descartado_tope' | 'fuera_ventana' | 'fallido'

export interface NoticeCandidate {
  kind: string
}

export interface BudgetState {
  /** Weekly budget (normally `WEEKLY_NOTICE_BUDGET`). */
  budget: number
  /** Counted messages already sent this ISO week to the household. */
  used: number
  /**
   * Priority-1 moments still to come this week that are already known
   * (pending prep alerts, long dinners in this week's menu), not counting
   * the current moment.
   */
  reservedP1: number
  /**
   * Another message of this same moment (same scheduler tick) already spent
   * the household's budget: whatever goes out now rides on it.
   */
  momentAlreadyCounted?: boolean
}

export interface MomentPlan<C extends NoticeCandidate> {
  /** What goes out now, in one message, highest priority first. */
  send: C[]
  /** Dropped by the budget (`descartado_tope`). */
  dropped: C[]
  /** Whether the message spends one unit of the weekly budget. */
  counts: boolean
}

const byPriority = <C extends NoticeCandidate>(a: C, b: C) => noticePriority(a.kind) - noticePriority(b.kind)

/**
 * Pure: which of the avisos of one moment (one household, one tick) go out.
 * - Exempt kinds always go.
 * - With a priority-1 aviso among them: they go while the budget has room.
 * - Only priority 2–4: they go if there is room after the priority-1 reserve.
 * - All the counted ones that go spend one message together.
 */
export function planMoment<C extends NoticeCandidate>(candidates: readonly C[], state: BudgetState): MomentPlan<C> {
  const exempt = candidates.filter((c) => !countsAgainstBudget(c.kind))
  const paid = candidates.filter((c) => countsAgainstBudget(c.kind))
  if (paid.length === 0) return { send: [...exempt].sort(byPriority), dropped: [], counts: false }
  const remaining = state.budget - state.used
  const hasP1 = paid.some((c) => noticePriority(c.kind) === 1)
  const allowed =
    Boolean(state.momentAlreadyCounted) || (hasP1 ? remaining >= 1 : remaining - Math.max(0, state.reservedP1) >= 1)
  if (!allowed) return { send: [...exempt].sort(byPriority), dropped: [...paid].sort(byPriority), counts: false }
  return { send: [...candidates].sort(byPriority), dropped: [], counts: !state.momentAlreadyCounted }
}

/** How the merged message went out on its channel. */
export type DeliveryResult = 'ok' | 'outside-window' | 'error'

export interface NoticeLogEntry {
  kind: string
  priority: NoticePriority
  outcome: NoticeOutcome
  /** This row is the one that spent a unit of the weekly budget. */
  counted: boolean
}

/**
 * Pure: the log rows of one moment. The first aviso sent is `enviado` (and
 * carries the budget unit when it counts), the rest `fusionado`; dropped
 * ones `descartado_tope`; when the merged message couldn't go out, all of
 * them `fuera_ventana` (Meta's 24 h window, no template) or `fallido`.
 */
export function logEntriesFor<C extends NoticeCandidate>(plan: MomentPlan<C>, delivery: DeliveryResult | null): NoticeLogEntry[] {
  const out: NoticeLogEntry[] = []
  plan.send.forEach((c, i) => {
    const outcome: NoticeOutcome =
      delivery === 'outside-window' ? 'fuera_ventana' : delivery === 'error' ? 'fallido' : i === 0 ? 'enviado' : 'fusionado'
    out.push({ kind: c.kind, priority: noticePriority(c.kind), outcome, counted: outcome === 'enviado' && plan.counts })
  })
  for (const c of plan.dropped) out.push({ kind: c.kind, priority: noticePriority(c.kind), outcome: 'descartado_tope', counted: false })
  return out
}

/** Avisos less than this apart are one moment (the scheduler ticks every 5 min). */
export const MOMENT_MS = 5 * 60 * 1000

/**
 * Pure: how many priority-1 moments are still to come this week, from the
 * times already known (pending prep alerts, cooking reminders of the week's
 * long dinners). Times after `now` and before `weekEnd`; times within
 * `MOMENT_MS` of each other are one moment (one message).
 */
export function upcomingMoments(times: readonly Date[], now: Date, weekEnd: Date): number {
  const future = times
    .map((t) => t.getTime())
    .filter((t) => t > now.getTime() + MOMENT_MS && t < weekEnd.getTime())
    .sort((a, b) => a - b)
  let count = 0
  let last = -Infinity
  for (const t of future) {
    if (t - last >= MOMENT_MS) {
      count += 1
      last = t
    }
  }
  return count
}
