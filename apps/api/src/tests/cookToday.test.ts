/**
 * PRO-230 (D-069): «hoy cocina Pablo, mándale la receta». A two-person
 * household, with and without WhatsApp; that day's prep alerts go to the cook.
 * The DB path (alerts moved, new alerts for the cook) is in cookToday.smoke.ts.
 */
import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ createRecipeFromParts: vi.fn() }))

import { assignCookToday, cookMessage, findMember, forwardLink, type CookTodayDeps } from '../services/cookToday.js'
import { appSkills } from '../services/assistant/appSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import type { AppApi } from '../services/assistant/appApi.js'

const ANA = { userId: 'u-ana', username: 'ana', role: 'owner' as const, joinedAt: '' }
const PABLO = { userId: 'u-pablo', username: 'Pablo_G', role: 'member' as const, joinedAt: '' }
// Monday 2026-10-19, 12:00 Madrid.
const NOW = new Date('2026-10-19T10:00:00Z')
const days = () => {
  const d: any[] = [{}, {}, {}, {}, {}, {}, {}]
  d[0] = { dinner: { dishes: [{ kind: 'recipe', recipeId: 'r-filete', recipeName: 'Filete' }] } }
  return d
}

function deps(over: Partial<CookTodayDeps> = {}) {
  const sent: Array<{ userId: string; text: string }> = []
  const assigned: any[] = []
  const d: CookTodayDeps = {
    loadHousehold: async () => ({ id: 'h1', members: [ANA, PABLO] }),
    loadDay: async () => ({ menuId: 'm1', days: days() }),
    loadRecipes: async () => [{ id: 'r-filete', name: 'Filete a la plancha' }],
    pendingPreps: async () => [{ title: 'Acuérdate: Saca el filete del frigorífico', fireAt: new Date('2026-10-19T17:30:00Z') }],
    whatsAppOf: async (id) => (id === PABLO.userId ? { notify: true } : null),
    sendWhatsApp: async (userId, text) => {
      sent.push({ userId, text })
      return { status: 'ok' }
    },
    assign: async (p) => {
      assigned.push(p)
    },
    webUrl: 'https://mimoia.com',
    ...over,
  }
  return { d, sent, assigned }
}

