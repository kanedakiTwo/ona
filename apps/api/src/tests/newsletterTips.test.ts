/**
 * Receta y truco por persona (PRO-1020, specs/newsletter.md): las reglas del
 * §6.3 de los trucos de Marketing en `pickTip`, la adopción en 14 días,
 * `pickRecipe` y el destino de los huecos «receta» y «truco». Puro; el SQL
 * del repo va en newsletterTips.smoke.ts.
 */
import { describe, expect, it } from 'vitest'
import { FEATURE_IDS } from '@ona/shared'
import {
  NEWSLETTER_TIPS,
  personalSlotDestination,
  pickRecipe,
  pickTip,
  tipAdoptedAt,
  weeksSinceSignup,
  type NewsletterTip,
  type TipPersona,
} from '../services/newsletterTips.js'

const NOW = new Date('2026-11-06T08:00:00.000Z')
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000)
const use = (days: number, last = days) => ({ firstUsedAt: daysAgo(days), lastUsedAt: daysAgo(last) })

/** Alta hace 3 semanas, WhatsApp conectado con avisos, sola en casa, ha generado menú y abierto la lista. */
function persona(extra: Partial<TipPersona> = {}): TipPersona {
  return {
    userId: 'u1',
    householdId: 'h1',
    signedUpAt: daysAgo(20),
    whatsapp: { linked: true, notify: true, declined: false },
    push: false,
    accounts: 1,
    isOwner: true,
    adults: 1,
    familyInviteDeclined: false,
    inviteOfferDeclined: false,
    usage: { menu_semanal: use(19, 1), lista_compra: use(18, 2), mimo_whatsapp: use(15, 1) },
    shown: [],
    ...extra,
  }
}

const id = (p: TipPersona) => pickTip(p, NOW)?.tip.id

describe('the tip catalogue', () => {
  it('only tips in production, with unique ids, and every usage feature exists (PRO-1023)', () => {
    expect(new Set(NEWSLETTER_TIPS.map((t) => t.id)).size).toBe(NEWSLETTER_TIPS.length)
    for (const t of NEWSLETTER_TIPS) {
      expect(t.enProduccion, t.id).toBe(true)
      expect(t.enPausa, t.id).toBeUndefined()
      if (t.feature) expect(FEATURE_IDS, t.id).toContain(t.feature)
      expect(t.feature || t.usedState, `${t.id}: sin forma de saber si lo usa`).toBeTruthy()
      expect(t.path.startsWith('/'), t.id).toBe(true)
    }
  })

  it('no health words and no «aún no has…» (tone, trucos.md §8)', () => {
    for (const t of NEWSLETTER_TIPS) {
      expect(`${t.title} ${t.body}`, t.id).not.toMatch(/sano|saludable|dieta|calor[ií]as|prote[ií]na|m[eé]dico|aún no has|te estás perdiendo|deber[ií]as/i)
    }
  })
})

