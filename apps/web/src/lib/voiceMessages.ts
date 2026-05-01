import type { RealtimeTurn } from '@/hooks/useRealtimeSession'

const buffer: RealtimeTurn[] = []
const listeners = new Set<() => void>()

export function appendVoiceTurns(turns: RealtimeTurn[]) {
  if (turns.length === 0) return
  buffer.push(...turns)
  listeners.forEach(fn => fn())
}

export function consumeVoiceTurns(): RealtimeTurn[] {
  const out = buffer.splice(0, buffer.length)
  return out
}

export function subscribeVoiceTurns(fn: () => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

export function hasPendingVoiceTurns(): boolean {
  return buffer.length > 0
}
