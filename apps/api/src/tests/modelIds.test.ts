/**
 * PRO-232 (D-070): every Claude call of the product uses one constant,
 * `CLAUDE_MODEL` in `config/models.ts` (Opus 5.5). This fails if a
 * `claude-…` model id appears anywhere else in `src/` (pricing and tests
 * excepted), so the next change of model stays a one-line change.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CLAUDE_MODEL } from '../config/models.js'
import { PRICES } from '../config/pricing.js'

const SRC = fileURLToPath(new URL('..', import.meta.url))
const ALLOWED = new Set(['config/models.ts', 'config/pricing.ts'])
const MODEL_ID = /claude-(?:opus|sonnet|haiku|fable|mythos)-[0-9][a-z0-9-]*/g

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return name === 'tests' || name === 'node_modules' ? [] : sourceFiles(path)
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [path] : []
  })
}

describe('Claude model ids (PRO-232)', () => {
  it('the product model is Opus 5.5', () => {
    expect(CLAUDE_MODEL).toBe('claude-opus-5-5')
  })

  it('no other file in src/ names a Claude model', () => {
    const offenders: string[] = []
    for (const file of sourceFiles(SRC)) {
      const rel = relative(SRC, file).split('\\').join('/')
      if (ALLOWED.has(rel)) continue
      for (const m of readFileSync(file, 'utf8').matchAll(MODEL_ID)) offenders.push(`${rel}: ${m[0]}`)
    }
    expect(offenders).toEqual([])
  })

  it('the cost ledger has a price for it', () => {
    expect(PRICES[`anthropic/${CLAUDE_MODEL}`]).toMatchObject({ currency: 'USD', inputPerMTok: 4, outputPerMTok: 20 })
  })
})
