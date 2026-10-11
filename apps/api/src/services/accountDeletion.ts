import { and, asc, eq, inArray, ne, or } from 'drizzle-orm'
import { unlink } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import {
  adminAuditLog,
  householdMembers,
  households,
  menus,
  recipePhotos,
  recipes,
  shoppingLists,
  users,
  whatsappLinks,
  whatsappMessages,
} from '../db/schema.js'

/**
 * "Borrar mi cuenta" (GDPR art. 17). Most user data goes with the users row
 * (ON DELETE CASCADE), but three things would go wrong with a bare DELETE:
 *
 *  - recipes.author_id is SET NULL, and authorId NULL means "Mimoia catalogue":
 *    the user's private recipes would become public. They're deleted first.
 *  - households.owner_id CASCADEs: deleting an owner would wipe the shared
 *    household (menus, list, pantry) for every other member. Ownership moves
 *    to the longest-standing adult member instead. That household's menus and
 *    shopping lists that this user created are reassigned, so the others keep
 *    their week. A household left with no one is deleted.
 *  - admin_audit_log.admin_id has no ON DELETE: admin accounts are refused
 *    here (the audit trail must survive).
 *
 * Also removed: WhatsApp messages from the linked phone (incl. those sent
 * before linking) and image files on the volume for deleted recipes/photos.
 */

export class AdminAccountDeletionError extends Error {
  constructor() {
    super('Las cuentas de administrador no se pueden borrar desde la app.')
    this.name = 'AdminAccountDeletionError'
  }
}

export interface DeletionSummary {
  recipesDeleted: number
  householdsDeleted: number
  householdsTransferred: number
  imagesRemoved: number
}

/** Local file behind an image URL we serve from the volume, or null for anything else. */
export function localImagePath(
  imageUrl: string | null | undefined,
  base = env.IMAGE_PUBLIC_URL_BASE,
  dir = env.IMAGE_STORAGE_DIR,
): string | null {
  if (!imageUrl) return null
  const prefix = base.replace(/\/+$/, '') + '/'
  if (!imageUrl.startsWith(prefix)) return null
  const name = basename(imageUrl.slice(prefix.length))
  // Only files we write ourselves: <uuid>.jpg. Seed images (<slug>.jpg under
  // the web app's public dir) never match the volume base in production.
  if (!/^[0-9a-f-]{36}\.jpg$/i.test(name)) return null
  return join(dir, name)
}

export async function deleteAccount(
  userId: string,
  deps: { db?: any; removeFile?: (path: string) => Promise<void> } = {},
): Promise<DeletionSummary> {
  const db = deps.db ?? defaultDb
  const removeFile = deps.removeFile ?? ((p: string) => unlink(p))

  const [admin] = await db
    .select({ role: users.role })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1)
  if (admin?.role === 'admin') throw new AdminAccountDeletionError()
  const [audited] = await db.select({ id: adminAuditLog.id }).from(adminAuditLog).where(eq(adminAuditLog.adminId, userId)).limit(1)
  if (audited) throw new AdminAccountDeletionError()

  const filesToRemove: string[] = []

  const summary = await db.transaction(async (tx: any) => {
    // 1. Households the user belongs to: hand over or delete.
    const memberships = await tx
      .select({ householdId: householdMembers.householdId })
      .from(householdMembers)
      .where(eq(householdMembers.userId, userId))
    const owned = await tx.select({ id: households.id }).from(households).where(eq(households.ownerId, userId))
    const householdIds = [...new Set([...memberships.map((m: any) => m.householdId), ...owned.map((h: any) => h.id)])]

    const deadHouseholds: string[] = []
    let transferred = 0
    for (const householdId of householdIds) {
      const others = await tx
        .select({ userId: householdMembers.userId, role: householdMembers.role })
        .from(householdMembers)
        .where(and(eq(householdMembers.householdId, householdId), ne(householdMembers.userId, userId)))
        .orderBy(asc(householdMembers.joinedAt))
      if (others.length === 0) {
        deadHouseholds.push(householdId)
        continue
      }
      const [house] = await tx.select({ ownerId: households.ownerId }).from(households).where(eq(households.id, householdId)).limit(1)
      let ownerId: string = house?.ownerId
      if (ownerId === userId) {
        const heir = others.find((o: any) => o.role !== 'child') ?? others[0]
        ownerId = heir.userId
        await tx.update(households).set({ ownerId }).where(eq(households.id, householdId))
        await tx
          .update(householdMembers)
          .set({ role: 'owner' })
          .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, ownerId)))
        transferred += 1
      }
      // The shared week this user planned stays with the household.
      await tx.update(menus).set({ userId: ownerId }).where(and(eq(menus.householdId, householdId), eq(menus.userId, userId)))
      await tx
        .update(shoppingLists)
        .set({ userId: ownerId })
        .where(and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.userId, userId)))
    }

    // 2. The user's own recipes (never let them fall into the catalogue).
    const ownRecipes = await tx.select({ id: recipes.id, imageUrl: recipes.imageUrl }).from(recipes).where(eq(recipes.authorId, userId))
    const recipeIds = ownRecipes.map((r: any) => r.id)
    for (const r of ownRecipes) {
      const p = localImagePath(r.imageUrl)
      if (p) filesToRemove.push(p)
    }
    const photoScope = [
      ...(recipeIds.length > 0 ? [inArray(recipePhotos.recipeId, recipeIds)] : []),
      ...(deadHouseholds.length > 0 ? [inArray(recipePhotos.householdId, deadHouseholds)] : []),
    ]
    if (photoScope.length > 0) {
      const photos = await tx.select({ imageUrl: recipePhotos.imageUrl }).from(recipePhotos).where(or(...photoScope))
      for (const ph of photos) {
        const p = localImagePath(ph.imageUrl)
        if (p) filesToRemove.push(p)
      }
    }
    if (recipeIds.length > 0) await tx.delete(recipes).where(inArray(recipes.id, recipeIds))

    // 3. WhatsApp history from the linked phone (rows from before linking have no user_id).
    const [link] = await tx.select({ phone: whatsappLinks.phone }).from(whatsappLinks).where(eq(whatsappLinks.userId, userId)).limit(1)
    if (link) await tx.delete(whatsappMessages).where(eq(whatsappMessages.phone, link.phone))

    // 4. Households nobody is left in, then the user (cascades the rest).
    if (deadHouseholds.length > 0) await tx.delete(households).where(inArray(households.id, deadHouseholds))
    await tx.delete(users).where(eq(users.id, userId))

    return {
      recipesDeleted: recipeIds.length,
      householdsDeleted: deadHouseholds.length,
      householdsTransferred: transferred,
    }
  })

  // 5. Files, after the commit (a failed unlink must not resurrect the account).
  let imagesRemoved = 0
  for (const p of new Set(filesToRemove)) {
    try {
      await removeFile(p)
      imagesRemoved += 1
    } catch {
      // already gone / not on this volume
    }
  }
  return { ...summary, imagesRemoved }
}
