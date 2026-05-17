/**
 * Household management helpers — used by the REST surface and (in the next
 * session) the request-scoping middleware.
 *
 * Invariants:
 *   - Every user has at least one membership row. `primary_household_id`
 *     points to the household whose reads drive the UI.
 *   - The OWNER role is fungible: when a user leaves a household they own
 *     while other members remain, the oldest member is promoted to owner.
 *   - Tokens for invites are 32 random hex chars (16 bytes). The owner
 *     shares the link manually (no email auto-sent).
 */
import { and, eq, asc, isNotNull } from 'drizzle-orm'
import { randomBytes } from 'node:crypto'
import { db } from '../db/connection.js'
import { households, householdMembers, householdInvites, users } from '../db/schema.js'

export type HouseholdRole = 'owner' | 'member' | 'child'

const INVITE_TTL_DAYS = 7

export class HouseholdNotFoundError extends Error {
  constructor() {
    super('Household not found')
    this.name = 'HouseholdNotFoundError'
  }
}

export class NotHouseholdMemberError extends Error {
  constructor() {
    super('No perteneces a esta casa')
    this.name = 'NotHouseholdMemberError'
  }
}

export class NotHouseholdOwnerError extends Error {
  constructor() {
    super('Solo el dueño de la casa puede hacer esto')
    this.name = 'NotHouseholdOwnerError'
  }
}

export class InviteExpiredError extends Error {
  constructor() {
    super('Esta invitación ha caducado o ya se usó')
    this.name = 'InviteExpiredError'
  }
}

export interface HouseholdMember {
  userId: string
  username: string
  role: HouseholdRole
  joinedAt: string
}

export interface HouseholdDetails {
  id: string
  name: string
  ownerId: string
  members: HouseholdMember[]
  pendingInvites: Array<{
    id: string
    token: string
    role: HouseholdRole
    email: string | null
    expiresAt: string
    invitedByUserId: string
  }>
}

/** Load a user's primary household + members + pending invites. */
export async function loadHouseholdForUser(userId: string): Promise<HouseholdDetails | null> {
  const [user] = await db
    .select({ primaryHouseholdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (!user?.primaryHouseholdId) return null
  return await loadHousehold(user.primaryHouseholdId)
}

/** Load a household by id. Throws NotFound. */
export async function loadHousehold(householdId: string): Promise<HouseholdDetails> {
  const [household] = await db
    .select()
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1)
  if (!household) throw new HouseholdNotFoundError()

  const memberRows = await db
    .select({
      userId: householdMembers.userId,
      username: users.username,
      role: householdMembers.role,
      joinedAt: householdMembers.joinedAt,
    })
    .from(householdMembers)
    .innerJoin(users, eq(users.id, householdMembers.userId))
    .where(eq(householdMembers.householdId, householdId))
    .orderBy(asc(householdMembers.joinedAt))

  const invites = await db
    .select()
    .from(householdInvites)
    .where(
      and(
        eq(householdInvites.householdId, householdId),
        // Drizzle's isNull / isNotNull keyword expressions don't have a
        // direct equality-to-null helper, so we use `consumedAt IS NULL`.
      ),
    )
  const pending = invites
    .filter((i) => i.consumedAt == null && i.expiresAt > new Date())
    .map((i) => ({
      id: i.id,
      token: i.token,
      role: i.role as HouseholdRole,
      email: i.email,
      expiresAt: i.expiresAt.toISOString(),
      invitedByUserId: i.invitedByUserId,
    }))

  return {
    id: household.id,
    name: household.name,
    ownerId: household.ownerId,
    members: memberRows.map((m) => ({
      userId: m.userId,
      username: m.username,
      role: m.role as HouseholdRole,
      joinedAt: m.joinedAt.toISOString(),
    })),
    pendingInvites: pending,
  }
}

/** Throw NotHouseholdMemberError if the user isn't a member. */
export async function assertHouseholdMember(userId: string, householdId: string): Promise<HouseholdRole> {
  const [m] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.userId, userId), eq(householdMembers.householdId, householdId)))
    .limit(1)
  if (!m) throw new NotHouseholdMemberError()
  return m.role as HouseholdRole
}

/** Throw NotHouseholdOwnerError if the user isn't the owner. */
export async function assertHouseholdOwner(userId: string, householdId: string): Promise<void> {
  const [h] = await db
    .select({ ownerId: households.ownerId })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1)
  if (!h) throw new HouseholdNotFoundError()
  if (h.ownerId !== userId) throw new NotHouseholdOwnerError()
}

