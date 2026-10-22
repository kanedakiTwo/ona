import { and, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { telegramLinkCodes, telegramLinks } from '../../db/schema.js'
import { pruneHistory, type TelegramHistoryEntry } from './history.js'
import { generateTelegramLinkCode, TG_LINK_CODE_TTL_MS } from './linking.js'

/** DB half of Mimo on Telegram (PRO-313). */

export interface TelegramLink {
  userId: string
  chatId: string
  history: TelegramHistoryEntry[]
}

export async function getLinkByChat(chatId: string): Promise<TelegramLink | null> {
  const [row] = await db
    .select({ userId: telegramLinks.userId, chatId: telegramLinks.chatId, history: telegramLinks.history })
    .from(telegramLinks)
    .where(eq(telegramLinks.chatId, chatId))
    .limit(1)
  return row ?? null
}

export async function getLinkByUser(userId: string): Promise<{ chatId: string; linkedAt: Date } | null> {
  const [row] = await db
    .select({ chatId: telegramLinks.chatId, linkedAt: telegramLinks.linkedAt })
    .from(telegramLinks)
    .where(eq(telegramLinks.userId, userId))
    .limit(1)
  return row ?? null
}

/** New one-time code; any earlier unused code of the user stops working. */
export async function createLinkCode(userId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + TG_LINK_CODE_TTL_MS)
  await db.delete(telegramLinkCodes).where(and(eq(telegramLinkCodes.userId, userId), isNull(telegramLinkCodes.usedAt)))
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateTelegramLinkCode()
    const rows = await db
      .insert(telegramLinkCodes)
      .values({ code, userId, expiresAt })
      .onConflictDoNothing()
      .returning({ code: telegramLinkCodes.code })
    if (rows.length > 0) return { code, expiresAt }
  }
  throw new Error('No se pudo generar un código de vinculación')
}

/**
 * Use up `code` (unknown, used or expired → null) and link `chatId` to its
 * owner, one to one: the chat leaves any other account, the account's
 * previous chat is replaced, and the history starts empty.
 */
export async function consumeLinkCode(code: string, chatId: string, now: Date = new Date()): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(telegramLinkCodes)
      .set({ usedAt: now })
      .where(and(eq(telegramLinkCodes.code, code), isNull(telegramLinkCodes.usedAt), gt(telegramLinkCodes.expiresAt, now)))
      .returning({ userId: telegramLinkCodes.userId })
    if (!row) return null
    await tx.delete(telegramLinks).where(or(eq(telegramLinks.chatId, chatId), eq(telegramLinks.userId, row.userId)))
    await tx.insert(telegramLinks).values({ userId: row.userId, chatId, lastInboundAt: now })
    return { userId: row.userId }
  })
}

/**
 * Claim an update for a linked chat: false when it was already handled (a
 * retry, or an older update arriving late). Also stamps the last inbound.
 */
export async function claimUpdate(chatId: string, updateId: number, now: Date = new Date()): Promise<boolean> {
  const rows = await db
    .update(telegramLinks)
    .set({ lastUpdateId: updateId, lastInboundAt: now })
    .where(and(eq(telegramLinks.chatId, chatId), sql`(${telegramLinks.lastUpdateId} IS NULL OR ${telegramLinks.lastUpdateId} < ${updateId})`))
    .returning({ id: telegramLinks.id })
  return rows.length > 0
}

export async function appendHistory(chatId: string, entries: TelegramHistoryEntry[], now: Date = new Date()): Promise<void> {
  if (entries.length === 0) return
  // Turns of one chat run one after another (inbound queue), so read-modify-write is safe.
  const link = await getLinkByChat(chatId)
  if (!link) return
  await db
    .update(telegramLinks)
    .set({ history: pruneHistory([...(link.history ?? []), ...entries], now) })
    .where(eq(telegramLinks.chatId, chatId))
}

export async function unlink(userId: string): Promise<boolean> {
  const rows = await db.delete(telegramLinks).where(eq(telegramLinks.userId, userId)).returning({ id: telegramLinks.id })
  return rows.length > 0
}
