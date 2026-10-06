import { and, desc, eq, gt, gte, isNull, or, inArray } from 'drizzle-orm'
import { db } from '../../db/connection.js'
import { users, whatsappLinkCodes, whatsappLinks, whatsappMessages, whatsappPhoneTokens } from '../../db/schema.js'
import type { InboundMessage } from './webhookParser.js'
import type { HistoryRow } from './history.js'
import crypto from 'crypto'
import { generateLinkCode, LINK_CODE_TTL_MS, PHONE_TOKEN_TTL_MS } from './linking.js'

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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

/**
 * Link `phone ↔ userId` one-to-one inside a transaction. A phone already
 * linked to someone else moves to the new user; a user re-linking replaces
 * their previous phone; messages the phone sent before linking are adopted.
 */
async function linkPhoneToUser(tx: Tx, phone: string, userId: string, profileName: string | null, now: Date) {
  await tx.delete(whatsappLinks).where(or(eq(whatsappLinks.phone, phone), eq(whatsappLinks.userId, userId)))
  await tx.insert(whatsappLinks).values({ userId, phone, profileName, lastInboundAt: now })
  await tx
    .update(whatsappMessages)
    .set({ userId })
    .where(and(eq(whatsappMessages.phone, phone), isNull(whatsappMessages.userId)))
}

/**
 * Consume a code sent from `phone` (profile flow) and link it to the code's
 * owner. Returns null for unknown/used/expired codes.
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
    await linkPhoneToUser(tx, phone, row.userId, profileName, now)
    return { userId: row.userId }
  })
}

// ─── WhatsApp-first linking (phone tokens) ──────────────────────

export async function hasActivePhoneToken(phone: string, now: Date = new Date()): Promise<boolean> {
  const [row] = await db
    .select({ token: whatsappPhoneTokens.token })
    .from(whatsappPhoneTokens)
    .where(
      and(
        eq(whatsappPhoneTokens.phone, phone),
        isNull(whatsappPhoneTokens.usedAt),
        gt(whatsappPhoneTokens.expiresAt, now),
      ),
    )
    .limit(1)
  return Boolean(row)
}

export async function createPhoneToken(phone: string, profileName: string | null, now: Date = new Date()): Promise<string> {
  const token = crypto.randomBytes(16).toString('hex')
  await db.insert(whatsappPhoneTokens).values({
    token,
    phone,
    profileName,
    expiresAt: new Date(now.getTime() + PHONE_TOKEN_TTL_MS),
  })
  return token
}

export async function getPhoneToken(token: string) {
  const [row] = await db.select().from(whatsappPhoneTokens).where(eq(whatsappPhoneTokens.token, token)).limit(1)
  return row ?? null
}

/** Consume a phone token confirmed by a logged-in user. Null when unknown/used/expired. */
export async function consumePhoneToken(
  token: string,
  userId: string,
  now: Date = new Date(),
): Promise<{ phone: string; profileName: string | null } | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .update(whatsappPhoneTokens)
      .set({ usedAt: now })
      .where(
        and(
          eq(whatsappPhoneTokens.token, token),
          isNull(whatsappPhoneTokens.usedAt),
          gt(whatsappPhoneTokens.expiresAt, now),
        ),
      )
      .returning({ phone: whatsappPhoneTokens.phone, profileName: whatsappPhoneTokens.profileName })
    if (!row) return null
    await linkPhoneToUser(tx, row.phone, userId, row.profileName, now)
    return row
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
