/**
 * PRO-1199: «Tu semana con Mimoia» en la newsletter (specs/newsletter.md →
 * «Tus números con Mimoia»).
 *
 *   - Reglas: una casa con 2 recetas cocinadas y el menú hecho → esas dos
 *     líneas; sin nada → sin bloque (nunca «0 recetas»); la semana vacía →
 *     el mes.
 *   - Carta: el bloque va en la carta de cada cuenta con números; la lista de
 *     espera nunca lo lleva; el hueco `{numeros}` lo pone en una frase y
 *     entonces el bloque no se repite; un fallo leyendo las cifras solo lo
 *     quita.
 *   - Vista previa con 3 personas de verdad: cada una con lo suyo.
 *   - Nada de salud ni de otras casas.
 */
import { describe, expect, it, vi } from 'vitest'
import {
  EMPTY_USAGE_NUMBERS,
  menuDishesInRange,
  numbersBlock,
  numbersSentence,
  numbersWindows,
  usageNumbers,
  type HouseholdNumbers,
} from '../services/newsletterNumbers.js'
import { fillLetter, waitlistLetterFacts, type NewsletterLetterRepo } from '../services/newsletterLetter.js'
import {
  newsletterSendSchema,
  newsletterTokenForUser,
  newsletterTokenForWaitlist,
  previewNewsletter,
  sendNewsletter,
  type NewsletterCandidate,
  type NewsletterDeps,
  type NewsletterRepo,
} from '../services/newsletter.js'
import type { EmailMessage, EmailResult } from '../services/email.js'

const ANA = '22222222-2222-4222-8222-22222222222a'
const BEA = '22222222-2222-4222-8222-22222222222b'
const ADMIN = '22222222-2222-4222-8222-2222222222ad'
const TOKEN_W = 'wwwwwwwwwwwwwwwwwwwwwwwwwwwwwwww'
/** Viernes 13 de noviembre de 2026, 9:00 en Madrid. */
const NOW = new Date('2026-11-13T08:00:00Z')

const EMPTY: HouseholdNumbers = { week: EMPTY_USAGE_NUMBERS, month: EMPTY_USAGE_NUMBERS }
const COOKED_AND_MENU: HouseholdNumbers = {
  week: { ...EMPTY_USAGE_NUMBERS, menuWeeks: 1, cooked: 2 },
  month: { ...EMPTY_USAGE_NUMBERS, menuWeeks: 3, cooked: 9 },
}