describe('pickTip (§6.3)', () => {
  it('follows the §5 order by weeks since sign-up: week 3 → the list (33) before anything else', () => {
    expect(weeksSinceSignup(daysAgo(20), NOW)).toBe(3)
    expect(id(persona())).toBe('tachar_lista')
  })

  it('used → out: whoever already ticks the list gets the next one', () => {
    expect(id(persona({ usage: { ...persona().usage, marcar_lista: use(10) } }))).toBe('receta_enlace')
  })

  it('the state counts as used too: WhatsApp connected never gets «Escríbeme por WhatsApp»', () => {
    const fresh = persona({ signedUpAt: daysAgo(2), usage: {} })
    expect(id(fresh)).not.toBe('whatsapp')
    expect(id({ ...fresh, whatsapp: { linked: false, notify: false, declined: false } })).toBe('whatsapp')
  })

  it('a «no» is for good: avisos declined → never the 50; family invite declined → never the 45', () => {
    const noAvisos = persona({ signedUpAt: daysAgo(2), whatsapp: { linked: true, notify: false, declined: false }, usage: {} })
    expect(id(noAvisos)).toBe('avisos_whatsapp')
    expect(id({ ...noAvisos, whatsapp: { linked: true, notify: false, declined: true } })).not.toBe('avisos_whatsapp')

    const couple = persona({ signedUpAt: daysAgo(40), adults: 2, usage: { ...persona().usage, marcar_lista: use(30), receta_enlace: use(30), receta_foto: use(30) } })
    expect(id(couple)).toBe('invitar_casa')
    expect(id({ ...couple, familyInviteDeclined: true })).not.toBe('invitar_casa')
    // Only the owner of a one-account household with 2 adults or more.
    expect(id({ ...couple, isOwner: false })).not.toBe('invitar_casa')
    expect(id({ ...couple, accounts: 2 })).not.toBe('invitar_casa')
  })

  it('rest: shown 4 weeks ago or less → out; after that, back; after 2 shows, 12 weeks; 3 shows at most', () => {
    const p = persona()
    expect(id({ ...p, shown: [{ tip: 'tachar_lista', shownAt: daysAgo(7) }] })).toBe('receta_enlace')
    expect(id({ ...p, shown: [{ tip: 'tachar_lista', shownAt: daysAgo(27) }] })).toBe('receta_enlace')
    expect(id({ ...p, shown: [{ tip: 'tachar_lista', shownAt: daysAgo(28) }] })).toBe('tachar_lista')
    const twice = [
      { tip: 'tachar_lista', shownAt: daysAgo(70) },
      { tip: 'tachar_lista', shownAt: daysAgo(40) },
    ]
    expect(id({ ...p, shown: twice })).toBe('receta_enlace')
    expect(id({ ...p, shown: [{ tip: 'tachar_lista', shownAt: daysAgo(120) }, { tip: 'tachar_lista', shownAt: daysAgo(84) }] })).toBe('tachar_lista')
    const thrice = [200, 150, 100].map((d) => ({ tip: 'tachar_lista', shownAt: daysAgo(d) }))
    expect(id({ ...p, shown: thrice })).toBe('receta_enlace')
  })

  it('then priority A before B, and on a tie the one shown fewer times', () => {
    const late = persona({
      signedUpAt: daysAgo(400),
      usage: { ...persona().usage, marcar_lista: use(300), receta_enlace: use(300), receta_foto: use(300), pedido_tiendas: use(300) },
    })
    // Every §5 tip used: A first (afinar), B after.
    expect(id(late)).toBe('afinar_menu')
    const used = { ...late, usage: { ...late.usage, afinar_menu: use(300, 1) } }
    expect(NEWSLETTER_TIPS.find((t) => t.id === id(used))?.priority).toBe('B')
  })

  it('what is paused or not in production is never shown', () => {
    const catalog: NewsletterTip[] = [
      { id: 'pausado', n: 1, priority: 'A', title: 'P', body: 'P', path: '/menu', usedState: () => false, enProduccion: true, enPausa: 'PRO-298' },
      { id: 'en_rama', n: 2, priority: 'A', title: 'R', body: 'R', path: '/menu', usedState: () => false, enProduccion: false },
      { id: 'bueno', n: 3, priority: 'C', title: 'B', body: 'B', path: '/menu', usedState: () => false, enProduccion: true },
    ]
    expect(pickTip(persona(), NOW, catalog)?.tip.id).toBe('bueno')
  })

  it('one sharing tip a month at most (57–59)', () => {
    const catalog: NewsletterTip[] = [
      { id: 'compartir_a', n: 57, priority: 'A', share: true, title: 'A', body: 'A', path: '/shopping', usedState: () => false, enProduccion: true },
      { id: 'compartir_b', n: 58, priority: 'A', share: true, title: 'B', body: 'B', path: '/recipes', usedState: () => false, enProduccion: true },
      { id: 'otro', n: 60, priority: 'C', title: 'C', body: 'C', path: '/menu', usedState: () => false, enProduccion: true },
    ]
    expect(pickTip(persona(), NOW, catalog)?.tip.id).toBe('compartir_a')
    const after = persona({ shown: [{ tip: 'compartir_a', shownAt: daysAgo(14) }] })
    expect(pickTip(after, NOW, catalog)?.tip.id).toBe('otro')
    expect(pickTip(persona({ shown: [{ tip: 'compartir_a', shownAt: daysAgo(31) }] }), NOW, catalog)?.tip.id).toBe('compartir_b')
  })

  it('none left: an A used but untouched for 60 days («por si se te había olvidado»); else null = the general tip', () => {
    const all = Object.fromEntries(NEWSLETTER_TIPS.filter((t) => t.feature).map((t) => [t.feature!, use(100, 5)]))
    const everything = persona({
      signedUpAt: daysAgo(400),
      whatsapp: { linked: true, notify: true, declined: false },
      push: true,
      usage: { ...persona().usage, ...all },
    })
    expect(pickTip(everything, NOW)).toBeNull()
    const forgot = { ...everything, usage: { ...everything.usage, receta_foto: use(200, 61), afinar_menu: use(200, 90) } }
    expect(pickTip(forgot, NOW)).toEqual({ tip: NEWSLETTER_TIPS.find((t) => t.id === 'afinar_menu'), reason: 'olvidado' })
    // Resting too.
    const rested = { ...forgot, shown: [{ tip: 'afinar_menu', shownAt: daysAgo(7) }] }
    expect(pickTip(rested, NOW)?.tip.id).toBe('receta_foto')
  })
})

