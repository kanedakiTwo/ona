/**
 * Tu propia foto como foto principal de la receta (PRO-145,
 * specs/recipe-images.md → "Own photo").
 *
 * The author (or an admin) uploads a photo from the camera or the gallery, or
 * picks one from the household gallery «así me quedó». It goes through sharp
 * (EXIF rotation → centred 4:3 crop → ≤ 1200 px wide JPEG) and is stored on
 * the same volume as the generated photos (`<recipeId>.jpg`). It costs
 * nothing and never counts against the monthly AI image quota.
 */

import { eq } from 'drizzle-orm'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import sharp from 'sharp'
import { env } from '../config/env.js'
import { db as defaultDb } from '../db/connection.js'
import { recipes } from '../db/schema.js'

type Db = typeof defaultDb

/** 10 MB: a phone photo straight from the camera fits. */
export const OWN_IMAGE_MAX_BYTES = 10 * 1024 * 1024

const ACCEPTED = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'])

export function isAcceptedImageType(mime: string | null | undefined): boolean {
  return !!mime && ACCEPTED.has(mime.toLowerCase())
}

export class UnreadableImageError extends Error {
  constructor() {
    super('No hemos podido leer la foto. Prueba con otra en JPG o PNG.')
    this.name = 'UnreadableImageError'
  }
}

const HERO_WIDTH = 1200

/** Photo bytes → centred 4:3 JPEG, at most 1200 px wide. Pure (no I/O). */
export async function toOwnHeroJpeg(bytes: Buffer): Promise<Buffer> {
  let upright: Buffer
  let width: number
  let height: number
  try {
    const out = await sharp(bytes).rotate().toBuffer({ resolveWithObject: true })
    upright = out.data
    width = out.info.width
    height = out.info.height
  } catch {
    throw new UnreadableImageError()
  }
  // Largest 4:3 box that fits, centred.
  let cropW = width
  let cropH = Math.round((width * 3) / 4)
  if (cropH > height) {
    cropH = height
    cropW = Math.round((height * 4) / 3)
  }
  const left = Math.floor((width - cropW) / 2)
  const top = Math.floor((height - cropH) / 2)
  const outW = Math.min(HERO_WIDTH, cropW)
  return sharp(upright)
    .extract({ left, top, width: cropW, height: cropH })
    .resize({ width: outW, height: Math.round((outW * 3) / 4), fit: 'fill' })
    .jpeg({ quality: 85, mozjpeg: true })
    .toBuffer()
}

/** Who may change a recipe's main photo: its author, or an admin. */
export function canChangeRecipeImage(authorId: string | null, who: { userId: string; isAdmin: boolean }): boolean {
  if (who.isAdmin) return true
  return authorId !== null && authorId === who.userId
}

/** Crop, store as `<recipeId>.jpg` and point `recipes.image_url` at it. */
export async function saveOwnRecipeImage(recipeId: string, bytes: Buffer, db: Db = defaultDb): Promise<{ imageUrl: string }> {
  const jpg = await toOwnHeroJpeg(bytes)
  const filename = `${recipeId}.jpg`
  await mkdir(env.IMAGE_STORAGE_DIR, { recursive: true })
  await writeFile(join(env.IMAGE_STORAGE_DIR, filename), jpg)
  const imageUrl = `${env.IMAGE_PUBLIC_URL_BASE.replace(/\/+$/, '')}/${filename}`
  await db.update(recipes).set({ imageUrl, updatedAt: new Date() }).where(eq(recipes.id, recipeId))
  return { imageUrl }
}

/** Bytes of a gallery photo already on the volume (`<photoId>.jpg`). */
export async function readStoredPhoto(imageUrl: string): Promise<Buffer> {
  const filename = imageUrl.split('/').pop()
  if (!filename || filename.includes('..')) throw new UnreadableImageError()
  try {
    return await readFile(join(env.IMAGE_STORAGE_DIR, filename))
  } catch {
    throw new UnreadableImageError()
  }
}
