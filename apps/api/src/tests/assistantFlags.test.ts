/**
 * Conversation flags for the Mimoia HQ agents (GET /admin/assistant-reviews/flags,
 * specs/whatsapp.md): the deterministic detectors (health talk, §6 health
 * claims, "Hecho" with no change in the tool trace, errors) and the merge with
 * the daily reviewer's findings — always anonymised.
 */
import { describe, expect, it } from 'vitest'
import {
  buildFlagItems,
  countFlags,
  detectFlags,
  isUnverifiedDone,
  replyFlags,
  reviewerCategory,
  traceHasChange,
  type FlagRow,
} from '../services/assistantFlags.js'
import { healthClaimWords, HEALTH_EVAL_CASES } from '../services/assistant/healthGuard.js'
import { computeStats, buildTranscripts, type ReviewRow } from '../services/whatsapp/reviewer.js'

const swap = { name: 'swap_meal', input: '{"dayIndex":3}', summary: 'Hecho. He puesto "Merluza" en la cena del jueves.' }
const read = { name: 'get_todays_menu', input: '{}', summary: 'Hoy: lentejas.' }

describe('health detectors', () => {
  it('flags the real bad replies of the test households as health talk', () => {
    for (const c of HEALTH_EVAL_CASES) {
      expect(replyFlags(c.badReply, null).categories, c.id).toContain('health_talk')
    }
  })

  it('flags §6 guard-list claims with the same list as the public-pages test', () => {
    expect(healthClaimWords('Este caldo depura y es antiinflamatorio')).toEqual(['antiinflamatorio/a', 'depura / detox'])
    const f = replyFlags('Te pongo la crema, que ayuda a perder peso.', null)
    expect(f.categories).toEqual(['health_claim'])
    expect(f.claimWords).toEqual(['pérdida de peso'])
  })

  it('leaves a correct health answer alone', () => {
    const ok = 'Eso, mejor con su medico. Mimoia no sustituye a un profesional sanitario. Si quieres, le pongo una merluza en salsa verde.'
    expect(replyFlags(ok, { toolTrace: [] }).categories).toEqual([])
  })

  it('counts the engine health_talk flag even if the words changed', () => {
    expect(replyFlags('Mejor otra cosa.', { corrections: ['health_talk'], toolTrace: [] }).categories).toContain('health_talk')
  })
})

describe('unverified "Hecho"', () => {
  it('is flagged when the reply says Hecho and no tool changed anything', () => {
    expect(isUnverifiedDone('Hecho: - Cena del jueves cambiada', { toolTrace: [] })).toBe(true)
    expect(isUnverifiedDone('Hecho: - Cena del jueves cambiada', { toolTrace: [read] })).toBe(true)
    expect(isUnverifiedDone('Ya he cambiado la cena del jueves.', { toolTrace: [{ ...swap, error: true }] })).toBe(true)
    expect(isUnverifiedDone('Hecho.', { toolTrace: [{ name: 'swap_meal', input: '{}', summary: 'No he encontrado la receta "X".' }] })).toBe(true)
  })

  it('is not flagged when a tool really changed something, or there is no claim', () => {
    expect(isUnverifiedDone('Hecho: - Merluza el jueves para cenar', { toolTrace: [swap] })).toBe(false)
    expect(isUnverifiedDone('Hoy tienes lentejas.', { toolTrace: [read] })).toBe(false)
  })

  it('cannot judge turns from before the tool trace, except when the engine flagged them', () => {
    expect(isUnverifiedDone('Hecho: - cambiado', null)).toBe(false)
    expect(isUnverifiedDone('Hecho: - cambiado', { tools: [] })).toBe(false)
    expect(isUnverifiedDone('Listo.', { corrections: ['unverified_claim'] })).toBe(true)
  })

  it('traceHasChange ignores read-only tools and errors', () => {
    expect(traceHasChange([read])).toBe(false)
    expect(traceHasChange([read, swap])).toBe(true)
  })
})

const at = (iso: string) => new Date(iso)
const row = (over: Partial<FlagRow>): FlagRow => ({
  phone: '34600111222',
  userId: 'u1',
  direction: 'in',
  kind: 'text',
  body: 'cambia la cena del jueves',
  status: 'processed',
  meta: { tools: [], corrections: [], toolTrace: [] },
  createdAt: at('2026-10-12T08:00:00Z'),
  ...over,
})

