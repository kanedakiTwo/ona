/**
 * PRO-1315 (D-164) — in staging with «Mimo remoto» (MIMO_REMOTO=1) nothing
 * goes to the Anthropic API: the one-off calls of the test households go to
 * the office's queue (with their usual fallback when no answer comes), and
 * the jobs without a user (catalogue photos, daily review, the ficha's
 * nightly and weekly passes) don't run. No route makes an Anthropic client.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {}, pool: {} }))
vi.mock('../config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../config/env.js')>()
  return { ...mod, env: { ...mod.env, MIMO_REMOTO: true, ANTHROPIC_API_KEY: 'sk-test' } }
})

/** Every Anthropic client made in this file (there must be none). */
const made = vi.hoisted(() => ({ clients: 0 }))
vi.mock('@anthropic-ai/sdk', () => {
  class Anthropic {
    constructor() {
      made.clients++
      throw new Error('PRO-1315: un cliente de Anthropic con MIMO_REMOTO=1')
    }
  }
  return { default: Anthropic, Anthropic }
})

/** The office: keeps each request and answers it with what `office.answer` says. */
const office = vi.hoisted(() => ({ requests: [] as any[], answer: (_req: any): any => null }))
vi.mock('../services/assistant/mimoRemoto.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../services/assistant/mimoRemoto.js')>()
  const answers = new Map<string, any>()
  return {
    ...mod,
    dbTurnStore: () => ({
      async create(peticion: unknown) {
        const id = `t${office.requests.length}`
        office.requests.push(peticion)
        answers.set(id, office.answer(peticion))
        return id
      },
      async answerOf(id: string) { return answers.get(id) ?? null },
      async expire() { return true },
    }),
  }
})

import { aiJobsWithoutUserAllowed, anthropicClient } from '../services/anthropicClient.js'
import { cookNowPhrase } from '../services/cookNow/phrase.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { runProfileRefinerIfDue } from '../services/profile/refiner.js'
import { readRestrictionText } from '../services/restrictionReader.js'
import { runDailyReviewIfDue } from '../services/whatsapp/reviewer.js'

const FACTS = { recipeName: 'Lentejas', uses: [], expiring: [], lastCookedDaysAgo: null, repeat: false, missingSecondary: [] }
const costs: CostRow[] = []
setCostSinkForTests((row) => { costs.push(row) })

afterEach(() => {
  office.requests.length = 0
  office.answer = () => null
  costs.length = 0
})

describe('PRO-1315 — staging with MIMO_REMOTO=1: no Anthropic API', () => {
  it('the one-off client is the office queue, not Anthropic', async () => {
    office.answer = () => ({ content: [{ type: 'text', text: 'hola' }], stop_reason: 'end_turn' })
    const client = anthropicClient()
    const res: any = await client.messages.create({ model: 'm', max_tokens: 10, messages: [{ role: 'user', content: 'x' }] })
    expect(res.content[0].text).toBe('hola')
    expect(res.usage).toBeUndefined()
    expect(office.requests).toHaveLength(1)
    expect(made.clients).toBe(0)
  })

  it('a test household call goes by the queue: answered, no cost', async () => {
    office.answer = () => ({ content: [{ type: 'text', text: 'Hoy toca algo rico.' }], stop_reason: 'end_turn' })
    const phrase = await cookNowPhrase('u1', FACTS, { paused: async () => false, timeoutMs: 2000 })
    expect(phrase).toBeTruthy()
    expect(office.requests).toHaveLength(1)
    expect(office.requests[0].system).toBeTruthy()
    expect(costs).toHaveLength(0)
    expect(made.clients).toBe(0)
  })

  it('no answer in time → the usual fallback', async () => {
    const phrase = await cookNowPhrase('u1', FACTS, { paused: async () => false, timeoutMs: 50 })
    expect(phrase).toBeNull()
    office.answer = () => ({ content: [{ type: 'text', text: 'esto no es JSON' }], stop_reason: 'end_turn' })
    const reading = await readRestrictionText('u1', 'sin cosas raras', { loadCatalog: async () => [] })
    expect(reading).toBeTruthy()
    expect(office.requests).toHaveLength(2)
    expect(made.clients).toBe(0)
  })

  it('the jobs without a user do not run', async () => {
    expect(aiJobsWithoutUserAllowed()).toBe(false)
    // 10:00 Madrid on a Monday: review and refiner (nightly and weekly) would be due.
    const monday = new Date('2026-11-23T09:00:00Z')
    await expect(runDailyReviewIfDue(monday)).resolves.toBeNull()
    await expect(runProfileRefinerIfDue(monday)).resolves.toBeNull()
    expect(office.requests).toHaveLength(0)
    expect(made.clients).toBe(0)
  })

  it('nothing in the API makes an Anthropic client but the guarded places', () => {
    const src = join(fileURLToPath(new URL('.', import.meta.url)), '..')
    // Guarded on their own: Mimo (engine.ts) and the planner (menuPlannerShadow.ts) use the
    // queue themselves; the storage seals job leaves the API with PRO-1314.
    const allowed = new Set(['services/anthropicClient.ts', 'services/assistant/engine.ts', 'services/menuPlannerShadow.ts', 'services/catalogStorageLabels.ts'])
    const offenders: string[] = []
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) { if (name !== 'tests') walk(p); continue }
        if (!p.endsWith('.ts')) continue
        const rel = relative(src, p).split('\\').join('/')
        if (/new Anthropic\s*\(/.test(readFileSync(p, 'utf8')) && !allowed.has(rel)) offenders.push(rel)
      }
    }
    walk(src)
    expect(offenders).toEqual([])
  })
})
