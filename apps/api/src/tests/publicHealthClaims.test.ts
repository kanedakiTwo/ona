/**
 * Guard: no health claims on ONA's public marketing pages.
 *
 * Why this exists: on 2026-10-07 the landing and footer sold a
 * "filosofía antiinflamatoria". ONA HQ's constitution (§6) forbids health
 * effects in any external material, and RD 1907/1996 art. 4 bans advertising
 * unproven preventive or therapeutic effects. Several Claude sessions write
 * copy in parallel, so this scans the public surfaces on every CI run.
 *
 * The advisor's knowledge base (kb/) is product-internal and out of scope.
 * If a phrase here is legitimately needed (e.g. a legal page quoting the
 * law), add that file to ALLOWED with a comment saying why.
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'

const WEB_SRC = resolve(__dirname, '../../../web/src')

const PUBLIC_SURFACES = [
  'app/(public)',
  'components/shared/Footer.tsx',
]

/** Pages that may name these words without making a claim (legal texts). */
const ALLOWED = new Set<string>([
  'app/(public)/privacidad/page.tsx',
  'app/(public)/terminos/page.tsx',
])

const BANNED: Array<[RegExp, string]> = [
  [/antiinflamatori/i, 'antiinflamatorio/a'],
  [/reduce(n)? la inflamaci[oó]n/i, 'reduce la inflamación'],
  [/\bprevien(e|en)\b/i, 'previene'],
  [/\bcura(n)?\b/i, 'cura'],
  [/\badelgaza/i, 'adelgaza'],
  [/p[eé]rdida de peso|perder peso|pierde peso/i, 'pérdida de peso'],
  [/quema(r)? grasa/i, 'quema grasa'],
  [/control(a|ar) (la )?(glucosa|insulina|az[uú]car en sangre)/i, 'controla la glucosa/insulina'],
  [/depura|desintoxica|detox/i, 'depura / detox'],
  [/microbiota|microbioma|salud intestinal/i, 'microbioma'],
  [/refuerza (las|tus) defensas|sistema inmune/i, 'defensas'],
  [/protege (el|tu) coraz[oó]n/i, 'protege el corazón'],
  [/cardi[oó]log/i, 'cardiólogo como reclamo'],
]

function filesUnder(rel: string): string[] {
  const abs = join(WEB_SRC, rel)
  if (statSync(abs).isFile()) return [abs]
  return readdirSync(abs).flatMap((name) => filesUnder(join(rel, name)))
}

describe('public marketing pages make no health claims (constitution §6, RD 1907/1996)', () => {
  const files = PUBLIC_SURFACES.flatMap(filesUnder).filter((f) => /\.(tsx?|mdx?)$/.test(f))

  it('scans at least the landing page and the footer', () => {
    const rels = files.map((f) => relative(WEB_SRC, f))
    expect(rels).toContain('app/(public)/page.tsx')
    expect(rels).toContain('components/shared/Footer.tsx')
  })

  for (const file of files) {
    const rel = relative(WEB_SRC, file)
    if (ALLOWED.has(rel)) continue
    it(rel, () => {
      const text = readFileSync(file, 'utf8')
      const hits = BANNED.filter(([re]) => re.test(text)).map(([, label]) => label)
      expect(hits, `claims prohibidos en ${rel}`).toEqual([])
    })
  }
})
