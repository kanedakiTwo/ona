/**
 * PRO-1272 (E-93, hallazgo 2): one recipe link could hold the whole API for
 * minutes. The JSON-LD and og:image regexes backtracked quadratically on
 * `<script type=x ` (or `<meta `) repeated without `>`; 120 KB took 1.8 s and
 * a page may weigh 2 MB. The page is now walked tag by tag.
 */
import { describe, expect, it } from 'vitest'
import { extractOgImage, parseJsonLdRecipe } from '../services/sources/article.js'

const TWO_MB = 2 * 1024 * 1024
const repeat = (s: string) => s.repeat(Math.ceil(TWO_MB / s.length))

function timed(fn: () => unknown): number {
  const t = performance.now()
  fn()
  return performance.now() - t
}

describe('una página hecha para atascar el extractor', () => {
  for (const [name, html] of [
    ['<script type=x sin cerrar', repeat('<script type=x ')],
    ['<meta property=og:image sin cerrar', repeat('<meta property="og:image" ')],
    ['<meta content=… sin cerrar', repeat('<meta content="https://a.b/c.jpg" ')],
    ['<link rel=image_src sin cerrar', repeat('<link rel="image_src" ')],
    ['<script> abiertos sin </script>', repeat('<script type="application/ld+json">{')],
  ] as const) {
    it(`${name}: 2 MB en menos de 200 ms`, () => {
      expect(html.length).toBeGreaterThanOrEqual(TWO_MB)
      const ms = timed(() => {
        expect(parseJsonLdRecipe(html)).toBeNull()
        expect(extractOgImage(html)).toBeNull()
      })
      expect(ms).toBeLessThan(200)
    })
  }
})

describe('lo de siempre sigue saliendo', () => {
  it('reads the JSON-LD recipe whatever the attribute order and capitals', () => {
    const html = `<html><head><SCRIPT id="x" TYPE='application/ld+json'>{"@type":"Recipe","name":"Lentejas","recipeIngredient":["200 g de lentejas"],"recipeInstructions":["Cocer"]}</SCRIPT></head></html>`
    expect(parseJsonLdRecipe(html)?.name).toBe('Lentejas')
  })

  it('finds og:image with content before or after the property, and its fallbacks in order', () => {
    expect(extractOgImage('<meta property="og:image" content="https://a.es/1.jpg">')).toBe('https://a.es/1.jpg')
    expect(extractOgImage("<meta content='https://a.es/2.jpg' name='og:image:secure_url'/>")).toBe('https://a.es/2.jpg')
    expect(
      extractOgImage('<meta name="twitter:image" content="https://a.es/t.jpg"><meta property="og:image" content="https://a.es/o.jpg">'),
    ).toBe('https://a.es/o.jpg')
    expect(extractOgImage('<meta name="twitter:image" content="https://a.es/t.jpg">')).toBe('https://a.es/t.jpg')
    expect(extractOgImage('<link rel="image_src" href="https://a.es/l.jpg">')).toBe('https://a.es/l.jpg')
  })

  it('skips an og:image that is not a web address', () => {
    expect(extractOgImage('<meta property="og:image" content="/rel.jpg">')).toBeNull()
  })

  it('keeps indexes right after characters whose lowercase is longer (İ)', () => {
    const html = `<p>İİİİ</p><script type="application/ld+json">{"@type":"Recipe","name":"Tortilla","recipeIngredient":["4 huevos"],"recipeInstructions":["Batir"]}</script>`
    expect(parseJsonLdRecipe(html)?.name).toBe('Tortilla')
  })
})
