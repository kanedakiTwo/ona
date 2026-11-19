/**
 * Messages sent one after another are ONE turn (Miguel, 19-nov). In the
 * sign-ups, a household sent «2 adultos» and «Casi a diario» in a row and
 * Mimo asked again; another's «No» answered another question. Now the plain
 * texts that arrive from the same number within `windowMs` of the previous
 * one (5 s) are processed together, in order, as one message to Mimo.
 *
 * Only plain texts wait and join. A control word (BAJA, ALTA, «humano»), a
 * link code, a tapped button, a photo, a voice note or a document is never
 * joined: it first lets the texts waiting before it go (as their own turn)
 * and then goes alone, so the order is kept. A burst is capped at `maxMs`
 * (20 s) from its first text.
 *
 * In process, like the per-phone queue: Railway runs one API instance, and
 * each message is already stored (unique wamid, so Meta's retries are
 * dropped) before it reaches here. The texts that join a turn are marked
 * `ignored` with `merged` (history reads the joined text from the turn's
 * own row, the last one).
 */
import type { InboundMessage } from './webhookParser.js'
import { controlCommand } from './commands.js'
import { isLinkAttempt } from './linking.js'

/** Silence after the last text before the burst is answered. */
export const COALESCE_WINDOW_MS = 5_000
/** A burst never waits longer than this from its first text. */
export const COALESCE_MAX_MS = 20_000

/** Pure: may this message wait and join the texts around it? */
export function joinable(msg: InboundMessage): boolean {
  if (msg.kind !== 'text') return false
  const text = msg.text?.trim() ?? ''
  if (!text) return false
  return controlCommand(text) === null && !isLinkAttempt(text)
}

/** Pure: one message out of a burst of texts (oldest first): the last one's ids, the texts in order. */
export function joinTexts(burst: readonly InboundMessage[]): InboundMessage {
  const last = burst[burst.length - 1]
  if (burst.length === 1) return last
  return { ...last, text: burst.map((m) => m.text?.trim() ?? '').filter(Boolean).join('\n') }
}

export interface Coalescer {
  /** Hand a stored inbound message over; resolves once the turn it went into is done. */
  push(msg: InboundMessage): Promise<void>
}

/**
 * `run(turn, absorbed)`: one turn — a joined text (with the wamids of the
 * texts it absorbed) or a message alone. `onWait`: a text started waiting
 * (shows «escribiendo…» right away). `windowMs` 0 = no waiting (tests).
 */
export function createCoalescer(opts: {
  run: (turn: InboundMessage, absorbed: string[]) => Promise<void>
  onWait?: (msg: InboundMessage) => void
  windowMs?: number
  maxMs?: number
}): Coalescer {
  const windowMs = opts.windowMs ?? COALESCE_WINDOW_MS
  const maxMs = opts.maxMs ?? COALESCE_MAX_MS
  type Burst = { msgs: InboundMessage[]; first: number; timer: ReturnType<typeof setTimeout> | null; waiters: Array<() => void> }
  const bursts = new Map<string, Burst>()

  const flush = (phone: string) => {
    const b = bursts.get(phone)
    if (!b) return
    bursts.delete(phone)
    if (b.timer) clearTimeout(b.timer)
    const done = opts.run(joinTexts(b.msgs), b.msgs.slice(0, -1).map((m) => m.wamid))
    for (const w of b.waiters) void done.then(w, w)
  }

  return {
    push(msg) {
      if (!joinable(msg) || windowMs <= 0) {
        flush(msg.from)
        return opts.run(msg, [])
      }
      const now = Date.now()
      const b: Burst = bursts.get(msg.from) ?? { msgs: [], first: now, timer: null, waiters: [] }
      b.msgs.push(msg)
      bursts.set(msg.from, b)
      opts.onWait?.(msg)
      if (b.timer) clearTimeout(b.timer)
      const wait = Math.max(0, Math.min(windowMs, b.first + maxMs - now))
      b.timer = setTimeout(() => flush(msg.from), wait)
      return new Promise<void>((resolve) => b.waiters.push(resolve))
    },
  }
}