describe('assignCookToday — two-person household', () => {
  it('with WhatsApp: Pablo gets the recipe + pending preparativos; that day is his', async () => {
    const { d, sent, assigned } = deps()
    const r = await assignCookToday(ANA.userId, { name: 'Pablo' }, d, NOW)
    expect(r).toMatchObject({ status: 'sent', cook: 'Pablo_G' })
    expect(sent).toHaveLength(1)
    expect(sent[0].userId).toBe(PABLO.userId)
    expect(sent[0].text).toBe(
      'Hoy cocinas tú la cena (te lo pide ana):\n→ Filete a la plancha: mimoia.com/recipes/r-filete\n\nCon antelación:\n- Saca el filete del frigorífico (a las 19:30)\n\nTe aviso yo a esa hora.',
    )
    expect(assigned).toEqual([{ householdId: 'h1', menuId: 'm1', day: expect.objectContaining({ isoDate: '2026-10-19', dayIndex: 0 }), cookId: PABLO.userId, requesterId: ANA.userId }])
  })

  it('without WhatsApp: nothing sent, alerts stay with Ana, and a link to forward it', async () => {
    const { d, sent, assigned } = deps({ whatsAppOf: async () => null })
    const r = await assignCookToday(ANA.userId, { name: 'pablo' }, d, NOW)
    expect(r).toMatchObject({ status: 'not_reachable', reason: 'no_whatsapp', cook: 'Pablo_G' })
    if (r.status !== 'not_reachable') throw new Error()
    expect(r.forwardUrl).toBe(forwardLink(r.text))
    expect(decodeURIComponent(r.forwardUrl)).toContain('Filete a la plancha')
    expect(sent).toEqual([])
    expect(assigned).toEqual([])
  })

  it('WhatsApp linked but avisos off, or the message cannot go out → not sent, not assigned', async () => {
    const off = deps({ whatsAppOf: async () => ({ notify: false }) })
    expect(await assignCookToday(ANA.userId, { name: 'Pablo' }, off.d, NOW)).toMatchObject({ status: 'not_reachable', reason: 'avisos_off' })
    const win = deps({ sendWhatsApp: async () => ({ status: 'skipped', error: 'outside-24h-window' }) })
    expect(await assignCookToday(ANA.userId, { name: 'Pablo' }, win.d, NOW)).toMatchObject({ status: 'not_reachable', reason: 'window' })
    expect(win.assigned).toEqual([])
  })

  it('refuses: alone at home, unknown name, oneself, no recipe that day', async () => {
    expect(await assignCookToday(ANA.userId, { name: 'Pablo' }, deps({ loadHousehold: async () => ({ id: 'h1', members: [ANA] }) }).d, NOW)).toMatchObject({ status: 'error' })
    expect(await assignCookToday(ANA.userId, { name: 'Lucía' }, deps().d, NOW)).toMatchObject({ status: 'error', message: expect.stringContaining('Están: ana, Pablo_G') })
    expect(await assignCookToday(ANA.userId, { name: 'Ana' }, deps().d, NOW)).toMatchObject({ status: 'error', message: expect.stringContaining('eres tú') })
    expect(await assignCookToday(ANA.userId, { name: 'Pablo', day: 'mañana' }, deps().d, NOW)).toMatchObject({ status: 'error', message: expect.stringContaining('No hay receta') })
  })

  it('findMember matches the first name, accents and case', () => {
    expect(findMember([ANA, PABLO], 'pablo')?.userId).toBe(PABLO.userId)
    expect(findMember([ANA, { ...PABLO, username: 'María José' }], 'maria')?.username).toBe('María José')
    expect(findMember([ANA, PABLO], 'Lucía')).toBeNull()
  })

  it('another day says which', () => {
    const day = { weekStart: '2026-10-19', dayIndex: 3, isoDate: '2026-10-22', label: 'jueves 22 de octubre' }
    expect(cookMessage({ requester: 'ana', day, isToday: false, meal: 'lunch', recipes: [{ id: 'r', name: 'Lentejas' }], preps: [], webUrl: 'https://mimoia.com' })).toBe(
      'El jueves 22 de octubre cocinas tú la comida (te lo pide ana):\n→ Lentejas: mimoia.com/recipes/r',
    )
  })
})

describe('Mimo: set_cook_today (web chat and WhatsApp)', () => {
  const skill = appSkills.find((s) => s.name === 'set_cook_today')!
  const ctx = (api: AppApi) => ({ userId: 'u-ana', db: null, api }) as any
  it('offered on both channels', () => {
    for (const mode of [undefined, 'whatsapp']) expect(toolsFor({ mode }).map((s) => s.name)).toContain('set_cook_today')
  })
  it('calls the route and reports each outcome', async () => {
    const calls: any[] = []
    const reply = (body: unknown): AppApi => async (method, path, b) => {
      calls.push({ method, path, body: b })
      return body as any
    }
    const sent = await skill.handler({ name: 'Pablo', day: 'hoy' }, ctx(reply({ status: 'sent', cook: 'Pablo_G', text: '' })))
    expect(calls[0]).toEqual({ method: 'POST', path: '/households/me/cook-today', body: { name: 'Pablo', day: 'hoy' } })
    expect(sent.summary).toContain('los avisos de preparación de ese día le llegan a Pablo_G')
    const not = await skill.handler({ name: 'Pablo' }, ctx(reply({ status: 'not_reachable', cook: 'Pablo_G', reason: 'no_whatsapp', text: 't', forwardUrl: 'https://wa.me/?text=t' })))
    expect(not.summary).toContain('Pablo_G no tiene WhatsApp conectado')
    expect(not.summary).toContain('https://wa.me/?text=t')
    const err = await skill.handler({ name: 'Lucía' }, ctx(reply({ status: 'error', message: 'No encuentro a «Lucía» en tu hogar.' })))
    expect(err.summary).toBe('No hecho: No encuentro a «Lucía» en tu hogar.')
  })
})
