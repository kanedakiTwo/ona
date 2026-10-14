/**
 * PRO-92: the blog's front matter + Markdown parser (apps/web/src/lib/blog/markdown.ts).
 *
 * Publishing an article is just flipping `publicado` to true, so the parser is
 * what decides what the public sees: a bad header must throw (the build fails)
 * instead of the article silently vanishing or showing, and unsafe links must
 * never become <a>. Also checks that every real article in
 * apps/web/content/blog parses.
 *
 * Run: pnpm --filter @ona/api test src/tests/blogMarkdown.test.ts
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  formatBlogDate,
  isValidSlug,
  parseArticle,
  parseInline,
  parseMarkdown,
} from '../../../web/src/lib/blog/markdown'

const HEADER = [
  '---',
  'titulo: "Un título: con dos puntos"',
  'fecha: 2026-10-14',
  'autor: Miguel Martín',
  'resumen: Resumen corto.',
  'imagen: /landing/step-02.jpg',
  'publicado: false',
  '---',
].join('\n')

describe('parseArticle', () => {
  it('reads the header and returns the body', () => {
    const { meta, body } = parseArticle(`${HEADER}\nHola.\n`)
    expect(meta).toEqual({
      titulo: 'Un título: con dos puntos',
      fecha: '2026-10-14',
      autor: 'Miguel Martín',
      resumen: 'Resumen corto.',
      imagen: '/landing/step-02.jpg',
      publicado: false,
    })
    expect(body).toBe('Hola.\n')
  })

  it('publicado: true is the only way to publish', () => {
    expect(parseArticle(HEADER.replace('publicado: false', 'publicado: true')).meta.publicado).toBe(true)
    expect(() => parseArticle(HEADER.replace('publicado: false', 'publicado: sí'))).toThrow(/publicado/)
  })

  it('throws on a missing header or field, or a bad date / image', () => {
    expect(() => parseArticle('Sin cabecera')).toThrow(/cabecera/)
    expect(() => parseArticle(HEADER.replace('autor: Miguel Martín\n', ''))).toThrow(/autor/)
    expect(() => parseArticle(HEADER.replace('2026-10-14', '14/10/2026'))).toThrow(/fecha/)
    expect(() => parseArticle(HEADER.replace('/landing/step-02.jpg', 'javascript:alert(1)'))).toThrow(/imagen/)
  })

  it('accepts CRLF files', () => {
    expect(parseArticle(`${HEADER}\nHola.`.replace(/\n/g, '\r\n')).meta.autor).toBe('Miguel Martín')
  })
})

describe('parseMarkdown', () => {
  it('parses headings, paragraphs, lists, quotes, images and rules', () => {
    const blocks = parseMarkdown(
      [
        '# Título dentro', '', 'Línea uno', 'línea dos.', '', '### Sub', '',
        '- a', '- b', '', '1. uno', '2. dos', '', '> cita', '> larga', '', '![Foto](/landing/step-01.jpg)', '', '---',
      ].join('\n'),
    )
    expect(blocks.map((b) => b.type)).toEqual(['heading', 'paragraph', 'heading', 'list', 'list', 'quote', 'image', 'rule'])
    expect(blocks[0]).toMatchObject({ level: 2 })
    expect(blocks[1]).toEqual({ type: 'paragraph', children: [{ type: 'text', text: 'Línea uno línea dos.' }] })
    expect(blocks[2]).toMatchObject({ level: 3 })
    expect(blocks[3]).toMatchObject({ ordered: false, items: [[{ text: 'a' }], [{ text: 'b' }]] })
    expect(blocks[4]).toMatchObject({ ordered: true })
    expect(blocks[5]).toEqual({ type: 'quote', children: [{ type: 'text', text: 'cita larga' }] })
    expect(blocks[6]).toEqual({ type: 'image', alt: 'Foto', src: '/landing/step-01.jpg' })
  })

  it('does not hang on a line that looks like an image but is not one', () => {
    expect(parseMarkdown('![sin cerrar y texto')).toEqual([
      { type: 'paragraph', children: [{ type: 'text', text: '![sin cerrar y texto' }] },
    ])
  })

  it('drops images from unsafe sources', () => {
    expect(parseMarkdown('![x](http://evil.example/x.jpg)')).toEqual([])
    expect(parseMarkdown('![x](//evil.example/x.jpg)')).toEqual([])
  })
})

describe('parseInline', () => {
  it('bold, italic, code and links', () => {
    expect(parseInline('a **b** *c* `d` [e](/como-funciona)')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'strong', children: [{ type: 'text', text: 'b' }] },
      { type: 'text', text: ' ' },
      { type: 'em', children: [{ type: 'text', text: 'c' }] },
      { type: 'text', text: ' ' },
      { type: 'code', text: 'd' },
      { type: 'text', text: ' ' },
      { type: 'link', href: '/como-funciona', children: [{ type: 'text', text: 'e' }] },
    ])
  })

  it('keeps unsafe links as plain text', () => {
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([{ type: 'text', text: 'clic)' }])
    expect(parseInline('[otro](//evil.example)')).toEqual([{ type: 'text', text: 'otro' }])
  })

  it('raw HTML stays text (the page renders tokens, never HTML)', () => {
    expect(parseInline('<script>x</script>')).toEqual([{ type: 'text', text: '<script>x</script>' }])
  })
})

describe('slugs and dates', () => {
  it('slugs are lowercase words joined by hyphens', () => {
    expect(isValidSlug('decidir-la-cena')).toBe(true)
    expect(isValidSlug('Mayus')).toBe(false)
    expect(isValidSlug('../etc')).toBe(false)
  })

  it('formats AAAA-MM-DD in Spanish without shifting the day', () => {
    expect(formatBlogDate('2026-10-14')).toBe('14 de octubre de 2026')
  })
})

describe('real articles in apps/web/content/blog', () => {
  const dir = resolve(__dirname, '../../../web/content/blog')
  const files = readdirSync(dir).filter((f) => f.endsWith('.md'))

  it('there is at least the example article', () => {
    expect(files.length).toBeGreaterThan(0)
  })

  for (const file of files) {
    it(`${file} has a valid name and header`, () => {
      expect(isValidSlug(file.slice(0, -3))).toBe(true)
      expect(() => parseArticle(readFileSync(join(dir, file), 'utf8'))).not.toThrow()
    })
  }
})
