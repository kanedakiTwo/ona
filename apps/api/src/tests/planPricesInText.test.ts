/**
 * PRO-394 (D-169): prices come from `PLANS`, never by hand. No text in the
 * web, the API, Mimo's knowledge base or the specs says a Plus price other
 * than the one in `PLANS`, and no «x,99 €» price is left from an old plan.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PAID_PLANS, euros, planByKey } from '@ona/shared'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '../../../..')
const ROOTS = ['apps/web/src', 'apps/api/src', 'kb', 'specs', 'packages/shared/src']
/** Tests quote the figures on purpose (and examples of other amounts). */
const SKIP = new Set(['node_modules', 'tests', '.next'])

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files(p, out)
    else if (/\.(tsx?|md)$/.test(name)) out.push(p)
  }
  return out
}

const texts = ROOTS.flatMap((r) => files(join(REPO, r))).map((p) => ({ path: relative(REPO, p), text: readFileSync(p, 'utf8') }))

/** «9,99 €», «8,33 €» without the period. */
const amountOf = (label: string) => label.replace(/\s*\/.*$/, '').replace(/\s+€/, ' €')
const plus = planByKey('plus')
const PLUS_AMOUNTS = new Set([
  ...Object.values(plus.prices).map((p) => euros(p.cents)),
  ...Object.values(plus.prices).flatMap((p) => (p.perMonth ? [amountOf(p.perMonth)] : [])),
])
/** Gratis (PRO-385) has no prices. */
const PLAN_AMOUNTS = new Set(PAID_PLANS.flatMap((p) => Object.values(p.prices).map((pr) => euros(pr.cents))))

describe('plan prices in text (PRO-394)', () => {
  it('reads the files', () => {
    expect(texts.some((t) => t.path === 'apps/web/src/app/(public)/precios/page.tsx')).toBe(true)
    expect(texts.some((t) => t.path === 'kb/sobre-mimoia.md')).toBe(true)
  })

  it('every «Plus … x €» is a price of Plus in PLANS', () => {
    const wrong: string[] = []
    for (const { path, text } of texts) {
      for (const m of text.matchAll(/\bPlus\b[^.\n€]{0,40}?(\d+(?:,\d{1,2})?)\s?€/g)) {
        const amount = `${m[1]} €`
        if (!PLUS_AMOUNTS.has(amount)) wrong.push(`${path}: «${m[0]}»`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('every «x,99 €» is a price in PLANS', () => {
    const wrong: string[] = []
    for (const { path, text } of texts) {
      for (const m of text.matchAll(/(\d+),99\s?€/g)) {
        if (!PLAN_AMOUNTS.has(`${m[1]},99 €`)) wrong.push(`${path}: «${m[0]}»`)
      }
    }
    expect(wrong).toEqual([])
  })

  it('Plus is 9,99 € a month and 99,99 € a year (D-169)', () => {
    expect([plus.prices.mensual.cents, plus.prices.anual.cents]).toEqual([999, 9999])
    expect(plus.prices.anual.perMonth).toBe('8,33 €/mes')
  })
})
