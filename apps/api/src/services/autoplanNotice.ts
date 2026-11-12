/**
 * Piloto automático, paso 2 (PRO-382, D-158; specs/notifications.md «La
 * semana, hecha»): once Mimo has made next week (PRO-381,
 * `weeklyAutoplan.ts`), ONE message tells the household so.
 *
 *   - Priority 1 (`weekly_autoplan` in `NOTICE_PRIORITY`): it spends one of
 *     the week's 4 units, like any aviso (`planMoment`).
 *   - To the person the week was made for (the owner), by the first channel
 *     that gets through (`autoplanChannels`):
 *       1. WhatsApp, written from its guide (`MESSAGE_GUIDES.weekly_autoplan`):
 *          free text inside the 24 h window; outside it only with its own
 *          template (`WHATSAPP_TEMPLATES.weekly_autoplan`, `mimoia_semana_lista`
 *          once Meta approves it: MIG-23), never the generic one;
 *       2. the phone notification, if it is on;
 *       3. email (`autoplanEmail`): to whoever has neither, or when neither
 *          could carry it.
 *   - Once per household and week: `payload.noticeAt` on the week's claim row
 *     (`autoplan:<scope>:<weekStart>`), set before sending. Only between
 *     08:00 and 22:30 (Madrid) and before the week's Monday; never when the
 *     household already opened or changed that week, or replaced it.
 *
 * The reply («vale» or «cámbiame el jueves») is `noteAutoplanReply` in
 * `weeklyAutoplan.ts`, called from `whatsapp/inbound.ts`.
 */
import { and, eq, like, sql } from 'drizzle-orm'
import type { DayMenu } from '@ona/shared'
import { env } from '../config/env.js'
import { db } from '../db/connection.js'
import { menus, notificationSchedule, pushSubscriptions, users } from '../db/schema.js'
import { renderBrandEmail, sendEmail, type EmailMessage } from './email.js'
import { brandAssets } from './emailBrand.js'
import { madridParts } from './madridTime.js'
import { DAY_NAME_ES, MONTHS_ES, mealEntriesForDay, plusDays, recipesOfDay, shortWebLink, weekRangeEs } from './menuText.js'
import { fillRecipeNames } from './menuNames.js'
import { logEntriesFor, planMoment, type DeliveryResult } from './notifications/budget.js'
import { budgetKeyFor, loadFullBudgetState, recordNotices } from './notifications/budgetStore.js'
import { deliverInOrder, pushOutcome } from './notifications/channels.js'
import { isAwakeTime } from './notifications/hours.js'
import { isPushConfigured, type PushPayload } from './pushNotifier.js'
import { resolveScope, scopeWhere } from './scopeResolver.js'
import { autoplanDue } from './weeklyAutoplan.js'
import { agreementFacts } from './whatsapp/dishAgreement.js'
import { isUserAllowed, isWhatsAppConfigured } from './whatsapp/config.js'
import { guidedMeta, type GuideSpec } from './whatsapp/guided.js'
import { sendProactive, writeGuided } from './whatsapp/outbound.js'
import { chooseDelivery, parseTemplateMap, templateFor, type ChannelOutcome } from './whatsapp/proactive.js'
import { getLinkByUser } from './whatsapp/store.js'

export const AUTOPLAN_NOTICE_KIND = 'weekly_autoplan'

// ─── What the message says (pure) ──────────────────────────────────

/** Pure: the day's main dish — the lunch's first recipe, else the dinner's, else whatever the day has. */
export function mainDishOfDay(day: DayMenu | null | undefined): string | null {
  const recipe = recipesOfDay(day, ['lunch', 'dinner'])[0] ?? recipesOfDay(day)[0]
  if (recipe) return recipe.name
  return mealEntriesForDay(day)[0]?.dishes[0] ?? null
}

/** Pure: up to `max` different main dishes of the week, in day order (the ones the message names). */
export function autoplanDishes(days: readonly (DayMenu | null | undefined)[], max = 4): string[] {
  const out: string[] = []
  for (const day of days) {
    const name = mainDishOfDay(day)
    if (name && !out.includes(name)) out.push(name)
    if (out.length >= max) break
  }
  return out
}

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Pure: the 7 days, «Lunes 16» → main dish (or «Sin plan»), for the email. */
export function autoplanWeekLines(weekStart: string, days: readonly (DayMenu | null | undefined)[]): Array<{ label: string; value: string }> {
  return DAY_NAME_ES.map((name, i) => ({
    label: `${capital(name)} ${Number(plusDays(weekStart, i).slice(8, 10))}`,
    value: mainDishOfDay(days[i]) ?? 'Sin plan',
  }))
}

