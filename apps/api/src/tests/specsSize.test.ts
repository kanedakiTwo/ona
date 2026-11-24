/**
 * Specs guard (PRO-405, auditoría del 18-nov P-7): every agent reads the specs
 * whole, and they had grown from 35.000 to 190.000 words (`menus.md` alone,
 * 22.000). Two checks over `specs/**`:
 *
 * - **Word cap**: a spec over `SPEC_WORD_CAP` words is reported as a warning
 *   (a `::warning` line the CI shows on the run) but never fails the run.
 *   Split it by topics like `menus.md`: the spec keeps a «## Partes» list
 *   linking each `<spec>-<tema>.md`, and what no longer exists goes to
 *   `specs/historico/<spec>.md`.
 * - **No broken paths**: every relative link in a spec (`## Source` paths and
 *   links between specs) points to a file or folder that exists. This one
 *   fails: moving or splitting a spec must not leave dead links behind.
 */
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'

const REPO = resolve(__dirname, '../../../..')
const SPECS = join(REPO, 'specs')

const SPEC_WORD_CAP = 5000

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length
}

/** Relative link targets of a markdown text, outside code blocks and spans. */
function relativeLinks(markdown: string): string[] {
  const text = markdown.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const links: string[] = []
  let at = text.indexOf('](')
  while (at !== -1) {
    // The target may hold parentheses of its own (`app/(public)/…`): read to
    // the one that closes the link.
    let depth = 1
    let end = at + 2
    while (end < text.length && depth > 0 && text[end] !== '\n') {
      if (text[end] === '(') depth++
      else if (text[end] === ')') depth--
      if (depth > 0) end++
    }
    const target = text.slice(at + 2, end).trim().split(/\s+/)[0] ?? ''
    if (depth === 0 && target && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('#')) {
      links.push(target)
    }
    at = text.indexOf('](', end)
  }
  return links
}

function specFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return specFiles(path)
    return name.endsWith('.md') ? [path] : []
  })
}

describe('relativeLinks', () => {
  it('reads paths with parentheses and skips URLs, anchors and code', () => {
    const md = [
      '- [page](../apps/web/src/app/(public)/blog/page.tsx) — the blog',
      '- [Menus → Semana tipo](./menus-semana-tipo.md#semana-tipo-d-182)',
      '[web](https://mimoia.app) [here](#partes) `[x](src)`',
      '```',
      '[inside](./nope.md)',
      '```',
    ].join('\n')
    expect(relativeLinks(md)).toEqual([
      '../apps/web/src/app/(public)/blog/page.tsx',
      './menus-semana-tipo.md#semana-tipo-d-182',
    ])
  })

  it('counts words as whitespace-separated tokens', () => {
    expect(countWords('  Tiene\n cuatro  palabras así ')).toBe(4)
  })
})

describe('specs', () => {
  const files = specFiles(SPECS)

  it('finds the specs, the split parts and the history', () => {
    const names = files.map((f) => relative(SPECS, f))
    for (const name of ['index.md', 'menus.md', 'menus-semana-tipo.md', 'advisor.md', 'historico/menus.md']) {
      expect(names).toContain(name)
    }
  })

  it(`warns (without failing) about any spec over ${SPEC_WORD_CAP} words`, () => {
    const over = files
      .map((f) => ({ file: relative(REPO, f), words: countWords(readFileSync(f, 'utf8')) }))
      .filter((s) => s.words > SPEC_WORD_CAP)
    for (const s of over) {
      console.warn(
        `::warning file=${s.file}::${s.file} tiene ${s.words} palabras (tope ${SPEC_WORD_CAP}, PRO-405): pártela por temas como specs/menus.md`,
      )
    }
  })

  it('has no broken relative links (## Source paths and links between specs)', () => {
    const broken: string[] = []
    for (const file of files) {
      for (const link of relativeLinks(readFileSync(file, 'utf8'))) {
        const path = decodeURIComponent(link.split('#')[0] ?? '')
        if (!path) continue
        if (!existsSync(resolve(dirname(file), path))) broken.push(`${relative(REPO, file)} → ${link}`)
      }
    }
    expect(broken).toEqual([])
  })
})
