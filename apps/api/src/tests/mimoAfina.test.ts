/**
 * PRO-297 (hogares de prueba, 2026-10-20): the «Afina tu menú» notice said
 * «díselo a Mimo o quítalo en Perfil → "Lo que recuerdo de ti"», and Mimo
 * answered «Desde aquí no veo ese aviso», «Esos "Me apetece" no los puedo
 * deshacer desde el chat» and «esa pizza y ese ramen deberían ser versiones
 * sin gluten» (they had gluten). Four parts: the notices in Mimo's context,
 * tools to see and forget verdicts (web and WhatsApp), the allergen rule with
 * its eval case, and the notice naming the screen the web shows today.
 */
import { readFileSync } from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it, vi } from 'vitest'
import type { TasteVerdictRow } from '@ona/shared'
import {
  AFINA_NOTICE_KEY,
  AFINA_NOTICE_SCREEN,
  AFINA_NOTICE_TEXT,
  noticeDeliveries,
  noticesContextBlock,
} from '../services/afinaNotice.js'
import {
  forgetTasteVerdictsSkill,
  listTasteVerdictsSkill,
  matchVerdicts,
} from '../services/assistant/tasteSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import { toolMadeChange } from '../services/assistant/claims.js'
import { ALLERGEN_CHECK_RULE, NOTICE_TASTE_RULE, buildSystemParts } from '../services/assistant/systemPrompt.js'
import { FREE_FROM_CLAIM_RE, MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'

const WEB = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../web/src')
const web = (f: string) => readFileSync(path.join(WEB, f), 'utf8')
const DAY = 86_400_000

describe('the notice names the screen the web shows today (part 4)', () => {
  it('no longer sends them to «Lo que recuerdo de ti» in Perfil', () => {
    expect(AFINA_NOTICE_TEXT).not.toContain('Lo que recuerdo de ti')
    expect(AFINA_NOTICE_TEXT).toContain(`quítalo en ${AFINA_NOTICE_SCREEN} (o dímelo y te ayudo)`)
    expect(AFINA_NOTICE_SCREEN).toBe('Perfil → «Tu ficha» → «Editar mis datos uno a uno», en el apartado «Afina tu menú»')
  })

  it('every step of the path is on screen with that name', () => {
    // Perfil → «Tu ficha» (the card on top of the profile hub)
    expect(web('app/profile/page.tsx')).toContain('<FichaHubCard />')
    expect(web('components/ficha/FichaHubCard.tsx')).toMatch(/href="\/profile\/ficha"[\s\S]*>Tu ficha</)
    // → «Editar mis datos uno a uno» (/profile/memoria)
    expect(web('app/profile/ficha/page.tsx')).toMatch(/href="\/profile\/memoria"[^>]*>\s*Editar mis datos uno a uno/)
    // → the «Afina tu menú» section, with «Olvidar» on every verdict
    expect(web('app/profile/memoria/page.tsx')).toContain('<TasteMemorySection />')
    const section = web('components/taste/TasteMemorySection.tsx')
    expect(section).toMatch(/className=\{SUB_EYEBROW\}>Afina tu menú</)
    expect(section).toContain('Olvidar')
  })
})

describe('Mimo sees the notices sent to the household (part 1)', () => {
  const now = new Date('2026-10-22T10:00:00Z')
  const created = new Date('2026-10-20T08:00:00Z')
  const base = { key: AFINA_NOTICE_KEY, userId: 'u1', createdAt: created, whatsappSentAt: null, appSince: null, dismissedAt: null }

  it('WhatsApp sent: type, date and channel, and what it said', () => {
    const block = noticesContextBlock([{ ...base, whatsappSentAt: new Date('2026-10-20T19:30:00Z') }], now)
    expect(block).toContain('Avisos que la app y tu habeis mandado a este hogar (ultimos 14 dias):')
    expect(block).toContain('fallo de «Afina tu menú» con alergias y dietas (ya arreglado): por WhatsApp (de tu parte) el 2026-10-20.')
    expect(block).toContain(AFINA_NOTICE_TEXT)
  })

  it('in the app (no WhatsApp in the household) and closed', () => {
    const block = noticesContextBlock([{ ...base, userId: null, appSince: created, dismissedAt: new Date('2026-10-21T09:00:00Z') }], now)
    expect(block).toContain('en la app (tarjeta encima del menu) desde el 2026-10-20; cerrado en la app el 2026-10-21.')
  })

  it('WhatsApp still waiting for the window: not sent yet, nothing to say; from day 3 it is in the app', () => {
    expect(noticesContextBlock([base], now)).toBe('')
    const later = new Date(created.getTime() + 3 * DAY + 1000)
    expect(noticeDeliveries(base, later).appAt?.toISOString()).toBe(new Date(created.getTime() + 3 * DAY).toISOString())
    expect(noticesContextBlock([base], later)).toContain('en la app (tarjeta encima del menu) desde el 2026-10-23')
  })

  it('only the last 14 days', () => {
    const old = { ...base, userId: null, appSince: created }
    expect(noticesContextBlock([old], new Date(created.getTime() + 14 * DAY - 1000))).not.toBe('')
    expect(noticesContextBlock([old], new Date(created.getTime() + 15 * DAY))).toBe('')
  })

  it('the scan marker of a key never reaches a household (no household id), and none = empty', () => {
    expect(noticesContextBlock([], now)).toBe('')
  })
})

const ROWS: TasteVerdictRow[] = [
  { recipeId: '11111111-1111-4111-8111-111111111111', name: 'Pizza margarita', imageUrl: null, verdict: 'like', reason: null, updatedAt: '2026-10-17T18:00:00.000Z' },
  { recipeId: '22222222-2222-4222-8222-222222222222', name: 'Ramen de pollo', imageUrl: null, verdict: 'like', reason: null, updatedAt: '2026-10-17T18:01:00.000Z' },
  { recipeId: '33333333-3333-4333-8333-333333333333', name: 'Crema de calabaza', imageUrl: null, verdict: 'love', reason: null, updatedAt: '2026-10-18T10:00:00.000Z' },
]

function fakeApi(rows = ROWS) {
  const calls: Array<[string, string]> = []
  const api = vi.fn(async (method: string, p: string) => {
    calls.push([method, p])
    if (method === 'GET' && p === '/taste/verdicts') return { verdicts: rows }
    if (method === 'DELETE') return null
    throw new Error(`unexpected ${method} ${p}`)
  })
  return { api: api as any, calls }
}

describe('Mimo sees and forgets «Afina tu menú» verdicts (part 2)', () => {
  it('both tools are there on the web chat and on WhatsApp (D-051)', () => {
    for (const mode of ['text', 'voice', 'whatsapp']) {
      const names = toolsFor({ mode }).map((s) => s.name)
      expect(names).toContain('list_taste_verdicts')
      expect(names).toContain('forget_taste_verdicts')
    }
  })

  it('list: every verdict with its label, or only «Me apetece»', async () => {
    const { api } = fakeApi()
    const all = await listTasteVerdictsSkill.handler({}, { userId: 'u1', db: null, api })
    expect(all.summary).toContain('- Pizza margarita: «Me apetece» (2026-10-17)')
    expect(all.summary).toContain('- Crema de calabaza: «Me encanta» (2026-10-18)')
    const likes = await listTasteVerdictsSkill.handler({ verdict: 'like' }, { userId: 'u1', db: null, api })
    expect(likes.summary).not.toContain('Crema de calabaza')
    expect(toolMadeChange('list_taste_verdicts', likes.summary, false)).toBe(false)
  })

  it('forget by name: the same DELETE as «Olvidar», only the ones named', async () => {
    const { api, calls } = fakeApi()
    const r = await forgetTasteVerdictsSkill.handler({ names: ['la pizza', 'ramen'] }, { userId: 'u1', db: null, api, channel: 'whatsapp' })
    expect(calls.filter(([m]) => m === 'DELETE').map(([, p]) => p)).toEqual([`/taste/${ROWS[0].recipeId}`, `/taste/${ROWS[1].recipeId}`])
    expect(r.summary).toContain('- Pizza margarita (era «Me apetece»)')
    expect(r.summary).toContain('- Ramen de pollo (era «Me apetece»)')
    expect(toolMadeChange('forget_taste_verdicts', r.summary, false)).toBe(true)
  })

  it('a name that isn\'t rated is said, and a partial removal still counts as a change', async () => {
    const { api } = fakeApi()
    const r = await forgetTasteVerdictsSkill.handler({ names: ['pizza', 'lentejas'] }, { userId: 'u1', db: null, api })
    expect(r.summary).toContain('lentejas')
    expect(toolMadeChange('forget_taste_verdicts', r.summary, false)).toBe(true)
    const none = await forgetTasteVerdictsSkill.handler({ names: ['lentejas'] }, { userId: 'u1', db: null, api })
    expect(none.summary).toMatch(/^No he encontrado/)
    expect(toolMadeChange('forget_taste_verdicts', none.summary, false)).toBe(false)
  })

  it('all=true with verdict: every «Me apetece», nothing else; with nothing asked, nothing removed', async () => {
    const { api, calls } = fakeApi()
    await forgetTasteVerdictsSkill.handler({ all: true, verdict: 'like' }, { userId: 'u1', db: null, api })
    expect(calls.filter(([m]) => m === 'DELETE')).toHaveLength(2)
    const empty = fakeApi()
    const r = await forgetTasteVerdictsSkill.handler({}, { userId: 'u1', db: null, api: empty.api })
    expect(empty.calls).toEqual([])
    expect(r.summary).toMatch(/^No he quitado nada/)
  })

  it('matching: exact name first, then contained, accents and case ignored', () => {
    expect(matchVerdicts(ROWS, 'PIZZA MARGARITA').map((r) => r.name)).toEqual(['Pizza margarita'])
    expect(matchVerdicts(ROWS, 'la crema').map((r) => r.name)).toEqual(['Crema de calabaza'])
    expect(matchVerdicts(ROWS, '')).toEqual([])
  })
})

describe('never «sin gluten» without the ingredients (part 3)', () => {
  for (const mode of ['text', 'voice', 'whatsapp'] as const) {
    it(`${mode}: the rules are in the cached instructions`, () => {
      const { instructions, context } = buildSystemParts('ctx', mode)
      expect(instructions).toContain(ALLERGEN_CHECK_RULE)
      expect(instructions).toContain(NOTICE_TASTE_RULE)
      expect(context).not.toContain(ALLERGEN_CHECK_RULE)
    })
  }

  it('says to look with get_recipe_details, in this turn, for gluten and any other allergen', () => {
    expect(ALLERGEN_CHECK_RULE).toMatch(/Nunca digas que un plato es sin gluten/)
    expect(ALLERGEN_CHECK_RULE).toMatch(/sin haber mirado en este turno sus ingredientes con get_recipe_details/)
    expect(ALLERGEN_CHECK_RULE).toMatch(/cualquier otro alergeno/)
    expect(NOTICE_TASTE_RULE).toMatch(/nunca digas que no lo ves/)
    expect(NOTICE_TASTE_RULE).toMatch(/list_taste_verdicts[\s\S]*forget_taste_verdicts/)
  })

  it('the battery has the pizza case and the notice case', () => {
    expect(MIMO_EVAL_CASES.filter((c) => c.check === 'alergeno-sin-mirar' || c.check === 'aviso-afina').map((c) => c.id)).toEqual([
      'pizza-sin-gluten',
      'aviso-afina-quitar',
    ])
  })

  it('the pizza: the reply Mimo gave fails; one that read the flour passes; not reading fails live', () => {
    const c = MIMO_EVAL_CASES.find((x) => x.id === 'pizza-sin-gluten')!
    expect(c.toolResults?.get_recipe_details).toContain('harina de trigo')
    expect(mimoReplyProblems(c.badReply, c)).toEqual(expect.arrayContaining(['dice-sin-alergeno', 'no-confirma']))
    const good = 'No: la pizza margarita lleva harina de trigo, así que tiene gluten. Si quieres, quito ese «Me apetece».'
    expect(mimoReplyProblems(good, c, ['get_recipe_details'])).toEqual([])
    expect(mimoReplyProblems(good, c, [])).toEqual(['no-mira-receta'])
  })

  it('the claim detector: free-from claims yes, «no es sin gluten» / «lleva gluten» no', () => {
    for (const bad of ['deberían ser versiones sin gluten', 'la pizza es sin gluten', 'no lleva gluten', 'son aptas para celiacos', 'seguro que es sin lactosa']) {
      expect(FREE_FROM_CLAIM_RE.test(bad.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()), bad).toBe(true)
    }
    for (const ok of ['no es sin gluten', 'lleva gluten', 'no era sin gluten: lleva harina de trigo']) {
      expect(FREE_FROM_CLAIM_RE.test(ok), ok).toBe(false)
    }
  })

  it('the notice: «no veo ese aviso» / «no los puedo deshacer» / the email fail; removing them passes', () => {
    const c = MIMO_EVAL_CASES.find((x) => x.id === 'aviso-afina-quitar')!
    expect(c.context).toContain('Avisos que la app y tu habeis mandado')
    expect(mimoReplyProblems(c.badReply, c)).toEqual(expect.arrayContaining(['no-ve-aviso', 'no-confirma']))
    const good = 'Hecho: he quitado el «Me apetece» de la pizza margarita y del ramen de pollo. Ya no cuentan para tu menú.'
    expect(mimoReplyProblems(good, c, ['list_taste_verdicts', 'forget_taste_verdicts'])).toEqual([])
    expect(mimoReplyProblems(good, c, ['list_taste_verdicts'])).toEqual(['no-quita'])
  })
})

describe('the «Afina tu menú» summary points to the same screen', () => {
  it('no «Lo que recuerdo de ti» in Perfil', () => {
    const swiper = web('components/taste/TasteSwiper.tsx')
    expect(swiper).not.toContain('Perfil → Lo que recuerdo de ti')
    expect(swiper).toContain('Lo tienes todo en Perfil → Tu ficha → Editar mis datos uno a uno')
  })
})
