/**
 * Web Push dispatcher.
 *
 * Thin wrapper around the `web-push` library that:
 *   - Lazy-configures VAPID from `env` exactly once.
 *   - Sends a JSON payload to every subscription belonging to a user.
 *   - Reaps subscriptions whose endpoint comes back 404 / 410 (Gone) —
 *     those mean the browser dropped the registration on its end, and
 *     keeping the row alive just wastes future retries.
 *
 * When VAPID keys are missing from env (dev box, broken deploy) we
 * **never throw at module load**. Callers see a typed
 * `PushNotConfiguredError` so the route handler can return 503 with a
 * friendly message instead of crashing the request.
 */

import webpush from 'web-push'
import { eq } from 'drizzle-orm'
import { db } from '../db/connection.js'
import { pushSubscriptions } from '../db/schema.js'
import { env } from '../config/env.js'

export class PushNotConfiguredError extends Error {
  constructor() {
    super('Push notifications not configured (VAPID keys missing).')
    this.name = 'PushNotConfiguredError'
  }
}

let configured = false
function ensureConfigured(): void {
  if (configured) return
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    throw new PushNotConfiguredError()
  }
  webpush.setVapidDetails(env.VAPID_SUBJECT, env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY)
  configured = true
}

export function isPushConfigured(): boolean {
  return Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY)
}

export interface PushPayload {
  /** Notification title (~50 chars max for good iOS rendering). */
  title: string
  /** Body text (~120 chars max). */
  body: string
  /** Optional URL the browser opens on tap. Relative to the app origin. */
  url?: string
  /** Optional notification icon path. Defaults to /icons/icon-192.png. */
  icon?: string
  /** Optional tag — same tag replaces the prior notification (vs stacking). */
  tag?: string
}

export interface DispatchResult {
  sent: number
  failed: number
  removedDeadSubscriptions: number
}

/**
 * Send a push payload to every active subscription for a user. Best-effort:
 * partial failures are logged and reflected in the return value but never
 * throw. The caller decides whether `sent === 0` is itself an error.
 */
export async function sendPushToUser(
  userId: string,
  payload: PushPayload,
): Promise<DispatchResult> {
  ensureConfigured()

  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(eq(pushSubscriptions.userId, userId))

  let sent = 0
  let failed = 0
  let removedDeadSubscriptions = 0

  for (const sub of subs) {
    try {
      await webpush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        JSON.stringify(payload),
        { TTL: 60 * 60 * 24 }, // 24h — give the browser time to come online
      )
      sent += 1
      // Touch last-used for "last delivered" analytics; await is fine, low volume.
      await db
        .update(pushSubscriptions)
        .set({ lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, sub.id))
    } catch (err: any) {
      const status = err?.statusCode
      // 404 = endpoint URL invalid. 410 = endpoint revoked (browser cleared
      // its push registration). Either way the row is dead — reap it so we
      // don't keep trying every dispatch.
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id))
        removedDeadSubscriptions += 1
      } else {
        failed += 1
        console.warn(
          `[pushNotifier] sendNotification failed for endpoint=${sub.endpoint.slice(0, 60)}…`,
          { status, message: err?.body || err?.message },
        )
      }
    }
  }

  return { sent, failed, removedDeadSubscriptions }
}
