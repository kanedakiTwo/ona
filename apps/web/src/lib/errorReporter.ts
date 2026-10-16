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
 *   - Failed or slow API requests (PRO-143, `reportApiProblem`, called from
 *     lib/api.ts): method + route pattern + status only — never the body,
 *     query string or ids — and at most MAX_API_PROBLEM_REPORTS_PER_SESSION
 *     per browser session (sessionStorage).
 *   - ChunkLoadError (a tab older than the last deploy): reported and the
 *     page reloads once (`installChunkReload`, on even when reporting is off).
 *   - Off in development unless NEXT_PUBLIC_ERROR_REPORTING=true (or the
 *     e2e flag `window.__ONA_ERROR_REPORTING__`); NEXT_PUBLIC_ERROR_REPORTING=false
 *     switches it off everywhere.
 */
import {
  MAX_API_PROBLEM_REPORTS_PER_SESSION,
  buildApiProblemMessage,
  buildClientErrorReport,
  clientErrorDedupeKey,
  isChunkLoadError,
  isIgnorableClientError,
  shouldReloadForChunkError,
  type ApiProblem,
} from "@ona/shared"

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

/** Dedupe, cap and send one report. False when it was not sent. */
function submit(message: string, stack?: string): boolean {
  if (sent >= MAX_REPORTS_PER_PAGE) return false
  const key = clientErrorDedupeKey(message, stack)
  if (seen.has(key)) return false
  seen.add(key)
  sent += 1
  const report = buildClientErrorReport({
    message,
    stack,
    path: window.location.pathname,
    release: process.env.NEXT_PUBLIC_RELEASE,
  })
  send(JSON.stringify(report))
  return true
}

/** Report one error. Safe to call from anywhere; never throws. */
export function reportError(error: unknown): void {
  try {
    if (typeof window === "undefined" || !isErrorReportingEnabled()) return
    const e = describeError(error)
    if (isIgnorableClientError(e)) return
    submit(e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message, e.stack)
  } catch {
    // The reporter must never become the error.
  }
}

const SESSION_COUNT_KEY = "ona_api_problem_reports"
let apiProblemsInMemory = 0

/** Per-session budget for request reports; falls back to memory if storage is blocked. */
function takeApiProblemSlot(): boolean {
  try {
    const used = Number(sessionStorage.getItem(SESSION_COUNT_KEY) ?? "0") || 0
    if (used >= MAX_API_PROBLEM_REPORTS_PER_SESSION) return false
    sessionStorage.setItem(SESSION_COUNT_KEY, String(used + 1))
    return true
  } catch {
    if (apiProblemsInMemory >= MAX_API_PROBLEM_REPORTS_PER_SESSION) return false
    apiProblemsInMemory += 1
    return true
  }
}

/**
 * A web → API request that failed (status), never answered (network) or is
 * still pending after API_SLOW_MS (slow). Only the method, the route pattern
 * and the status leave the browser. Never throws.
 */
export function reportApiProblem(input: { method?: string; path: string; problem: ApiProblem; status?: number }): void {
  try {
    if (typeof window === "undefined" || !isErrorReportingEnabled()) return
    const message = buildApiProblemMessage(input)
    // Same request problem on the same page load → once, before spending the session budget.
    if (seen.has(clientErrorDedupeKey(message)) || sent >= MAX_REPORTS_PER_PAGE) return
    if (!takeApiProblemSlot()) return
    submit(message)
  } catch {
    // Never.
  }
}

const CHUNK_RELOAD_KEY = "ona_chunk_reload_at"
let chunkInstalled = false

/**
 * A ChunkLoadError means this tab runs an older build than the server: report
 * it and reload the page once (no second reload within CHUNK_RELOAD_WINDOW_MS,
 * so a chunk that is really missing can't loop). Returns true when a reload
 * was started.
 */
export function handleChunkLoadError(error: unknown): boolean {
  try {
    if (typeof window === "undefined" || !isChunkLoadError(error)) return false
    reportError(error)
    // The marker must survive the reload: with storage blocked, never reload
    // (it could loop) — the error boundary still offers «Reintentar».
    const raw = sessionStorage.getItem(CHUNK_RELOAD_KEY)
    const now = Date.now()
    if (!shouldReloadForChunkError(raw == null ? null : Number(raw), now)) return false
    sessionStorage.setItem(CHUNK_RELOAD_KEY, String(now))
    window.location.reload()
    return true
  } catch {
    return false
  }
}

/** Listen for ChunkLoadErrors (also when reporting is off). Idempotent. */
export function installChunkReload(): void {
  if (chunkInstalled || typeof window === "undefined") return
  chunkInstalled = true
  window.addEventListener("error", (event: ErrorEvent) => {
    handleChunkLoadError(event.error ?? event.message)
  })
  window.addEventListener("unhandledrejection", (event: PromiseRejectionEvent) => {
    handleChunkLoadError(event.reason)
  })
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
