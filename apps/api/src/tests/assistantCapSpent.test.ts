/**
 * PRO-1302: in the app's chat, with the month's cap used up, what the code
 * answers keeps working («¿qué hay hoy?», «la lista», «siguiente» in cook
 * mode); a request for the model gets the whole notice once (what still works
 * and where the menu and the list are) and one short line after that; the
 * turn that reaches the cap ends whole, with the notice.
 */
import express from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

const { chatMock, recordAdvisorUsage, budget, capHit, spendCap, todaysMenu, shoppingList } = vi.hoisted(() => ({
  chatMock: vi.fn(),
  recordAdvisorUsage: vi.fn(async () => 0),
  budget: vi.fn(),
  capHit: { told: false, record: vi.fn() },
  spendCap: vi.fn(),
  todaysMenu: vi.fn(),
  shoppingList: vi.fn(),
}))

vi.mock('../db/connection.js', () => ({
  db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => [], orderBy: async () => [] }) }) }), execute: async () => ({ rows: [] }) },
  pool: {},
}))
vi.mock('../middleware/auth.js', () => ({
  authMiddleware: (req: any, _res: any, next: any) => {
    req.userId = 'u-1'
    req.user = { role: 'user' }
    next()
  },
}))
vi.mock('../services/accountAccess.js', () => ({ requirePaidPlan: () => (_req: any, _res: any, next: any) => next() }))
vi.mock('../services/advisorBudget.js', () => ({
  BUDGET_WARNING_LINE: 'Te queda poco de Mimo este mes; se renueva el día 1.',
  checkAdvisorBudget: budget,
  crossesBudgetWarning: (before: number, added: number, cap: number) => before < cap * 0.8 && before + added >= cap * 0.8,
  recordAdvisorUsage,
}))
vi.mock('../services/spendCap.js', () => ({ spendCapStatus: spendCap }))
vi.mock('../services/capHits.js', () => ({
  capHitThisMonth: async () => capHit.told,
  recordCapHit: capHit.record,
}))
vi.mock('../services/recipeVisibility.js', () => ({ canViewRecipe: async () => true }))
vi.mock('../services/chatMessages.js', () => ({ recordWebChatTurn: async () => {} }))
vi.mock('../services/whatsapp/optInOffer.js', () => ({ claimOptInReoffer: async () => false, withReofferLine: (m: string) => m }))
vi.mock('../services/assistant/engine.js', () => ({ chat: chatMock }))
vi.mock('../services/assistant/skills.js', () => ({
  skills: [
    { name: 'get_todays_menu', handler: todaysMenu },
    { name: 'get_shopping_list', handler: shoppingList },
  ],
}))
vi.mock('../services/usageEvents.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/usageEvents.js')>()),
  trackEvent: vi.fn(),
}))

const { default: assistantRouter } = await import('../routes/assistant.js')
const { capNoticeApp, capNoticeAppShort } = await import('../services/capNotice.js')

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

const OVER = { exceeded: true, budgetMicros: 6_000_000, spentMicros: 6_200_000 }

beforeEach(() => {
  vi.clearAllMocks()
  capHit.told = false
  // The real table: one row per user and month; true only the first time.
  capHit.record.mockImplementation(async () => {
    if (capHit.told) return false
    capHit.told = true
    return true
  })
  budget.mockResolvedValue(OVER)
  spendCap.mockResolvedValue({ exceeded: false, spentEur: 6.2, capEur: 20 })
  chatMock.mockResolvedValue({ message: 'Hecho: el jueves, merluza en salsa.', actionTaken: true, usage: {} })
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Madrid' }).format(new Date())
  todaysMenu.mockResolvedValue({ data: { date: today, day: { lunch: { dishes: [{ kind: 'recipe', recipeId: 'r-1', recipeName: 'Lentejas' }] } } }, summary: 'Menu', uiHint: 'menu' })
  shoppingList.mockResolvedValue({ data: { listId: 'l-1', items: [{ name: 'Leche', aisle: 'lacteos' }] }, summary: 'Te faltan 1 cosas: Leche.', uiHint: 'shopping_list' })
})

