/**
 * PRO-1123 (D-176): la carta personal de la newsletter y el editor de Admin
 * (specs/newsletter.md → «Carta personal», «Editor en Admin»).
 *
 *   - Carta: dos personas reciben cartas distintas (su nombre, su receta, su
 *     porqué); sin nombre, un saludo neutro («Hola:»), nunca «estimado
 *     usuario»; ningún dato de salud en la frase (ni alergias ni dietas, ni un
 *     plato cocinado que las delate).
 *   - Editor: guardar (borra la prueba y la programación), la vista previa
 *     con 2–3 personas de verdad (sin sus enlaces de baja), la prueba al
 *     correo de la cuenta del admin con su caso, «Programar» para el viernes
 *     a las 9:00 solo con la prueba de la plantilla guardada esa semana, y un
 *     envío a mano que no es la plantilla probada no sale.
 *   - El programador la envía una vez a su hora; sin prueba, no sale.
 */
import express, { type RequestHandler } from 'express'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanFirstName,
  fillLetter,
  nameFromUsername,
  reasonLine,
  safeDishName,
  waitlistLetterFacts,
  type LetterFacts,
  type NewsletterLetterRepo,
} from '../services/newsletterLetter.js'
import {
  newsletterSendSchema,
  newsletterTokenForUser,
  newsletterTokenForWaitlist,
  previewNewsletter,
  sendNewsletter,
  withPersonalLetter,
  type NewsletterCandidate,
  type NewsletterDeps,
  type NewsletterRepo,
} from '../services/newsletter.js'
import { draftReadiness, nextFridayNine, runScheduledNewsletterIfDue } from '../services/newsletterDrafts.js'
import type { EmailMessage, EmailResult } from '../services/email.js'
import { createNewsletterRouter } from '../routes/newsletter.js'
import { memoryDraftsRepo } from './fixtures/memoryNewsletterDrafts.js'

const ANA = '11111111-1111-4111-8111-11111111111a'
const BEA = '11111111-1111-4111-8111-11111111111b'
const ADMIN = '11111111-1111-4111-8111-1111111111ad'
const TOKEN_W = 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'
/** Jueves 5 de noviembre de 2026, 14:00 en Madrid. */
const NOW = new Date('2026-11-05T13:00:00Z')

const TEMPLATE = {
  subject: '{nombre}, tu receta de esta semana',
  preheader: 'La he elegido para tu casa',
  content: {
    edition: 'N.º 4 · 6 de noviembre de 2026',
    preface: 'Hola, {nombre}:',
    headline: 'Una receta *para vosotros*',
    intro: 'Esta semana te mando {receta}. {porque}',
    star: {
      title: 'Lentejas estofadas',
      body: 'De cuchara, para el primer fin de semana de frío.',
      imageUrl: 'https://mimoia.com/images/recipes/lentejas.jpg',
      imageAlt: 'Un plato de lentejas',
      url: 'https://mimoia.com/recipes/lentejas',
    },
    cta: { label: 'Abrir Mimoia', url: 'https://mimoia.com/menu' },
    signoff: 'Un abrazo, {nombre}.',
    from: { name: 'Miguel', role: 'Fundador de Mimoia' },
  },
}
const ISSUE = newsletterSendSchema.parse({ issueId: '2026-11-06', ...TEMPLATE })

const FACTS: Record<string, LetterFacts> = {
  [ANA]: { firstName: 'Ana', people: 4, kids: 2, hasDislikes: true, lastCooked: 'Pollo al curry' },
  [BEA]: { firstName: null, people: 1, kids: 0, hasDislikes: false, lastCooked: 'Bizcocho sin gluten' },
  [ADMIN]: { firstName: 'Miguel', people: 3, kids: 1, hasDislikes: false, lastCooked: null },
}

function letters(facts = FACTS): NewsletterLetterRepo {
  return {
    async accountFacts(ids) {
      return new Map(ids.flatMap((id) => (facts[id] ? [[id, facts[id]] as const] : [])))
    },
    async recipeSeasons() {
      return new Map()
    },
  }
}

const account = (email: string, userId: string): NewsletterCandidate => ({
  source: 'user',
  email,
  status: 'active',
  newsletterOptIn: true,
  token: newsletterTokenForUser(userId),
  userId,
  referralCode: `cd${userId.slice(-2)}2345`,
})
const waitlisted = (email: string, firstName: string | null): NewsletterCandidate => ({
  source: 'waitlist',
  email,
  status: 'waiting',
  newsletterOptIn: true,
  token: newsletterTokenForWaitlist(TOKEN_W),
  leaveToken: TOKEN_W,
  letter: waitlistLetterFacts({ firstName, householdSize: '2', currentMethod: 'improviso' }),
})

