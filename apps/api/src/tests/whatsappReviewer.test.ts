/**
 * Conversation reviewer agent — pure parts: day boundaries, objective
 * signals, transcripts with the engine trace, and the WhatsApp summary; and
 * (D-189) the memory of its own findings (same key, days, regression) and the
 * app's chat turns in the same review, with fake loaders and a fake model.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('../db/connection.js', () => ({ db: {} }))

const {
  computeStats,
  buildTranscripts,
  formatReviewMessage,
  reviewerSystemPrompt,
  reviewDay,
  appTurnRows,
  REVIEW_HOUR,
  REVIEW_SCHEMA,
} = await import('../services/whatsapp/reviewer.js')
type ReviewRow = import('../services/whatsapp/reviewer.js').ReviewRow
type ReviewResult = import('../services/whatsapp/reviewer.js').ReviewResult
import { madridMidnightUtc, addDays } from '../services/madridTime.js'

const at = (iso: string) => new Date(iso)
const row = (over: Partial<ReviewRow>): ReviewRow => ({
  phone: '34600111222',
  userId: 'u1',
  username: 'miguel',
  direction: 'in',
  kind: 'text',
  body: 'hola',
  status: 'processed',
  errorMessage: null,
  meta: null,
  createdAt: at('2026-10-07T07:37:30Z'),
  ...over,
})

describe('Madrid day boundaries', () => {
  it('finds 00:00 Madrid in UTC across DST (CEST +2 in October, CET +1 in November)', () => {
    expect(madridMidnightUtc('2026-10-07').toISOString()).toBe('2026-10-06T22:00:00.000Z')
    expect(madridMidnightUtc('2026-11-10').toISOString()).toBe('2026-11-09T23:00:00.000Z')
    expect(addDays('2026-10-01', -1)).toBe('2026-09-30')
  })
})

describe('computeStats', () => {
  it('counts turns, failures, slow turns, engine corrections, frustration, closing questions and proactive sends', () => {
    const rows = [
      row({ body: 'Pon chawanmushi hoy', meta: { tools: ['import_recipe_from_url'], corrections: ['promise'], ms: 25_000 } }),
      row({ direction: 'out', kind: 'reply', status: 'sent', body: '¿Te la pongo luego?\n\nVer menú: https://x/menu' }),
      row({ body: 'no, eso no es lo que te he dicho', status: 'failed' }),
      row({ direction: 'out', kind: 'daily_brief', status: 'sent', body: 'Buenos días' }),
      row({ direction: 'out', kind: 'reply', status: 'failed', body: 'Hecho' }),
      row({ userId: 'u2', phone: '34600999888', body: 'hola' }),
    ]
    expect(computeStats(rows)).toEqual({
      conversations: 2,
      turns: 3,
      failedTurns: 1,
      slowTurns: 1,
      corrections: 1,
      frustrationCues: 1,
      questionEndings: 1,
      proactiveSent: 1,
      sendFailures: 1,
      healthTalk: 0,
      healthClaims: 0,
      unverifiedDone: 0,
      guidedWritten: 0,
      guidedFallback: 0,
      appTurns: 0,
    })
  })
})

describe('buildTranscripts', () => {
  it('renders one transcript per user with Madrid times and the engine trace', () => {
    const [t] = buildTranscripts([
      row({ body: 'Pon chawanmushi', meta: { tools: ['import_recipe_from_url', 'swap_meal'], corrections: ['promise'], ms: 7_200 } }),
      row({ direction: 'out', kind: 'ack', status: 'sent', body: 'Voy a leer esa receta…', createdAt: at('2026-10-07T07:37:35Z') }),
    ])
    expect(t).toContain('=== Conversación 1 (miguel) · canal whatsapp ===')
    expect(t).toContain('[09:37] USUARIO (text): Pon chawanmushi')
    expect(t).toContain('↳ herramientas: import_recipe_from_url, swap_meal · correcciones del motor: promise · 7.2 s')
    expect(t).toContain('[09:37] MIMO (ack): Voy a leer esa receta…')
  })

  it('marks turns recorded before the tool log as "sin registro", not "ninguna"', () => {
    const [t] = buildTranscripts([row({ meta: null }), row({ meta: { tools: [], ms: 900 }, createdAt: at('2026-10-07T07:40:00Z') })])
    expect(t).toContain('↳ herramientas: sin registro')
    expect(t).toContain('↳ herramientas: ninguna · 0.9 s')
  })
})

describe('formatReviewMessage', () => {
  it('summarises with the most severe findings first and points to the admin endpoint', () => {
    const msg = formatReviewMessage(
      '2026-10-07',
      { conversations: 1, turns: 2, failedTurns: 0, slowTurns: 0, corrections: 1, frustrationCues: 0, questionEndings: 0, proactiveSent: 2, sendFailures: 0, healthTalk: 0, healthClaims: 0, unverifiedDone: 0 },
      'Día correcto salvo un enlace.',
      [
        { severity: 'baja', category: 'respuesta_larga', when: '09:55', userMessage: 'x', whatHappened: 'Respuesta larga', expected: '', suggestedFix: 'Acortar' },
        { severity: 'alta', category: 'promesa_incumplida', when: '09:37', userMessage: 'y', whatHappened: 'Prometió crear la receta luego', expected: '', suggestedFix: 'Crearla en el turno' },
      ],
    )
    expect(msg.split('\n')[0]).toBe('*Revisión de conversaciones del 2026-10-07*')
    expect(msg.indexOf('[alta]')).toBeLessThan(msg.indexOf('[baja]'))
    expect(msg).toContain('GET /admin/assistant-reviews')
  })

  it('the reviewer prompt lists the tools and the schema forbids extra keys', () => {
    expect(reviewerSystemPrompt(['swap_meal', 'set_meal_note'])).toContain('swap_meal, set_meal_note')
    expect(REVIEW_SCHEMA.additionalProperties).toBe(false)
    expect(REVIEW_SCHEMA.properties.findings.items.additionalProperties).toBe(false)
  })
})

// ─── D-189: memory, structured fields, app turns ─────────────────

const finding = (over: Record<string, unknown> = {}) => ({
  severity: 'media',
  category: 'pregunta_innecesaria',
  when: '21:05',
  userMessage: 'x',
  whatHappened: 'Dos preguntas en el aviso',
  expected: 'Una',
  suggestedFix: 'Una pregunta',
  canal: 'whatsapp',
  clave: 'checkin.varias_preguntas',
  patron: 'Mimo hace dos preguntas seguidas en el aviso de la cena',
  donde: 'guia_aviso:dinner_checkin',
  arreglo: 'La guía del aviso de la cena pide una sola pregunta',
  prueba: 'Un test de la guía que falla si el aviso lleva dos preguntas',
  tipo: 'arreglo',
  ...over,
})
const prev = (day: string, clave = 'checkin.varias_preguntas') => ({ day, findings: [finding({ clave })] })

function harness(opts: { rows?: ReviewRow[]; prior?: Array<{ day: string; findings: unknown }>; findings?: unknown[] }) {
  const saved: ReviewResult[] = []
  const inputs: string[] = []
  const deps = {
    loadRows: async () => opts.rows ?? [row({})],
    loadPrior: async () => opts.prior ?? [],
    toolNames: async () => ['swap_meal'],
    save: async (_day: string, r: ReviewResult) => void saved.push(r),
  }
  const llm = async (_system: string, input: string) => {
    inputs.push(input)
    return { summary: 'ok', findings: (opts.findings ?? [finding()]) as any }
  }
  return { deps, llm, saved, inputs }
}

describe('reviewer memory (D-189)', () => {
  it('runs at 01:00 Madrid, before the night snapshot', () => {
    expect(REVIEW_HOUR).toBe(1)
  })

  it('gives the model the keys and patterns of the 14 days before, and keeps the key it reuses', async () => {
    const h = harness({ prior: [prev('2026-11-16'), prev('2026-11-17'), prev('2026-11-17'), prev('2026-11-01', 'vieja.clave')] })
    const r = await reviewDay('2026-11-18', h.llm, { notify: false }, h.deps)
    expect(h.inputs[0]).toContain('Tu memoria')
    expect(h.inputs[0]).toContain('- checkin.varias_preguntas · 2 día(s), el último 2026-11-17')
    expect(h.inputs[0]).not.toContain('vieja.clave') // 17 days before: out of memory
    expect(r.findings?.[0]).toMatchObject({ clave: 'checkin.varias_preguntas', dias: 3, regresion: false, donde: 'guia_aviso:dinner_checkin', tipo: 'arreglo' })
    expect(h.saved[0].findings?.[0]).toMatchObject({ dias: 3, regresion: false })
  })

  it('a key back after 3 days or more away is a regression; one seen 2 days ago is not', async () => {
    const back = harness({ prior: [prev('2026-11-10'), prev('2026-11-14')] })
    expect((await reviewDay('2026-11-18', back.llm, { notify: false }, back.deps)).findings?.[0]).toMatchObject({ dias: 3, regresion: true })
    const close = harness({ prior: [prev('2026-11-15')] })
    expect((await reviewDay('2026-11-18', close.llm, { notify: false }, close.deps)).findings?.[0]).toMatchObject({ dias: 2, regresion: false })
  })

  it('a new problem starts at one day; a bad key or place is normalised', async () => {
    const h = harness({ findings: [finding({ clave: 'Menú. Cambio no-pedido', donde: 'la base de datos', tipo: 'quizá' })] })
    const [f] = (await reviewDay('2026-11-18', h.llm, { notify: false }, h.deps)).findings ?? []
    expect(f).toMatchObject({ clave: 'menu.cambio_no_pedido', donde: 'otro', tipo: 'arreglo', dias: 1, regresion: false })
  })

  it('the prompt knows the company rules and the schema asks for the structured fields', () => {
    const p = reviewerSystemPrompt(['swap_meal'])
    expect(p).toMatch(/Opus 5\.5 \(D-070\)/)
    expect(p).toMatch(/tope de gasto .* decision de negocio/)
    expect(p).toMatch(/fuera de las 24 h .* plantillas/)
    expect(p).toMatch(/UN solo arreglo/)
    expect(REVIEW_SCHEMA.properties.findings.items.required).toEqual(
      expect.arrayContaining(['canal', 'clave', 'patron', 'donde', 'arreglo', 'prueba', 'tipo']),
    )
  })
})

describe('app turns in the review (D-189)', () => {
  const t0 = at('2026-11-18T19:00:00Z')
  const appRows = appTurnRows([
    { userId: 'u9', username: 'ana', role: 'user', body: '¿Qué cenamos?', meta: { mode: 'chat' } as any, createdAt: t0 },
    {
      userId: 'u9',
      username: 'ana',
      role: 'assistant',
      body: 'Hecho: te he puesto tortilla.',
      meta: { tools: ['swap_meal'], toolTrace: [{ name: 'swap_meal', input: 'cena', summary: 'cambiado' }], ms: 4_000 },
      createdAt: new Date(t0.getTime() + 1),
    },
  ])

  it('maps a web turn to the reviewer shape, with what Mimo did on the user row', () => {
    expect(appRows).toHaveLength(2)
    expect(appRows[0]).toMatchObject({ channel: 'app', direction: 'in', status: 'processed', meta: { tools: ['swap_meal'], ms: 4_000 } })
    expect(appRows[1]).toMatchObject({ channel: 'app', direction: 'out', kind: 'reply', status: 'sent' })
  })

  it('app and WhatsApp turns go into the same review, each conversation with its channel', async () => {
    const h = harness({ rows: [row({}), ...appRows] })
    const r = await reviewDay('2026-11-18', h.llm, { notify: false }, h.deps)
    expect(r.stats).toMatchObject({ turns: 2, appTurns: 1, conversations: 2 })
    expect(h.inputs[0]).toContain('(ana) · canal app ===')
    expect(h.inputs[0]).toContain('(miguel) · canal whatsapp ===')
    expect(h.inputs[0]).toContain('· swap_meal cena → cambiado')
  })

  it('a day with only app turns is reviewed, not "empty"', async () => {
    const h = harness({ rows: appRows })
    expect((await reviewDay('2026-11-18', h.llm, { notify: false }, h.deps)).status).toBe('ok')
  })
})
