import jwt from 'jsonwebtoken'
import { env } from '../../config/env.js'

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

export function appApiFor(userId: string): AppApi {
  const token = jwt.sign({ userId }, env.JWT_SECRET, { expiresIn: '5m' })
  return async (method, path, body) => {
    const r = await fetch(`${INTERNAL_BASE}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
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