function memoryRepo(candidates: NewsletterCandidate[], admins = ['miguel@example.com']): NewsletterRepo {
  const claimed = new Set<string>()
  return {
    async candidates() {
      return candidates.map((c) => ({ ...c }))
    },
    async claimedHashes() {
      return new Set(claimed)
    },
    async claim(_i, rs) {
      const got = new Set<string>()
      for (const r of rs) if (!claimed.has(r.hash)) (claimed.add(r.hash), got.add(r.hash))
      return got
    },
    async markSent() {},
    async release() {},
    async isAdminEmail(e) {
      return admins.includes(e)
    },
    async unsubscribe() {
      return { outcome: 'not_found', recipientHash: null }
    },
    async getUserOptIn() {
      return null
    },
    async setUserOptIn() {
      return null
    },
  }
}

const okBatch = () => vi.fn(async (m: EmailMessage[]): Promise<EmailResult[]> => m.map((_, i) => ({ status: 'sent', id: `re_${i}` })))

function deps(repo: NewsletterRepo, extra: Partial<NewsletterDeps> = {}): NewsletterDeps {
  return {
    repo,
    sendBatch: okBatch(),
    sendOne: vi.fn(async (): Promise<EmailResult> => ({ status: 'sent', id: 're_p' })),
    publicUrl: 'https://mimoia.com',
    apiUrl: 'https://api.mimoia.com',
    letters: letters(),
    tips: {
      async personas() {
        return new Map()
      },
      async recipeFacts() {
        return new Map()
      },
      async record() {},
      async markAdopted() {},
      async userIdByEmail(e) {
        return e === 'miguel@example.com' ? ADMIN : null
      },
    },
    now: () => NOW,
    ...extra,
  }
}

const HEALTH = /alerg|gluten|lactosa|celiac|diab|vegan|vegetarian|dieta|intoleran|salud/i

