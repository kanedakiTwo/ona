/**
 * PRO-1316: every paid call has its place in the cost ledger. Hand-run
 * scripts record as `script_<name>` (system), the «Cocinar ahora» line stays
 * out of the monthly cap, and no script calls Anthropic with its own client
 * without recording it.
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PgDialect } from 'drizzle-orm/pg-core'
import { afterEach, describe, expect, it } from 'vitest'
import {
  billCostsToScript,
  flushCostEvents,
  getUserMonthlySpendEur,
  recordCost,
  runWithCostUser,
  setCostSinkForTests,
  type CostRow,
} from '../services/costLedger.js'
import { scriptAnthropic } from '../services/scriptCost.js'

afterEach(() => {
  billCostsToScript(null)
  setCostSinkForTests(null)
})

function captureSink(): CostRow[] {
  const rows: CostRow[] = []
  setCostSinkForTests(async (row) => {
    rows.push(row)
  })
  return rows
}

describe('scriptAnthropic', () => {
  it('records each answer as script_<name>, system, and returns it untouched', async () => {
    const rows = captureSink()
    const answer = { content: [{ type: 'text', text: 'hola' }], usage: { input_tokens: 100, output_tokens: 10 } }
    const client = { messages: { create: async (_args: unknown) => answer, other: () => 'x' }, extra: 1 }
    const wrapped = scriptAnthropic('mimoExam', client)
    expect(await wrapped.messages.create({ model: 'claude-opus-5-5', max_tokens: 10 })).toBe(answer)
    expect(wrapped.messages.other()).toBe('x')
    expect(wrapped.extra).toBe(1)
    await flushCostEvents()
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ feature: 'script_mimoExam', userId: null, provider: 'anthropic', model: 'claude-opus-5-5' })
    expect(rows[0].costMicros).toBeGreaterThan(0)
  })
})

describe('billCostsToScript', () => {
  it('relabels what services record and drops the user and household', async () => {
    const rows = captureSink()
    billCostsToScript('reimportRecipeFromUrl')
    await runWithCostUser('u1', async () => {
      recordCost({ feature: 'recipe_extract_url', provider: 'anthropic', model: 'claude-opus-5-5', units: { inputTokens: 10 }, householdId: 'hh-1' })
    })
    await flushCostEvents()
    expect(rows[0]).toMatchObject({ feature: 'script_reimportRecipeFromUrl', userId: null })
    expect(rows[0].householdId).toBeUndefined()
  })

  it('flushCostEvents waits for the inserts still running', async () => {
    let done = false
    setCostSinkForTests(async () => {
      await new Promise((r) => setTimeout(r, 20))
      done = true
    })
    recordCost({ feature: 'x', provider: 'anthropic', model: 'claude-opus-5-5', units: { inputTokens: 1 } })
    expect(done).toBe(false)
    await flushCostEvents()
    expect(done).toBe(true)
  })
})

describe('getUserMonthlySpendEur', () => {
  it('leaves the «Cocinar ahora» line out of the monthly cap', async () => {
    let query = ''
    const db = {
      execute: async (q: any) => {
        const { sql, params } = new PgDialect().sqlToQuery(q)
        query = `${sql} ${params.join('|')}`
        return { rows: [{ micros: 0 }] }
      },
    }
    await getUserMonthlySpendEur('00000000-0000-0000-0000-000000000001', new Date(), db as any)
    expect(query).toMatch(/feature NOT IN/)
    expect(query).toContain('cook_now_phrase')
  })
})

describe('hand-run scripts', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '../../scripts')
  const scripts = readdirSync(dir).filter((f) => f.endsWith('.ts'))

  it('none calls Anthropic with its own client without recording it', () => {
    const unrecorded = scripts.filter((f) => {
      const src = readFileSync(join(dir, f), 'utf8')
      return /new Anthropic\(/.test(src) && !/scriptAnthropic\(|billCostsToScript\(/.test(src)
    })
    expect(unrecorded).toEqual([])
  })

  it('those that record wait for the ledger before exiting', () => {
    const unflushed = scripts.filter((f) => {
      const src = readFileSync(join(dir, f), 'utf8')
      return /scriptAnthropic\(|billCostsToScript\(/.test(src) && !/flushCostEvents\(\)/.test(src)
    })
    expect(unflushed).toEqual([])
  })

  it('the one-off fills already done are gone', () => {
    for (const f of ['populateRecipeCourses.ts', 'populatePrepRequirements.ts', 'regenerateRecipes.ts']) expect(scripts).not.toContain(f)
  })
})