/** Rename a household. Owner-only. */
export async function renameHousehold(userId: string, householdId: string, name: string): Promise<HouseholdDetails> {
  await assertHouseholdOwner(userId, householdId)
  const trimmed = (name ?? '').trim()
  if (trimmed.length < 1 || trimmed.length > 60) {
    throw new Error('El nombre debe tener entre 1 y 60 caracteres')
  }
  await db.update(households).set({ name: trimmed }).where(eq(households.id, householdId))
  return await loadHousehold(householdId)
}

/** Create an invite. Owner-only. */
export async function createInvite(
  inviterId: string,
  householdId: string,
  role: HouseholdRole = 'member',
  email: string | null = null,
): Promise<{ token: string; expiresAt: string }> {
  await assertHouseholdOwner(inviterId, householdId)
  if (role !== 'member' && role !== 'child') {
    throw new Error('Solo se pueden invitar miembros o niños')
  }
  const token = randomBytes(16).toString('hex')
  const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000)
  await db.insert(householdInvites).values({
    householdId,
    invitedByUserId: inviterId,
    role,
    email: email?.toLowerCase().trim() || null,
    token,
    expiresAt,
  })
  return { token, expiresAt: expiresAt.toISOString() }
}

/** Revoke a pending invite. Owner-only. */
export async function revokeInvite(userId: string, inviteId: string): Promise<void> {
  const [invite] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.id, inviteId))
    .limit(1)
  if (!invite) throw new HouseholdNotFoundError()
  await assertHouseholdOwner(userId, invite.householdId)
  // Hard delete pending invites — keeps the list clean. Consumed ones are
  // historical and never appear in pending anyway.
  await db.delete(householdInvites).where(eq(householdInvites.id, inviteId))
}

/** Preview an invite by token. No auth required (recipient may not have an account yet). */
export async function previewInvite(token: string): Promise<{
  householdName: string
  invitedByUsername: string
  role: HouseholdRole
  expiresAt: string
}> {
  const [row] = await db
    .select({
      role: householdInvites.role,
      expiresAt: householdInvites.expiresAt,
      consumedAt: householdInvites.consumedAt,
      householdName: households.name,
      invitedByUsername: users.username,
    })
    .from(householdInvites)
    .innerJoin(households, eq(households.id, householdInvites.householdId))
    .innerJoin(users, eq(users.id, householdInvites.invitedByUserId))
    .where(eq(householdInvites.token, token))
    .limit(1)
  if (!row) throw new HouseholdNotFoundError()
  if (row.consumedAt != null) throw new InviteExpiredError()
  if (row.expiresAt < new Date()) throw new InviteExpiredError()
  return {
    householdName: row.householdName,
    invitedByUsername: row.invitedByUsername,
    role: row.role as HouseholdRole,
    expiresAt: row.expiresAt.toISOString(),
  }
}

/** Accept an invite. Auth required. */
export async function acceptInvite(userId: string, token: string): Promise<HouseholdDetails> {
  const [invite] = await db
    .select()
    .from(householdInvites)
    .where(eq(householdInvites.token, token))
    .limit(1)
  if (!invite) throw new HouseholdNotFoundError()
  if (invite.consumedAt != null) throw new InviteExpiredError()
  if (invite.expiresAt < new Date()) throw new InviteExpiredError()

  await db.transaction(async (tx) => {
    // Add the membership (idempotent — uniqueIndex catches dupes).
    try {
      await tx.insert(householdMembers).values({
        householdId: invite.householdId,
        userId,
        role: invite.role,
      })
    } catch (err) {
      const code = (err as { code?: string })?.code
      if (code !== '23505') throw err
      // already a member — fall through
    }
    // Mark invite consumed.
    await tx
      .update(householdInvites)
      .set({ consumedAt: new Date(), consumedByUserId: userId })
      .where(eq(householdInvites.id, invite.id))
    // Set primary household to the one just joined (so the user immediately
    // sees the shared menu / shopping after accepting).
    await tx.update(users).set({ primaryHouseholdId: invite.householdId }).where(eq(users.id, userId))
  })

  return await loadHousehold(invite.householdId)
}

