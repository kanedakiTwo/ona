/**
 * recipe_photos business logic (PR 8C).
 *
 * Household-shared gallery — distinct from `recipes.image_url` which is
 * the author's hero. Any member can upload; deletes are member-only too
 * (anybody in the household can clean up the gallery).
 *
 * Storage reuses `IMAGE_STORAGE_DIR` + `IMAGE_PUBLIC_URL_BASE` from the
 * AI hero generator. We persist one JPEG per row, keyed by the row's
 * own UUID for collision-free filenames + cheap deletion.
 */

import { and, desc, eq } from 'drizzle-orm'
import { randomUUID } from 'crypto'
import { unlink } from 'fs/promises'
import { join } from 'path'
import sharp from 'sharp'
import { mkdir, writeFile } from 'fs/promises'
import { db as defaultDb } from '../db/connection.js'
import { recipePhotos, users } from '../db/schema.js'
import { getPrimaryHouseholdId } from './scopeResolver.js'
import { env } from '../config/env.js'

type Db = typeof defaultDb

export interface PhotoRow {
  id: string
  recipeId: string
  householdId: string
  uploadedByUserId: string | null
  uploadedByUsername: string | null
  imageUrl: string
  caption: string | null
  createdAt: string
}

export class NoHouseholdError extends Error {
  constructor() {
    super('Tu cuenta aún no tiene un hogar asignado.')
    this.name = 'NoHouseholdError'
  }
}

export class PhotoNotFoundError extends Error {
  constructor() {
    super('Foto no encontrada.')
    this.name = 'PhotoNotFoundError'
  }
}

export async function listPhotosForRecipe(
  userId: string,
  recipeId: string,
  db: Db = defaultDb,
): Promise<PhotoRow[]> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return []
  const rows = await db
    .select({
      id: recipePhotos.id,
      recipeId: recipePhotos.recipeId,
      householdId: recipePhotos.householdId,
      uploadedByUserId: recipePhotos.uploadedByUserId,
      uploadedByUsername: users.username,
      imageUrl: recipePhotos.imageUrl,
      caption: recipePhotos.caption,
      createdAt: recipePhotos.createdAt,
    })
    .from(recipePhotos)
    .leftJoin(users, eq(users.id, recipePhotos.uploadedByUserId))
    .where(and(eq(recipePhotos.recipeId, recipeId), eq(recipePhotos.householdId, householdId)))
    .orderBy(desc(recipePhotos.createdAt))
  return rows.map((r) => ({
    id: r.id,
    recipeId: r.recipeId,
    householdId: r.householdId,
    uploadedByUserId: r.uploadedByUserId ?? null,
    uploadedByUsername: r.uploadedByUsername ?? null,
    imageUrl: r.imageUrl,
    caption: r.caption ?? null,
    createdAt: r.createdAt.toISOString(),
  }))
}

export interface UploadPhotoInput {
  bytes: Buffer
  caption?: string | null
}

/**
 * Process the uploaded bytes through sharp (resize 1600px wide, JPEG q85),
 * write to the storage volume keyed by a fresh UUID, persist the row.
 */
export async function uploadPhotoForRecipe(
  userId: string,
  recipeId: string,
  input: UploadPhotoInput,
  db: Db = defaultDb,
): Promise<PhotoRow> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) throw new NoHouseholdError()

  const id = randomUUID()
  const filename = `${id}.jpg`

  const jpg = await sharp(input.bytes)
    .rotate() // honour EXIF orientation from phone cameras
    .resize({ width: 1600, withoutEnlargement: true })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()

  await mkdir(env.IMAGE_STORAGE_DIR, { recursive: true })
  const filePath = join(env.IMAGE_STORAGE_DIR, filename)
  await writeFile(filePath, jpg)

  const base = env.IMAGE_PUBLIC_URL_BASE.replace(/\/+$/, '')
  const imageUrl = `${base}/${filename}`

  const caption = input.caption?.trim()
  await db.insert(recipePhotos).values({
    id,
    recipeId,
    householdId,
    uploadedByUserId: userId,
    imageUrl,
    caption: caption ? caption.slice(0, 280) : null,
  })

  const [row] = await listPhotosForRecipe(userId, recipeId, db).then((rows) =>
    rows.filter((r) => r.id === id),
  )
  return row
}

/**
 * Hard-delete a photo row + its file on disk. Returns false if the photo
 * isn't in the caller's household (404 from the route).
 */
export async function deletePhotoForUser(
  userId: string,
  photoId: string,
  db: Db = defaultDb,
): Promise<boolean> {
  const householdId = await getPrimaryHouseholdId(userId, db)
  if (!householdId) return false

  const [row] = await db
    .select({ imageUrl: recipePhotos.imageUrl })
    .from(recipePhotos)
    .where(and(eq(recipePhotos.id, photoId), eq(recipePhotos.householdId, householdId)))
    .limit(1)
  if (!row) return false

  await db
    .delete(recipePhotos)
    .where(and(eq(recipePhotos.id, photoId), eq(recipePhotos.householdId, householdId)))

  // Best-effort file cleanup — never fails the delete if the file's gone.
  try {
    const filename = row.imageUrl.split('/').pop()
    if (filename) {
      await unlink(join(env.IMAGE_STORAGE_DIR, filename))
    }
  } catch (e) {
    console.warn('[recipePhotos] file cleanup failed (continuing):', e)
  }
  return true
}
