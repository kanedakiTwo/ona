/**
 * PRO-1292: in the app's chat, «¿qué hay hoy?» and the cook mode's
 * «siguiente» are answered by the code: no model call and nothing metered —
 * `recordAdvisorUsage` is what writes the chat's row in `cost_events`, and it
 * never runs for these turns. Anything more goes to the model as before.
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
  chatMock.mockResolvedValue({ message: 'Respuesta del modelo', actionTaken: false, usage: { inputTokens: 10, outputTokens: 5 } })
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

describe('POST /assistant/:userId/chat — contesta el código (PRO-1292)', () => {
  it('«¿Qué hay hoy?»: el menú guardado, sin modelo ni coste; el evento y el turno guardado con su rastro', async () => {
    const r = await post({ message: '¿Qué hay hoy?', history: [] })
    expect(r.status).toBe(200)
    expect(r.json.message).toMatch(/^Hoy, .+:\n- Comida: Lentejas$/)
    expect(r.json.uiHint).toBe('menu')
    expect(todaysMenu).toHaveBeenCalledWith({ day: 'hoy' }, expect.objectContaining({ userId: 'u-1' }))
    expect(chatMock).not.toHaveBeenCalled()
    expect(recordAdvisorUsage).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('mimo_code_reply', { userId: 'u-1', channel: 'web', props: { kind: 'ver_menu' } })
    expect(recordWebChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ userMessage: '¿Qué hay hoy?', response: expect.objectContaining({ toolTrace: [expect.objectContaining({ name: 'get_todays_menu' })] }) }),
      expect.anything(),
    )
  })

  it('modo cocina, «Siguiente» por voz: lee el paso siguiente de la receta abierta y mueve la pantalla', async () => {
    const r = await post({
      message: 'Venga, siguiente.',
      history: [],
      mode: 'voice',
      context: { path: `/recipes/${RECIPE_ID}/cook`, cookStep: { step: 1, total: 3 } },
    })
    expect(r.json).toMatchObject({
      message: 'Paso 2 de 3: Pocha 150 g de cebolla y dos dientes de ajo.',
      uiHint: 'cooking_step',
      data: { direction: 'next' },
    })
    expect(chatMock).not.toHaveBeenCalled()
    expect(recordAdvisorUsage).not.toHaveBeenCalled()
    expect(trackEvent).toHaveBeenCalledWith('mimo_code_reply', { userId: 'u-1', channel: 'voice', props: { kind: 'paso_cocina' } })
  })

  it('«siguiente» fuera del modo cocina, o con otra pregunta, va al modelo y se cobra como siempre', async () => {
    await post({ message: 'siguiente', history: [], context: { path: '/menu' } })
    await post({
      message: 'siguiente, ¿y cuánto lo dejo?',
      history: [],
      context: { path: `/recipes/${RECIPE_ID}/cook`, cookStep: { step: 1, total: 3 } },
    })
    await post({ message: '¿qué hay hoy? y cámbiame el jueves', history: [] })
    expect(chatMock).toHaveBeenCalledTimes(3)
    expect(recordAdvisorUsage).toHaveBeenCalledTimes(3)
    expect(trackEvent).not.toHaveBeenCalledWith('mimo_code_reply', expect.anything())
  })

  it('un paso que no cuadra con la receta (otra versión en pantalla) va al modelo', async () => {
    await post({ message: 'siguiente', history: [], context: { path: `/recipes/${RECIPE_ID}/cook`, cookStep: { step: 1, total: 5 } } })
    expect(chatMock).toHaveBeenCalledOnce()
  })
})
