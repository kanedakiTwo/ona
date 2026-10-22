import type { telegramLinks } from '../../db/schema.js'
import { HISTORY_WINDOW_MS, type HistoryRow } from '../whatsapp/history.js'

/**
 * Pure: the Telegram conversation kept on the link row (PRO-313), in the
 * shape `whatsapp/history.ts` reads, so `buildChatHistory` (12 h window,
 * ⟦hecho: …⟧ tool lines) serves both channels.
 */
export type TelegramHistoryEntry = (typeof telegramLinks.$inferSelect)['history'][number]

/** At most this many entries are kept (and only the last 12 h). */
export const TG_HISTORY_KEEP = 40

export function pruneHistory(entries: readonly TelegramHistoryEntry[], now: Date): TelegramHistoryEntry[] {
  const since = now.getTime() - HISTORY_WINDOW_MS
  return entries.filter((e) => new Date(e.createdAt).getTime() >= since).slice(-TG_HISTORY_KEEP)
}

export function toHistoryRows(entries: readonly TelegramHistoryEntry[]): HistoryRow[] {
  return entries.map((e) => ({ ...e, createdAt: new Date(e.createdAt) }))
}

const TRACE_FIELD_MAX = 260

/** A turn's tool trace, trimmed for storage (the history line is capped anyway). */
export function compactTrace(
  trace: ReadonlyArray<{ name: string; input?: string; summary?: string; error?: boolean }> | undefined,
): Array<{ name: string; input?: string; summary?: string; error?: boolean }> {
  return (trace ?? []).slice(0, 12).map((t) => ({
    name: t.name,
    ...(t.input ? { input: t.input.slice(0, TRACE_FIELD_MAX) } : {}),
    ...(t.summary ? { summary: t.summary.slice(0, TRACE_FIELD_MAX) } : {}),
    ...(t.error ? { error: true } : {}),
  }))
}