/** «16 de noviembre» (the subject's days). */
function dayMonthEs(isoDate: string): string {
  const [, m, d] = isoDate.split('-').map(Number)
  return `${d} de ${MONTHS_ES[m - 1]}`
}

export interface AutoplanCopyInput {
  weekStart: string
  /** 3 or 4 main dishes, by their exact name (`autoplanDishes`). */
  dishes: string[]
  webUrl: string
}

const listOf = (names: string[]) => (names.length <= 1 ? (names[0] ?? '') : `${names.slice(0, -1).join(', ')} y ${names[names.length - 1]}`)

/** Pure: the fixed text (the guide's safety net, and the template's `{{1}}` when there is no writer). */
export function autoplanFixedText(i: AutoplanCopyInput): string {
  const range = weekRangeEs(i.weekStart)
  const dishes = i.dishes.length ? ` Van, entre otros, ${listOf(i.dishes.map((d) => `*${d}*`))}.` : ''
  return [
    `Tu semana ${range} ya está hecha.${dishes} La lista de la compra también está lista.`,
    '¿Te encaja? Contesta «vale» o dime qué cambio (por ejemplo, «cámbiame el jueves»).',
    `Ver la semana: ${shortWebLink(i.webUrl, `/menu?week=${i.weekStart}`)}`,
  ].join('\n\n')
}

/** Pure: what the writer gets (D-065) and the strings the message must carry. */
export function autoplanGuide(i: AutoplanCopyInput): GuideSpec {
  const range = weekRangeEs(i.weekStart)
  const link = shortWebLink(i.webUrl, `/menu?week=${i.weekStart}`)
  return {
    kind: 'weekly_autoplan',
    facts: [
      `Semana: ${range} (ya está hecha; la ha hecho Mimo)`,
      `Algunos platos: ${i.dishes.join(' · ')}`,
      ...agreementFacts(i.dishes),
      'La lista de la compra de esa semana ya está lista.',
      'Si contesta «vale», se queda así; si pide un cambio («cámbiame el jueves»), Mimo lo cambia.',
      `Enlace a la semana: ${link}`,
    ],
    required: [range, ...i.dishes, 'vale', link],
    dishes: i.dishes,
  }
}

/** Pure: the phone notification (no links, opens the week). */
export function autoplanPushPayload(i: AutoplanCopyInput): PushPayload {
  const body = `${capital(weekRangeEs(i.weekStart))}${i.dishes.length ? `: ${i.dishes.slice(0, 3).join(', ')}…` : '.'} La lista también está lista.`
  return {
    title: 'Vuestra semana ya está hecha',
    body: body.length > 180 ? `${body.slice(0, 179)}…` : body,
    url: `/menu?week=${i.weekStart}`,
    tag: AUTOPLAN_NOTICE_KIND,
  }
}

/** Pure: «Vuestra semana del 16 al 22 de noviembre ya está hecha». */
export function autoplanEmailSubject(weekStart: string): string {
  return `Vuestra semana ${weekRangeEs(weekStart)} ya está hecha`
}

export function autoplanEmail(i: { email: string; weekStart: string; days: readonly (DayMenu | null | undefined)[]; publicUrl: string }): EmailMessage {
  const web = i.publicUrl.replace(/\/+$/, '')
  const { html, text } = renderBrandEmail({
    preheader: 'Mimo os ha dejado hecha la semana que viene y la lista de la compra.',
    eyebrow: 'Vuestra semana',
    heading: 'La semana que viene, *hecha*',
    paragraphs: [
      `Mimo os ha dejado hecha la semana del ${dayMonthEs(i.weekStart)} al ${dayMonthEs(plusDays(i.weekStart, 6))}, y la lista de la compra ya está lista.`,
      'Si algo no os encaja, cambiadlo en la web o decídselo a Mimo. Si no, no tenéis que hacer nada: la semana se queda así.',
    ],
    table: autoplanWeekLines(i.weekStart, i.days),
    button: { label: 'Ver la semana', url: `${web}/menu?week=${i.weekStart}` },
    secondButton: { label: 'Mandar la lista', url: `${web}/shopping` },
    footer: [
      'Os escribimos porque Mimo os hace la semana cada jueves.',
      `Para apagarlo: Perfil → Avisos → «La semana, hecha cada jueves» (${web}/profile/avisos), o díselo a Mimo.`,
    ],
    assets: brandAssets(web),
  })
  return { to: i.email, subject: autoplanEmailSubject(i.weekStart), html, text }
}

