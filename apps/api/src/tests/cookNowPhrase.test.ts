import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { cleanPhrase, cookNowPhrase, phraseFacts } from '../services/cookNow/phrase.js'

const costRows: CostRow[] = []
beforeAll(() => setCostSinkForTests(async (row) => void costRows.push(row)))
afterAll(() => setCostSinkForTests(null))

const facts = { recipeName: 'Tortilla de calabacín', uses: ['calabacín', 'huevo'], expiring: ['calabacín'], lastCookedDaysAgo: 12, repeat: true, missingSecondary: ['perejil'] }

describe('phraseFacts', () => {
  it('lists only the facts given', () => {
    const t = phraseFacts(facts)
    expect(t).toContain('calabacín, huevo')
    expect(t).toContain('Caduca pronto: calabacín')
    expect(t).toContain('hace 12 días')
    expect(t).toContain('Repetir a menudo')
  })
})

describe('cleanPhrase', () => {
  it('first line, no quotes, at most 160 characters', () => {
    expect(cleanPhrase('«Te gasta el calabacín.»\nOtra')).toBe('Te gasta el calabacín.')
    expect(cleanPhrase('x'.repeat(300)).length).toBeLessThanOrEqual(160)
    expect(cleanPhrase('   ')).toBeNull()
  })
})

describe('cookNowPhrase', () => {
  const ok = async () => ({ content: [{ type: 'text', text: 'Te gasta el calabacín, que caduca pronto.' }], usage: { input_tokens: 1, output_tokens: 1 } })
  it('returns the model line', async () => {
    expect(await cookNowPhrase('u', facts, { create: ok as any, paused: async () => false })).toBe('Te gasta el calabacín, que caduca pronto.')
  })
  it('null when the model fails, is slow or the account is paused', async () => {
    expect(await cookNowPhrase('u', facts, { create: async () => { throw new Error('x') }, paused: async () => false })).toBeNull()
    expect(await cookNowPhrase('u', facts, { create: () => new Promise(() => {}), paused: async () => false, timeoutMs: 10 })).toBeNull()
    expect(await cookNowPhrase('u', facts, { create: ok as any, paused: async () => true })).toBeNull()
  })
  it('bills the line to the user and household that asked for it, not to the system (PRO-1316)', async () => {
    costRows.length = 0
    await cookNowPhrase('user-1', facts, { create: ok as any, paused: async () => false, householdId: 'hh-1' })
    await new Promise((r) => setTimeout(r, 0))
    expect(costRows).toHaveLength(1)
    expect(costRows[0]).toMatchObject({ feature: 'cook_now_phrase', userId: 'user-1', householdId: 'hh-1' })
  })
})
