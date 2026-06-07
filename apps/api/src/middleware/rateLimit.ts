import type { Request, Response, NextFunction } from 'express'

/**
 * Tiny dependency-free fixed-window rate limiter.
 *
 * Why home-grown instead of `express-rate-limit`: this repo's deploy target
 * is a single small Railway instance and we don't want to add a dependency
 * (or a Redis store) for what amounts to anti-spam / anti-brute-force on the
 * two auth endpoints. The window is per-process and in-memory, so the limit
 * is approximate across restarts and across multiple instances — that's an
 * accepted trade-off for the current single-instance scale.
 *
 * The counting logic is extracted into a pure `FixedWindowCounter` so it can
 * be unit-tested with an injectable clock without spinning up Express.
 */

export interface RateLimitDecision {
  /** True when this hit is allowed (under the limit). */
  allowed: boolean
  /** Hits remaining in the current window after this one (never negative). */
  remaining: number
  /** Epoch ms when the current window resets. */
  resetAt: number
}

interface Bucket {
  count: number
  resetAt: number
}

/**
 * Fixed-window counter. Each key gets `max` hits per `windowMs`; the window
 * starts on the first hit and resets `windowMs` later. Expired buckets are
 * pruned lazily on access plus periodically via `prune()`.
 */
export class FixedWindowCounter {
  private buckets = new Map<string, Bucket>()

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  /** Record a hit for `key` at time `now` and report whether it's allowed. */
  hit(key: string, now: number): RateLimitDecision {
    const existing = this.buckets.get(key)
    if (!existing || now >= existing.resetAt) {
      const resetAt = now + this.windowMs
      this.buckets.set(key, { count: 1, resetAt })
      return { allowed: true, remaining: this.max - 1, resetAt }
    }
    existing.count += 1
    const allowed = existing.count <= this.max
    return {
      allowed,
      remaining: Math.max(0, this.max - existing.count),
      resetAt: existing.resetAt,
    }
  }

  /** Drop buckets whose window has elapsed. Cheap O(n) sweep. */
  prune(now: number): void {
    for (const [key, b] of this.buckets) {
      if (now >= b.resetAt) this.buckets.delete(key)
    }
  }

  /** Test/diagnostic helper. */
  size(): number {
    return this.buckets.size
  }
}

interface RateLimitOptions {
  /** Max requests allowed per window, per key. */
  max: number
  /** Window length in milliseconds. */
  windowMs: number
  /** Spanish message returned on 429. */
  message?: string
  /** Key extractor; defaults to the client IP. */
  keyFn?: (req: Request) => string
}

/**
 * Build an Express middleware enforcing a per-key fixed window. Returns 429
 * with a `Retry-After` header (seconds) when the limit is exceeded.
 *
 * Keying defaults to `req.ip`, which requires `app.set('trust proxy', …)` to
 * be configured so the real client IP is read from `X-Forwarded-For` behind
 * Railway's edge proxy (otherwise every request shares the proxy's IP and the
 * whole world gets rate-limited as one bucket).
 */
export function rateLimit(opts: RateLimitOptions) {
  const counter = new FixedWindowCounter(opts.max, opts.windowMs)
  const message =
    opts.message ?? 'Demasiadas peticiones. Espera un momento e inténtalo de nuevo.'
  const keyFn = opts.keyFn ?? ((req: Request) => req.ip ?? 'unknown')

  // Periodic prune so a flood of unique keys can't grow the map unbounded
  // between requests. Unref so it never holds the process open in tests.
  const timer = setInterval(() => counter.prune(Date.now()), opts.windowMs)
  if (typeof timer.unref === 'function') timer.unref()

  return function rateLimitMiddleware(req: Request, res: Response, next: NextFunction): void {
    const now = Date.now()
    const decision = counter.hit(keyFn(req), now)
    res.setHeader('X-RateLimit-Limit', String(opts.max))
    res.setHeader('X-RateLimit-Remaining', String(decision.remaining))
    if (!decision.allowed) {
      const retryAfterSec = Math.max(1, Math.ceil((decision.resetAt - now) / 1000))
      res.setHeader('Retry-After', String(retryAfterSec))
      res.status(429).json({ error: message, code: 'RATE_LIMITED' })
      return
    }
    next()
  }
}
