/**
 * Installed app and push notifications, in aggregate (PRO-83, specs/metrics.md
 * "App instalada y avisos"). Two numbers per ISO week and device for
 * GET /admin/metrics:
 *   - households that opened the installed app (`display-mode: standalone`):
 *     the web reports it at most once a day (`POST /usage/app-opened`), and
 *     the API keeps one `app_opened_installed` usage event per household and
 *     Madrid day, with `props.device` only (never the whole browser string);
 *   - households with push notifications on, from `push_subscriptions`.
 *
 * Pure builders here are unit-tested (appInstalls.test.ts); the SQL lives in
 * `loadInstallRows`, called by `loadBusinessMetrics`.
 */
import { sql } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import { weekOfDay, type Week } from './businessMetrics.js'

type Db = typeof defaultDb

export const DEVICES = ['android', 'ios', 'desktop'] as const
export type Device = (typeof DEVICES)[number]

/** Households per device; `total` counts each household once even if it uses two devices. */
export interface DeviceCounts { android: number; ios: number; desktop: number; total: number }

/** Pure: the browser's user agent → android | ios | desktop. Nothing else is kept. */
export function deviceFromUserAgent(ua: string | null | undefined): Device {
  const s = String(ua ?? '')
  if (/android/i.test(s)) return 'android'
  if (/iphone|ipad|ipod/i.test(s)) return 'ios'
  return 'desktop'
}

/**
 * Pure (PRO-307): the system of the browser a person came in with, for the households by system in
 * GET /admin/usage — android | ios | desktop, or null with no browser string (counted as
 * `unknown`). Only that word is stored (`props.device` of `screen_viewed`), never the browser string.
 * iPadOS Safari says «Macintosh» and comes out as desktop.
 */
export function systemFromUserAgent(ua: string | null | undefined): Device | null {
  return String(ua ?? '').trim() ? deviceFromUserAgent(ua) : null
}

/** Pure (PRO-307): a `screen_viewed` from the web gets `device` from its browser; any other event, as it came. */
export function withScreenDevice<E extends { name: string; props: Record<string, string | number | boolean> }>(ev: E, ua: string | null | undefined): E {
  const device = ev.name === 'screen_viewed' ? systemFromUserAgent(ua) : null
  return device ? { ...ev, props: { ...ev.props, device } } : ev
}

/** `day` = Europe/Madrid calendar date (YYYY-MM-DD) of the open / subscription. */
export interface HouseholdDeviceDay { householdId: string; day: string; device: Device }

function emptyCounts(): DeviceCounts {
  return { android: 0, ios: 0, desktop: 0, total: 0 }
}

function count(rows: HouseholdDeviceDay[]): DeviceCounts {
  const byDevice: Record<Device, Set<string>> = { android: new Set(), ios: new Set(), desktop: new Set() }
  const all = new Set<string>()
  for (const r of rows) {
    byDevice[r.device]?.add(r.householdId)
    all.add(r.householdId)
  }
  return { android: byDevice.android.size, ios: byDevice.ios.size, desktop: byDevice.desktop.size, total: all.size }
}

/**
 * Pure: households that opened the installed app, per week and device. Any
 * number of opens by the same household in a week (or a day) counts once.
 */
export function buildInstalledOpens(weeks: Week[], opens: HouseholdDeviceDay[]): Map<Week, DeviceCounts> {
  const out = new Map<Week, DeviceCounts>()
  for (const w of weeks) out.set(w, count(opens.filter((o) => weekOfDay(o.day) === w)))
  return out
}

/**
 * Pure: households with push notifications on at the end of each week — a
 * subscription that still exists today and was created on or before that
 * Sunday. Unsubscribing deletes the row, so past weeks are a lower bound.
 */
export function buildPushEnabled(weeks: Week[], subs: HouseholdDeviceDay[]): Map<Week, DeviceCounts> {
  const out = new Map<Week, DeviceCounts>()
  for (const w of weeks) out.set(w, count(subs.filter((s) => weekOfDay(s.day) <= w)))
  return out
}

export function deviceCountsFor(map: Map<Week, DeviceCounts>, week: Week): DeviceCounts {
  return map.get(week) ?? emptyCounts()
}

// ─── SQL ─────────────────────────────────────────────────────────

const TZ = 'Europe/Madrid'

/**
 * Record one installed-app open for the user's household, at most once per
 * household and Madrid day. Never throws; skipped under vitest.
 */
export async function recordInstalledOpen(userId: string, device: Device, db: Db = defaultDb): Promise<void> {
  if (process.env.VITEST) return
  try {
    await db.execute(sql`
      INSERT INTO usage_events (user_id, household_id, name, channel, props)
      SELECT u.id, u.primary_household_id, 'app_opened_installed', 'web', ${JSON.stringify({ device })}::jsonb
        FROM users u
       WHERE u.id = ${userId}::uuid
         AND NOT EXISTS (
           SELECT 1 FROM usage_events e
            WHERE e.name = 'app_opened_installed'
              AND (e.household_id = u.primary_household_id OR (u.primary_household_id IS NULL AND e.user_id = u.id))
              AND (e.created_at AT TIME ZONE ${TZ})::date = (now() AT TIME ZONE ${TZ})::date
         )
    `)
  } catch (err: any) {
    console.warn('[usage] installed open failed (ignored):', err?.message ?? err)
  }
}

/** Raw rows for the two counters, counted users only (same rule as the rest of /admin/metrics). */
export async function loadInstallRows(
  opts: { from: Date; includeInternal: boolean },
  db: Db = defaultDb,
): Promise<{ opens: HouseholdDeviceDay[]; subs: HouseholdDeviceDay[] }> {
  const counted = sql`(${opts.includeInternal}::boolean OR (u.role <> 'admin' AND u.suspended_at IS NULL))`
  const [opens, subs] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(e.household_id, u.primary_household_id)::text AS household_id,
             to_char(e.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
             e.props->>'device' AS device
        FROM usage_events e JOIN users u ON u.id = e.user_id
       WHERE e.name = 'app_opened_installed' AND e.created_at >= ${opts.from} AND ${counted}
         AND COALESCE(e.household_id, u.primary_household_id) IS NOT NULL
       GROUP BY 1, 2, 3
    `),
    db.execute(sql`
      SELECT u.primary_household_id::text AS household_id,
             to_char(p.created_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
             p.user_agent
        FROM push_subscriptions p JOIN users u ON u.id = p.user_id
       WHERE u.primary_household_id IS NOT NULL AND ${counted}
    `),
  ])
  const asDevice = (d: unknown): Device => ((DEVICES as readonly string[]).includes(String(d)) ? (d as Device) : 'desktop')
  return {
    opens: (opens.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day, device: asDevice(r.device) })),
    subs: (subs.rows as any[]).map((r) => ({ householdId: r.household_id, day: r.day, device: deviceFromUserAgent(r.user_agent) })),
  }
}
