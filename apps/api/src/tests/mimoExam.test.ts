/**
 * PRO-1304 · El examen fijo de Mimo: los 75 casos del histórico en la
 * batería (`MIMO_EXAM_CASES`), el corrector (`mimoExam.ts`: comprobaciones
 * de código, el juez, la nota y el precio) y una pasada entera
 * (`runExam`) con un modelo y un juez falsos: 75 notas, su precio, y dos
 * pasadas iguales dan lo mismo.
 */
import { describe, expect, it } from 'vitest'
import { MIMO_EXAM_CASES, type ExamCase } from '../services/assistant/mimoExamCases.js'
import {
  EXAM_CRITERIA,
  JUDGE_SYSTEM,
  caseMean,
  codeAnswerOf,
  codeChecks,
  combineScores,
  compareExams,
  estimateTurnUsage,
  examContext,
  examHistory,
  examOnboarding,
  judgePrompt,
  parseJudge,
  simulatedToolSummary,
  speedScore,
  usageEur,
  type TurnRun,
} from '../services/assistant/mimoExam.js'
import { runExam, type MessagesLike } from '../services/assistant/mimoExamRun.js'
import { toolsFor } from '../services/assistant/skills.js'

const byId = (id: string): ExamCase => {
  const c = MIMO_EXAM_CASES.find((x) => x.id === id)
  if (!c) throw new Error(`no case ${id}`)
  return c
}

const run = (over: Partial<TurnRun> = {}): TurnRun => ({ porCodigo: null, reply: 'Hecho: martes, cena: Revuelto de calabacín (en lugar de Lubina al horno).', tools: ['swap_meal'], rondas: 2, ms: null, flags: [], ...over })

describe('los casos', () => {
  it('son los 75 del examen, con su forma', () => {
    expect(MIMO_EXAM_CASES).toHaveLength(75)
    expect(new Set(MIMO_EXAM_CASES.map((c) => c.id)).size).toBe(75)
    expect(MIMO_EXAM_CASES.filter((c) => c.sin_modelo)).toHaveLength(22)
    for (const c of MIMO_EXAM_CASES) {
      expect(c.mensaje.length, c.id).toBeGreaterThan(0)
      expect(c.debe.length, c.id).toBeGreaterThan(0)
      expect(['trivial', 'normal', 'dificil']).toContain(c.dificultad)
      expect(EXAM_CRITERIA).toContain(c.criterio_principal)
    }
  })

  it('no llevan teléfonos, correos ni enlaces', () => {
    const text = JSON.stringify(MIMO_EXAM_CASES)
    expect(text).not.toMatch(/https?:\/\/|www\.|@[a-z]|\+34|\b\d{3} ?\d{3} ?\d{3}\b/i)
  })

  it('cada herramienta esperada existe en su canal', () => {
    for (const c of MIMO_EXAM_CASES) {
      const mode = c.canal === 'app' ? 'text' : 'whatsapp'
      const names = new Set(toolsFor({ mode, onboarding: examOnboarding(c) } as never).map((s) => s.name))
      for (const t of c.herramientas) expect(names.has(t), `${c.id}: ${t}`).toBe(true)
    }
  })

  it('el hogar va de contexto y el historial como lo monta el motor', () => {
    const c = byId('h-041')
    expect(examContext(c)).toContain(c.hogar)
    expect(examContext(c)).toContain(c.situacion)
    for (const x of MIMO_EXAM_CASES) {
      const h = examHistory(x)
      if (h.length === 0) continue
      expect(h[0].role, x.id).toBe('user')
      expect(h[h.length - 1].role, x.id).toBe('assistant')
      for (let i = 1; i < h.length; i += 1) expect(h[i].role).not.toBe(h[i - 1].role)
    }
  })

  it('las herramientas simuladas: las de leer dan la situación; las demás, «Hecho»', () => {
    const c = byId('h-001')
    expect(simulatedToolSummary(c, 'get_weekly_menu', {})).toContain(c.situacion)
    expect(simulatedToolSummary(c, 'swap_meal', { day: 1 })).toMatch(/^Hecho \(simulado\): swap_meal/)
  })
})

describe('lo que contesta el código', () => {
  it('ver el menú, el paso siguiente en el modo cocina, una cortesía y el botón del aviso de la cena', () => {
    expect(codeAnswerOf(byId('h-027'))).toBe('ver_menu')
    expect(codeAnswerOf(byId('h-054'))).toBe('paso_cocina')
    expect(codeAnswerOf(byId('h-007'))).toBe('cortesia')
    expect(codeAnswerOf(byId('h-028'))).toBe('aviso_cena')
  })

  it('una petición de verdad va al modelo', () => {
    expect(codeAnswerOf(byId('h-001'))).toBeNull()
    expect(codeAnswerOf(byId('h-041'))).toBeNull()
  })
})

