/**
 * Photos are made smaller before Claude reads them (2026-10-23: a school
 * menu photo uploaded from the web failed — over Claude's 5 MB per image —
 * while the same menu through WhatsApp, already compressed, was read).
 */
import { describe, expect, it } from 'vitest'
import sharp from 'sharp'
import { VISION_MAX_EDGE, fitImageForClaude } from '../services/visionImage.js'
import { readSchoolMenu } from '../services/schoolMenu.js'

/** A noisy 4000×3000 PNG: a phone-camera-sized photo, many MB. */
async function bigPhoto(): Promise<Buffer> {
  const w = 4000
  const h = 3000
  const raw = Buffer.alloc(w * h * 3)
  for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) >>> 24
  return sharp(raw, { raw: { width: w, height: h, channels: 3 } }).png({ compressionLevel: 0 }).toBuffer()
}

describe('fitImageForClaude', () => {
  it('a camera-sized photo becomes a JPEG of at most 1568 px and well under 5 MB', async () => {
    const input = await bigPhoto()
    expect(input.length).toBeGreaterThan(5 * 1024 * 1024)
    const out = await fitImageForClaude(input, 'image/png')
    const meta = await sharp(out.data).metadata()
    expect(out.mimeType).toBe('image/jpeg')
    expect(meta.format).toBe('jpeg')
    expect(Math.max(meta.width!, meta.height!)).toBe(VISION_MAX_EDGE)
    expect(out.data.length).toBeLessThan(5 * 1024 * 1024)
  })

  it('a small photo goes as it is; one that is not an image too', async () => {
    const small = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#c65d38' } }).png().toBuffer()
    expect(await fitImageForClaude(small, 'image/png')).toEqual({ data: small, mimeType: 'image/png' })
    const junk = Buffer.from('x')
    expect(await fitImageForClaude(junk, 'image/jpeg')).toEqual({ data: junk, mimeType: 'image/jpeg' })
  })
})

describe('readSchoolMenu sends the reader a fitted photo, the PDF as it is', () => {
  const answer = { days: [{ date: '2026-11-03', dish: 'Lentejas', group: 'legumbre' }] }

  it('photo', async () => {
    let seen: { mimeType: string; size: number } | null = null
    const days = await readSchoolMenu({ data: await bigPhoto(), mimeType: 'image/png' }, '2026-10-23', null, async (file) => {
      seen = { mimeType: file.mimeType, size: file.data.length }
      return answer
    })
    expect(days).toHaveLength(1)
    expect(seen!.mimeType).toBe('image/jpeg')
    expect(seen!.size).toBeLessThan(5 * 1024 * 1024)
  })

  it('PDF', async () => {
    const pdf = Buffer.from('%PDF-1.4 menu')
    let seen: Buffer | null = null
    await readSchoolMenu({ data: pdf, mimeType: 'application/pdf' }, '2026-10-23', null, async (file) => {
      seen = file.data
      return answer
    })
    expect(seen).toBe(pdf)
  })
})
