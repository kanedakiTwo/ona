import { sql } from 'drizzle-orm'
import { env } from '../../config/env.js'
import { db as defaultDb } from '../../db/connection.js'
import { madridMidnightUtc, madridParts } from '../madridTime.js'

/**
 * Daily voice (OpenAI Realtime) minutes per user, read from the cost ledger:
 * every `POST /realtime/:userId/usage` records a `voice_realtime` cost event
 * with `units.minutes`. Until 2026-10-07 this lived in a process-local Map,
 * which every deploy reset. The day is the Madrid day.
 *
 * Known limit: minutes are what the browser reports when a session ends
 * (the audio runs browser ↔ OpenAI over WebRTC); a client that never reports
 * isn't counted here. The monthly € cap (spendCap.ts) and OpenAI's own
 * session limits are the backstop.
 */
export async function usedMinutesToday(userId: string, now: Date = new Date(), db: any = defaultDb): Promise<number> {
  const since = madridMidnightUtc(madridParts(now).isoDate)
  const res = await db.execute(sql`
    SELECT COALESCE(SUM((units->>'minutes')::float), 0) AS minutes
      FROM cost_events
     WHERE user_id = ${userId}::uuid AND feature = 'voice_realtime' AND created_at >= ${since}
  `)
  return Number((res.rows[0] as { minutes?: string | number } | undefined)?.minutes ?? 0)
}

export async function checkQuota(
  userId: string,
  opts: { now?: Date; db?: any; limitMinutes?: number } = {},
): Promise<{ ok: true } | { ok: false; usedMinutes: number; limitMinutes: number }> {
  const limitMinutes = opts.limitMinutes ?? env.REALTIME_DAILY_MINUTES_PER_USER
  const usedMinutes = await usedMinutesToday(userId, opts.now, opts.db)
  if (usedMinutes >= limitMinutes) return { ok: false, usedMinutes: Math.round(usedMinutes), limitMinutes }
  return { ok: true }
}