describe('la carta personal (PRO-1123)', () => {
  it('dos personas reciben cartas distintas: su nombre, su porqué', async () => {
    const d = deps(memoryRepo([account('ana@example.com', ANA), account('bea@example.com', BEA)]))
    const out = await sendNewsletter(ISSUE, d)
    expect(out).toMatchObject({ mode: 'send', sent: 2 })
    const [toAna, toBea] = (d.sendBatch as ReturnType<typeof okBatch>).mock.calls[0][0]
    expect(toAna.subject).toBe('Ana, tu receta de esta semana')
    expect(toAna.text).toContain('Hola, Ana:')
    expect(toAna.text).toContain('Esta semana te mando Lentejas estofadas. La he elegido para los cuatro, peques incluidos:')
    expect(toAna.text).toContain('no lleva nada de lo que me dijisteis que no os gusta')
    expect(toAna.text).toContain('«Pollo al curry»')
    expect(toBea.text).not.toEqual(toAna.text)
    expect(toBea.html).not.toContain('{nombre}')
    expect(toBea.html).not.toContain('{porque}')
  })

  it('sin nombre, un saludo neutro: «Hola:», nunca «estimado usuario»', async () => {
    const d = deps(memoryRepo([account('bea@example.com', BEA)]))
    await sendNewsletter(ISSUE, d)
    const [toBea] = (d.sendBatch as ReturnType<typeof okBatch>).mock.calls[0][0]
    expect(toBea.subject).toBe('Tu receta de esta semana')
    expect(toBea.text).toContain('Hola:')
    expect(toBea.text).toContain('Un abrazo.')
    expect(toBea.text).not.toMatch(/estimad|usuari/i)
    expect(fillLetter('{nombre}, esta semana va por ti.', { name: null, recipe: '', reason: '' })).toBe('Esta semana va por ti.')
  })

  it('ningún dato de salud en la frase: ni lo cocinado que lo delata', async () => {
    const d = deps(memoryRepo([account('bea@example.com', BEA)]))
    await sendNewsletter(ISSUE, d)
    const [toBea] = (d.sendBatch as ReturnType<typeof okBatch>).mock.calls[0][0]
    expect(toBea.text).toContain('La he elegido para ti.')
    expect(toBea.text).not.toMatch(HEALTH)
    // La frase solo sabe de personas, gustos (sin nombrarlos), temporada y lo cocinado.
    for (const dish of ['Bizcocho sin gluten', 'Crema vegana', 'Tarta para diabéticos', 'Pan sin lactosa', 'Cena keto'])
      expect(safeDishName(dish)).toBeNull()
    const line = reasonLine({ firstName: 'Ana', people: 2, kids: 0, hasDislikes: true, lastCooked: 'Lasaña sin gluten' }, ['autumn'], NOW)
    expect(line).toBe('La he elegido para los dos: es muy de otoño y no lleva nada de lo que me dijisteis que no os gusta.')
    expect(line).not.toMatch(HEALTH)
  })

  it('la lista de espera, con lo que se sepa: su nombre y que improvisa', async () => {
    const d = deps(memoryRepo([waitlisted('carla@example.com', ' carla '), waitlisted('dani@example.com', 'x_99')]))
    await sendNewsletter(ISSUE, d)
    const [toCarla, toDani] = (d.sendBatch as ReturnType<typeof okBatch>).mock.calls[0][0]
    expect(toCarla.text).toContain('Hola, Carla:')
    expect(toCarla.text).toContain('La he elegido para los dos: para que esta semana no toque improvisar la cena.')
    expect(toDani.text).toContain('Hola:')
  })

  it('los nombres: solo los que parecen un nombre', () => {
    expect(cleanFirstName('maría josé')).toBe('María josé')
    expect(cleanFirstName('<b>')).toBeNull()
    expect(nameFromUsername('miguel')).toBe('Miguel')
    expect(nameFromUsername('mmartin84')).toBeNull()
    expect(nameFromUsername('ana_g')).toBeNull()
  })

  it('una plantilla sin huecos sale tal cual', () => {
    const plain = newsletterSendSchema.parse({ ...ISSUE, subject: 'El menú', content: { ...ISSUE.content, preface: 'Hola a todos', intro: 'Texto', signoff: 'Un abrazo' } })
    expect(withPersonalLetter(plain, { name: 'Ana', reason: 'x' }).content.intro).toBe('Texto')
  })

  it('la prueba lleva el caso del admin: su nombre y su casa', async () => {
    const d = deps(memoryRepo([]))
    await sendNewsletter({ ...ISSUE, testTo: 'miguel@example.com' }, d)
    const msg = (d.sendOne as any).mock.calls[0][0] as EmailMessage
    expect(msg.subject).toBe('[Prueba] Miguel, tu receta de esta semana')
    expect(msg.text).toContain('La he elegido para los tres, peques incluidos.')
  })
})

// ─── El editor ───────────────────────────────────────────────────

const servers: Server[] = []
afterEach(() => {
  for (const s of servers.splice(0)) s.close()
})

async function serve(app: express.Express): Promise<string> {
  const server = await new Promise<Server>((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s))
  })
  servers.push(server)
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

function editor(opts: { now?: () => Date; proofStatus?: EmailResult['status'] } = {}) {
  const drafts = memoryDraftsRepo()
  const audit = vi.fn(async () => 'a1')
  const repo = memoryRepo([account('ana@example.com', ANA), account('bea@example.com', BEA), waitlisted('carla@example.com', 'Carla'), account('eva@example.com', ADMIN)])
  const sendOne = vi.fn(async (): Promise<EmailResult> => ({ status: opts.proofStatus ?? 'sent', id: 're_p' }))
  const sendBatch = okBatch()
  const asAdmin: RequestHandler = (req, _res, next) => {
    ;(req as any).userId = ADMIN
    next()
  }
  let clock = opts.now ?? (() => NOW)
  const app = express()
    .use(express.json())
    .use(
      createNewsletterRouter({
        repo,
        drafts,
        adminAuth: [asAdmin],
        audit: audit as any,
        adminEmail: async (id) => (id === ADMIN ? 'Miguel@Example.com' : null),
        makeDeps: (urls) => ({ ...deps(repo, { sendOne, sendBatch, now: () => clock() }), ...urls }),
        publicUrl: () => 'https://mimoia.com',
        now: () => clock(),
      }),
    )
  return { app, drafts, audit, sendOne, sendBatch, setNow: (d: Date) => (clock = () => d) }
}

const json = (method: string, body?: unknown) => ({ method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) })

