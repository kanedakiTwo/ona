/**
 * PRO-248: the avisos question («¿Quieres que también te escriba yo?») is
 * asked once, when linking or at the end of the WhatsApp sign-up. Whoever
 * didn't answer — never whoever said no — hears it one more time, in one
 * line, after their first week with a menu and the shopping list, on
 * WhatsApp or in the web chat, whichever they use first (D-051).
 *
 * «Said no» = `opt_in_declined_at` (since PRO-248) or, for older answers, an
 * inbound «No, gracias» or a BAJA in the messages.
 */
import { sql, type SQL } from 'drizzle-orm'
import { db as defaultDb } from '../../db/connection.js'
import { OPT_IN_NO } from './commands.js'

type Db = typeof defaultDb

/** Days since the first menu before the extra offer («su primera semana»). */
export const REOFFER_AFTER_DAYS = 7

/** SQL: the link aliased `wl` said no to the avisos. */
export function optInDeclinedSql(): SQL {
  return sql`(wl.opt_in_declined_at IS NOT NULL OR EXISTS (
    SELECT 1 FROM whatsapp_messages m
     WHERE m.phone = wl.phone
       AND ((m.direction = 'in' AND lower(trim(m.body)) = ${OPT_IN_NO.toLowerCase()})
         OR (m.direction = 'out' AND m.kind = 'optout'))
  ))`
}

/** The person said no («No, gracias» or BAJA): never offered again. */
export async function markOptInDeclined(userId: string, now: Date = new Date(), db: Db = defaultDb): Promise<void> {
  await db.execute(sql`UPDATE whatsapp_links SET opt_in_declined_at = ${now} WHERE user_id = ${userId} AND opt_in_declined_at IS NULL`)
}

/**
 * Atomically claims the one extra offer for `userId`: true only the first
 * time every condition holds (avisos off, asked before, no answer, a menu
 * at least `REOFFER_AFTER_DAYS` old and the shopping list opened), and it
 * records it so neither channel offers it again.
 */
export async function claimOptInReoffer(userId: string, now: Date = new Date(), db: Db = defaultDb): Promise<boolean> {
  const weekAgo = new Date(now.getTime() - REOFFER_AFTER_DAYS * 24 * 60 * 60 * 1000)
  const res = await db.execute(sql`
    UPDATE whatsapp_links wl SET opt_in_reoffered_at = ${now}
     WHERE wl.user_id = ${userId}
       AND wl.notify = false
       AND wl.opt_in_reoffered_at IS NULL
       AND NOT ${optInDeclinedSql()}
       AND EXISTS (SELECT 1 FROM whatsapp_messages p
                    WHERE p.phone = wl.phone AND p.direction = 'out' AND p.kind = 'optin_prompt')
       AND EXISTS (SELECT 1 FROM usage_events e
                    WHERE e.name = 'menu_generated' AND e.created_at <= ${weekAgo}
                      AND (e.user_id = wl.user_id OR e.household_id IN (SELECT household_id FROM household_members WHERE user_id = wl.user_id)))
       AND EXISTS (SELECT 1 FROM usage_events e
                    WHERE e.name = 'shopping_list_viewed'
                      AND (e.user_id = wl.user_id OR e.household_id IN (SELECT household_id FROM household_members WHERE user_id = wl.user_id)))
     RETURNING wl.id`)
  return (res.rows as unknown[]).length > 0
}

/**
 * The extra offer in the web chat (WhatsApp's is `COPY.optInReoffer`): one
 * line; «sí» → Mimo's set_whatsapp_notifications.
 */
export const REOFFER_WEB =
  'Por cierto: si quieres, también te escribo yo por WhatsApp, solo lo importante (un aviso antes de cocinar y la lista de la compra los sábados). Dime «sí, avísame» y lo activo; solo te lo pregunto esta vez.'

/** Pure: Mimo's web reply with the extra offer as its last line. */
export function withReofferLine(message: string): string {
  const m = (message ?? '').trimEnd()
  return m ? `${m}\n\n${REOFFER_WEB}` : REOFFER_WEB
}