const post = (body: unknown) =>
  fetch(`${base}/assistant/u-1/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({
    status: r.status,
    json: (await r.json()) as any,
  }))

describe('POST /assistant/:userId/chat con el tope agotado (PRO-1302)', () => {
  it('«¿qué hay hoy?» y «la lista» contestan; una petición al modelo recibe el aviso entero una sola vez', async () => {
    const hoy = await post({ message: '¿Qué hay hoy?', history: [] })
    expect(hoy.status).toBe(200)
    expect(hoy.json.message).toMatch(/^Hoy, .+:\n- Comida: Lentejas$/)
    const lista = await post({ message: 'Mándame la lista de la compra', history: [] })
    expect(lista.json).toMatchObject({ message: 'Te faltan 1 cosas: Leche.', uiHint: 'shopping_list' })

    const first = await post({ message: 'Cámbiame la cena del jueves', history: [] })
    expect(first.status).toBe(429)
    expect(first.json).toMatchObject({ code: 'ADVISOR_BUDGET_EXCEEDED', error: capNoticeApp(6), capEur: 6 })
    const second = await post({ message: '¿Y algo con pescado?', history: [] })
    expect(second.json.error).toBe(capNoticeAppShort(6))
    expect(chatMock).not.toHaveBeenCalled()
    expect(recordAdvisorUsage).not.toHaveBeenCalled()
  })

  it('el aviso dice qué sigue funcionando y dónde están el menú y la lista', () => {
    expect(capNoticeApp(6)).toContain('«¿qué hay hoy?», «mándame el menú», «la lista de la compra» y, en el modo cocina, «siguiente»')
    expect(capNoticeApp(6)).toContain('en Menú y en Compra')
  })

  it('el tope de toda la IA también: lo que contesta el código sigue', async () => {
    budget.mockResolvedValue({ exceeded: false, budgetMicros: 6_000_000, spentMicros: 1_000_000 })
    spendCap.mockResolvedValue({ exceeded: true, spentEur: 21, capEur: 20 })
    expect((await post({ message: 'qué comemos hoy', history: [] })).status).toBe(200)
    const r = await post({ message: 'hola', history: [] })
    expect(r.json).toMatchObject({ code: 'SPEND_CAP_EXCEEDED', error: capNoticeApp(20) })
    expect(capHit.record).toHaveBeenCalledWith(expect.objectContaining({ cap: 'ia', channel: 'app' }))
  })

  it('el turno que llega al tope se termina entero y lleva el aviso al final', async () => {
    budget.mockResolvedValue({ exceeded: false, budgetMicros: 6_000_000, spentMicros: 5_900_000 })
    recordAdvisorUsage.mockResolvedValueOnce(200_000)
    const r = await post({ message: 'Cámbiame el jueves por merluza', history: [] })
    expect(r.status).toBe(200)
    expect(r.json.message).toBe(`Hecho: el jueves, merluza en salsa.\n\n${capNoticeApp(6)}`)
    expect(capHit.record).toHaveBeenCalledOnce()
  })

  it('si ese turno pregunta algo, la respuesta lo termina (una vez) con el aviso', async () => {
    budget.mockResolvedValue({ exceeded: false, budgetMicros: 6_000_000, spentMicros: 5_900_000 })
    recordAdvisorUsage.mockResolvedValueOnce(200_000)
    chatMock.mockResolvedValueOnce({ message: '¿Te cambio el jueves por merluza?', actionTaken: false, usage: {} })
    const asking = await post({ message: 'Cámbiame el jueves', history: [] })
    expect(asking.json.message).toBe('¿Te cambio el jueves por merluza?')
    expect(capHit.record).not.toHaveBeenCalled()

    budget.mockResolvedValue(OVER)
    const history = [
      { role: 'user', content: 'Cámbiame el jueves' },
      { role: 'assistant', content: '¿Te cambio el jueves por merluza?' },
    ]
    const yes = await post({ message: 'sí', history })
    expect(yes.status).toBe(200)
    expect(yes.json.message).toBe(`Hecho: el jueves, merluza en salsa.\n\n${capNoticeApp(6)}`)
    const again = await post({ message: 'y el viernes', history: [...history, { role: 'user', content: 'sí' }, { role: 'assistant', content: '¿Algo más?' }] })
    expect(again.status).toBe(429)
    expect(again.json.error).toBe(capNoticeAppShort(6))
    expect(chatMock).toHaveBeenCalledTimes(2)
  })
})