describe('las comprobaciones de código', () => {
  it('rápido: por rondas; lo que debía contestar el código y pasó por el modelo, 1 como mucho', () => {
    const c = byId('h-001')
    expect(speedScore(c, run({ rondas: 2 })).score).toBe(2)
    expect(speedScore(c, run({ rondas: 4 })).score).toBe(1)
    expect(speedScore(c, run({ rondas: 6 })).score).toBe(0)
    expect(speedScore(c, run({ rondas: 1, ms: 40_000 })).score).toBe(0)
    expect(speedScore(byId('h-002'), run({ rondas: 1 })).score).toBe(1)
    expect(speedScore(byId('h-002'), run({ porCodigo: 'ver_menu' })).score).toBe(2)
  })

  it('hecho entero: sin la herramienta esperada, 0; una equivalente vale', () => {
    const c = byId('h-001')
    expect(codeChecks(c, run({ tools: [] }))).toContainEqual(expect.objectContaining({ criterion: 'hecho_entero', cap: 0 }))
    expect(codeChecks(c, run({ tools: ['add_dish'] })).some((x) => x.criterion === 'hecho_entero')).toBe(false)
    const hard = byId('h-041')
    expect(codeChecks(hard, run({ tools: ['log_cooked'] }))).toContainEqual(expect.objectContaining({ criterion: 'hecho_entero', cap: 1 }))
  })

  it('corto: el largo por dificultad y el enlace que nadie pidió', () => {
    const c = byId('h-001')
    expect(codeChecks(c, run({ reply: 'x'.repeat(500) }))).toContainEqual(expect.objectContaining({ criterion: 'corto_sin_relleno', cap: 1 }))
    expect(codeChecks(c, run({ reply: 'x'.repeat(900) }))).toContainEqual(expect.objectContaining({ criterion: 'corto_sin_relleno', cap: 0 }))
    expect(codeChecks(c, run({ reply: 'Hecho. Mira https://mimoia.app/menu' }))).toContainEqual(expect.objectContaining({ criterion: 'corto_sin_relleno', cap: 1 }))
  })

  it('verdad: «hecho» sin ninguna herramienta que cambie nada, 0', () => {
    const c = byId('h-001')
    expect(codeChecks(c, run({ tools: ['get_weekly_menu'], reply: 'Hecho, he cambiado la lubina.' }))).toContainEqual(expect.objectContaining({ criterion: 'verdad_comprobada', cap: 0 }))
    expect(codeChecks(c, run()).some((x) => x.criterion === 'verdad_comprobada')).toBe(false)
  })
})

describe('el juez', () => {
  const good = '{"hecho_entero":{"nota":2,"porque":"a"},"respeta_la_casa":{"nota":1,"porque":"b"},"platos_con_sentido":{"nota":null,"porque":"no aplica"},"corto_sin_relleno":{"nota":2,"porque":"c"},"verdad_comprobada":{"nota":0,"porque":"d"}}'

  it('lee su JSON, también con texto alrededor', () => {
    const v = parseJudge(`Aquí va:\n${good}\n`)
    expect(v?.scores).toEqual({ hecho_entero: 2, respeta_la_casa: 1, platos_con_sentido: null, corto_sin_relleno: 2, verdad_comprobada: 0 })
    expect(v?.why.verdad_comprobada).toBe('d')
  })

  it('no acepta notas fuera de 0-2 ni «no aplica» donde siempre aplica', () => {
    expect(parseJudge(good.replace('"nota":2,"porque":"a"', '"nota":3,"porque":"a"'))).toBeNull()
    expect(parseJudge(good.replace('"nota":2,"porque":"a"', '"nota":null,"porque":"a"'))).toBeNull()
    expect(parseJudge('no sé')).toBeNull()
  })

  it('lee el caso entero y lo que hizo Mimo', () => {
    const c = byId('h-041')
    const p = judgePrompt(c, run(), [{ name: 'swap_meal', input: '{"day":3}', summary: 'Hecho (simulado)' }])
    for (const d of [...c.debe, ...c.no_debe, c.mensaje, c.hogar]) expect(p).toContain(d)
    expect(p).toContain('swap_meal')
    expect(JUDGE_SYSTEM).toMatch(/0 a 2/)
  })

  it('la nota: el juez con los topes del código, rápido del código, y la media sin lo que no aplica', () => {
    const v = parseJudge(good)!
    const notas = combineScores(v.scores, [{ criterion: 'hecho_entero', cap: 1, why: '' }], 2)
    expect(notas.hecho_entero).toBe(1)
    expect(notas.rapido).toBe(2)
    expect(caseMean(notas)).toBe(1.2)
  })
})

