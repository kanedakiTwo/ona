/**
 * Guard: no health claims on Mimoia's public marketing pages.
 *
 * Why this exists: on 2026-10-07 the landing and footer sold a
 * "filosofía antiinflamatoria". Mimoia HQ's constitution (§6) forbids health
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
import { HEALTH_CLAIM_PATTERNS } from '../services/assistant/healthGuard.js'

const WEB_SRC = resolve(__dirname, '../../../web/src')

const PUBLIC_SURFACES = [
  'app/(public)',
  'components/shared/Footer.tsx',
  // The public recipe page's waitlist block and link-preview text (specs/recipes.md).
  'components/recipes/RecipeWaitlistCta.tsx',
  'lib/recipeMetadata.ts',
  // The landing's waitlist section + share text (specs/waitlist.md).
  'components/waitlist',
  // The blog (specs/blog.md): its components and every article, published or not.
  'components/blog',
  '../content/blog',
]

/** Pages that may name these words without making a claim (legal texts). */
const ALLOWED = new Set<string>([
  'app/(public)/privacidad/page.tsx',
  'app/(public)/terminos/page.tsx',
])

/** The §6 guard list lives in healthGuard.ts: the conversation flags scan Mimo's replies with it too. */
const BANNED = HEALTH_CLAIM_PATTERNS

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
    expect(rels).toContain('components/waitlist/WaitlistSection.tsx')
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