// ─── Which channel (pure) ──────────────────────────────────────────

export type AutoplanChannel = 'whatsapp' | 'push' | 'email'

export interface AutoplanReach {
  /** WhatsApp linked, «avisos» on, not suspended. */
  whatsapp: boolean
  /** Inside Meta's 24 h window. */
  inWindow: boolean
  /** This kind's own template (`WHATSAPP_TEMPLATES.weekly_autoplan`), or null. */
  template: string | null
  /** The phone notification is on (a subscribed device). */
  push: boolean
  /** An address to write to. */
  email: boolean
}

/**
 * Pure: the channels to try, in order; the next one only when the previous
 * didn't get through. WhatsApp inside the window, or outside it with its
 * template; then the phone notification; then email.
 */
export function autoplanChannels(r: AutoplanReach): AutoplanChannel[] {
  const out: AutoplanChannel[] = []
  if (r.whatsapp && (r.inWindow || r.template)) out.push('whatsapp')
  if (r.push) out.push('push')
  if (r.email) out.push('email')
  return out
}

// ─── The run (in the scheduler tick) ───────────────────────────────

const TEMPLATES = parseTemplateMap(env.WHATSAPP_TEMPLATES)

/** This kind's template only: the generic `WHATSAPP_TEMPLATE_NAME` never carries it. */
export function autoplanTemplate(perKind: Readonly<Record<string, string>> = TEMPLATES): string | null {
  return templateFor(AUTOPLAN_NOTICE_KIND, perKind, '')
}

/** Households per tick; the rest go in the next one. */
export const AUTOPLAN_NOTICES_PER_TICK = 30

interface NoticeRow {
  id: string
  userId: string
  payload: { menuId?: string; viewedBy?: string[]; changed?: boolean } & Record<string, unknown>
}

async function setNotice(id: string, notice: Record<string, unknown>): Promise<void> {
  await db
    .update(notificationSchedule)
    .set({ payload: sql`${notificationSchedule.payload} || ${JSON.stringify({ notice })}::jsonb` })
    .where(eq(notificationSchedule.id, id))
}

/** Claims the row: true only for the first caller (two processes never send it twice). */
async function claimNotice(id: string, now: Date): Promise<boolean> {
  const rows = await db
    .update(notificationSchedule)
    .set({ payload: sql`${notificationSchedule.payload} || ${JSON.stringify({ noticeAt: now.toISOString() })}::jsonb` })
    .where(and(eq(notificationSchedule.id, id), sql`NOT (${notificationSchedule.payload} ? 'noticeAt')`))
    .returning({ id: notificationSchedule.id })
  return rows.length > 0
}

/** The week the household sees is still the one Mimo made. */
async function stillMimosWeek(userId: string, weekStart: string, menuId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: menus.id })
    .from(menus)
    .where(and(scopeWhere(menus.userId, menus.householdId, await resolveScope(userId)), eq(menus.weekStart, weekStart)))
    .orderBy(sql`${menus.createdAt} DESC`)
    .limit(1)
  return row?.id === menuId
}

async function hasPush(userId: string): Promise<boolean> {
  if (!isPushConfigured()) return false
  const [row] = await db.select({ id: pushSubscriptions.id }).from(pushSubscriptions).where(eq(pushSubscriptions.userId, userId)).limit(1)
  return Boolean(row)
}

const emailOutcome = (r: { status: 'sent' | 'skipped' | 'failed'; error?: string }): ChannelOutcome =>
  r.status === 'sent' ? { status: 'ok' } : r.status === 'skipped' ? { status: 'skipped', error: 'email-not-configured' } : { status: 'error', error: r.error }

export interface AutoplanNoticesResult {
  weekStart: string
  sent: Record<AutoplanChannel, number>
  dropped: number
  failed: number
  skipped: number
}

/**
 * From the scheduler tick, right after `runWeeklyAutoplanIfDue`: tells each
 * household whose week Mimo made and hasn't been told yet.
 */
