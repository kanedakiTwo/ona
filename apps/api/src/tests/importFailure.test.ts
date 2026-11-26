/**
 * PRO-1301: when importing a link fails, Mimo says the motive in one sentence
 * (private video, no text, a network we don't read) and what does work, and
 * doesn't offer to paste links from networks the import can't read. 2026-11
 * history: Mimo invited a household to paste a video link, the import failed
 * and it asked for a screenshot without saying why. specs/recipe-import.md.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ importRecipeFromUrl: vi.fn() }))

import { importRecipeFromUrl } from '../services/recipeImport.js'
import { importRecipeFromUrlSkill } from '../services/assistant/skills.js'
import { IMPORT_WORKS, importFailureReason, unsupportedNetwork } from '../services/sources/importFailure.js'
import { SocialCaptionUnavailableError, extractSocialRecipe } from '../services/sources/social.js'
import { NoExtractableContentError, buildYouTubePromptInput } from '../services/sources/youtube.js'
import { NeedsScreenshotError } from '../services/sources/needsScreenshot.js'
import { PageFetchError } from '../services/net/publicFetch.js'
import { PAGE_SCREENSHOT_MESSAGE } from '../services/sources/article.js'
import { buildSystemParts } from '../services/assistant/systemPrompt.js'

const ctx = { userId: 'u1', db: null }
/** What Mimo is told to say, between «». */
const said = (summary: string) => /«([^»]*)»/.exec(summary)?.[1] ?? ''

describe('the motive, by what failed', () => {
  it('a private post or one behind a login', async () => {
    const fetchPage = async () => {
      throw new PageFetchError('No se pudo descargar la página (HTTP 403).')
    }
    const err = await extractSocialRecipe('https://www.instagram.com/reel/x', 'instagram', { provider: {} as any, fetchPage }).catch((e) => e)
    expect(err).toBeInstanceOf(SocialCaptionUnavailableError)
    expect(importFailureReason(err)).toBe('No he podido abrir ese vídeo: es privado o pide iniciar sesión.')
  })
  it('a post without the recipe in its text', async () => {
    const err = await extractSocialRecipe('https://www.tiktok.com/@a/video/1', 'tiktok', { provider: {} as any, fetchPage: async () => '<html></html>' }).catch((e) => e)
    expect(importFailureReason(err)).toMatch(/no trae la receta escrita en su texto, y el vídeo en sí no lo puedo ver/)
  })
  it('a YouTube video that shows nothing (private) vs one without captions nor recipe text', () => {
    const priv = (() => { try { buildYouTubePromptInput({ title: '', description: '', transcript: null }) } catch (e) { return e } })()
    expect(priv).toBeInstanceOf(NoExtractableContentError)
    expect(importFailureReason(priv)).toBe('No he podido abrir ese vídeo: es privado o ya no está disponible.')
    const noText = (() => { try { buildYouTubePromptInput({ title: 'Lentejas', description: 'corto', transcript: null }) } catch (e) { return e } })()
    expect(importFailureReason(noText)).toMatch(/no trae la receta escrita/)
  })
  it('a page that gives no text, and one that doesn\'t open', () => {
    expect(importFailureReason(new NeedsScreenshotError(PAGE_SCREENSHOT_MESSAGE))).toBe('Esa página no me deja leer la receta: no trae el texto.')
    expect(importFailureReason(new PageFetchError('x'))).toMatch(/^No he podido abrir esa página/)
    expect(importFailureReason(new Error('otra cosa'))).toBeNull()
  })
  it('networks the import doesn\'t read', () => {
    expect(unsupportedNetwork('https://www.facebook.com/watch/?v=1')).toBe('Facebook')
    expect(unsupportedNetwork('https://fb.watch/abc')).toBe('Facebook')
    expect(unsupportedNetwork('https://x.com/a/status/1')).toBe('X (Twitter)')
    expect(unsupportedNetwork('https://es.pinterest.com/pin/1')).toBe('Pinterest')
    expect(unsupportedNetwork('https://www.instagram.com/reel/x')).toBeNull()
    expect(unsupportedNetwork('https://www.youtube.com/watch?v=1')).toBeNull()
    expect(unsupportedNetwork('https://www.recetasderechupete.com/x')).toBeNull()
  })
})

describe('import_recipe_from_url: one sentence with the motive, then what works', () => {
  beforeEach(() => {
    vi.mocked(importRecipeFromUrl).mockReset()
  })

  it('private Instagram reel → motive + what works (with the screenshot), nothing saved', async () => {
    vi.mocked(importRecipeFromUrl).mockImplementation(async () => {
      throw new SocialCaptionUnavailableError('private')
    })
    const r = await importRecipeFromUrlSkill.handler({ url: 'https://www.instagram.com/reel/x' }, ctx)
    expect(r).toMatchObject({ data: null, uiHint: 'text' })
    expect(r.summary).toMatch(/^No se ha guardado nada/)
    expect(said(r.summary)).toBe(`No he podido abrir ese vídeo: es privado o pide iniciar sesión. ${IMPORT_WORKS}`)
  })
  it('a page without text keeps the screenshot sentence for the photo that comes next', async () => {
    vi.mocked(importRecipeFromUrl).mockImplementation(async () => {
      throw new NeedsScreenshotError(PAGE_SCREENSHOT_MESSAGE)
    })
    const r = await importRecipeFromUrlSkill.handler({ url: 'https://blog.example/receta' }, ctx)
    expect(r.summary).toContain(PAGE_SCREENSHOT_MESSAGE)
    expect(said(r.summary)).toMatch(/^Esa página no me deja leer la receta: no trae el texto\. Sí puedo con/)
  })
  it('a Facebook link: said up front, without trying', async () => {
    const r = await importRecipeFromUrlSkill.handler({ url: 'https://www.facebook.com/reel/123' }, ctx)
    expect(importRecipeFromUrl).not.toHaveBeenCalled()
    expect(said(r.summary)).toBe(`Los enlaces de Facebook no los puedo leer. ${IMPORT_WORKS}`)
  })
  it('the tool and the prompt say which links work and not to offer the others', () => {
    expect(importRecipeFromUrlSkill.description).toMatch(/no lee Facebook, X\/Twitter, Pinterest/)
    expect(importRecipeFromUrlSkill.description).toMatch(/no ofrezcas pegar enlaces de esas redes/)
    expect(IMPORT_WORKS).toMatch(/YouTube.*Instagram o TikTok.*webs de recetas.*captura/)
    const system = JSON.stringify(buildSystemParts({ tools: new Set(['import_recipe_from_url']) } as any))
    expect(system).toMatch(/no ofrezcas pegar enlaces de otras redes/)
  })
})
