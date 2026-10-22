/**
 * PRO-295 · «¿Qué te queda en la nevera?» read by Claude, not cut by commas.
 * Marina's literal answer (hogares de prueba, 2026-10-20) filled the despensa
 * with «Pues mira», «Me sienta fatal)», «Ni nata ni queso»…, none linked to an
 * ingredient, and her lactose intolerance went nowhere: the menu brought
 * dairy. Now: foods with quantity linked to the catalogue, nothing that isn't
 * food, and an allergy or intolerance stops the week until she says whether
 * to save it — also when the model fails (keyword rule).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../config/env.js', async (importOriginal) => {
  const real = await importOriginal<typeof import('../config/env.js')>()
  return { ...real, env: { ...real.env, ANTHROPIC_API_KEY: '' } }
})
const costs: unknown[][] = []
vi.mock('../services/costLedger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/costLedger.js')>()),
  recordAnthropicCost: vi.fn((...args: unknown[]) => {
    costs.push(args)
  }),
}))
vi.mock('../services/healthConsent.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/healthConsent.js')>()),
  hasHealthConsent: vi.fn(async () => false),
  grantHealthConsent: vi.fn(async () => {}),
}))
const pantry: any[] = []
vi.mock('../services/pantryStore.js', () => ({
  NoHouseholdError: class NoHouseholdError extends Error {},
  listPantryForUser: vi.fn(async () => pantry),
  addPantryForUser: vi.fn(async (_u: string, input: any) => {
    const row = { id: `p-${pantry.length + 1}`, quantity: 1, unit: 'u', storedAt: new Date().toISOString(), ...input }
    pantry.push(row)
    return row
  }),
  patchPantryForUser: vi.fn(async (_u: string, id: string, patch: any) => {
    const row = pantry.find((r) => r.id === id)
    Object.assign(row, patch)
    return row
  }),
}))

import {
  clearFridgeReadingCache,
  healthMentionByKeywords,
  prepareFridgeForMenu,
  readFridgeText,
  FRIDGE_READER_MODEL,
} from '../services/fridgeReader.js'
import { rememberFridge } from '../services/fridgeBoost.js'
import { skills } from '../services/assistant/skills.js'
import { weekPlanSchema, fridgeTextOf } from '@ona/shared'

/** The task's literal text (PRO-295). */
const MARINA =
  'Pues mira, me queda medio pollo asado de ayer, cuatro huevos, … leche sin lactosa (ojo: no tomo nada de lactosa, ni nata ni queso, me sienta fatal) …'

const CATALOG = [
  { id: 'ing-pollo', name: 'pollo' },
  { id: 'ing-huevo', name: 'huevo' },
  { id: 'ing-leche-sl', name: 'leche sin lactosa' },
  { id: 'ing-leche', name: 'leche' },
  { id: 'ing-nata', name: 'nata' },
  { id: 'ing-queso', name: 'queso' },
  { id: 'ing-calabacin', name: 'calabacín' },
]
const loadCatalog = async () => CATALOG

/** What Claude answers for Marina's text (simulated model). */
function marinaModel() {
  return vi.fn(async (_p: any) => ({
    content: [
      {
        type: 'tool_use',
        id: 't1',
        name: 'read_fridge',
        input: {
          items: [
            { name: 'pollo asado', ingredient: 'pollo', quantity: 0.5, unit: 'u' },
            { name: 'huevos', ingredient: 'huevo', quantity: 4, unit: 'u' },
            { name: 'leche sin lactosa', ingredient: 'leche sin lactosa', quantity: 1, unit: 'u' },
          ],
          health: { mentioned: true, restrictions: ['sin lactosa'], quote: 'no tomo nada de lactosa, ni nata ni queso, me sienta fatal' },
        },
      },
    ],
    usage: { input_tokens: 900, output_tokens: 300 },
  })) as any
}

beforeEach(() => {
  clearFridgeReadingCache()
  costs.length = 0
  pantry.length = 0
})
afterEach(() => vi.clearAllMocks())