describe('las reglas (PRO-1199)', () => {
  it('una casa con 2 recetas cocinadas y el menú hecho → esas dos líneas', () => {
    expect(numbersBlock(COOKED_AND_MENU)).toEqual({
      period: 'semana',
      title: 'Tu semana con Mimoia',
      lines: ['El menú de la semana hecho', '2 recetas cocinadas'],
    })
  })

  it('una casa sin nada → sin bloque', () => {
    expect(numbersBlock(EMPTY)).toBeNull()
    expect(numbersBlock(undefined)).toBeNull()
    expect(numbersSentence(numbersBlock(EMPTY))).toBe('')
  })

  it('solo las cifras que no son cero, en singular o plural', () => {
    const b = numbersBlock({
      week: { menuWeeks: 1, dishes: 14, cooked: 1, newRecipes: 1, listSent: true },
      month: EMPTY_USAGE_NUMBERS,
    })
    expect(b?.lines).toEqual(['El menú de la semana hecho (14 platos)', '1 receta cocinada', '1 receta nueva probada', 'La lista de la compra mandada'])
    expect(numbersBlock({ week: { ...EMPTY_USAGE_NUMBERS, newRecipes: 2, cooked: 3 }, month: EMPTY_USAGE_NUMBERS })?.lines).toEqual([
      '3 recetas cocinadas',
      '2 recetas nuevas probadas',
    ])
    for (const l of b!.lines) expect(l).not.toMatch(/\b0\b/)
  })

  it('la semana vacía → el mes', () => {
    const b = numbersBlock({ week: EMPTY_USAGE_NUMBERS, month: { ...EMPTY_USAGE_NUMBERS, menuWeeks: 2, dishes: 20, listSent: true } })
    expect(b).toEqual({ period: 'mes', title: 'Tu mes con Mimoia', lines: ['2 semanas con el menú hecho (20 platos)', 'La lista de la compra mandada'] })
  })

  it('en una frase para el hueco {numeros}', () => {
    expect(numbersSentence(numbersBlock(COOKED_AND_MENU))).toBe('Tu semana con Mimoia: el menú de la semana hecho y 2 recetas cocinadas.')
  })

  it('cuenta los platos de los días del periodo, sin sobras, tápers ni días sin cocinar', () => {
    const dish = (variant?: string) => ({ kind: 'recipe', recipeId: 'r', ...(variant ? { variant } : {}) })
    const days = [
      { lunch: { dishes: [dish(), dish()] }, dinner: { dishes: [dish('leftover')] } }, // lunes 9
      { lunch: { dishes: [dish()], taper: 1 } }, // martes 10
      { lunch: { dishes: [dish()] } }, // miércoles 11, «sin cocinar»
      { dinner: { dishes: [dish(), { kind: 'note', text: 'Pizza' }] } }, // jueves 12
      {},
      {},
      { lunch: { dishes: [dish()] } }, // domingo 15: fuera
    ]
    expect(menuDishesInRange({ weekStart: '2026-11-09', days, skippedDays: [2] }, '2026-11-07', '2026-11-13')).toBe(3)
  })

  it('cocinadas: la misma receta el mismo día cuenta una vez; nuevas, las que la casa no había cocinado', () => {
    const { today, weekFrom } = numbersWindows(NOW)
    expect([weekFrom, today]).toEqual(['2026-11-07', '2026-11-13'])
    const n = usageNumbers({
      menus: [],
      cooked: [
        { recipeId: 'a', day: '2026-11-10' },
        { recipeId: 'a', day: '2026-11-10' },
        { recipeId: 'b', day: '2026-11-12' },
        { recipeId: 'c', day: '2026-11-01' }, // antes del periodo
      ],
      cookedBefore: new Set(['a']),
      listSent: false,
      from: weekFrom,
      to: today,
    })
    expect(n).toEqual({ menuWeeks: 0, dishes: 0, cooked: 2, newRecipes: 1, listSent: false })
  })

  it('el hueco vacío se va sin dejar un párrafo en blanco', () => {
    expect(fillLetter('Hola.\n\n{numeros}\n\nUn abrazo.', { name: null, recipe: '', reason: '', numbers: '' })).toBe('Hola.\n\nUn abrazo.')
    expect(fillLetter('Mira: {numeros}', { name: null, recipe: '', reason: '', numbers: 'Tu semana con Mimoia: 2 recetas cocinadas.' })).toBe(
      'Mira: Tu semana con Mimoia: 2 recetas cocinadas.',
    )
  })
})

// ─── En la carta ─────────────────────────────────────────────────

const TEMPLATE = {
  subject: '{nombre}, tu receta de esta semana',
  content: {
    preface: 'Hola, {nombre}:',
    intro: 'Esta semana te mando {receta}.',
    star: {
      title: 'Lentejas estofadas',
      body: 'De cuchara.',
      imageUrl: 'https://mimoia.com/images/recipes/lentejas.jpg',
      imageAlt: 'Un plato de lentejas',
      url: 'https://mimoia.com/recipes/lentejas',
    },
    cta: { label: 'Abrir Mimoia', url: 'https://mimoia.com/menu' },
  },
}
const ISSUE = newsletterSendSchema.parse({ issueId: '2026-11-13', ...TEMPLATE })

const NUMBERS: Record<string, HouseholdNumbers> = {
  [ANA]: COOKED_AND_MENU,
  [BEA]: EMPTY,
  [ADMIN]: { week: { ...EMPTY_USAGE_NUMBERS, listSent: true }, month: EMPTY_USAGE_NUMBERS },
}