/** Remove a member from a household. Owner-only. Last owner can't leave. */
export async function removeMember(actorId: string, householdId: string, targetUserId: string): Promise<HouseholdDetails> {
  await assertHouseholdOwner(actorId, householdId)
  const [target] = await db
    .select({ role: householdMembers.role })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, targetUserId)))
    .limit(1)
  if (!target) throw new NotHouseholdMemberError()
  if (target.role === 'owner') {
    throw new Error('No puedes quitar al dueño — primero pasa la propiedad o sal de la casa.')
  }
  await db.delete(householdMembers).where(and(
    eq(householdMembers.householdId, householdId),
    eq(householdMembers.userId, targetUserId),
  ))
  // If the removed user's primary household was this one, fall them back to
  // their solo household (always exists per the backfill) or auto-create one.
  await ensureSoloHouseholdFallback(targetUserId, householdId)
  return await loadHousehold(householdId)
}

/**
 * Leave a household. If the user is the owner:
 *   - If other members exist, promote the longest-joined member to owner.
 *   - If alone, the household row is dropped (cascade kills the member row).
 * On exit, the user is auto-attached to a solo household (created if needed).
 */
export async function leaveHousehold(userId: string, householdId: string): Promise<HouseholdDetails | null> {
  await assertHouseholdMember(userId, householdId)
  const [household] = await db
    .select({ ownerId: households.ownerId })
    .from(households)
    .where(eq(households.id, householdId))
    .limit(1)
  if (!household) throw new HouseholdNotFoundError()

  await db.transaction(async (tx) => {
    if (household.ownerId === userId) {
      const others = await tx
        .select({ userId: householdMembers.userId, joinedAt: householdMembers.joinedAt })
        .from(householdMembers)
        .where(and(
          eq(householdMembers.householdId, householdId),
          // exclude self by setting userId condition manually after the read
        ))
        .orderBy(asc(householdMembers.joinedAt))
      const next = others.find((m) => m.userId !== userId)
      if (next) {
        // Promote the oldest non-owner member.
        await tx.update(households).set({ ownerId: next.userId }).where(eq(households.id, householdId))
        await tx.update(householdMembers)
          .set({ role: 'owner' })
          .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, next.userId)))
        await tx.delete(householdMembers).where(and(
          eq(householdMembers.householdId, householdId),
          eq(householdMembers.userId, userId),
        ))
      } else {
        // Alone — drop the whole household (cascades the member row).
        await tx.delete(households).where(eq(households.id, householdId))
      }
    } else {
      await tx.delete(householdMembers).where(and(
        eq(householdMembers.householdId, householdId),
        eq(householdMembers.userId, userId),
      ))
    }
  })

  await ensureSoloHouseholdFallback(userId, householdId)
  return await loadHouseholdForUser(userId)
}

/**
 * Helper: if a user's primary_household_id points to a household they're no
 * longer in, attach them to a solo household. Creates one if it doesn't
 * exist yet. Called on remove + leave to keep the invariant
 * "every user has a primary household" true.
 */
async function ensureSoloHouseholdFallback(userId: string, leftHouseholdId: string) {
  const [u] = await db
    .select({ primaryHouseholdId: users.primaryHouseholdId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (u?.primaryHouseholdId && u.primaryHouseholdId !== leftHouseholdId) return // still has a valid one

  // Find any household where the user still has membership; prefer the
  // oldest one they own.
  const memberships = await db
    .select({ householdId: householdMembers.householdId, role: householdMembers.role, joinedAt: householdMembers.joinedAt })
    .from(householdMembers)
    .where(eq(householdMembers.userId, userId))
    .orderBy(asc(householdMembers.joinedAt))
  let fallbackId = memberships.find((m) => m.role === 'owner')?.householdId ?? memberships[0]?.householdId
  if (!fallbackId) {
    // Create a fresh solo household.
    const [h] = await db.insert(households).values({ name: 'Mi casa', ownerId: userId }).returning({ id: households.id })
    await db.insert(householdMembers).values({ householdId: h.id, userId, role: 'owner' })
    fallbackId = h.id
  }
  await db.update(users).set({ primaryHouseholdId: fallbackId }).where(eq(users.id, userId))
}

/** Called from /register: every new account gets a solo household automatically. */
export async function createSoloHouseholdForNewUser(userId: string): Promise<string> {
  const [h] = await db
    .insert(households)
    .values({ name: 'Mi casa', ownerId: userId })
    .returning({ id: households.id })
  await db.insert(householdMembers).values({ householdId: h.id, userId, role: 'owner' })
  await db.update(users).set({ primaryHouseholdId: h.id }).where(eq(users.id, userId))
  return h.id
}