describe('Marina’s fridge, read by Claude (simulated)', () => {
  it('foods with quantity, linked to the catalogue; nothing that isn’t food; the lactose is a health mention', async () => {
    const create = marinaModel()
    const r = await readFridgeText('u-1', MARINA, { create, loadCatalog })
    expect(r.source).toBe('model')
    expect(r.items).toEqual([
      { name: 'pollo asado', quantity: 0.5, unit: 'u', ingredientId: 'ing-pollo' },
      { name: 'huevos', quantity: 4, unit: 'u', ingredientId: 'ing-huevo' },
      { name: 'leche sin lactosa', quantity: 1, unit: 'u', ingredientId: 'ing-leche-sl' },
    ])
    const names = r.items.map((i) => i.name.toLowerCase())
    for (const junk of ['pues mira', 'me sienta fatal)', 'ni nata ni queso']) expect(names).not.toContain(junk)
    expect(r.health?.restrictions).toEqual(['sin lactosa'])
    // One call to Opus 5.5 (D-070), the whole text, billed in cost_events.
    expect(create).toHaveBeenCalledTimes(1)
    const params = create.mock.calls[0][0]
    expect(params.model).toBe('claude-opus-5-5')
    expect(JSON.stringify(params.messages)).toContain('ni nata ni queso')
    expect(costs).toEqual([['fridge_reader', FRIDGE_READER_MODEL, { input_tokens: 900, output_tokens: 300 }, 'u-1']])
  })

  it('the menu waits: «¿lo guardo como restricción?» first (and the same text is read once)', async () => {
    const create = marinaModel()
    const gate = await prepareFridgeForMenu('u-1', MARINA, undefined, 'web', { create, loadCatalog, hasConsent: async () => true })
    expect(gate).toEqual({ status: 'ask', restrictions: ['sin lactosa'], quote: 'no tomo nada de lactosa, ni nata ni queso, me sienta fatal', needsConsent: false })

    const save = vi.fn(async (_u: string, r: string[]) => r)
    const ready = await prepareFridgeForMenu('u-1', MARINA, { decision: 'save' }, 'web', { create, loadCatalog, hasConsent: async () => true, saveRestrictions: save })
    expect(ready.status).toBe('ready')
    expect(save).toHaveBeenCalledWith('u-1', ['sin lactosa'], 'profile')
    expect(create).toHaveBeenCalledTimes(1)
  })

  it('saving needs the health consent: ticked right there on the web, never by chat or WhatsApp', async () => {
    const create = marinaModel()
    const save = vi.fn(async (_u: string, r: string[]) => r)
    const grant = vi.fn(async () => {})
    const deps = { create, loadCatalog, hasConsent: async () => false, saveRestrictions: save, grantConsent: grant }

    expect((await prepareFridgeForMenu('u-1', MARINA, undefined, 'web', deps)).status).toBe('ask')
    expect(await prepareFridgeForMenu('u-1', MARINA, undefined, 'web', deps)).toMatchObject({ needsConsent: true })
    expect((await prepareFridgeForMenu('u-1', MARINA, { decision: 'save' }, 'web', deps)).status).toBe('needs_consent')
    expect((await prepareFridgeForMenu('u-1', MARINA, { decision: 'save', consent: true }, 'chat', deps)).status).toBe('needs_consent')
    expect((await prepareFridgeForMenu('u-1', MARINA, { decision: 'save', consent: true }, 'whatsapp', deps)).status).toBe('whatsapp_no_health')
    expect(save).not.toHaveBeenCalled()

    const ok = await prepareFridgeForMenu('u-1', MARINA, { decision: 'save', consent: true }, 'web', deps)
    expect(ok).toMatchObject({ status: 'ready', savedRestrictions: ['sin lactosa'] })
    expect(grant).toHaveBeenCalledWith('u-1')
    expect(save).toHaveBeenCalledTimes(1)
  })

  it('«no, genera sin guardarla» generates and saves nothing', async () => {
    const save = vi.fn(async (_u: string, r: string[]) => r)
    const gate = await prepareFridgeForMenu('u-1', MARINA, { decision: 'skip' }, 'web', { create: marinaModel(), loadCatalog, saveRestrictions: save })
    expect(gate).toMatchObject({ status: 'ready', savedRestrictions: [] })
    expect(save).not.toHaveBeenCalled()
  })

  it('the despensa gets the foods, linked; a food already there gets the quantity said now, in the fridge', async () => {
    pantry.push({ id: 'p-0', name: 'Huevos', ingredientId: 'ing-huevo', quantity: 12, unit: 'u', location: 'despensa', storedAt: new Date().toISOString() })
    const r = await readFridgeText('u-1', MARINA, { create: marinaModel(), loadCatalog })
    await rememberFridge('u-1', r.items)
    expect(pantry.map((p) => [p.name, p.ingredientId, p.quantity, p.location])).toEqual([
      ['Huevos', 'ing-huevo', 4, 'nevera'],
      ['pollo asado', 'ing-pollo', 0.5, 'nevera'],
      ['leche sin lactosa', 'ing-leche-sl', 1, 'nevera'],
    ])
  })
})

