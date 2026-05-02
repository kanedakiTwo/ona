/**
 * Tiny pub/sub bus that lets the assistant drive the cooking-mode UI from
 * outside the React tree (the cooking shell keeps step + timer state
 * locally for performance; this bridges the gap).
 *
 * Producers: voice mode (`useRealtimeSession` tool dispatcher) and the
 * text chat (`AdvisorChat`) when an assistant reply carries a
 * `uiHint: 'cooking_*'`.
 *
 * Consumer: `CookingShell` subscribes on mount, unsubscribes on unmount.
 * If no shell is mounted (i.e. user not in `/recipes/:id/cook`), commands
 * are silently dropped — the assistant still spoke the confirmation, so
 * no further UX is needed.
 */

export type CookingCommand =
  | { type: 'timer.start'; minutes: number; label?: string | null; stepIndex?: number }
  | { type: 'step.advance'; direction: 'next' | 'previous' | 'repeat' }

type Listener = (cmd: CookingCommand) => void

const listeners = new Set<Listener>()

export function emitCookingCommand(cmd: CookingCommand): void {
  for (const fn of listeners) {
    try { fn(cmd) } catch (err) { console.warn('[cookingCommands] listener error', err) }
  }
}

export function subscribeCookingCommands(fn: Listener): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
