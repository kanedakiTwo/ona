import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'
import { INTERNAL_CALL_HEADER } from '../usageEvents.js'
import { CHANNEL_HEADER } from '../menuEdits.js'

/**
 * The assistant calls Mimoia's own REST API as the user — the same endpoints the
 * web UI uses. Anything the UI can do, the assistant can do with identical
 * validation, side effects (shopping list, prep alerts…) and permissions
 * (it can never do more than the user could in the app).
 *
 * Calls go over loopback with a short-lived JWT for the user.
 */

export class AppApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'AppApiError'
    this.status = status
  }
}

export type AppApi = <T = any>(method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, body?: unknown) => Promise<T>

const INTERNAL_BASE = (process.env.INTERNAL_API_URL || `http://127.0.0.1:${env.PORT}`).replace(/\/+$/, '')

/**
 * `channel` is the conversation's (web chat/voice or WhatsApp): it travels in
 * `x-mimoia-channel` so routes that keep a log of who changed what (the menu's
 * change log, services/menuEdits.ts) can tell Mimo on WhatsApp from Mimo on
 * the web.
 */
export function appApiFor(userId: string, opts: { channel?: 'web' | 'whatsapp' } = {}): AppApi {
  const channelHeader: Record<string, string> = opts.channel ? { [CHANNEL_HEADER]: opts.channel } : {}
  const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '5m' })
  return async (method, path, body) => {
    const r = await fetch(`${INTERNAL_BASE}${path}`, {
      method,
      // Marks the call as the assistant's own (or a system job's): the usage
      // middleware doesn't count it as a web action; the skill runner records
      // it with the conversation's channel instead (services/usageEvents.ts).
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', [INTERNAL_CALL_HEADER]: '1', ...channelHeader },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(90_000),
    })
    const text = await r.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    } catch {
      json = text
    }
    if (!r.ok) {
      const msg = (json && typeof json === 'object' && (json.error || json.message)) || `HTTP ${r.status}`
      throw new AppApiError(r.status, String(msg))
    }
    return json
  }
}
