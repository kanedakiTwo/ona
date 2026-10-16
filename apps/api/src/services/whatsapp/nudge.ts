/**
 * The one WhatsApp reminder (PRO-107, specs/whatsapp.md "Recordatorio"):
 * whoever didn't connect WhatsApp is offered it twice in total — in the
 * sign-up and once more, as a card on /menu after their first week is
 * resolved (a menu generated and the shopping list used). Shown once: the
 * first time the card is seen it is stamped (`users.whatsapp_nudge_at`) and
 * never comes back, «Ahora no» or not.
 */
import { eq, isNull, and, sql } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { users } from '../../db/schema.js'

export interface NudgeInput {
  /** WhatsApp configured and allowed for this account. */
  available: boolean
  linked: boolean
  nudgeAt: Date | null
  /** The household has generated a menu and opened the shopping list. */
  firstWeekResolved: boolean
}

/** Pure: show the reminder card on /menu? */
export function shouldShowWhatsAppNudge(i: NudgeInput): boolean {
  return i.available && !i.linked && i.nudgeAt == null && i.firstWeekResolved
}

export async function loadNudgeState(userId: string): Promise<{ nudgeAt: Date | null; firstWeekResolved: boolean }> {
  const res = await db.execute(sql`
    SELECT u.whatsapp_nudge_at AS nudge_at,
           (EXISTS (SELECT 1 FROM usage_events e WHERE e.household_id = u.primary_household_id AND e.name = 'menu_generated')
            AND EXISTS (SELECT 1 FROM usage_events e WHERE e.household_id = u.primary_household_id AND e.name = 'shopping_list_viewed'))
             AS resolved
      FROM users u WHERE u.id = ${userId}::uuid
  `)
  const row = (res.rows as any[])[0]
  return { nudgeAt: row?.nudge_at ? new Date(row.nudge_at) : null, firstWeekResolved: Boolean(row?.resolved) }
}

/** Stamp the card as shown (idempotent: keeps the first date). */
export async function markNudgeShown(userId: string, now = new Date()): Promise<void> {
  await db.update(users).set({ whatsappNudgeAt: now }).where(and(eq(users.id, userId), isNull(users.whatsappNudgeAt)))
}
