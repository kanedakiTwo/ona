/**
 * PRO-66: which link becomes the source of a screenshot's recipe on WhatsApp
 * (apps/api/src/services/whatsapp/photoSource.ts). Pure, over stored rows.
 */
import { describe, expect, it } from 'vitest'
import { firstUrl, pendingSourceQuestion, unreadLinkForScreenshot } from '../services/whatsapp/photoSource.js'
import type { HistoryRow } from '../services/whatsapp/history.js'

const NOW = new Date('2026-10-15T10:00:00Z')
const ago = (m: number) => new Date(NOW.getTime() - m * 60_000)
const TT = 'https://www.tiktok.com/@cocina/video/123'

const unread = (at: Date, url = TT): HistoryRow => ({
  direction: 'in', kind: 'text', body: url, status: 'processed', createdAt: at,
  meta: { toolTrace: [{ name: 'import_recipe_from_url', input: JSON.stringify({ url }), summary: 'Responde al usuario exactamente: «No he podido leer la receta de este vídeo; mándame una captura».' }] },
})

describe('firstUrl', () => {
  it('finds the link and drops trailing punctuation', () => {
    expect(firstUrl(`mira ${TT}.`)).toBe(TT)
    expect(firstUrl('(https://a.es/receta)')).toBe('https://a.es/receta')
    expect(firstUrl('sin enlace')).toBeNull()
    expect(firstUrl(null)).toBeNull()
  })
})

describe('unreadLinkForScreenshot', () => {
  it('the link that got «mándame una captura» in the last 30 min', () => {
    expect(unreadLinkForScreenshot([unread(ago(29))], NOW)).toBe(TT)
  })
  it('older than 30 min → none', () => {
    expect(unreadLinkForScreenshot([unread(ago(31))], NOW)).toBeNull()
  })
  it('a link that was imported fine (or any other tool) → none', () => {
    const ok: HistoryRow = { ...unread(ago(5)), meta: { toolTrace: [{ name: 'import_recipe_from_url', input: JSON.stringify({ url: TT }), summary: 'Receta «X» guardada' }] } }
    expect(unreadLinkForScreenshot([ok], NOW)).toBeNull()
  })
  it('already used by an earlier screenshot → none', () => {
    const used: HistoryRow = { direction: 'in', kind: 'image', body: '[Foto de una receta]', status: 'processed', createdAt: ago(2), meta: { photoRecipeId: 'r1', photoSourceUrl: TT } }
    expect(unreadLinkForScreenshot([unread(ago(5)), used], NOW)).toBeNull()
  })
})

describe('pendingSourceQuestion', () => {
  const asked = (at: Date, id = 'r1'): HistoryRow => ({
    direction: 'in', kind: 'image', body: '[Foto de una receta]', status: 'processed', createdAt: at,
    meta: { photoRecipeId: id, photoRecipeName: 'Pasta', sourceAsked: true },
  })
  it('open within 30 min', () => {
    expect(pendingSourceQuestion([asked(ago(10))], NOW)).toEqual({ recipeId: 'r1', name: 'Pasta' })
  })
  it('closed after 30 min', () => {
    expect(pendingSourceQuestion([asked(ago(31))], NOW)).toBeNull()
  })
  it('a newer photo without the question closes it', () => {
    const book: HistoryRow = { ...asked(ago(3), 'r2'), meta: { photoRecipeId: 'r2', photoRecipeName: 'Lentejas' } }
    expect(pendingSourceQuestion([asked(ago(10)), book], NOW)).toBeNull()
  })
  it('answered once → closed', () => {
    const answer: HistoryRow = { direction: 'in', kind: 'text', body: TT, status: 'processed', createdAt: ago(5), meta: { sourceAttachedTo: 'r1' } }
    expect(pendingSourceQuestion([asked(ago(10)), answer], NOW)).toBeNull()
  })
})