describe('el editor de Admin (PRO-1123)', () => {
  it('guardar la plantilla, la vista previa con personas de verdad y la prueba al admin', async () => {
    const e = editor()
    const b = await serve(e.app)
    const base = `${b}/admin/newsletter/drafts/2026-11-06`

    // La recomendación de Marketing, y Miguel la corrige y la guarda.
    expect((await fetch(`${base}/recommendation`, json('PUT', TEMPLATE))).status).toBe(200)
    expect((await fetch(`${base}/preview`, json('POST'))).status).toBe(409)
    const saved = await fetch(`${base}/template`, json('PUT', { ...TEMPLATE, preheader: 'Corregido por Miguel' }))
    expect(await saved.json()).toMatchObject({ draft: { issueId: '2026-11-06', ready: false, notReady: 'sin_prueba', template: { preheader: 'Corregido por Miguel' } } })
    expect(e.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'newsletter.template_save' }))

    const read = await (await fetch(base)).json()
    expect(read.draft.recommendation.preheader).toBe('La he elegido para tu casa')

    // Vista previa: 3 personas (2 cuentas y la de la lista), cada una su carta, sin sus enlaces de baja.
    const { previews } = await (await fetch(`${base}/preview`, json('POST'))).json()
    expect(previews).toHaveLength(3)
    expect(previews.map((p: any) => p.source)).toEqual(['user', 'user', 'waitlist'])
    expect(previews[0].subject).toBe('Ana, tu receta de esta semana')
    expect(previews[1].subject).toBe('Tu receta de esta semana')
    expect(previews[2].html).toContain('Hola, Carla:')
    expect(previews[0].to).not.toBe('ana@example.com')
    for (const p of previews) {
      expect(p.html).toContain('prueba-no-da-de-baja-a-nadie')
      expect(p.html).not.toContain(TOKEN_W)
    }
    expect(e.sendBatch).not.toHaveBeenCalled()

    // La prueba va al correo de su cuenta de admin, con su caso.
    const proof = await (await fetch(`${base}/proof`, json('POST'))).json()
    expect(proof).toMatchObject({ status: 'sent', draft: { ready: true, notReady: null } })
    const msg = e.sendOne.mock.calls[0][0] as unknown as EmailMessage
    expect(msg.to).toBe('miguel@example.com')
    expect(msg.subject).toBe('[Prueba] Miguel, tu receta de esta semana')

    // Guardar otra vez borra la prueba.
    await fetch(`${base}/template`, json('PUT', TEMPLATE))
    expect(e.drafts.rows.get('2026-11-06')!.proofSentAt).toBeNull()
  })

  it('una prueba que no salió (sin Resend) no cuenta como vista', async () => {
    const e = editor({ proofStatus: 'skipped' })
    const b = await serve(e.app)
    const base = `${b}/admin/newsletter/drafts/2026-11-06`
    await fetch(`${base}/template`, json('PUT', TEMPLATE))
    expect(await (await fetch(`${base}/proof`, json('POST'))).json()).toMatchObject({ status: 'skipped', draft: { ready: false } })
    expect((await fetch(`${base}/schedule`, json('POST'))).status).toBe(409)
  })

  it('«Programar»: el viernes a las 9:00, solo con la prueba de la plantilla de esa semana', async () => {
    const e = editor()
    const b = await serve(e.app)
    const base = `${b}/admin/newsletter/drafts/2026-11-06`
    const sinPlantilla = await fetch(`${base}/schedule`, json('POST'))
    expect(sinPlantilla.status).toBe(409)
    expect(await sinPlantilla.json()).toMatchObject({ reason: 'sin_plantilla' })
    await fetch(`${base}/template`, json('PUT', TEMPLATE))
    expect(await (await fetch(`${base}/schedule`, json('POST'))).json()).toMatchObject({ reason: 'sin_prueba' })
    await fetch(`${base}/proof`, json('POST'))
    const ok = await (await fetch(`${base}/schedule`, json('POST'))).json()
    expect(ok.draft.scheduledFor).toBe('2026-11-06T08:00:00.000Z')
    expect(e.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'newsletter.schedule' }))
    // Desprogramar.
    expect((await (await fetch(`${base}/schedule`, json('DELETE'))).json()).draft.scheduledFor).toBeNull()
  })

  it('un envío a mano solo sale con la plantilla guardada y probada, y una vez', async () => {
    const e = editor()
    const b = await serve(e.app)
    const send = (body: unknown) => fetch(`${b}/admin/newsletter/send`, json('POST', body))
    expect(await (await send(ISSUE)).json()).toMatchObject({ code: 'NEWSLETTER_NOT_READY', reason: 'sin_plantilla' })
    await fetch(`${b}/admin/newsletter/drafts/2026-11-06/template`, json('PUT', TEMPLATE))
    await fetch(`${b}/admin/newsletter/drafts/2026-11-06/proof`, json('POST'))
    expect(await (await send({ ...ISSUE, subject: 'Otro texto' })).json()).toMatchObject({ reason: 'otro_texto' })
    // El recuento y la prueba siguen libres.
    expect(await (await send({ ...ISSUE, dryRun: true })).json()).toMatchObject({ mode: 'dry_run' })
    expect(await (await send(ISSUE)).json()).toMatchObject({ mode: 'send', sent: 4 })
    expect(await (await send(ISSUE)).json()).toMatchObject({ reason: 'ya_enviada' })
    expect(e.drafts.rows.get('2026-11-06')!.sendResult).toMatchObject({ sent: 4 })
  })
})

