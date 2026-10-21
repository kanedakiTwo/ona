/**
 * PRO-156: the messages Mimo sends by itself are written from a guide by a
 * small model, validated in code, with today's fixed text as the safety net.
 * The writer is always simulated here.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AI_DISCLOSURE_FIRST_PERSON, type DayMenu } from '@ona/shared'
import {
  composeGuided,
  guidedMeta,
  guidedSystemPrompt,
  guidedUserPrompt,
  validateGuided,
  MESSAGE_GUIDES,
  GUIDED_KINDS,
  GUIDED_MODEL,
  type GuideSpec,
  type GuidedWriter,
} from '../services/whatsapp/guided.js'
import { dailyBriefGuide, formatDailyBrief, planProactive, withText, shoppingReminderGuide, formatShoppingReminder } from '../services/whatsapp/proactive.js'
import { repeatedSentences, replayDailyBriefs } from '../services/whatsapp/guidedReplay.js'
import { setCostSinkForTests, type CostRow } from '../services/costLedger.js'
import { computeStats, buildTranscripts, reviewerSystemPrompt, type ReviewRow } from '../services/whatsapp/reviewer.js'
import { buildProactiveReport } from '../services/proactiveReport.js'

const WEB = 'https://mimoia.test'
const day = {
  lunch: { dishes: [{ kind: 'recipe', recipeId: 'a1', recipeName: 'Lentejas estofadas' }] },
  dinner: { dishes: [{ kind: 'recipe', recipeId: 'b2', recipeName: 'Tortilla de patatas' }] },
} as unknown as DayMenu
const fallback = formatDailyBrief(day, WEB)!
const spec = dailyBriefGuide(day, WEB)!

const GOOD = `¡Buenos días! Hoy en casa toca cuchara y tortilla:
- Comida: Lentejas estofadas
→ mimoia.test/recipes/a1
- Cena: Tortilla de patatas
→ mimoia.test/recipes/b2

¿Te cambio algo?

Ver menú: ${WEB}/menu`

const writerSaying = (text: string): GuidedWriter & { calls: number } => {
  const w = (async () => {
    w.calls += 1
    return { text, usage: { input_tokens: 1200, output_tokens: 150 } }
  }) as GuidedWriter & { calls: number }
  w.calls = 0
  return w
}
const ctx = async () => ({ memory: [], recent: [], previous: [] })
const deps = (writer: GuidedWriter | null, over = false) => ({ writer, userId: 'user-1', overBudget: async () => over, context: ctx })

afterEach(() => setCostSinkForTests(null))

describe('guides', () => {
  it('every guided kind has a guide with purpose, what it must carry, tone and a length cap', () => {
    for (const k of GUIDED_KINDS) {
      const g = MESSAGE_GUIDES[k]
      expect(g.purpose && g.mustCarry && g.tone).toBeTruthy()
      expect(g.maxChars).toBeGreaterThan(100)
      const prompt = guidedSystemPrompt(k)
      expect(prompt).toContain(g.purpose)
      expect(prompt).toMatch(/Nada de salud/)
      expect(prompt).toMatch(/Nunca digas «no puedo»/)
    }
  })

  it('the morning brief must carry every dish, every recipe link and the menu link', () => {
    expect(spec.required).toEqual(['Lentejas estofadas', 'mimoia.test/recipes/a1', 'Tortilla de patatas', 'mimoia.test/recipes/b2', `${WEB}/menu`])
  })

  it('the prompt carries the facts, the memory, the recent chat and the previous messages as data', () => {
    const p = guidedUserPrompt(spec, { memory: ['dislikes: ["coliflor"]'], recent: [{ who: 'usuario', text: 'hoy llego tarde' }], previous: ['Buenos días, ayer'] }, fallback)
    expect(p).toContain('<datos>')
    expect(p).toContain('Comida: Lentejas estofadas')
    expect(p).toContain('<memoria_del_hogar>\ndislikes: ["coliflor"]')
    expect(p).toContain('USUARIO: hoy llego tarde')
    expect(p).toContain('<mensajes_anteriores_de_este_tipo>')
    expect(p).toContain('«Buenos días, ayer»')
  })

  it('the planner attaches the guide to the daily brief', async () => {
    const r = await planProactive({
      parts: { isoDate: '2026-10-13', weekday: 1, hour: 9, minute: 5 },
      breakfastTime: null,
      dinnerTime: null,
      prefs: { daily_brief: true },
      sentRecently: {},
      todayDay: async () => day,
      todayDinner: async () => null,
      cookedToday: async () => true,
      pendingShopping: async () => [],
      hasNextWeekMenu: async () => true,
      webUrl: WEB,
    })
    expect(r).toEqual([{ kind: 'daily_brief', messages: [{ type: 'text', text: fallback }], guide: spec }])
  })

  it('withText swaps the text and keeps the buttons', () => {
    const b = [{ type: 'buttons' as const, text: 'viejo', buttons: [{ id: 'nudge:yes', title: 'Sí, prepáralo' }] }]
    expect(withText(b, 'nuevo')).toEqual([{ ...b[0], text: 'nuevo' }])
  })
})

describe('composeGuided — simulated writer', () => {
  it('a valid message goes out as written, billed to the household as whatsapp_guided', async () => {
    const rows: CostRow[] = []
    setCostSinkForTests(async (r) => void rows.push(r))
    const r = await composeGuided(spec, fallback, deps(writerSaying(GOOD)))
    expect(r).toEqual({ text: GOOD, source: 'guide' })
    expect(guidedMeta(r)).toEqual({ guided: 'guide' })
    await new Promise((res) => setTimeout(res, 0))
    expect(rows).toEqual([expect.objectContaining({ feature: 'whatsapp_guided', model: GUIDED_MODEL, userId: 'user-1' })])
  })

  it('a message without a required link falls back to the fixed text', async () => {
    const r = await composeGuided(spec, fallback, deps(writerSaying(GOOD.replace(`Ver menú: ${WEB}/menu`, 'Mira el menú en la app.'))))
    expect(r).toEqual({ text: fallback, source: 'fallback', reason: 'invalid:missing_required' })
  })

  it.each([
    ['a banned word', GOOD.replace('¿Te cambio algo?', '¿Te cambio algo? Es un menú muy saludable.'), 'invalid:banned_word'],
    ['«no puedo»', GOOD.replace('¿Te cambio algo?', 'No puedo cambiar la comida, pero ¿la cena?'), 'invalid:banned_word'],
    ['a health claim', GOOD.replace('¿Te cambio algo?', 'Las lentejas son antiinflamatorias. ¿Te cambio algo?'), 'invalid:health'],
    ['a link that is not ours', GOOD.replace('¿Te cambio algo?', '¿Te cambio algo? Más ideas en https://otra-web.com/recetas'), 'invalid:unknown_link'],
    ['too long', GOOD + '\n' + 'Y mucho más. '.repeat(80), 'invalid:too_long'],
    ['empty', '   ', 'invalid:empty'],
  ])('%s → fixed text', async (_label, text, reason) => {
    const r = await composeGuided(spec, fallback, deps(writerSaying(text)))
    expect(r).toEqual({ text: fallback, source: 'fallback', reason })
  })

  it('with the household over its monthly cap → fixed text, and the writer is never called', async () => {
    const w = writerSaying(GOOD)
    expect(await composeGuided(spec, fallback, deps(w, true))).toEqual({ text: fallback, source: 'fallback', reason: 'over_budget' })
    expect(w.calls).toBe(0)
  })

  it('no writer (no API key), a failing writer or a slow one → fixed text', async () => {
    expect(await composeGuided(spec, fallback, deps(null))).toMatchObject({ text: fallback, reason: 'no_writer' })
    const boom: GuidedWriter = async () => {
      throw new Error('529 overloaded')
    }
    expect(await composeGuided(spec, fallback, deps(boom))).toMatchObject({ text: fallback, reason: 'error' })
    const slow: GuidedWriter = () => new Promise(() => {})
    expect(await composeGuided(spec, fallback, { ...deps(slow), timeoutMs: 20 })).toMatchObject({ text: fallback, reason: 'error' })
  })

  it('never reaches the network under vitest when no writer is given', async () => {
    const r = await composeGuided(spec, fallback, { userId: null, overBudget: async () => false, context: ctx })
    expect(r).toMatchObject({ source: 'fallback', reason: 'no_writer' })
  })

  it('a sentence already sent in a recent message of the kind → fixed text', async () => {
    const previous = [GOOD.replace('Lentejas estofadas', 'Garbanzos')]
    const r = await composeGuided(spec, fallback, { ...deps(writerSaying(GOOD)), context: async () => ({ memory: [], recent: [], previous }) })
    expect(r.reason).toBe('invalid:repeats')
  })
})

describe('validateGuided — legal and other rules', () => {
  const asks: GuideSpec = { kind: 'weekly_nudge', facts: [], required: [] }
  it('a question-kind message must ask', () => {
    expect(validateGuided('Domingo tranquilo, ¿te preparo el menú de la semana que viene?', asks, 'x')).toEqual({ ok: true })
    expect(validateGuided('Domingo tranquilo: te preparo el menú de la semana que viene.', asks, 'x')).toEqual({ ok: false, reason: 'no_question' })
  })

  it('the AI disclosure is carried literally, never paraphrased', () => {
    const withDisclosure = `Hola. ${AI_DISCLOSURE_FIRST_PERSON} ¿Qué cenamos hoy?`
    const s: GuideSpec = { kind: 'cooking_reminder', facts: [], required: [] }
    expect(validateGuided(`Ey, ${AI_DISCLOSURE_FIRST_PERSON} Vamos a cocinar.`, s, withDisclosure)).toEqual({ ok: true })
    expect(validateGuided('Ey, soy una IA y me puedo equivocar. Vamos a cocinar.', s, withDisclosure)).toEqual({ ok: false, reason: 'missing_required' })
    expect(validateGuided('Soy una inteligencia artificial y hoy toca cocinar ya.', s, 'sin aviso')).toEqual({ ok: false, reason: 'ai_paraphrase' })
  })

  it('the shopping reminder needs the count and the list link', () => {
    const items = ['leche', 'pan', 'huevos', 'tomates']
    const g = shoppingReminderGuide(items, WEB)
    const fixed = formatShoppingReminder(items, WEB)
    expect(validateGuided(`Sábado de compra: te quedan 4 cosas, entre ellas leche y pan.\n\nLa lista: ${WEB}/shopping`, g, fixed)).toEqual({ ok: true })
    expect(validateGuided('Sábado de compra: te quedan unas cuantas cosas, como leche y pan.', g, fixed)).toMatchObject({ ok: false })
  })
})

describe('replay: five mornings in a row for the same household', () => {
  const r = (id: string, name: string) => ({ kind: 'recipe', recipeId: id, recipeName: name })
  const week = [
    { lunch: { dishes: [r('l1', 'Lentejas estofadas')] }, dinner: { dishes: [r('d1', 'Tortilla de patatas')] } },
    { lunch: { dishes: [r('l2', 'Arroz con pollo')] }, dinner: { dishes: [r('d2', 'Crema de calabaza')] } },
    { lunch: { dishes: [r('l3', 'Merluza en salsa verde')] }, dinner: { dishes: [r('d3', 'Ensalada de garbanzos')] } },
    { lunch: { dishes: [r('l4', 'Macarrones con tomate')] }, dinner: { dishes: [r('d4', 'Huevos rellenos')] } },
    { lunch: { dishes: [r('l5', 'Pollo al horno')] }, dinner: { dishes: [r('d5', 'Pizza casera')] } },
  ] as unknown as DayMenu[]

  const OPENINGS = ['¡Buenos días! Hoy en casa toca esto', 'Arrancamos la mañana con un plan sencillo', 'Hola de nuevo, este es el plan de hoy', 'Otro día más, y esto es lo que hay', 'Buen día por ahí, te cuento lo de hoy']
  const CLOSINGS = ['¿Quieres cambiar algún plato?', '¿Lo dejamos así o tocamos algo?', '¿Te apetece cambiar alguna cosa?', '¿Cambiamos algo o va bien?', '¿Hay algo que prefieras mover?']

  /** A simulated writer that reads the previous messages it is given and picks a different opening and closing. */
  const variedWriter: GuidedWriter = async (_system, prompt) => {
    const previous = prompt.split('<mensajes_anteriores_de_este_tipo>')[1]?.split('</mensajes_anteriores_de_este_tipo>')[0] ?? ''
    const opening = OPENINGS.find((o) => !previous.includes(o))!
    const closing = CLOSINGS.find((c) => !previous.includes(c))!
    // PRO-274: the agreement lines are for the writer, not for the message.
    const facts = prompt.split('<datos>\n')[1].split('\n</datos>')[0].split('\n').filter((f) => !/^«.+» es (?:femenino|masculino) /.test(f))
    const body = facts.filter((f) => !f.startsWith('Enlace «Ver menú»')).map((f) => f.replace(/^\s+enlace de [^:]+: /, '→ ')).join('\n')
    const menu = facts.find((f) => f.startsWith('Enlace «Ver menú»'))!.replace('Enlace «Ver menú»: ', '')
    return { text: `${opening}:\n${body}\n\n${closing}\n\n${menu}`, usage: null }
  }

  it('the menu of the day never repeats a sentence', async () => {
    const out = await replayDailyBriefs(week, { webUrl: WEB, writer: variedWriter })
    expect(out.map((m) => m.source)).toEqual(['guide', 'guide', 'guide', 'guide', 'guide'])
    expect(repeatedSentences(out.map((m) => m.text))).toEqual([])
    // …and each day carries its own dishes and links.
    expect(out[2].text).toContain('Merluza en salsa verde')
    expect(out[2].text).toContain('mimoia.test/recipes/l3')
  })

  it('a writer that always says the same thing is caught on day 2 (fixed text instead)', async () => {
    const parrot: GuidedWriter = async (s, p) => variedWriter(s, p.replace(/<mensajes_anteriores_de_este_tipo>[\s\S]*?<\/mensajes_anteriores_de_este_tipo>/, ''))
    const out = await replayDailyBriefs(week.slice(0, 2), { webUrl: WEB, writer: parrot })
    expect(out.map((m) => m.reason ?? m.source)).toEqual(['guide', 'invalid:repeats'])
  })
})

