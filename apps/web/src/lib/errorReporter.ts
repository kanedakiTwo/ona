/**
 * In-house error tracker, browser side (specs/errors.md). Uncaught errors,
 * unhandled promise rejections and the App Router error boundaries report
 * to `POST ${NEXT_PUBLIC_API_URL}/client-errors`; the API scrubs and groups
 * them in `app_errors`.
 *
 *   - Listeners are installed once, from the root layout.
 *   - The same error from the same place is sent once per page load, and no
 *     more than MAX_REPORTS_PER_PAGE reports per page load in total.
 *   - Only the path leaves the browser (never the query string or hash).
 *   - Anonymous visitors: `navigator.sendBeacon` (text/plain, no CORS
 *     preflight, survives page unload). Logged-in users: a keepalive fetch
 *     carrying the session token so the report is attributed — a beacon
 *     can't send headers. Either falls back to the other.
 *   - Off in development unless NEXT_PUBLIC_ERROR_REPORTING=true (or the
 *     e2e flag `window.__ONA_ERROR_REPORTING__`); NEXT_PUBLIC_ERROR_REPORTING=false
 *     switches it off everywhere.
 */
import { buildClientErrorReport, clientErrorDedupeKey, isIgnorableClientError } from "@ona/shared"

const ENDPOINT = `${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/client-errors`
const MAX_REPORTS_PER_PAGE = 10
const CONTENT_TYPE = "text/plain;charset=UTF-8"

declare global {
  interface Window {
    /** Test hook (Playwright): force reporting on under `next dev`. */
    __ONA_ERROR_REPORTING__?: boolean
  }
}

const seen = new Set<string>()
let sent = 0
let installed = false

export function isErrorReportingEnabled(): boolean {
  const flag = process.env.NEXT_PUBLIC_ERROR_REPORTING
  if (flag === "false") return false
  if (process.env.NODE_ENV === "production" || flag === "true") return true
  return typeof window !== "undefined" && window.__ONA_ERROR_REPORTING__ === true
}

function describeError(error: unknown): { name?: string; message: string; stack?: string } {
  if (error instanceof Error) return { name: error.name, message: error.message, stack: error.stack }
  if (typeof error === "string") return { message: error }
  try {
    return { message: JSON.stringify(error) ?? String(error) }
  } catch {
    return { message: String(error) }
  }
}

function sendBeacon(body: string): boolean {
  try {
    return navigator.sendBeacon?.(ENDPOINT, new Blob([body], { type: CONTENT_TYPE })) ?? false
  } catch {
    return false
  }
}

function sendFetch(body: string, token?: string): Promise<unknown> {
  const headers: Record<string, string> = { "Content-Type": CONTENT_TYPE }
  if (token) headers.Authorization = `Bearer ${token}`
  return fetch(ENDPOINT, { method: "POST", body, headers, keepalive: true })
}

function send(body: string): void {
  let token: string | null = null
  try {
    token = localStorage.getItem("ona_token")
  } catch {
    // Storage blocked (private mode, sandboxed iframe): report anonymously.
  }
  if (token) {
    sendFetch(body, token).catch(() => {
      if (!sendBeacon(body)) void sendFetch(body).catch(() => {})
    })
    return
  }
  if (!sendBeacon(body)) void sendFetch(body).catch(() => {})
}

/** Report one error. Safe to call from anywhere; never throws. */
export function reportError(error: unknown): void {
  try {
    if (typeof window === "undefined" || !isErrorReportingEnabled()) return
    if (sent >= MAX_REPORTS_PER_PAGE) return
    const e = describeError(error)
    if (isIgnorableClientError(e)) return
    const key = clientErrorDedupeKey(e.message, e.stack)
    if (seen.has(key)) return
    seen.add(key)
    sent += 1
    const report = buildClientErrorReport({
      message: e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message,
      stack: e.stack,
      path: window.location.pathname,
      release: process.env.NEXT_PUBLIC_RELEASE,
    })
    send(JSON.stringify(report))
  } catch {
    // The reporter must never become the error.
  }
}

/** Listen to uncaught errors and unhandled rejections. Idempotent. */
export function installErrorReporter(): void {
  if (installed || typeof window === "undefined" || !isErrorReportingEnabled()) return
  installed = true
  window.addEventListener("error", (event: ErrorEvent) => {
    reportError(event.error ?? event.message)
  })
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    reportError(event.reason)
  })
}
