/**
 * 19-nov: at most one survey a week per household. A leftovers question went
 * out and then «si Mimoia dejara de existir…» right after, stuck to other
 * replies. Counts, for anyone in the household, in the last 7 days: the
 * leftovers question (PRO-285, `users.leftovers_question_at`), the Sean
 * Ellis survey asked or answered (PRO-334, `users.sean_ellis_at`) and the
 * «pregunta única» (PRO-1091, `whatsapp_question_sends`).
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'

type Db = typeof defaultDb

export const SURVEY_EVERY_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Did this person's household get a survey in the last 7 days? */
export async function surveyedThisWeek(userId: string, now: Date = new Date(), db: Db = defaultDb): Promise<boolean> {
  const since = new Date(now.getTime() - SURVEY_EVERY_DAYS * DAY_MS).toISOString()
  const res = await db.execute(sql`
    WITH hh AS (
      SELECT household_id FROM household_members WHERE user_id = ${userId}::uuid
      UNION SELECT primary_household_id FROM users WHERE id = ${userId}::uuid AND primary_household_id IS NOT NULL
    ), people AS (
      SELECT ${userId}::uuid AS user_id
      UNION SELECT hm.user_id FROM household_members hm WHERE hm.household_id IN (SELECT household_id FROM hh)
    )
    SELECT (
      EXISTS (SELECT 1 FROM users u WHERE u.id IN (SELECT user_id FROM people)
               AND (u.sean_ellis_at >= ${since}::timestamptz OR u.leftovers_question_at >= ${since}::timestamptz))
      OR EXISTS (SELECT 1 FROM whatsapp_question_sends s WHERE s.household_id IN (SELECT household_id FROM hh)
               AND s.sent_at >= ${since}::timestamptz)
    ) AS recent
  `)
  return Boolean((res.rows as any[])[0]?.recent)
}

/** The households among `householdIds` that got a survey in the last 7 days (for the «pregunta única»). */
export async function surveyedHouseholds(householdIds: readonly string[], now: Date = new Date(), db: Db = defaultDb): Promise<Set<string>> {
  if (householdIds.length === 0) return new Set()
  const since = new Date(now.getTime() - SURVEY_EVERY_DAYS * DAY_MS).toISOString()
  const ids = sql.join(householdIds.map((id) => sql`${id}::uuid`), sql`, `)
  const res = await db.execute(sql`
    SELECT DISTINCT hm.household_id::text AS id
      FROM household_members hm JOIN users u ON u.id = hm.user_id
     WHERE hm.household_id IN (${ids})
       AND (u.sean_ellis_at >= ${since}::timestamptz OR u.leftovers_question_at >= ${since}::timestamptz)
    UNION
    SELECT DISTINCT s.household_id::text FROM whatsapp_question_sends s
     WHERE s.household_id IN (${ids}) AND s.sent_at >= ${since}::timestamptz
  `)
  return new Set((res.rows as Array<{ id: string }>).map((r) => r.id))
}
