/**
 * PRO-1054: Mimo knows the Friday email (a recipe of the week and Mimoia's
 * news) and signs the person up or off through the same route as the switch
 * in Perfil → Ajustes → Avisos (`GET`/`PUT /newsletter/me`). Before, the
 * newcomers heard «no me consta que Mimoia mande recetas por email», even
 * with the box ticked. specs/newsletter.md.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../services/recipeImport.js', () => ({ createRecipeFromParts: vi.fn(), importRecipeFromUrl: vi.fn() }))

import { getNewsletter, setNewsletter } from '../services/assistant/newsletterSkills.js'
import { describeAlerts } from '../services/assistant/appSkills.js'
import { toolsFor } from '../services/assistant/skills.js'
import { selectToolGroups } from '../services/assistant/toolGroups.js'
import { MIMO_EVAL_CASES, mimoReplyProblems } from '../services/assistant/mimoEvalCases.js'
import { AppApiError, type AppApi } from '../services/assistant/appApi.js'

function fakeApi(optIn = false) {
  const calls: { method: string; path: string; body?: unknown }[] = []
  let on = optIn
  const api: AppApi = async (method, p, body) => {
    calls.push({ method, path: p, body })
    if (method === 'PUT') on = (body as { optIn: boolean }).optIn
    return { optIn: on } as any
  }
  return { api, calls }
}
const ctx = (api: AppApi, channel?: string) => ({ userId: 'u1', db: null, api, channel }) as any

describe('Mimo: get_newsletter / set_newsletter (same route as the switch)', () => {
  it('are offered in the web chat and on WhatsApp, and the turn about the Friday email gets them', () => {
    for (const mode of [undefined, 'whatsapp']) {
      const names = toolsFor({ mode }).map((s) => s.name)
      expect(names).toContain('get_newsletter')
      expect(names).toContain('set_newsletter')
    }
    for (const message of [
      'lo de la receta de los viernes por email como me apunto?',
      'apúntame a la newsletter',
      'no me mandes más el correo de los viernes',
    ]) {
      const sel = selectToolGroups({ message })
      expect([...sel.tools]).toContain('set_newsletter')
      expect(sel.about).toBe(true)
    }
  })

  it('«apúntame» → PUT optIn true and says where it is undone', async () => {
    const f = fakeApi(false)
    const r = await setNewsletter.handler({ on: true }, ctx(f.api, 'whatsapp'))
    expect(f.calls).toEqual([{ method: 'PUT', path: '/newsletter/me', body: { optIn: true } }])
    expect(r.summary).toMatch(/^Hecho: apuntado al correo de los viernes\./)
    expect(r.summary).toContain('Perfil → Ajustes → Avisos')
  })

  it('«no me lo mandes más» → PUT optIn false', async () => {
    const f = fakeApi(true)
    const r = await setNewsletter.handler({ on: false }, ctx(f.api))
    expect(f.calls[0].body).toEqual({ optIn: false })
    expect(r.summary).toMatch(/^Hecho: ya no le llegará el correo de los viernes\./)
  })

  it('without on/off changes nothing; an API refusal says so', async () => {
    const f = fakeApi()
    expect((await setNewsletter.handler({}, ctx(f.api))).summary).toMatch(/^No he cambiado nada/)
    expect(f.calls).toHaveLength(0)
    const failing: AppApi = async () => {
      throw new AppApiError(404, 'User not found')
    }
    expect((await setNewsletter.handler({ on: true }, ctx(failing))).summary).toBe('No he cambiado nada: User not found')
  })

  it('get_newsletter says the state, what it is and where it lives', async () => {
    const off = await getNewsletter.handler({}, ctx(fakeApi(false).api))
    expect(off.summary).toMatch(/^No está apuntado\./)
    const on = await getNewsletter.handler({}, ctx(fakeApi(true).api))
    expect(on.summary).toMatch(/^Está apuntado: le llega cada viernes\./)
    expect(on.summary).toContain('una receta de la semana')
    expect(on.summary).toContain('Perfil → Ajustes → Avisos')
  })

  it('get_alerts no longer says the email is only the account’s', () => {
    const s = describeAlerts({ kinds: [], whatsapp: { linked: false, notify: false }, push: { subscribed: false } } as any)
    expect(s).toContain('el correo de los viernes')
    expect(s).toContain('set_newsletter')
  })
})

describe('«Sobre Mimoia» knows the Friday email', () => {
  const kb = readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../kb/sobre-mimoia.md'), 'utf-8')
  it('says what it is and where it is switched on, and no longer «solo lo de la cuenta»', () => {
    expect(kb).toContain('**El correo de los viernes')
    expect(kb).toContain('Perfil → Ajustes → Avisos, con la casilla «Quiero recibir cada viernes por email una receta de la semana y novedades de Mimoia»')
    expect(kb).not.toContain('Por correo solo llega lo de la cuenta.')
  })
})

describe('battery: newsletter cases', () => {
  const cases = MIMO_EVAL_CASES.filter((c) => c.check === 'newsletter')
  it('has the four situations', () => {
    expect(cases.map((c) => c.id)).toEqual([
      'receta-viernes-como-me-apunto',
      'receta-viernes-apuntame',
      'receta-viernes-ya-apuntado',
      'receta-viernes-quitame',
    ])
  })
  it('each literal bad reply fails (it denied the email)', () => {
    for (const c of cases) expect(mimoReplyProblems(c.badReply, c)).toContain('niega-newsletter')
  })
  it('a good reply passes, and the live grading wants the right on/off', () => {
    const [how, signUp, already, off] = cases
    expect(mimoReplyProblems('Es el correo de los viernes: una receta de la semana y novedades. Se activa en Perfil → Ajustes → Avisos; si quieres, te apunto yo.', how)).toEqual([])
    const good = 'Hecho: te he apuntado al correo de los viernes. Te llega el próximo viernes por la mañana.'
    expect(mimoReplyProblems(good, signUp, ['set_newsletter'], [{ name: 'set_newsletter', input: '{"on":true}' }])).toEqual([])
    expect(mimoReplyProblems(good, signUp, ['get_newsletter'], [])).toEqual(expect.arrayContaining(['no-apunta', 'apunta-mal']))
    expect(mimoReplyProblems('Sí, estás apuntado: te llega cada viernes por la mañana.', already)).toEqual([])
    expect(mimoReplyProblems('Hecho, ya no te llegará el correo de los viernes. Lo puedes volver a activar en Ajustes → Avisos.', off, ['set_newsletter'], [{ name: 'set_newsletter', input: '{"on":true}' }])).toEqual(['apunta-mal'])
  })
})