describe('detectFlags', () => {
  it('pairs each turn with its reply and flags it; failed turns and failed sends are errors', () => {
    const { turns, flags } = detectFlags([
      row({}),
      row({ direction: 'out', kind: 'ack', status: 'sent', body: 'Me pongo con ello', createdAt: at('2026-10-12T08:00:05Z') }),
      row({ direction: 'out', kind: 'reply', status: 'sent', body: 'Hecho: - Merluza el jueves', createdAt: at('2026-10-12T08:00:10Z') }),
      row({ body: 'y el viernes?', meta: { toolTrace: [swap] }, createdAt: at('2026-10-12T08:05:00Z') }),
      row({ direction: 'out', kind: 'reply', status: 'failed', body: 'Hecho: - Merluza el viernes', createdAt: at('2026-10-12T08:05:10Z') }),
      row({ body: 'hola', status: 'failed', meta: null, createdAt: at('2026-10-12T09:00:00Z') }),
      row({ direction: 'out', kind: 'system', status: 'sent', body: 'Ha habido un error', createdAt: at('2026-10-12T09:00:02Z') }),
    ])
    expect(turns).toBe(3)
    expect(flags.map((f) => [f.category, f.day, f.reply])).toEqual([
      ['unverified_done', '2026-10-12', 'Hecho: - Merluza el jueves'],
      ['error_refusal', '2026-10-12', 'Hecho: - Merluza el viernes'],
      ['error_refusal', '2026-10-12', null],
    ])
  })

  it('feeds the daily reviewer: stats and a ⚑ line under the flagged reply', () => {
    const rows: ReviewRow[] = [
      { ...row({}), username: 'carmen', errorMessage: null } as ReviewRow,
      { ...row({ direction: 'out', kind: 'reply', status: 'sent', body: 'El arroz sube el azúcar. Hecho: - nada', createdAt: at('2026-10-12T08:00:10Z') }), username: 'carmen', errorMessage: null } as ReviewRow,
    ]
    const stats = computeStats(rows)
    expect([stats.healthTalk, stats.healthClaims, stats.unverifiedDone]).toEqual([1, 0, 1])
    expect(buildTranscripts(rows)[0]).toContain('⚑ señales automáticas: habla de efectos en el cuerpo (regla de salud) · dice "hecho" pero ninguna herramienta cambió nada')
  })
})

describe('buildFlagItems', () => {
  const detected = detectFlags([
    row({ createdAt: at('2026-10-12T08:00:00Z') }), // 10:00 Madrid
    row({ direction: 'out', kind: 'reply', status: 'sent', body: 'Hecho: Antonio ya tiene merluza el jueves. Llama al 600 111 222.', createdAt: at('2026-10-12T08:00:10Z') }),
  ]).flags

  it('anonymises replies and notes, and merges a reviewer finding about the same turn', () => {
    const items = buildFlagItems(
      detected,
      [
        {
          day: '2026-10-12',
          findings: [
            { severity: 'alta', category: 'afirmacion_falsa', when: 'Conversación 1 (carmen), 10:01', whatHappened: 'Dijo a carmen que había cambiado la cena', suggestedFix: 'Llamar a swap_meal' },
            { severity: 'baja', category: 'respuesta_larga', when: '11:30', whatHappened: 'Respuesta larga para Antonio', suggestedFix: 'Acortar' },
          ],
        },
      ],
      ['carmen', 'Antonio'],
    )
    expect(items).toHaveLength(2)
    const [merged, other] = items
    expect(merged).toMatchObject({ date: '2026-10-12', channel: 'whatsapp', category: 'unverified_done', source: 'both', reviewerCategory: 'afirmacion_falsa', severity: 'alta' })
    expect(merged.reply).toBe('Hecho: [nombre] ya tiene merluza el jueves. Llama al [teléfono].')
    expect(merged.note).toContain('Revisor: Dijo a [nombre] que había cambiado la cena → Llamar a swap_meal')
    expect(other).toMatchObject({ category: 'other', source: 'reviewer', reviewerCategory: 'respuesta_larga', reply: null })
    expect(JSON.stringify(items)).not.toMatch(/carmen|Antonio|600 111 222/)
  })

  it('a name revealed anywhere in the batch (here, the reviewer note) is masked in every reply', () => {
    const flags = detectFlags([
      row({}),
      row({ direction: 'out', kind: 'reply', status: 'sent', body: 'Hecho:\n- Antonio ya tiene merluza el jueves', createdAt: at('2026-10-12T08:00:10Z') }),
    ]).flags
    const items = buildFlagItems(flags, [{ day: '2026-10-12', findings: [{ category: 'lentitud', when: '', whatHappened: 'Tardó con la cena de Antonio' }] }], [])
    expect(JSON.stringify(items)).not.toContain('Antonio')
  })

  it('counts per category, and the reviewer findings by category and severity', () => {
    const items = buildFlagItems(detected, [{ day: '2026-10-12', findings: [{ severity: 'media', category: 'error_tecnico', when: '', whatHappened: 'x' }] }], [])
    expect(countFlags(items)).toEqual({
      byCategory: { health_talk: 0, health_claim: 0, unverified_done: 1, error_refusal: 1, other: 0 },
      reviewerByCategory: { error_tecnico: 1 },
      reviewerBySeverity: { media: 1 },
    })
  })

  it('maps reviewer categories onto flag categories', () => {
    expect(reviewerCategory('accion_no_hecha')).toBe('unverified_done')
    expect(reviewerCategory('rechazo_indebido')).toBe('error_refusal')
    expect(reviewerCategory('lentitud')).toBe('other')
  })
})
