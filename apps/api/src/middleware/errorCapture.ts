import { AsyncLocalStorage } from 'node:async_hooks'
import type { NextFunction, Request, Response } from 'express'
import type { AuthRequest } from './auth.js'
import { normalizeRoutePath, recordAppError, serverRelease } from '../services/appErrors.js'

/**
 * API side of the in-house error tracker (specs/errors.md): every response
 * with status ≥ 500 becomes a `server` row in `app_errors`. Responses are
 * never changed — this only observes.
 *
 * Most handlers catch their own errors, `console.error` them and answer
 * `res.status(500).json(...)`, so the real error never reaches Express's
 * error middleware. To still record the real message and stack, each request
 * runs in an AsyncLocalStorage context and `console.error` (patched once at
 * boot) stashes the last Error / message logged while handling it. On
 * `finish` with a 5xx, the observer records it with the route pattern
 * (`GET /recipes/:id`), never the raw URL.
 *
 *   observeServerErrors   app-level, mounted first: context + 5xx observer
 *   captureServerErrors   error middleware, mounted just before errorHandler
 *   installConsoleErrorCapture / installProcessErrorHandlers   once, at boot
 */

interface RequestErrorContext {
  loggedError?: Error
  loggedMessage?: string
  /** `error` field of the JSON body sent with the 5xx. */
  responseError?: string
}

const requestContext = new AsyncLocalStorage<RequestErrorContext>()

/** `res.locals` flag: this response's error is already recorded (or deliberately skipped). */
const HANDLED = 'appErrorHandled'

export function errorMessageOf(err: unknown): string {
  if (err instanceof Error) return err.name && err.name !== 'Error' ? `${err.name}: ${err.message}` : err.message
  if (typeof err === 'string') return err
  try {
    return JSON.stringify(err) ?? String(err)
  } catch {
    return String(err)
  }
}

/** `GET /recipes/:id` — the matched route pattern, or a normalised path when no route matched. */
export function routeLabel(req: Request): string {
  const route = req.route?.path
  const pattern = typeof route === 'string' ? `${req.baseUrl ?? ''}${route}` : normalizeRoutePath(req.originalUrl ?? req.url ?? '/')
  return `${req.method} ${pattern || '/'}`
}

function recordServerError(req: Request, message: string, stack?: string): void {
  recordAppError({
    kind: 'server',
    message,
    stack,
    path: routeLabel(req),
    release: serverRelease(),
    userAgent: req.get('user-agent'),
    userId: (req as AuthRequest).userId,
  })
}

/** HTTP status an error carries (body-parser, serve-static, http-errors), if any. */
function statusOf(err: unknown): number | undefined {
  const s = (err as { status?: unknown; statusCode?: unknown } | null)?.status ?? (err as any)?.statusCode
  return typeof s === 'number' && s >= 400 && s < 600 ? s : undefined
}

export function observeServerErrors(req: Request, res: Response, next: NextFunction): void {
  const ctx: RequestErrorContext = {}
  const json = res.json.bind(res)
  res.json = ((body?: unknown) => {
    const error = (body as { error?: unknown } | null | undefined)?.error
    if (res.statusCode >= 500 && typeof error === 'string') ctx.responseError = error
    return json(body)
  }) as Response['json']
  res.on('finish', () => {
    if (res.statusCode < 500 || res.locals[HANDLED]) return
    const err = ctx.loggedError
    const message = err
      ? errorMessageOf(err)
      : ctx.loggedMessage ?? `HTTP ${res.statusCode}${ctx.responseError ? `: ${ctx.responseError}` : ''}`
    recordServerError(req, message, err?.stack)
  })
  requestContext.run(ctx, next)
}

/**
 * Error middleware: records errors handed to `next(err)` (or thrown
 * synchronously) and passes them on untouched to the existing errorHandler.
 * Errors that carry a 4xx status (malformed JSON, a missing static file) are
 * the client's doing, not a server bug — skipped.
 */
export function captureServerErrors(err: unknown, req: Request, res: Response, next: NextFunction): void {
  const status = statusOf(err)
  res.locals[HANDLED] = true
  if (status === undefined || status >= 500) {
    recordServerError(req, errorMessageOf(err), err instanceof Error ? err.stack : undefined)
  }
  next(err)
}

/**
 * Wrap `target.error` so a call made while handling a request stashes the
 * logged Error (or, failing that, the logged text) in the request context.
 * Output is unchanged. Returns the restore function.
 */
export function captureConsoleErrors(target: Pick<Console, 'error'> = console): () => void {
  const original = target.error
  target.error = function (this: unknown, ...args: unknown[]) {
    const ctx = requestContext.getStore()
    if (ctx) {
      const err = args.find((a): a is Error => a instanceof Error)
      if (err) ctx.loggedError = err
      else {
        const text = args.filter((a) => typeof a === 'string' || typeof a === 'number').join(' ')
        if (text) ctx.loggedMessage = text.slice(0, 2000)
      }
    }
    return original.apply(this ?? target, args)
  }
  return () => {
    target.error = original
  }
}

let consoleCaptureInstalled = false
export function installConsoleErrorCapture(): void {
  if (consoleCaptureInstalled) return
  consoleCaptureInstalled = true
  captureConsoleErrors(console)
}

/**
 * Record unhandled promise rejections (an async handler or middleware that
 * throws: Express 4 doesn't catch those). Installing a listener means the
 * process logs and keeps serving instead of crashing — the request that
 * caused it times out. No-op if something else already listens.
 */
export function installProcessErrorHandlers(proc: NodeJS.Process = process): void {
  if (proc.listenerCount('unhandledRejection') > 0) return
  proc.on('unhandledRejection', (reason) => {
    console.error('[unhandledRejection]', reason)
    recordAppError({
      kind: 'server',
      message: `Unhandled rejection: ${errorMessageOf(reason)}`,
      stack: reason instanceof Error ? reason.stack : undefined,
      release: serverRelease(),
    })
  })
}
