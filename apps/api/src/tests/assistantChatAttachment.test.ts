/**
 * 2026-11-26: one photo or PDF with the message in the web chat (multipart,
 * field `file`). The route checks type and size, hands it to the engine for
 * this turn (never stored), keeps «[Adjunto]» in the saved turn and counts
 * `mimo_diet_document`. A JSON message without a file works as before.
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

const send = async (fields: Record<string, string>, file?: { bytes: Uint8Array; type: string; name: string }) => {
  const form = new FormData()
  for (const [k, v] of Object.entries(fields)) form.append(k, v)
  if (file) form.append('file', new Blob([file.bytes], { type: file.type }), file.name)
  const r = await fetch(`${base}/assistant/u-1/chat`, { method: 'POST', body: form })
  return { status: r.status, json: (await r.json()) as any }
}
const PDF = new TextEncoder().encode('%PDF-1.4\n1 0 obj << /Type /Page >> endobj')
const history = JSON.stringify([{ role: 'assistant', content: 'Hola, soy Mimo.' }])
const context = JSON.stringify({ path: '/profile/casa/alergias' })

describe('POST /assistant/:userId/chat con un archivo', () => {
  it('un PDF: va al modelo como documento, con la conversación y la página; se guarda «[Adjunto]» y cuenta mimo_diet_document', async () => {
    const r = await send({ message: 'Te mando la dieta de mi nutricionista.', history, mode: 'text', context }, { bytes: PDF, type: 'application/pdf', name: 'dieta.pdf' })
    expect(r.status).toBe(200)
    expect(r.json.message).toBe('Respuesta del modelo')
    expect(chatMock).toHaveBeenCalledOnce()
    const [userId, message, hist, , opts] = chatMock.mock.calls[0]
    expect(userId).toBe('u-1')
    expect(message).toContain('Te mando la dieta de mi nutricionista.')
    expect(hist).toEqual([{ role: 'assistant', content: 'Hola, soy Mimo.' }])
    expect(opts.images).toEqual([{ mediaType: 'application/pdf', data: Buffer.from(PDF).toString('base64') }])
    expect(recordWebChatTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: '[Adjunto] Te mando la dieta de mi nutricionista.' }), expect.anything())
    expect(trackEvent).toHaveBeenCalledWith('mimo_diet_document', { userId: 'u-1', channel: 'web', props: { kind: 'pdf' } })
  })

  it('una foto sin palabras: Mimo la ve con la frase por defecto; sin palabras de dieta no cuenta como dieta', async () => {
    const r = await send({ message: '', history: '[]', mode: 'text', context: '{}' }, { bytes: new Uint8Array([1, 2, 3]), type: 'image/png', name: 'plato.png' })
    expect(r.status).toBe(200)
    const [, message, , , opts] = chatMock.mock.calls[0]
    expect(message).toContain('Te mando este archivo.')
    expect(opts.images).toEqual([{ mediaType: 'image/png', data: Buffer.from([1, 2, 3]).toString('base64') }])
    expect(trackEvent).not.toHaveBeenCalledWith('mimo_diet_document', expect.anything())
    expect(recordWebChatTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: '[Adjunto] Te mando este archivo.' }), expect.anything())
  })

  it('un archivo que no es foto ni PDF: 415 con el texto en español, sin modelo', async () => {
    const r = await send({ message: 'mira', history: '[]' }, { bytes: new TextEncoder().encode('hola'), type: 'text/plain', name: 'nota.txt' })
    expect(r.status).toBe(415)
    expect(r.json).toEqual({ error: 'Solo puedo leer fotos (JPG, PNG o WebP) o un PDF.', code: 'ATTACHMENT_TYPE' })
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('demasiado grande: más de 20 MB, o un PDF de más de 100 páginas: 413, sin modelo', async () => {
    const big = await send({ message: 'la dieta', history: '[]' }, { bytes: new Uint8Array(20 * 1024 * 1024 + 1), type: 'application/pdf', name: 'grande.pdf' })
    expect(big.status).toBe(413)
    expect(big.json.code).toBe('ATTACHMENT_TOO_BIG')
    const pages = new TextEncoder().encode('%PDF-1.4\n' + '<< /Type /Page >>\n'.repeat(101))
    const long = await send({ message: 'la dieta', history: '[]' }, { bytes: pages, type: 'application/pdf', name: 'larga.pdf' })
    expect(long.status).toBe(413)
    expect(long.json.error).toMatch(/demasiado grande/)
    expect(chatMock).not.toHaveBeenCalled()
  })

  it('con un archivo no contesta el código («la lista» con una foto va al modelo)', async () => {
    await send({ message: 'la lista', history: '[]' }, { bytes: new Uint8Array([1]), type: 'image/jpeg', name: 'lista.jpg' })
    expect(chatMock).toHaveBeenCalledOnce()
    expect(trackEvent).not.toHaveBeenCalledWith('mimo_code_reply', expect.anything())
  })

  it('sin archivo, en JSON, todo sigue igual (sin images)', async () => {
    const r = await fetch(`${base}/assistant/u-1/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Cámbiame la cena del jueves', history: [] }),
    })
    expect(r.status).toBe(200)
    expect(chatMock.mock.calls[0][4].images).toBeUndefined()
    expect(recordWebChatTurn).toHaveBeenCalledWith(expect.objectContaining({ userMessage: 'Cámbiame la cena del jueves' }), expect.anything())
  })
})