describe('tokens y precio', () => {
  const tools = [{ name: 't', description: 'x'.repeat(3500), cache_control: { type: 'ephemeral', ttl: '1h' } }]
  const system = [
    { type: 'text', text: 'y'.repeat(3500), cache_control: { type: 'ephemeral', ttl: '1h' } },
    { type: 'text', text: 'hogar' },
  ]
  const r1 = { request: { system, tools, messages: [{ role: 'user', content: 'hola' }] }, response: { content: [{ type: 'tool_use', name: 'swap_meal', input: { a: 1 } }] } }
  const r2 = { request: { system, tools, messages: [{ role: 'user', content: 'hola' }, { role: 'assistant', content: 'z'.repeat(700) }] }, response: { content: [{ type: 'text', text: 'Hecho.' }] } }

  it('frío: la primera ronda escribe todo (lo fijo con la hora de caché) y la segunda lee lo de la primera', () => {
    const u = estimateTurnUsage([r1, r2], { warm: false })
    expect(u.cacheWrite1hTokens).toBeGreaterThan(2000)
    expect(u.cacheReadTokens).toBeGreaterThan(2000)
    expect(u.cacheWriteTokens).toBeGreaterThan(u.cacheWrite1hTokens!)
    expect(u.outputTokens).toBeGreaterThan(0)
  })

  it('caliente cuesta menos que frío', () => {
    const cold = usageEur(estimateTurnUsage([r1, r2], { warm: false }), 0.92)
    const warm = usageEur(estimateTurnUsage([r1, r2], { warm: true }), 0.92)
    expect(cold).toBeGreaterThan(warm)
    expect(warm).toBeGreaterThan(0)
  })
})

describe('una pasada entera', () => {
  /** Mimo llama la primera herramienta esperada y confirma; el juez, siempre lo mismo. */
  const fakeClient = (): MessagesLike & { calls: number } => {
    const c = {
      calls: 0,
      messages: {
        async create(args: any) {
          c.calls += 1
          if (args.system === JUDGE_SYSTEM) {
            const nota = args.messages[0].content.includes('cambiar_plato') ? 1 : 2
            const verdict = Object.fromEntries(['hecho_entero', 'respeta_la_casa', 'platos_con_sentido', 'corto_sin_relleno', 'verdad_comprobada'].map((k) => [k, { nota, porque: 'ok' }]))
            return { content: [{ type: 'text', text: JSON.stringify(verdict) }], stop_reason: 'end_turn' }
          }
          const caseId = /caso del examen/.test(JSON.stringify(args.system)) ? JSON.stringify(args.system) : ''
          const expected = MIMO_EXAM_CASES.find((x) => caseId.includes(JSON.stringify(x.situacion).slice(1, -1)))?.herramientas ?? []
          const answered = args.messages.some((m: any) => Array.isArray(m.content) && m.content.some((b: any) => b.type === 'tool_result'))
          if (expected.length > 0 && !answered) {
            return { content: [{ type: 'tool_use', id: 'tu_1', name: expected[0], input: {} }], stop_reason: 'tool_use' }
          }
          return { content: [{ type: 'text', text: expected.length ? 'Hecho.' : 'Vale.' }], stop_reason: 'end_turn' }
        },
      },
    }
    return c
  }

  it('da las 75 notas, su precio y el resumen por criterio y por tipo', async () => {
    const client = fakeClient()
    const { resumen, casos } = await runExam(MIMO_EXAM_CASES, { client, remote: true, eurPerUsd: 0.92, concurrency: 4 })
    expect(casos).toHaveLength(75)
    expect(casos.filter((c) => c.error)).toEqual([])
    expect(resumen.corregidos).toBe(75)
    for (const k of EXAM_CRITERIA) expect(resumen.porCriterio[k]).not.toBeNull()
    expect(Object.keys(resumen.porTipo).length).toBeGreaterThan(10)
    const byModel = casos.filter((c) => !c.porCodigo)
    expect(byModel.length).toBeGreaterThan(50)
    for (const c of byModel) {
      expect(c.precioEur, c.id).toBeGreaterThan(0)
      expect(c.precioCalienteEur!, c.id).toBeLessThan(c.precioEur)
      expect(c.tokens.cacheEscrita1h, c.id).toBeGreaterThan(10_000)
    }
    expect(resumen.coste.precioEur).toBeGreaterThan(0)
    expect(resumen.porCriterio.hecho_entero).toBeLessThan(2)
  })

  it('dos pasadas iguales difieren en menos de 0,2', async () => {
    const a = await runExam(MIMO_EXAM_CASES, { client: fakeClient(), remote: true, eurPerUsd: 0.92 })
    const b = await runExam(MIMO_EXAM_CASES, { client: fakeClient(), remote: true, eurPerUsd: 0.92 })
    expect(compareExams(a, b)).toMatchObject({ diferencia: 0, estable: true, casosQueCambian: [] })
  })

  it('un caso que falla no cuenta en la media y se dice', async () => {
    const client: MessagesLike = { messages: { create: async () => { throw new Error('caducado') } } }
    const { resumen, casos } = await runExam([byId('h-001'), byId('h-007')], { client, remote: true, eurPerUsd: 0.92 })
    expect(casos[0].error).toBe('caducado')
    expect(resumen).toMatchObject({ casos: 2, corregidos: 1, conError: 1 })
  })
})
