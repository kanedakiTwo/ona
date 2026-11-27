/**
 * PRO-1336: the web chat's mic (`mode: 'voice'`). Clear words go to Mimo with
 * the voice-note note and a change comes back with «Entendido: …» first;
 * doubtful or empty ones get a question, no model and nothing metered.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const RECIPE_ID = '11111111-2222-4333-8444-555555555555'
const STEPS = ['Lava las alubias.', 'Pocha 150 g de cebolla y dos dientes de ajo.', 'Añade el caldo.']

const { chatMock, recordAdvisorUsage, recordWebChatTurn, trackEvent, todaysMenu } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  recordAdvisorUsage: vi.fn(async () => 0),
  recordWebChatTurn: vi.fn(async () => {}),
  trackEvent: vi.fn(),
  todaysMenu: vi.fn(),
}))

vi.mock('../db/connection.js', async () => {
  const { recipes, recipeSteps } = await import('../db/schema.js')
  const rowsOf = (table: unknown) =>
    table === recipes ? [{ name: 'Alubias guisadas', authorId: null }] : table === recipeSteps ? STEPS.map((text) => ({ text })) : []
  const select = () => ({
    from: (table: unknown) => ({
      where: () => ({
        limit: async () => rowsOf(table),
        orderBy: async () => rowsOf(table),
      }),
    }),
  })
  return { db: { select, execute: async () => ({ rows: [] }), insert: () => ({ values: async () => {} }) }, pool: {} }
})
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'u-1'
    next()
  },
}))
vi.mock('../services/spendCap.js', () => ({ spendCapStatus: async () => ({ exceeded: false, spentEur: 0, capEur: 6 }) }))
vi.mock('../services/accountAccess.js', () => ({ requirePaidPlan: () => (_req: any, _res: any, next: any) => next() }))
vi.mock('../services/advisorBudget.js', () => ({
  BUDGET_WARNING_LINE: 'aviso',
  checkAdvisorBudget: async () => ({ exceeded: false, budgetMicros: 5_000_000, spentMicros: 0 }),
  crossesBudgetWarning: () => false,
  recordAdvisorUsage,
}))
vi.mock('../services/recipeVisibility.js', () => ({ canViewRecipe: async () => true }))
vi.mock('../services/chatMessages.js', () => ({ recordWebChatTurn }))
vi.mock('../services/whatsapp/optInOffer.js', () => ({ claimOptInReoffer: async () => false, withReofferLine: (m: string) => m }))
vi.mock('../services/assistant/engine.js', () => ({ chat: chatMock }))
vi.mock('../services/assistant/skills.js', () => ({ skills: [{ name: 'get_todays_menu', handler: todaysMenu }] }))
vi.mock('../services/usageEvents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/usageEvents.js')>()),
  trackEvent,
}))

const { default: assistantRouter } = await import('../routes/assistant.js')
const { VOICE_NOTE_NOTE, voiceDoubtfulReply, voiceEmptyReply } = await import('../services/assistant/voiceNote.js')

let server: Server
let base = ''
beforeAll(async () => {
  const app = express()
  app.use(express.json())
  app.use(assistantRouter)
  server = app.listen(0)
  await new Promise((r) => server.once('listening', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => server.close())

beforeEach(() => {
  vi.clearAllMocks()
  chatMock.mockResolvedValue({
    message: 'Hecho:\n- Jueves, cena: Tortilla de patatas',
    actionTaken: true,
    toolsUsed: ['swap_meal'],
    toolTrace: [{ name: 'swap_meal', input: '{}', summary: 'Jueves, cena: Tortilla de patatas (antes: Merluza)' }],
    usage: { inputTokens: 10, outputTokens: 5 },
  })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  todaysMenu.mockResolvedValue({
    data: { date: today, day: { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-1', recipeName: 'Lentejas' }] } } },
    summary: 'Menu de hoy: comida: Lentejas',
    uiHint: 'menu',
  })
})

const post = (body: unknown) =>
  fetch(`${base}/assistant/u-1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    json: (await r.json()) as any,
  }))

describe('POST /assistant/:userId/chat — notas de voz del micro (PRO-1336)', () => {
  it('claro: va al modelo con la nota y el cambio vuelve con lo entendido delante', async () => {
    const r = await post({ message: 'quita el pescado del jueves', history: [], mode: 'voice', context: { path: '/menu' } })
    expect(r.status).toBe(200)
    expect(r.json.message).toBe('Entendido: «quita el pescado del jueves».\nHecho:\n- Jueves, cena: Tortilla de patatas')
    expect(chatMock).toHaveBeenCalledOnce()
    expect(chatMock.mock.calls[0][1]).toContain(`${VOICE_NOTE_NOTE}\n\nquita el pescado del jueves`)
    expect(recordAdvisorUsage).toHaveBeenCalledOnce()
  })

  it('dudoso: lo que oyó y una pregunta, sin modelo ni coste', async () => {
    const r = await post({ message: 'Pescado.', history: [], mode: 'voice', context: { path: '/menu' } })
    expect(r.json).toEqual({ message: voiceDoubtfulReply('Pescado.'), actionTaken: false })
    expect(chatMock).not.toHaveBeenCalled()
    expect(recordAdvisorUsage).not.toHaveBeenCalled()
    expect(recordWebChatTurn).toHaveBeenCalledOnce()
  })

  it('una palabra que contesta a la pregunta de Mimo va al modelo', async () => {
    await post({ message: 'Pescado.', history: [{ role: 'assistant', content: '¿Qué quito del jueves?' }], mode: 'voice', context: { path: '/menu' } })
    expect(chatMock).toHaveBeenCalledOnce()
  })

  it('vacío (un fantasma del reconocimiento de voz): pide repetirlo', async () => {
    const r = await post({ message: 'Subtítulos realizados por la comunidad de Amara.org', history: [], mode: 'voice' })
    expect(r.json).toEqual({ message: voiceEmptyReply(), actionTaken: false })
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('escrito (modo texto), nada cambia: ni nota ni línea', async () => {
    const r = await post({ message: 'Pescado.', history: [], context: { path: '/menu' } })
    expect(r.json.message).toBe('Hecho:\n- Jueves, cena: Tortilla de patatas')
    expect(chatMock.mock.calls[0][1]).not.toContain(VOICE_NOTE_NOTE)
  })
})
