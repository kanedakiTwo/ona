/**
 * PRO-319 (D-051, D-064, D-065, D-110; specs/household-profile.md → «Mimo and
 * the ficha»): Mimo's ficha tools on the web chat and on WhatsApp, against a
 * fake app API (the same routes as «Tu ficha»). Each tool in both channels;
 * the weekly cap and the 24 h window of the pending question; nothing about
 * health written from WhatsApp; never another person's health in the summary.
 * The routes against Postgres: fichaMimo.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import {
  FICHA_FACTS_PATH,
  FICHA_PATH,
  FICHA_QUESTION_ASK_PATH,
  PROFILE_CHANGE_ACTIONS,
  type FichaFactView,
  type FichaView,
} from '@ona/shared'
import {
  answerFichaQuestionSkill,
  endOfMadridDay,
  explainFichaFactSkill,
  fichaSkills,
  fichaSummary,
  forgetFichaFactSkill,
  getFichaQuestionSkill,
  getFichaSkill,
  noteFichaFactSkill,
  setFichaLearningSkill,
} from '../services/assistant/fichaSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import { READ_ONLY_TOOLS } from '../services/assistant/claims.js'
import { AppApiError } from '../services/assistant/appApi.js'
import { fichaSubjectFor, mergeListValues, mimoMayAskQuestion } from '../services/profile/fichaStore.js'

const ME = '11111111-1111-4111-8111-111111111111'
const MARTA = '22222222-2222-4222-8222-222222222222'
const ABUELO = '33333333-3333-4333-8333-333333333333'
const CHANNELS = ['text', 'whatsapp'] as const

function fact(over: Partial<FichaFactView>): FichaFactView {
  return {
    id: 'f-x', subjectKey: 'casa', type: 'fixed_dish', topic: 'como_comeis', sentence: 'Pizza los viernes en la cena',
    origin: 'deducido', originLabel: 'Lo he deducido', temporary: false, validUntil: null, health: false, canEdit: true,
    updatedAt: '2026-10-20T10:00:00.000Z', ...over,
  }
}

const VIEW: FichaView = {
  householdId: 'h1',
  portrait: { text: 'En tu casa se come de cuchara. Marta es celíaca. Los viernes, pizza.', updatedAt: '2026-10-21T01:10:00.000Z' },
  people: [
    { key: 'casa', kind: 'household', label: 'La casa', ageBand: null, isViewer: false, canEdit: true },
    { key: `u:${ME}`, kind: 'user', label: 'Tú', ageBand: null, isViewer: true, canEdit: false },
    { key: `u:${MARTA}`, kind: 'user', label: 'Marta', ageBand: null, isViewer: false, canEdit: false },
    { key: `p:${ABUELO}`, kind: 'person', label: 'El abuelo', ageBand: 'adulto', isViewer: false, canEdit: true },
  ],
  facts: [
    fact({ id: 'f-pizza' }),
    fact({ id: 'f-cilantro', subjectKey: `u:${ME}`, type: 'dislikes', topic: 'gustos', sentence: 'No te gusta cilantro', origin: 'tu', originLabel: 'Lo dijiste tú' }),
    fact({ id: 'f-my-health', subjectKey: `u:${ME}`, type: 'restrictions', topic: 'salud', sentence: 'Sin lactosa', origin: 'tu', health: true }),
    fact({ id: 'f-marta-ajo', subjectKey: `u:${MARTA}`, type: 'dislikes', topic: 'gustos', sentence: 'No le gusta el ajo', canEdit: false }),
    fact({ id: 'f-marta-note', subjectKey: `u:${MARTA}`, type: 'notes', topic: 'notas', sentence: 'Es celíaca desde niña', canEdit: false }),
    fact({ id: 'f-abuelo-health', subjectKey: `p:${ABUELO}`, type: 'restrictions', topic: 'salud', sentence: 'Sin sal', health: true }),
    fact({ id: 'f-abuelo-cuchara', subjectKey: `p:${ABUELO}`, type: 'affinity', topic: 'gustos', sentence: 'Le encanta la cuchara' }),
  ],
  question: null,
  recent: [],
  learningPaused: false,
  readOnly: false,
}

type Call = { method: string; path: string; body: unknown }
function fakeApi(answers: Record<string, unknown> = {}) {
  const calls: Call[] = []
  const api = (async (method: string, path: string, body?: unknown) => {
    calls.push({ method, path, body })
    const key = `${method} ${path}`
    if (key in answers) {
      const a = answers[key]
      if (a instanceof Error) throw a
      return a
    }
    if (key === `GET ${FICHA_PATH}`) return VIEW
    return { ok: true }
  }) as any
  return { api, calls }
}
const ctx = (channel: string, api: any) => ({ userId: ME, db: null, channel, api }) as any

describe('Mimo and the ficha: the tools (PRO-319)', () => {
  it('the seven tools are on the web chat and on WhatsApp; the read ones never count as a change', () => {
    const names = fichaSkills.map((s) => s.name)
    expect(names).toEqual(['get_ficha', 'explain_ficha_fact', 'note_ficha_fact', 'forget_ficha_fact', 'set_ficha_learning', 'get_ficha_question', 'answer_ficha_question'])
    for (const mode of ['text', 'voice', 'whatsapp']) {
      const tools = toolsFor({ mode }).map((s) => s.name)
      for (const n of names) expect(tools).toContain(n)
    }
    for (const n of ['get_ficha', 'explain_ficha_fact', 'get_ficha_question']) expect(READ_ONLY_TOOLS.has(n)).toBe(true)
    expect(PROFILE_CHANGE_ACTIONS).toContain('question_asked')
  })

  it('«¿qué sabes de mí?» on the web: my facts and my health, the house, others — never another person\'s health', async () => {
    const { api, calls } = fakeApi()
    const r = await getFichaSkill.handler({}, ctx('text', api))
    expect(calls).toEqual([{ method: 'GET', path: FICHA_PATH, body: undefined }])
    expect(r.summary).toContain('Pizza los viernes en la cena')
    expect(r.summary).toContain('No te gusta cilantro')
    expect(r.summary).toContain('Sin lactosa') // the reader's own health, on the web
    expect(r.summary).toContain('No le gusta el ajo')
    expect(r.summary).toContain('Le encanta la cuchara')
    expect(r.summary).not.toContain('Sin sal') // a person without an account's health
    expect(r.summary).not.toContain('celíaca') // another member's note, and the portrait's sentence
    expect(r.summary).toContain('[id f-pizza]')
    expect(r.summary).toMatch(/con tus palabras/)
  })

  it('«¿qué sabes de mí?» on WhatsApp: no health at all, not even mine, and it says where to see it', async () => {
    const { api } = fakeApi()
    const r = await getFichaSkill.handler({}, ctx('whatsapp', api))
    expect(r.summary).toContain('No te gusta cilantro')
    expect(r.summary).not.toContain('Sin lactosa')
    expect(r.summary).not.toContain('Sin sal')
    expect(r.summary).not.toContain('celíaca')
    expect(r.summary).toContain('/profile/ficha')
  })

  it('the summary says when the learning is paused and when the ficha is almost empty', () => {
    const empty = fichaSummary({ ...VIEW, portrait: null, facts: [], learningPaused: true }, ME, 'text')
    expect(empty).toMatch(/casi vacía/)
    expect(empty).toMatch(/EN PAUSA/)
  })

  it.each(CHANNELS)('«apunta que…» (%s): the same route and body as the screen would, origin user on the server', async (channel) => {
    const { api, calls } = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: { factId: 'f-new', action: 'added', sentence: 'Pizza los viernes en la cena' } })
    const r = await noteFichaFactSkill.handler({ type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' }, about: 'household' }, ctx(channel, api))
    expect(calls).toEqual([{ method: 'POST', path: FICHA_FACTS_PATH, body: { type: 'fixed_dish', value: { dish: 'pizza', days: ['viernes'], meal: 'dinner' }, about: 'household', personId: null, validUntil: undefined } }])
    expect(r.summary).toMatch(/Apuntado en la ficha/)
    expect(r.uiHint).toBe('confirmation')
  })

  it('«sin horno hasta el 2 de noviembre»: valid until the end of that Madrid day', async () => {
    expect(endOfMadridDay('2026-11-02')).toBe('2026-11-02T22:59:59.000Z')
    const { api, calls } = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: { factId: 'f', action: 'added', sentence: 'Sin horno' } })
    await noteFichaFactSkill.handler({ type: 'temporary_situation', value: { description: 'Sin horno' }, about: 'household', valid_until: '2026-11-02' }, ctx('text', api))
    expect((calls[0].body as any).validUntil).toBe('2026-11-02T22:59:59.000Z')
  })

  it('«apunta que el abuelo…»: a person without an account by alias; an unknown alias saves nothing', async () => {
    const { api, calls } = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: { factId: 'f', action: 'added', sentence: 'Le encanta el cocido' } })
    await noteFichaFactSkill.handler({ type: 'affinity', value: { kind: 'style', target: 'el cocido', score: 2 }, about: 'person', person: 'el abuelo' }, ctx('whatsapp', api))
    expect((calls[1].body as any).personId).toBe(ABUELO)
    const other = fakeApi()
    const r = await noteFichaFactSkill.handler({ type: 'affinity', value: { kind: 'style', target: 'x', score: 1 }, about: 'person', person: 'la tía' }, ctx('text', other.api))
    expect(r.summary).toMatch(/No he guardado nada/)
    expect(r.summary).toContain('«El abuelo»')
    expect(other.calls.every((c) => c.method === 'GET')).toBe(true)
  })

  it.each(CHANNELS)('«quiero proteína en cada plato» (%s) writes protein_minimum about whoever says it', async (channel) => {
    const { api, calls } = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: { factId: 'f', action: 'added', sentence: 'Proteína en cada plato' } })
    const r = await noteFichaFactSkill.handler({ type: 'protein_minimum', value: { scope: 'every_dish' }, about: 'me' }, ctx(channel, api))
    expect(calls[0].body).toMatchObject({ type: 'protein_minimum', value: { scope: 'every_dish' }, about: 'me' })
    expect(r.summary).toMatch(/proteína/)
    // Said «for the house», the server still puts it on the person.
    expect(fichaSubjectFor('protein_minimum', 'household', ME, null)).toEqual({ subjectUserId: ME, subjectPersonId: null })
    expect(fichaSubjectFor('fixed_dish', 'household', ME, null)).toEqual({ subjectUserId: null, subjectPersonId: null })
    expect(fichaSubjectFor('restrictions', 'household', ME, null)).toEqual({ subjectUserId: ME, subjectPersonId: null })
    expect(fichaSubjectFor('affinity', 'person', ME, ABUELO)).toEqual({ subjectUserId: null, subjectPersonId: ABUELO })
  })

  it('nothing about health is written from WhatsApp: neither a health type nor a note that talks about it', async () => {
    for (const p of [
      { type: 'restrictions', value: ['sin gluten'], about: 'me' },
      { type: 'physical.weight_kg', value: 70, about: 'me' },
      { type: 'notes', value: ['Soy celíaca'], about: 'me' },
      { type: 'temporary_situation', value: { description: 'Embarazada hasta marzo' }, about: 'me' },
    ]) {
      const { api, calls } = fakeApi()
      const r = await noteFichaFactSkill.handler(p, ctx('whatsapp', api))
      expect(calls).toEqual([])
      expect(r.summary).toMatch(/no guardo datos de salud/)
    }
    // On the web it goes to the server (which asks for the consent).
    const web = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: new AppApiError(403, 'Para guardar datos de salud necesitas dar tu consentimiento en Perfil') })
    const r = await noteFichaFactSkill.handler({ type: 'restrictions', value: ['sin gluten'], about: 'me' }, ctx('text', web.api))
    expect(web.calls).toHaveLength(1)
    expect(r.summary).toMatch(/consentimiento/)
  })

  it('a server refusal on WhatsApp (the route checks the channel too) becomes the health reply', async () => {
    const { api } = fakeApi({ [`POST ${FICHA_FACTS_PATH}`]: new AppApiError(403, 'Por WhatsApp no guardo datos de salud: se cambian en Tu ficha, en la web') })
    const r = await noteFichaFactSkill.handler({ type: 'notes', value: ['algo raro'], about: 'me' }, ctx('whatsapp', api))
    expect(r.summary).toMatch(/no guardo datos de salud/)
  })

  it.each(CHANNELS)('«olvida que…» (%s): forgets what the reader may change, never another member\'s', async (channel) => {
    const { api, calls } = fakeApi()
    const ok = await forgetFichaFactSkill.handler({ fact_id: 'f-pizza' }, ctx(channel, api))
    expect(calls.at(-1)).toEqual({ method: 'DELETE', path: `${FICHA_PATH}/facts/f-pizza`, body: undefined })
    expect(ok.summary).toMatch(/Olvidado: «Pizza los viernes en la cena»/)
    const other = fakeApi()
    const no = await forgetFichaFactSkill.handler({ fact_id: 'f-marta-ajo' }, ctx(channel, other.api))
    expect(other.calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(no.summary).toMatch(/solo lo cambia ella/)
  })

  it('«olvida que…» about health goes to the web, not WhatsApp', async () => {
    const { api, calls } = fakeApi()
    const r = await forgetFichaFactSkill.handler({ fact_id: 'f-my-health' }, ctx('whatsapp', api))
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false)
    expect(r.summary).toMatch(/en la web/)
    const web = fakeApi()
    await forgetFichaFactSkill.handler({ fact_id: 'f-my-health' }, ctx('text', web.api))
    expect(web.calls.at(-1)?.method).toBe('DELETE')
  })

  it.each(CHANNELS)('«¿por qué crees que…?» (%s): the evidence in sentences, with dates and how it is used', async (channel) => {
    const why = {
      fact: VIEW.facts[0], confidence: 'Casi seguro', since: '2026-10-01',
      evidence: [{ date: '2026-10-17', text: 'Pidió pizza tres viernes seguidos' }], howIUse: 'Mimo lo tiene en cuenta al proponer el menú.',
    }
    const { api, calls } = fakeApi({ [`GET ${FICHA_PATH}/facts/f-pizza/why`]: why })
    const r = await explainFichaFactSkill.handler({ fact_id: 'f-pizza' }, ctx(channel, api))
    expect(calls.map((c) => c.path)).toEqual([FICHA_PATH, `${FICHA_PATH}/facts/f-pizza/why`])
    expect(r.summary).toContain('Casi seguro')
    expect(r.summary).toContain('2026-10-17: Pidió pizza tres viernes seguidos')
    expect(r.summary).toContain('Cómo lo uso')
  })

  it('«¿por qué crees que…?» never explains another person\'s health, nor any health on WhatsApp', async () => {
    const a = fakeApi()
    const r1 = await explainFichaFactSkill.handler({ fact_id: 'f-abuelo-health' }, ctx('text', a.api))
    expect(a.calls).toHaveLength(1)
    expect(r1.summary).toMatch(/No he encontrado/)
    const b = fakeApi()
    const r2 = await explainFichaFactSkill.handler({ fact_id: 'f-my-health' }, ctx('whatsapp', b.api))
    expect(b.calls).toHaveLength(1)
    expect(r2.summary).toMatch(/WhatsApp/)
  })

  it.each(CHANNELS)('«pausa lo que aprendes de mí» (%s): the reader\'s own switch', async (channel) => {
    const { api, calls } = fakeApi({ [`PUT ${FICHA_PATH}/learning`]: { paused: true } })
    const r = await setFichaLearningSkill.handler({ paused: true }, ctx(channel, api))
    expect(calls).toEqual([{ method: 'PUT', path: `${FICHA_PATH}/learning`, body: { paused: true } }])
    expect(r.summary).toMatch(/En pausa/)
    const back = fakeApi({ [`PUT ${FICHA_PATH}/learning`]: { paused: false } })
    expect((await setFichaLearningSkill.handler({ paused: false }, ctx(channel, back.api))).summary).toMatch(/Reanudado/)
  })

  it.each(CHANNELS)('the pending question (%s): asked once with Sí / No / Ahora no, answered through the screen\'s route', async (channel) => {
    const ask = { question: { id: 'q1', question: '¿Seguís sin horno?', subjectKey: 'casa', factId: 'f-h' }, reason: 'asked' }
    const { api, calls } = fakeApi({ [`POST ${FICHA_QUESTION_ASK_PATH}`]: ask })
    const r = await getFichaQuestionSkill.handler({}, ctx(channel, api))
    expect(calls).toEqual([{ method: 'POST', path: FICHA_QUESTION_ASK_PATH, body: undefined }])
    expect(r.summary).toContain('¿Seguís sin horno?')
    expect(r.summary).toContain('[[opciones: Sí | No | Ahora no]]')
    const ans = fakeApi()
    await answerFichaQuestionSkill.handler({ question_id: 'q1', answer: 'yes' }, ctx(channel, ans.api))
    expect(ans.calls).toEqual([{ method: 'POST', path: `${FICHA_PATH}/questions/q1`, body: { answer: 'yes' } }])
  })

  it('the pending question: when the server says no (this week already, outside the window), Mimo asks nothing', async () => {
    for (const reason of ['weekly_cap', 'outside_window', 'none']) {
      const { api } = fakeApi({ [`POST ${FICHA_QUESTION_ASK_PATH}`]: { question: null, reason } })
      const r = await getFichaQuestionSkill.handler({}, ctx('whatsapp', api))
      expect(r.summary).toMatch(/No hay pregunta que hacer ahora/)
      expect(r.summary).not.toContain('opciones')
    }
  })

  it('a child member is told the ficha is for the adults', async () => {
    const { api } = fakeApi({ [`GET ${FICHA_PATH}`]: new AppApiError(403, 'La ficha la ven los adultos de la casa') })
    expect((await getFichaSkill.handler({}, ctx('text', api))).summary).toMatch(/adultos/)
  })
})

describe('the pending question: at most one a week, WhatsApp only inside its 24 h window (PRO-319)', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  const daysAgo = (d: number) => new Date(now.getTime() - d * 24 * 3600 * 1000)
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600 * 1000)

  it('never asked, or asked more than 7 days ago: yes', () => {
    expect(mimoMayAskQuestion({ lastAskedAt: null, channel: 'web', lastInboundAt: null, now })).toEqual({ ok: true })
    expect(mimoMayAskQuestion({ lastAskedAt: daysAgo(7.1), channel: 'web', lastInboundAt: null, now })).toEqual({ ok: true })
  })

  it('asked in the last 7 days, on any channel: no', () => {
    expect(mimoMayAskQuestion({ lastAskedAt: daysAgo(6.9), channel: 'web', lastInboundAt: null, now })).toEqual({ ok: false, reason: 'weekly_cap' })
    expect(mimoMayAskQuestion({ lastAskedAt: daysAgo(1), channel: 'whatsapp', lastInboundAt: hoursAgo(1), now })).toEqual({ ok: false, reason: 'weekly_cap' })
  })

  it('WhatsApp: only within 24 h (with the safety margin) of the person\'s last message', () => {
    expect(mimoMayAskQuestion({ lastAskedAt: null, channel: 'whatsapp', lastInboundAt: hoursAgo(2), now })).toEqual({ ok: true })
    expect(mimoMayAskQuestion({ lastAskedAt: null, channel: 'whatsapp', lastInboundAt: hoursAgo(23.9), now })).toEqual({ ok: false, reason: 'outside_window' })
    expect(mimoMayAskQuestion({ lastAskedAt: null, channel: 'whatsapp', lastInboundAt: null, now })).toEqual({ ok: false, reason: 'outside_window' })
  })
})

describe('«apunta que…» adds to a list instead of replacing it (PRO-319)', () => {
  it('joins without repeats', () => {
    expect(mergeListValues(['cilantro', 'ajo'], ['Ajo', 'apio'])).toEqual(['cilantro', 'ajo', 'apio'])
    expect(mergeListValues(null, ['apio'])).toEqual(['apio'])
    expect(mergeListValues({ dish: 'a' }, { dish: 'b' })).toEqual({ dish: 'b' })
  })
})
