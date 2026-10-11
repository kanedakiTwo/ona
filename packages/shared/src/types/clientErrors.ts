import { z } from 'zod'

/**
 * In-house error tracker (specs/errors.md): the report the web client sends
 * to `POST /client-errors`. Shared so the reporter (apps/web/src/lib/
 * errorReporter.ts) and the API validate the very same shape — the contract
 * test (apps/api/src/tests/clientErrorReport.test.ts) runs the builder's
 * output through the schema and the body-size cap.
 *
 * The client sends raw-ish data; the API does the privacy work (scrubbing,
 * normalising, capping) before anything is stored.
 */

export const CLIENT_ERROR_LIMITS = {
  /** Hard cap on the request body; the API answers 413 above it. */
  maxBodyBytes: 8 * 1024,
  /** What the builder sends at most, per field. */
  message: 1000,
  stack: 4000,
  path: 300,
  release: 64,
} as const

/** What `POST /client-errors` accepts (unknown keys are dropped). */
export const clientErrorReportSchema = z.object({
  kind: z.literal('client'),
  message: z.string().trim().min(1).max(4000),
  stack: z.string().max(8000).optional(),
  path: z.string().max(2048).optional(),
  release: z.string().max(100).optional(),
})

export type ClientErrorReport = z.infer<typeof clientErrorReportSchema>

export interface ClientErrorInput {
  message?: unknown
  stack?: unknown
  /** Page path; anything after `?` or `#` is dropped here, before it leaves the browser. */
  path?: unknown
  release?: unknown
}

const byteLength = (s: string) => new TextEncoder().encode(s).length

const text = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined
  const t = v.trim()
  return t ? t.slice(0, max) : undefined
}

/**
 * Build the report body. Always valid against `clientErrorReportSchema` and
 * always within `maxBodyBytes` once JSON-encoded — multi-byte text and
 * escaped newlines can blow past the per-field caps, so the stack (then the
 * message) is halved until it fits.
 */
export function buildClientErrorReport(input: ClientErrorInput): ClientErrorReport {
  const path = typeof input.path === 'string' ? input.path.split(/[?#]/)[0] : undefined
  const report: ClientErrorReport = {
    kind: 'client',
    message: text(input.message, CLIENT_ERROR_LIMITS.message) ?? 'Error sin mensaje',
  }
  const stack = text(input.stack, CLIENT_ERROR_LIMITS.stack)
  if (stack) report.stack = stack
  const cleanPath = text(path, CLIENT_ERROR_LIMITS.path)
  if (cleanPath) report.path = cleanPath
  const release = text(input.release, CLIENT_ERROR_LIMITS.release)
  if (release) report.release = release

  while (byteLength(JSON.stringify(report)) > CLIENT_ERROR_LIMITS.maxBodyBytes) {
    if (report.stack) {
      const half = report.stack.slice(0, Math.floor(report.stack.length / 2))
      if (half) report.stack = half
      else delete report.stack
    } else {
      report.message = report.message.slice(0, Math.floor(report.message.length / 2)) || 'Error sin mensaje'
    }
  }
  return report
}

/** First stack frame line (V8 `at …` or Firefox/Safari `fn@url:line:col`), or ''. */
function firstFrame(stack: string | undefined): string {
  if (!stack) return ''
  for (const line of stack.split('\n')) {
    const t = line.trim()
    if (/^at\s/.test(t) || /@.*:\d+(?::\d+)?$/.test(t)) return t
  }
  return ''
}

/** In-page dedupe key: the same error from the same place is reported once per page load. */
export function clientErrorDedupeKey(message: string, stack?: string): string {
  return `${message.slice(0, 300)}\n${firstFrame(stack)}`
}

/**
 * Browser noise that says nothing about Mimoia: benign ResizeObserver warnings,
 * opaque cross-origin "Script error.", errors thrown by browser extensions,
 * and aborted fetches (navigation / query cancellation).
 */
export function isIgnorableClientError(e: { name?: string; message?: string; stack?: string }): boolean {
  const message = e.message ?? ''
  if (e.name === 'AbortError') return true
  if (/^ResizeObserver loop/.test(message)) return true
  if (/^Script error\.?$/.test(message.trim())) return true
  return /(chrome|moz|safari(-web)?)-extension:\/\//.test(`${message}\n${e.stack ?? ''}`)
}