describe('the allergy rule without the model', () => {
  it('keywords force the question even if the model fails, and only catalogue foods enter', async () => {
    const create = vi.fn(async () => {
      throw new Error('overloaded')
    }) as any
    const r = await readFridgeText('u-1', MARINA, { create, loadCatalog })
    expect(r.source).toBe('fallback')
    expect(r.health?.restrictions).toEqual(['sin lactosa'])
    expect(r.items.every((i) => i.ingredientId)).toBe(true)
    expect(r.items.map((i) => i.name)).not.toContain('Pues mira')

    const gate = await prepareFridgeForMenu('u-1', MARINA, undefined, 'web', { create, loadCatalog, hasConsent: async () => true })
    expect(gate.status).toBe('ask')
  })

  it('keywords win even when the model says there is no health mention', async () => {
    const create = vi.fn(async () => ({
      content: [{ type: 'tool_use', id: 't', name: 'read_fridge', input: { items: [], health: { mentioned: false } } }],
      usage: { input_tokens: 1, output_tokens: 1 },
    })) as any
    const r = await readFridgeText('u-1', 'dos yogures; mi hijo es alérgico al huevo', { create, loadCatalog })
    expect(r.health).toEqual({ restrictions: ['huevo'], quote: 'mi hijo es alérgico al huevo' })
  })

  it('the words of the task: «no tomo», «alergia», «me sienta mal»', () => {
    expect(healthMentionByKeywords('nata, que no tomo lactosa')).not.toBeNull()
    expect(healthMentionByKeywords('tengo alergia a las nueces')?.restrictions).toEqual(['frutos secos'])
    expect(healthMentionByKeywords('el queso me sienta mal')?.restrictions).toEqual(['sin lactosa'])
    expect(healthMentionByKeywords('soy celíaca')?.restrictions).toEqual(['sin gluten'])
    // A product «sin lactosa» alone, or plain food, is not a health mention.
    expect(healthMentionByKeywords('Medio calabacín, cuatro huevos, leche sin lactosa')).toBeNull()
    // Eggs in the fridge are not an egg allergy: only the health clause counts.
    expect(healthMentionByKeywords('cuatro huevos. No tomo lactosa')?.restrictions).toEqual(['sin lactosa'])
  })
})

describe('the /menu box and Mimo send the whole text', () => {
  it('the form sends the text whole and the API accepts it', async () => {
    const { buildWeekPlan } = await import('../../../web/src/lib/weekPlanForm')
    const plan = buildWeekPlan([], {}, MARINA)
    expect(plan).toEqual({ fridgeText: MARINA })
    expect(weekPlanSchema.safeParse(plan).success).toBe(true)
    expect(weekPlanSchema.safeParse({ ...plan, fridgeAnswer: { decision: 'save', consent: true } }).success).toBe(true)
    expect(buildWeekPlan([], {}, 'nada')).toBeUndefined()
    expect(fridgeTextOf({ fridge: ['medio calabacín', 'nata'] })).toBe('medio calabacín, nata')
  })

  it('Mimo (chat and WhatsApp): with an allergy in fridge_text the menu is not generated and Mimo asks', async () => {
    const skill = skills.find((s) => s.name === 'generate_weekly_menu')!
    const db: any = {
      select: () => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }), limit: async () => [] }) }) }),
      insert: vi.fn(),
    }
    for (const channel of ['text', 'whatsapp'] as const) {
      clearFridgeReadingCache()
      const r = await skill.handler({ fridge_text: MARINA }, { userId: 'u-1', db, channel } as any)
      expect(r.summary).toContain('Menu NO generado')
      expect(r.summary).toContain('sin lactosa')
      expect(r.summary).toContain('fridge_health')
      expect(db.insert).not.toHaveBeenCalled()
    }
  })
})