describe('tipAdoptedAt', () => {
  it('adopted = first use within 14 days after the send', () => {
    const shown = daysAgo(20)
    expect(tipAdoptedAt('tachar_lista', shown, { marcar_lista: use(10) })).toEqual(daysAgo(10))
    expect(tipAdoptedAt('tachar_lista', shown, { marcar_lista: use(5) })).toBeNull()
    expect(tipAdoptedAt('tachar_lista', shown, { marcar_lista: use(25) })).toBeNull()
    expect(tipAdoptedAt('invitar_casa', shown, {})).toBeNull()
  })
})

describe('pickRecipe', () => {
  const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6']
  const none = { blocked: new Set<string>(), sentBefore: new Set<string>() }

  it('never one the household can not eat, has said no to, or already got', () => {
    expect(pickRecipe(ids, { blocked: new Set(['r1', 'r2', 'r3']), sentBefore: new Set(['r4', 'r5']) }, 's')).toBe('r6')
    expect(pickRecipe(ids, { blocked: new Set(ids), sentBefore: new Set() }, 's')).toBeNull()
    expect(pickRecipe([], none, 's')).toBeNull()
  })

  it('stable for a person and an issue, and spread among people', () => {
    expect(pickRecipe(ids, none, 'n4|u1')).toBe(pickRecipe(ids, none, 'n4|u1'))
    const picks = new Set(Array.from({ length: 12 }, (_, k) => pickRecipe(ids, none, `n4|u${k}`)))
    expect(picks.size).toBeGreaterThan(1)
  })
})

describe('personalSlotDestination', () => {
  it('builds our recipe page or the tip screen; anything else → null', () => {
    const rid = '33333333-3333-4333-8333-333333333333'
    expect(personalSlotDestination('receta', 'https://mimoia.com/', rid)).toBe(`https://mimoia.com/recipes/${rid}`)
    expect(personalSlotDestination('truco', 'https://mimoia.com', 'tachar_lista')).toBe('https://mimoia.com/shopping')
    for (const bad of ['https://malo.example', '../admin', undefined, ['x']]) {
      expect(personalSlotDestination('receta', 'https://mimoia.com', bad)).toBeNull()
      expect(personalSlotDestination('truco', 'https://mimoia.com', bad)).toBeNull()
    }
  })
})