describe('el envío programado (PRO-1123)', () => {
  it('nextFridayNine: el viernes que toca a las 9:00 de Madrid', () => {
    expect(nextFridayNine(NOW).toISOString()).toBe('2026-11-06T08:00:00.000Z')
    expect(nextFridayNine(new Date('2026-11-06T07:30:00Z')).toISOString()).toBe('2026-11-06T08:00:00.000Z')
    expect(nextFridayNine(new Date('2026-11-06T09:00:00Z')).toISOString()).toBe('2026-11-13T08:00:00.000Z')
  })

  it('sale una vez a su hora; sin la prueba de la plantilla, no sale y se desprograma', async () => {
    const drafts = memoryDraftsRepo()
    const savedAt = new Date('2026-11-04T10:00:00Z')
    const at = new Date('2026-11-06T08:00:00Z')
    drafts.rows.set('n4', { ...(await drafts.saveTemplate('n4', TEMPLATE, ADMIN, savedAt))!, proofSentAt: new Date('2026-11-04T10:05:00Z'), scheduledFor: at, scheduledBy: ADMIN, apiUrl: 'https://api.mimoia.com' })
    drafts.rows.set('n5', { ...(await drafts.saveTemplate('n5', TEMPLATE, ADMIN, savedAt))!, scheduledFor: at })
    const send = vi.fn(async () => ({ mode: 'send' as const, issueId: 'n4', sent: 3, failed: 0, skipped: 0, alreadySent: 0 }))
    const audit = vi.fn(async () => 'a1')
    const run = (now: Date) =>
      runScheduledNewsletterIfDue(now, { drafts, send: send as any, makeDeps: (u) => deps(memoryRepo([]), u), audit: audit as any, publicUrl: 'https://mimoia.com' })

    expect(await run(new Date('2026-11-06T07:55:00Z'))).toEqual([])
    expect(await run(new Date('2026-11-06T08:01:00Z'))).toEqual([
      { issueId: 'n4', sent: 3 },
      { issueId: 'n5', skipped: 'sin_prueba' },
    ])
    expect(send).toHaveBeenCalledTimes(1)
    expect((send.mock.calls[0] as any[])[0]).toMatchObject({ issueId: 'n4', subject: TEMPLATE.subject })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({ adminId: ADMIN, action: 'newsletter.send' }))
    expect(drafts.rows.get('n5')!.scheduledFor).toBeNull()
    expect(await run(new Date('2026-11-06T08:06:00Z'))).toEqual([])
  })

  it('una plantilla de hace más de una semana no se programa', () => {
    const d = { issueId: 'x', template: TEMPLATE as any, savedAt: new Date('2026-10-28T08:00:00Z'), proofSentAt: new Date('2026-10-28T09:00:00Z') } as any
    expect(draftReadiness(d, new Date('2026-11-06T08:00:00Z'))).toEqual({ ok: false, reason: 'plantilla_antigua' })
  })
})

describe('previewNewsletter', () => {
  it('no reclama a nadie ni envía nada', async () => {
    const repo = memoryRepo([account('ana@example.com', ANA)])
    const claim = vi.spyOn(repo, 'claim')
    const d = deps(repo)
    const out = await previewNewsletter(ISSUE, d)
    expect(out).toHaveLength(1)
    expect(claim).not.toHaveBeenCalled()
    expect(d.sendBatch).not.toHaveBeenCalled()
  })
})
