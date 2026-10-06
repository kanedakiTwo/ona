import { and, desc, eq, gt, gte, isNull, or, inArray } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { users, whatsappLinkCodes, whatsappLinks, whatsappMessages } from '../../db/schema.js'
import type { InboundMessage } from './webhookParser.js'
import type { HistoryRow } from './history.js'
import { generateLinkCode, LINK_CODE_TTL_MS } from './linking.js'

/** DB access for the WhatsApp channel. Kept behind one object so `inbound.ts` can take a fake. */

export interface LinkWithUser {
  userId: string
  phone: string
  notify: boolean
  lastInboundAt: Date | null
  email: string
  username: string
  suspendedAt: Date | null
}

const linkWithUserColumns = {
  userId: whatsappLinks.userId,
  phone: whatsappLinks.phone,
  notify: whatsappLinks.notify,
  lastInboundAt: whatsappLinks.lastInboundAt,
  email: users.email,
  username: users.username,
  suspendedAt: users.suspendedAt,
}

export async function getLinkByPhone(phone: string): Promise<LinkWithUser | null> {
  const [row] = await db
    .select(linkWithUserColumns)
    .from(whatsappLinks)
    .innerJoin(users, eq(users.id, whatsappLinks.userId))
    .where(eq(whatsappLinks.phone, phone))
    .limit(1)
  return row ?? null
}

export async function getLinkByUser(userId: string): Promise<LinkWithUser | null> {
  const [row] = await db
    .select(linkWithUserColumns)
    .from(whatsappLinks)
    .innerJoin(users, eq(users.id, whatsappLinks.userId))
    .where(eq(whatsappLinks.userId, userId))
    .limit(1)
  return row ?? null
}

/** Every linked user who opted into proactive messages. */
export async function listNotifiableLinks(): Promise<LinkWithUser[]> {
  return db
    .select(linkWithUserColumns)
    .from(whatsappLinks)
    .innerJoin(users, eq(users.id, whatsappLinks.userId))
    .where(and(eq(whatsappLinks.notify, true), isNull(users.suspendedAt)))
}

export async function touchInbound(phone: string, at: Date): Promise<void> {
  await db.update(whatsappLinks).set({ lastInboundAt: at }).where(eq(whatsappLinks.phone, phone))
}

/** Returns false when Meta re-delivered a message we already have (dedupe). */
export async function insertInbound(msg: InboundMessage, body: string | null): Promise<boolean> {
  const rows = await db
    .insert(whatsappMessages)
    .values({
      wamid: msg.wamid,
      phone: msg.from,
      direction: 'in',
      kind: msg.kind,
      body,
      status: 'received',
    })
    .onConflictDoNothing({ target: whatsappMessages.wamid })
    .returning({ id: whatsappMessages.id })
  return rows.length > 0
}

export async function updateInbound(
  wamid: string,
  patch: { status: string; body?: string | null; userId?: string | null; errorMessage?: string | null },
): Promise<void> {
  await db.update(whatsappMessages).set(patch).where(eq(whatsappMessages.wamid, wamid))
}

export async function insertOutbound(row: {
  phone: string
  userId: string | null
  kind: string
  body: string
  status: 'sent' | 'failed'
  wamid?: string | null
  errorMessage?: string | null
}): Promise<void> {
  await db.insert(whatsappMessages).values({
    wamid: row.wamid ?? null,
    phone: row.phone,
    userId: row.userId,
    direction: 'out',
    kind: row.kind,
    body: row.body,
    status: row.status,
    errorMessage: row.errorMessage ?? null,
  })
}

export async function loadHistoryRows(phone: string, since: Date): Promise<HistoryRow[]> {
  const rows = await db
    .select({
      direction: whatsappMessages.direction,
      kind: whatsappMessages.kind,
      body: whatsappMessages.body,
      status: whatsappMessages.status,
      createdAt: whatsappMessages.createdAt,
    })
    .from(whatsappMessages)
    .where(and(eq(whatsappMessages.phone, phone), gte(whatsappMessages.createdAt, since)))
    .orderBy(desc(whatsappMessages.createdAt))
    .limit(60)
  return rows.reverse()
}

export async function hasRecentOutbound(phone: string, kinds: string[], since: Date): Promise<boolean> {
  const [row] = await db
    .select({ id: whatsappMessages.id })
    .from(whatsappMessages)
    .where(
      and(
        eq(whatsappMessages.phone, phone),
        eq(whatsappMessages.direction, 'out'),
        inArray(whatsappMessages.kind, kinds),
        gt(whatsappMessages.createdAt, since),
      ),
    )
    .limit(1)
  return Boolean(row)
}

/** New one-time code; any earlier unused code for the user stops working. */
export async function createLinkCode(userId: string, now: Date = new Date()): Promise<{ code: string; expiresAt: Date }> {
  const expiresAt = new Date(now.getTime() + LINK_CODE_TTL_MS)
  await db
    .delete(whatsappLinkCodes)
    .where(and(eq(whatsappLinkCodes.userId, userId), isNull(whatsappLinkCodes.usedAt)))
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateLinkCode()
    const rows = await db
      .insert(whatsappLinkCodes)
      .values({ code, userId, expiresAt })
      .onConflictDoNothing()
      .returning({ code: whatsappLinkCodes.code })
    if (rows.length > 0) return { code, expiresAt }
  }
  throw new Error('No se pudo generar un código de vinculación')
}

/**
 * Consume a code sent from `phone` and link it to the code's owner. A phone
 * already linked to someone else moves to the new user; a user re-linking
 * replaces their previous phone. Returns null for unknown/used/expired codes.
 */
export async function consumeLinkCode(
  code: string,
  phone: string,
  profileName: string | null,
  now: Date = new Date(),
): Promise<{ userId: string } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(whatsappLinkCodes)
      .set({ usedAt: now })
      .where(
        and(
          eq(whatsappLinkCodes.code, code),
          isNull(whatsappLinkCodes.usedAt),
          gt(whatsappLinkCodes.expiresAt, now),
        ),
      )
      .returning({ userId: whatsappLinkCodes.userId })
    if (!row) return null
    await tx
      .delete(whatsappLinks)
      .where(or(eq(whatsappLinks.phone, phone), eq(whatsappLinks.userId, row.userId)))
    await tx.insert(whatsappLinks).values({
      userId: row.userId,
      phone,
      profileName,
      lastInboundAt: now,
    })
    // Messages this phone sent before linking belong to the new owner now.
    await tx
      .update(whatsappMessages)
      .set({ userId: row.userId })
      .where(and(eq(whatsappMessages.phone, phone), isNull(whatsappMessages.userId)))
    return { userId: row.userId }
  })
}

export async function unlink(userId: string): Promise<boolean> {
  const rows = await db
    .delete(whatsappLinks)
    .where(eq(whatsappLinks.userId, userId))
    .returning({ id: whatsappLinks.id })
  return rows.length > 0
}

export async function setNotify(userId: string, notify: boolean): Promise<boolean> {
  const rows = await db
    .update(whatsappLinks)
    .set({ notify })
    .where(eq(whatsappLinks.userId, userId))
    .returning({ id: whatsappLinks.id })
  return rows.length > 0
}