function letters(numbers: NewsletterLetterRepo['numbers'] = async (ids) => new Map(ids.flatMap((id) => (NUMBERS[id] ? [[id, NUMBERS[id]] as const] : [])))): NewsletterLetterRepo {
  return {
    async accountFacts() {
      return new Map()
    },
    async recipeSeasons() {
      return new Map()
    },
    numbers,
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
const waitlisted = (email: string): NewsletterCandidate => ({
  source: 'waitlist',
  email,
  status: 'waiting',
  newsletterOptIn: true,
  token: newsletterTokenForWaitlist(TOKEN_W),
  leaveToken: TOKEN_W,
  letter: waitlistLetterFacts({ firstName: 'Carla', householdSize: '2' }),
})

function memoryRepo(candidates: NewsletterCandidate[]): NewsletterRepo {
  return {
    async candidates() {
      return candidates.map((c) => ({ ...c }))
    },
    async claimedHashes() {
      return new Set()
    },
    async claim(_i, rs) {
      return new Set(rs.map((r) => r.hash))
    },
    async markSent() {},
    async release() {},
    async isAdminEmail(e) {
      return e === 'miguel@example.com'
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

function deps(repo: NewsletterRepo, extra: Partial<NewsletterDeps> = {}): NewsletterDeps {
  return {
    repo,
    sendBatch: vi.fn(async (m: EmailMessage[]): Promise<EmailResult[]> => m.map((_, i) => ({ status: 'sent', id: `re_${i}` }))),
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

const sentTo = (d: NewsletterDeps, to: string) => (d.sendBatch as ReturnType<typeof vi.fn>).mock.calls[0][0].find((m: EmailMessage) => m.to === to) as EmailMessage

const HEALTH = /alerg|gluten|lactosa|celiac|diab|vegan|vegetarian|dieta|intoleran|salud|kcal|calor/i

describe('«Tu semana con Mimoia» en la carta (PRO-1199)', () => {
  it('la cuenta con números lleva el bloque; la que no tiene nada, no; la lista de espera, nunca', async () => {
    const d = deps(memoryRepo([account('ana@example.com', ANA), account('bea@example.com', BEA), waitlisted('carla@example.com')]))
    await sendNewsletter(ISSUE, d)
    const ana = sentTo(d, 'ana@example.com')
    expect(ana.html).toContain('Tu semana con Mimoia')
    expect(ana.html).toContain('El menú de la semana hecho')
    expect(ana.html).toContain('2 recetas cocinadas')
    expect(ana.text).toContain('TU SEMANA CON MIMOIA\n· El menú de la semana hecho\n· 2 recetas cocinadas')
    for (const m of [sentTo(d, 'bea@example.com'), sentTo(d, 'carla@example.com')]) {
      expect(m.html).not.toMatch(/Tu (semana|mes) con Mimoia/)
      expect(m.text).not.toMatch(/TU (SEMANA|MES) CON MIMOIA/)
      expect(m.html).not.toMatch(/\b0 recetas/)
    }
    expect(ana.html).not.toMatch(HEALTH)
  })

  it('la lista de espera no pide cifras', async () => {
    const numbers = vi.fn(async () => new Map<string, HouseholdNumbers>())
    const d = deps(memoryRepo([waitlisted('carla@example.com')]), { letters: letters(numbers) })
    await sendNewsletter(ISSUE, d)
    expect(numbers).not.toHaveBeenCalled()
  })

  it('el hueco {numeros} lo pone en la carta y el bloque no se repite', async () => {
    const issue = newsletterSendSchema.parse({
      issueId: '2026-11-13',
      ...TEMPLATE,
      content: { ...TEMPLATE.content, intro: 'Esta semana te mando {receta}.\n\n{numeros}' },
    })
    const d = deps(memoryRepo([account('ana@example.com', ANA), account('bea@example.com', BEA)]))
    await sendNewsletter(issue, d)
    const ana = sentTo(d, 'ana@example.com')
    expect(ana.html).toContain('Tu semana con Mimoia: el menú de la semana hecho y 2 recetas cocinadas.')
    expect(ana.html.match(/Tu semana con Mimoia/g)).toHaveLength(1)
    const bea = sentTo(d, 'bea@example.com')
    expect(bea.html).not.toContain('{numeros}')
    expect(bea.html).not.toContain('Tu semana con Mimoia')
  })

  it('un fallo leyendo las cifras solo quita el bloque', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const d = deps(memoryRepo([account('ana@example.com', ANA)]), {
      letters: letters(async () => {
        throw new Error('db down')
      }),
    })
    const out = await sendNewsletter(ISSUE, d)
    expect(out).toMatchObject({ mode: 'send', sent: 1 })
    expect(sentTo(d, 'ana@example.com').html).not.toContain('Tu semana con Mimoia')
    warn.mockRestore()
  })

  it('la prueba lleva los números del admin', async () => {
    const d = deps(memoryRepo([]))
    await sendNewsletter({ ...ISSUE, testTo: 'miguel@example.com' }, d)
    const msg = (d.sendOne as ReturnType<typeof vi.fn>).mock.calls[0][0] as EmailMessage
    expect(msg.html).toContain('Tu semana con Mimoia')
    expect(msg.html).toContain('La lista de la compra mandada')
  })

  it('vista previa con 3 personas de verdad: cada una con lo suyo', async () => {
    const d = deps(memoryRepo([account('ana@example.com', ANA), account('bea@example.com', BEA), waitlisted('carla@example.com')]))
    const out = await previewNewsletter(ISSUE, d)
    expect(out.map((p) => p.source)).toEqual(['user', 'user', 'waitlist'])
    expect(out[0].html).toContain('2 recetas cocinadas')
    expect(out[1].html).not.toContain('Tu semana con Mimoia')
    expect(out[2].html).not.toContain('Tu semana con Mimoia')
  })
})
