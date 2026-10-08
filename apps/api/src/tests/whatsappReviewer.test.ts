/**
 * Conversation reviewer agent — pure parts: day boundaries, objective
 * signals, transcripts with the engine trace, and the WhatsApp summary.
 */
import { describe, it, expect } from 'vitest'
import { computeStats, buildTranscripts, formatReviewMessage, reviewerSystemPrompt, REVIEW_SCHEMA, type ReviewRow } from '../services/whatsapp/reviewer.js'
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
    })
  })
})

describe('buildTranscripts', () => {
  it('renders one transcript per user with Madrid times and the engine trace', () => {
    const [t] = buildTranscripts([
      row({ body: 'Pon chawanmushi', meta: { tools: ['import_recipe_from_url', 'swap_meal'], corrections: ['promise'], ms: 7_200 } }),
      row({ direction: 'out', kind: 'ack', status: 'sent', body: 'Voy a leer esa receta…', createdAt: at('2026-10-07T07:37:35Z') }),
    ])
    expect(t).toContain('=== Conversación 1 (miguel) ===')
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
      { conversations: 1, turns: 2, failedTurns: 0, slowTurns: 0, corrections: 1, frustrationCues: 0, questionEndings: 0, proactiveSent: 2, sendFailures: 0 },
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
