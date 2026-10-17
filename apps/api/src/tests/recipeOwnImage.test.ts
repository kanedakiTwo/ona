/**
 * PRO-145 · Tu propia foto como foto principal de la receta
 * (services/recipeOwnImage.ts): recorte 4:3, formatos, quién puede
 * cambiarla y que la IA no genere cuando ya hay foto propia.
 */
import { describe, it, expect } from 'vitest'
import sharp from 'sharp'
import {
  OWN_IMAGE_MAX_BYTES,
  UnreadableImageError,
  canChangeRecipeImage,
  isAcceptedImageType,
  toOwnHeroJpeg,
} from '../services/recipeOwnImage.js'
import { shouldGenerateHouseImage } from '../services/recipeHouseImage.js'

function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 80 } } }).png().toBuffer()
}

describe('toOwnHeroJpeg', () => {
  it('recorta una foto cuadrada a 4:3', async () => {
    const out = await toOwnHeroJpeg(await png(1000, 1000))
    const meta = await sharp(out).metadata()
    expect(meta.format).toBe('jpeg')
    expect(meta.width! / meta.height!).toBeCloseTo(4 / 3, 2)
    expect(meta.width).toBe(1000)
  })

  it('recorta una panorámica a 4:3 y la deja en 1200 px de ancho', async () => {
    const out = await toOwnHeroJpeg(await png(3000, 1000))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(900)
  })

  it('recorta una vertical de móvil a 4:3', async () => {
    const out = await toOwnHeroJpeg(await png(1200, 1600))
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(900)
  })

  it('respeta la orientación EXIF (foto girada por el móvil)', async () => {
    // 1600×1200 marcada como «girar 90°»: de verdad es vertical 1200×1600.
    const rotated = await sharp(await png(1600, 1200)).jpeg().withMetadata({ orientation: 6 }).toBuffer()
    const out = await toOwnHeroJpeg(rotated)
    const meta = await sharp(out).metadata()
    expect(meta.width).toBe(1200)
    expect(meta.height).toBe(900)
  })

  it('rechaza lo que no es una imagen', async () => {
    await expect(toOwnHeroJpeg(Buffer.from('no soy una foto'))).rejects.toBeInstanceOf(UnreadableImageError)
  })
})

describe('formatos y tamaño', () => {
  it('acepta jpg, png, webp y heic; rechaza el resto', () => {
    for (const t of ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']) expect(isAcceptedImageType(t)).toBe(true)
    for (const t of ['image/gif', 'application/pdf', 'text/plain', '']) expect(isAcceptedImageType(t)).toBe(false)
  })

  it('el tope es de 10 MB', () => {
    expect(OWN_IMAGE_MAX_BYTES).toBe(10 * 1024 * 1024)
  })
})

describe('canChangeRecipeImage', () => {
  it('solo el autor o un admin', () => {
    expect(canChangeRecipeImage('u1', { userId: 'u1', isAdmin: false })).toBe(true)
    expect(canChangeRecipeImage('u1', { userId: 'u2', isAdmin: false })).toBe(false)
    expect(canChangeRecipeImage(null, { userId: 'u2', isAdmin: false })).toBe(false)
    expect(canChangeRecipeImage(null, { userId: 'u2', isAdmin: true })).toBe(true)
    expect(canChangeRecipeImage('u1', { userId: 'u2', isAdmin: true })).toBe(true)
  })
})

describe('shouldGenerateHouseImage', () => {
  it('genera con IA si al guardar no hay foto', () => {
    expect(shouldGenerateHouseImage({ currentUrl: null })).toBe(true)
    expect(shouldGenerateHouseImage({ currentUrl: 'https://example.com/og.jpg' })).toBe(true)
  })

  it('no genera si el autor sube su propia foto', () => {
    expect(shouldGenerateHouseImage({ currentUrl: null, ownPhoto: true })).toBe(false)
  })

  it('no genera si ya hay una foto nuestra', () => {
    expect(shouldGenerateHouseImage({ currentUrl: '/images/recipes/tortilla.jpg' })).toBe(false)
  })
})
