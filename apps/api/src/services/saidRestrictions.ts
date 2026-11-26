/**
 * PRO-1041 (Seguridad) · «soy celíaca» told to Mimo, by the web chat or by
 * WhatsApp, without the health-data consent.
 *
 * The consent is still given only on the web, with its own box (PRO-21,
 * PRO-150): Mimo never stores the allergy. Two things change:
 *
 * - The menu Mimo generates applies it, for that menu only
 *   (`withMenuOnlyRestrictions`). What is applied is what Mimo passes
 *   (`restrictions_said`) plus, as a rule without the model, the allergens
 *   named in the person's own recent messages (`restrictionsSaidIn`, the same
 *   keyword rule as the fridge answer, PRO-295). Lucía, Raúl, Irene, Mohamed
 *   and Iker (2026-10-24 → 2026-10-31) got menus with their allergen and only
 *   a manual check by Mimo kept it out; once it failed (caldo de pollo).
 * - Mimo sends a link to «Tus alergias y tu dieta» with what they said
 *   already marked (`healthConsentLink`). It travels after `#`, so it never
 *   reaches a server log; the box is still unticked.
 */
import { and, desc, eq, gte } from 'drizzle-orm'
import { unionRestrictions } from '@ona/shared'
import { chatMessages, whatsappLinks, whatsappMessages } from '../db/schema.js'
import { healthConsentLink } from './healthConsent.js'
import { normalizeText, restrictionKey } from './dietaryRestrictions.js'
import { cleanRestrictions, healthMentionByKeywords } from './fridgeReader.js'

/** How far back a said allergy still counts (a household's first weeks). */
export const SAID_WINDOW_DAYS = 30
const MAX_MESSAGES = 200

/** «sin gluten» / «sin lactosa» said as a diet («hola. vejetariano. sin lactosa», 2026-10-28). */
const DIET_WORDS: Array<[RegExp, string]> = [
  [/\bsin gluten\b/, 'sin gluten'],
  [/\bsin lactosa\b/, 'sin lactosa'],
]

/**
 * Pure: the allergies and intolerances a person said in their messages
 * (stored form, presets when they are one). Conservative on purpose: a false
 * alarm costs a few dishes for one week; a miss, a reaction.
 */
export function restrictionsSaidIn(texts: readonly string[]): string[] {
  const out: string[] = []
  for (const text of texts) {
    if (!text) continue
    out.push(...(healthMentionByKeywords(text)?.restrictions ?? []))
    const n = normalizeText(text)
    for (const [re, preset] of DIET_WORDS) if (re.test(n)) out.push(preset)
  }
  return unionRestrictions(out)
}

/** Pure: `said` without what is already among the saved restrictions (same meaning counts as saved). */
export function notYetSaved(said: readonly string[], saved: readonly string[]): string[] {
  const keys = new Set(saved.map(restrictionKey))
  return unionRestrictions(said.filter((r) => !keys.has(restrictionKey(r))))
}

/**
 * The person's own messages of the last `SAID_WINDOW_DAYS` (newest first):
 * WhatsApp's inbound rows (by the linked phone: the user id is set after the
 * turn) and the earlier turns of the web chat. The current web turn is not
 * stored yet: there Mimo's `restrictions_said` covers it.
 */
export async function loadRecentUserTexts(userId: string, db: any, now = new Date()): Promise<string[]> {
  const since = new Date(now.getTime() - SAID_WINDOW_DAYS * 86_400_000)
  const [link] = await db.select({ phone: whatsappLinks.phone }).from(whatsappLinks).where(eq(whatsappLinks.userId, userId)).limit(1)
  const wa = link
    ? await db
        .select({ body: whatsappMessages.body })
        .from(whatsappMessages)
        .where(and(eq(whatsappMessages.phone, link.phone), eq(whatsappMessages.direction, 'in'), gte(whatsappMessages.createdAt, since)))
        .orderBy(desc(whatsappMessages.createdAt))
        .limit(MAX_MESSAGES)
    : []
  const web = await db
    .select({ body: chatMessages.body })
    .from(chatMessages)
    .where(and(eq(chatMessages.userId, userId), eq(chatMessages.role, 'user'), gte(chatMessages.createdAt, since)))
    .orderBy(desc(chatMessages.createdAt))
    .limit(MAX_MESSAGES)
  return [...wa, ...web].map((r: { body: string | null }) => r.body ?? '').filter(Boolean)
}

export interface SaidRestrictions {
  /** Said and not saved: applied to this menu only. */
  apply: string[]
  /** The link to save them on the web (with them marked). */
  link: string
}

/**
 * Before Mimo generates a week: the allergies said (by Mimo's `fromModel` and
 * by the person's messages) that are not among the saved ones (read only
 * when something was said). Null when there are none. A read error of the
 * messages keeps what Mimo passed; of the saved ones, applies all that was said.
 */
export async function saidRestrictionsForMenu(
  userId: string,
  db: any,
  fromModel: unknown,
  saved: () => Promise<readonly string[]>,
  load: (userId: string, db: any) => Promise<string[]> = loadRecentUserTexts,
): Promise<SaidRestrictions | null> {
  const texts = await load(userId, db).catch(() => [] as string[])
  const said = unionRestrictions(cleanRestrictions(fromModel), restrictionsSaidIn(texts))
  if (said.length === 0) return null
  const apply = notYetSaved(said, await saved().catch(() => [] as string[]))
  return apply.length > 0 ? { apply, link: healthConsentLink(apply) } : null
}

/** The line the menu tools add for Mimo when they applied said allergies. */
export function saidRestrictionsLine(said: SaidRestrictions, channel?: string): string {
  const where = channel === 'whatsapp' ? 'Por WhatsApp no se guardan datos de salud' : 'Sin su consentimiento no se guardan'
  return `Aplicado solo a este menu (no esta guardado): ${said.apply.join(', ')}. ${where}: diselo en una linea y mandale este enlace para guardarlo en la web, con su permiso (ya va marcado): ${said.link}`
}