export async function sendAutoplanNoticesIfDue(now: Date = new Date()): Promise<AutoplanNoticesResult | null> {
  const { due, weekStart } = autoplanDue(now)
  if (!due || !isAwakeTime(madridParts(now))) return null
  const rows = (await db
    .select({ id: notificationSchedule.id, userId: notificationSchedule.userId, payload: notificationSchedule.payload })
    .from(notificationSchedule)
    .where(
      and(
        like(notificationSchedule.dedupKey, `autoplan:%:${weekStart}`),
        eq(notificationSchedule.status, 'sent'),
        sql`${notificationSchedule.payload} ? 'menuId'`,
        sql`NOT (${notificationSchedule.payload} ? 'noticeAt')`,
      ),
    )
    .limit(AUTOPLAN_NOTICES_PER_TICK)) as NoticeRow[]
  const result: AutoplanNoticesResult = { weekStart, sent: { whatsapp: 0, push: 0, email: 0 }, dropped: 0, failed: 0, skipped: 0 }
  for (const row of rows) {
    try {
      if (!(await claimNotice(row.id, now))) continue
      const outcome = await noticeOne(row, weekStart, now)
      if (outcome === 'skipped') result.skipped++
      else if (outcome === 'dropped') result.dropped++
      else if (outcome === 'failed') result.failed++
      else result.sent[outcome]++
    } catch (err: any) {
      result.failed++
      console.error(`[autoplan] notice ${row.id} failed:`, err?.message ?? err)
      await setNotice(row.id, { error: String(err?.message ?? err).slice(0, 200) }).catch(() => {})
    }
  }
  return result
}

async function noticeOne(row: NoticeRow, weekStart: string, now: Date): Promise<AutoplanChannel | 'skipped' | 'dropped' | 'failed'> {
  const menuId = row.payload.menuId!
  // Already seen or changed, or not Mimo's week anymore: nothing to tell.
  if (row.payload.changed || (row.payload.viewedBy ?? []).length > 0 || !(await stillMimosWeek(row.userId, weekStart, menuId))) {
    await setNotice(row.id, { skipped: 'ya la han visto o cambiado' })
    return 'skipped'
  }
  const [menu] = await db.select({ days: menus.days }).from(menus).where(eq(menus.id, menuId)).limit(1)
  const days = (menu ? await fillRecipeNames(menu.days as DayMenu[], db) : []) as DayMenu[]
  const copy: AutoplanCopyInput = { weekStart, dishes: autoplanDishes(days), webUrl: env.WEB_PUBLIC_URL }

  const budgetKey = await budgetKeyFor(row.userId)
  const plan = planMoment([{ kind: AUTOPLAN_NOTICE_KIND }], await loadFullBudgetState(budgetKey, now, false))
  if (plan.send.length === 0) {
    await recordNotices({ budgetKey, userId: row.userId, entries: logEntriesFor(plan, null), channel: null, now })
    await setNotice(row.id, { dropped: 'tope' })
    return 'dropped'
  }

  const link = isWhatsAppConfigured() ? await getLinkByUser(row.userId) : null
  const usable = Boolean(link && link.notify && !link.suspendedAt && isUserAllowed(link.email))
  const [u] = await db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1)
  const template = autoplanTemplate()
  const channels = autoplanChannels({
    whatsapp: usable,
    inWindow: Boolean(link) && chooseDelivery(link!.lastInboundAt, now, false) === 'session',
    template,
    push: await hasPush(row.userId),
    email: Boolean(u?.email),
  })

  const delivered = await deliverInOrder<AutoplanChannel>(channels, {
    whatsapp: async () => {
      const fixed = autoplanFixedText(copy)
      const w = await writeGuided(link!, autoplanGuide(copy), fixed, now)
      return sendProactive(link!, [{ type: 'text', text: w.text }], AUTOPLAN_NOTICE_KIND, now, { meta: guidedMeta(w) })
    },
    push: () => pushOutcome(row.userId, autoplanPushPayload(copy)),
    email: async () => emailOutcome(await sendEmail(autoplanEmail({ email: u!.email, weekStart, days, publicUrl: env.WEB_PUBLIC_URL }))),
  })
  const delivery: DeliveryResult = delivered.status === 'sent' ? 'ok' : 'error'
  await recordNotices({ budgetKey, userId: row.userId, entries: logEntriesFor(plan, delivery), channel: delivered.channel, now })
  await setNotice(row.id, delivered.channel ? { channel: delivered.channel } : { error: delivered.errorMessage ?? 'no-channel' })
  return delivered.channel ?? 'failed'
}