describe('the daily reviewer sees how each message was made', () => {
  const at = new Date('2026-10-13T07:05:00Z')
  const row = (over: Partial<ReviewRow>): ReviewRow => ({
    phone: '34600', userId: 'u1', username: 'ana', direction: 'out', kind: 'daily_brief', body: 'Hola', status: 'sent', errorMessage: null, meta: null, createdAt: at, ...over,
  })
  const rows = [
    row({ meta: { guided: 'guide' }, body: 'Hoy toca algo antiinflamatorio' }),
    row({ kind: 'shopping_reminder', meta: { guided: 'fallback', guidedReason: 'over_budget' } }),
    row({ direction: 'in', kind: 'text', body: 'vale', status: 'processed', createdAt: new Date(at.getTime() + 60_000) }),
  ]
  it('counts written vs fixed and marks them in the transcript, with the health detectors on the written ones', () => {
    const stats = computeStats(rows)
    expect(stats).toMatchObject({ guidedWritten: 1, guidedFallback: 1 })
    const t = buildTranscripts(rows).join('\n')
    expect(t).toContain('MIMO (daily_brief, redactado con guía)')
    expect(t).toContain('MIMO (shopping_reminder, texto fijo: over_budget)')
    expect(t).toMatch(/⚑ señales automáticas: reclamo de salud prohibido/)
    expect(reviewerSystemPrompt([])).toMatch(/redactado con guia/)
  })
})

describe('GET /admin/usage → proactive (reply rate and BAJA)', () => {
  it('counts by ISO week and kind: sent, replied, written from the guide or fixed, and opt-outs', () => {
    const report = buildProactiveReport(
      ['2026-10-12', '2026-10-13', '2026-10-19'],
      [
        { day: '2026-10-12', kind: 'daily_brief', guided: 'guide', replied: true, count: 3 },
        { day: '2026-10-13', kind: 'daily_brief', guided: 'fallback', replied: false, count: 1 },
        { day: '2026-10-13', kind: 'weekly_nudge', guided: '', replied: false, count: 2 },
        { day: '2026-10-19', kind: 'shopping_reminder', guided: 'guide', replied: true, count: 1 },
      ],
      [{ day: '2026-10-13', count: 1 }],
    )
    expect(report.weekly).toHaveLength(2)
    expect(report.weekly[0]).toMatchObject({ isoWeek: '2026-W42', sent: 6, replied: 3, replyRate: 0.5, guided: 3, fallback: 1, optouts: 1 })
    expect(report.weekly[0].byKind.daily_brief).toEqual({ sent: 4, replied: 3, replyRate: 0.75, guided: 3, fallback: 1 })
    expect(report.weekly[1]).toMatchObject({ isoWeek: '2026-W43', sent: 1, replyRate: 1, optouts: 0 })
    expect(report.totals).toEqual({ sent: 7, replied: 4, replyRate: 0.571, guided: 4, fallback: 1, optouts: 1 })
  })
})

vi.restoreAllMocks()
