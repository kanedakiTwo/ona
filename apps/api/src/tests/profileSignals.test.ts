/**
 * PRO-151 (specs/household-profile.md): the daily signals of a household,
 * the text the nightly refiner (PRO-152) reads. A synthetic day with a chat,
 * two menu changes, three «Afina tu menú» verdicts and shopping comes out in
 * time order and without health from WhatsApp (LEG-03); the size cap keeps
 * the most recent lines.
 */
import { describe, expect, it } from 'vitest'
import {
  cookSignal,
  feedbackSignal,
  formatDaySignals,
  menuEditSignal,
  messageSignal,
  onboardingSignal,
  recipeNoteSignal,
  recipeSignal,
  shoppingSignals,
  verdictSignal,
  type DaySignal,
  type SignalMember,
} from '../services/profile/signals.js'
import { mentionsHealth, stripHealthFromWhatsAppText } from '../services/profile/healthText.js'

const DAY = '2026-10-16'
/** Madrid is UTC+2 in October. */
const at = (hhmm: string) => new Date(`${DAY}T${hhmm}:00+02:00`)
const members: SignalMember[] = [
  { label: 'P1', userId: 'u1', role: 'owner' },
  { label: 'P2', userId: 'u2', role: 'member' },
]

function syntheticDay(): DaySignal[] {
  const s: (DaySignal | null)[] = [
    messageSignal({ at: at('08:10'), who: 'P1', channel: 'whatsapp', role: 'user', body: 'Soy celíaca, por cierto. Esta semana estamos sin horno, se ha roto.' }),
    messageSignal({
      at: at('08:11'), who: null, channel: 'whatsapp', role: 'assistant',
      body: 'Como eres celíaca, te quito el pan. Vale, nada de horno hasta que me digas.',
    }),
    messageSignal({
      at: at('08:10'), who: 'P1', channel: 'whatsapp', role: 'user', body: '',
      toolTrace: [{ name: 'update_memory', summary: 'Por WhatsApp no guardo datos de salud. Guardado: sin horno.' }],
    }),
    menuEditSignal({ at: at('09:00'), who: 'P1', action: 'swap', day: 3, meal: 'dinner', fromDay: null, fromMeal: null, beforeRecipeName: 'Ceviche de corvina', afterRecipeName: 'Tortilla de patatas', actor: 'user', channel: 'web' }),
    menuEditSignal({ at: at('09:05'), who: 'P1', action: 'remove', day: 4, meal: 'lunch', fromDay: null, fromMeal: null, beforeRecipeName: 'Lasaña al horno', afterRecipeName: null, actor: 'mimo', channel: 'whatsapp' }),
    verdictSignal({ at: at('12:00'), who: 'P2', recipeName: 'Lentejas estofadas', verdict: 'love' }),
    verdictSignal({ at: at('12:01'), who: 'P2', recipeName: 'Sushi', verdict: 'nope', reason: 'pescado crudo' }),
    verdictSignal({ at: at('12:02'), who: 'P2', recipeName: 'Pollo al curry', verdict: 'like' }),
    ...shoppingSignals([
      { at: at('18:00'), who: 'P2', kind: 'shopping_check', item: 'leche', on: true },
      { at: at('18:01'), who: 'P2', kind: 'shopping_check', item: 'pan', on: true },
      { at: at('18:05'), who: 'P2', kind: 'shopping_add', item: 'galletas', on: null },
      { at: at('18:06'), who: 'P2', kind: 'shopping_remove', item: 'cilantro', on: null },
      { at: at('18:07'), who: 'P2', kind: 'shopping_stock', item: 'arroz', on: true },
    ]),
    messageSignal({
      at: at('21:00'), who: 'P2', channel: 'web', role: 'user', body: '¿Qué cenamos mañana? Algo rápido.',
    }),
    messageSignal({
      at: at('21:00'), who: 'P2', channel: 'web', role: 'assistant', body: 'Te propongo tortilla.',
      toolTrace: [{ name: 'get_menu', summary: 'Menú de la semana' }],
    }),
  ]
  return s.filter((x): x is DaySignal => !!x)
}

describe('formatDaySignals: a synthetic household day', () => {
  const { text, omitted } = formatDaySignals(DAY, members, syntheticDay())

  it('collects every source, in time order', () => {
    expect(omitted).toBe(0)
    const order = [
      'Esta semana estamos sin horno',
      'Cambia cena del jueves: «Ceviche de corvina» → «Tortilla de patatas»',
      'Quita de comida del viernes: «Lasaña al horno» (lo hace Mimo, por WhatsApp)',
      '«Lentejas estofadas»: Me encanta',
      '«Sushi»: No (motivo: «pescado crudo»)',
      '«Pollo al curry»: Me gusta',
      'marca como comprado: «leche», «pan» (2)',
      'añade a la lista: «galletas»',
      'quita de la lista: «cilantro»',
      'tiene en casa: «arroz»',
      '¿Qué cenamos mañana?',
      'Mimo hizo → get_menu: Menú de la semana',
    ]
    const positions = order.map((s) => text.indexOf(s))
    expect(positions.every((p) => p >= 0), `missing: ${order.filter((_, i) => positions[i] < 0).join(' | ')}`).toBe(true)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })

  it('says who did what (P1/P2, never names), the time and the channel', () => {
    expect(text).toMatch(/^Señales del hogar del 2026-10-16 \(hora de Madrid\)\. Personas con cuenta: P1 \(adulto, titular\), P2 \(adulto\)/)
    expect(text).toMatch(/\n09:00 · P1 · Menú · Cambia/)
    expect(text).toMatch(/\n12:01 · P2 · Afina tu menú · «Sushi»/)
    expect(text).toMatch(/\n18:01 · P2 · Compra · marca como comprado/)
    expect(text).toMatch(/\n21:00 · P2 · Chat web · Escribe: «¿Qué cenamos mañana\? Algo rápido\.»/)
    expect(text).toMatch(/\n08:10 · P1 · WhatsApp · Escribe: «\[omitido\] Esta semana estamos sin horno, se ha roto\.»/)
  })

  it('carries no health from WhatsApp: the person, Mimo and its tools', () => {
    expect(text).not.toMatch(/celiac|celíac/i)
    expect(text).not.toMatch(/salud/i)
    expect(text).toContain('nada de horno hasta que me digas')
    expect(text).toContain('Guardado: sin horno')
  })
})

describe('formatDaySignals: size cap', () => {
  const many: DaySignal[] = Array.from({ length: 300 }, (_, i) => ({
    at: new Date(at('07:00').getTime() + i * 60_000),
    source: 'chat',
    who: 'P1',
    text: `Escribe: «mensaje número ${i} ${'bla '.repeat(20)}»`,
  }))
  const signup = onboardingSignal({
    at: at('06:30'), who: 'P1',
    answers: { adults: 2, kidsCount: 1, cookingFreq: 'daily', favoriteDishes: ['lentejas'], priority: 'quick', cookingNote: 'Teletrabajo y como en casa' },
  })

  it('keeps the most recent lines within the cap and says how many were left out', () => {
    const { text, omitted } = formatDaySignals(DAY, members, [...many, signup], { maxChars: 4000 })
    expect(text.length).toBeLessThanOrEqual(4000)
    expect(omitted).toBeGreaterThan(200)
    expect(text).toContain('mensaje número 299 ')
    expect(text).not.toContain('mensaje número 0 ')
    expect(text).toContain(`(${omitted} señales anteriores omitidas por espacio)`)
    // Newest kept are contiguous: the first kept is right after the omitted ones.
    expect(text).toContain(`mensaje número ${omitted} `)
    expect(text).not.toContain(`mensaje número ${omitted - 1} `)
  })

  it('always keeps the sign-up answers, with the free text', () => {
    const { text } = formatDaySignals(DAY, members, [...many, signup], { maxChars: 4000 })
    expect(text).toMatch(/· Alta · Respuestas del alta: Hogar: 2 adulto\(s\) y 1 niño\(s\)/)
    expect(text).toContain('«Teletrabajo y como en casa»')
    expect(text.indexOf('Respuestas del alta')).toBeLessThan(text.indexOf('omitidas por espacio'))
  })

  it('a quiet day says so', () => {
    expect(formatDaySignals(DAY, [], []).text).toMatch(/Personas con cuenta: ninguna con cuenta.*\nSin actividad\.$/s)
  })

  it('bounds each message', () => {
    const s = messageSignal({ at: at('10:00'), who: 'P1', channel: 'web', role: 'user', body: 'x'.repeat(5000) })!
    expect(s.text.length).toBeLessThan(700)
  })
})

describe('the other sources in words', () => {
  it('cooking, «¿Qué tal?», recipes and feedback', () => {
    expect(cookSignal({ at: at('14:00'), who: 'P1', recipeName: 'Lentejas', dayIndex: 0, meal: 'lunch', durationMin: 40, notes: 'le faltó sal' }).text)
      .toBe('Cocina «Lentejas» para comida del lunes en 40 min. Nota: «le faltó sal»')
    expect(recipeNoteSignal({ at: at('14:30'), who: 'P1', recipeName: 'Lentejas', rating: 5, notes: null, substitutions: null })!.text)
      .toBe('«Lentejas»: valoración 5 («Repetir a menudo»)')
    expect(recipeSignal({ at: at('15:00'), who: 'P1', name: 'Bizcocho', sourceType: 'youtube', copied: false }).text).toBe('Importa la receta «Bizcocho» de YouTube')
    expect(feedbackSignal({ at: at('16:00'), who: 'P1', channel: 'whatsapp', text: 'Tengo diabetes. Me encanta la app.' })!.text)
      .toBe('Sobre Mimoia (WhatsApp): «[omitido] Me encanta la app.»')
    // Web feedback is kept as written.
    expect(feedbackSignal({ at: at('16:00'), who: 'P1', channel: 'app', text: 'Tengo diabetes.' })!.text).toContain('diabetes')
  })

  it('the sign-up answers never carry restrictions or body data', () => {
    const s = onboardingSignal({ at: at('10:00'), who: 'P1', answers: { adults: 1, kidsCount: 0, cookingFreq: 'rarely', favoriteDishes: [], priority: 'cheap' } })
    expect(s.text).toBe('Respuestas del alta: Hogar: 1 adulto(s). Cuánto cocina: Poco (prefiere recetas rápidas). Qué quiere que priorice: Ahorro.')
  })
})

describe('stripHealthFromWhatsAppText (LEG-03)', () => {
  it.each([
    'Soy alérgico al marisco',
    'Mi hija es celíaca',
    'Tengo intolerancia a la lactosa',
    'Mi marido es diabético',
    'Estoy embarazada de 5 meses',
    'Peso 82 kilos y quiero adelgazar',
    'Comemos halal',
    'El médico me ha quitado la sal',
    'Tomo medicación para la tensión alta',
  ])('removes «%s»', (s) => {
    expect(mentionsHealth(s)).toBe(true)
    expect(stripHealthFromWhatsAppText(s)).toEqual({ text: '[omitido]', removed: 1 })
  })

  it.each([
    'No nos gusta el pescado crudo',
    'Somos vegetarianos',
    'Compra 1 kg de patatas',
    'Sin horno esta semana',
    'Pon tortilla el jueves',
  ])('keeps «%s»', (s) => {
    expect(stripHealthFromWhatsAppText(s)).toEqual({ text: s, removed: 0 })
  })

  it('keeps the rest of the message and collapses consecutive omissions', () => {
    expect(stripHealthFromWhatsAppText('Hola. Soy celíaca. Y alérgica a las nueces. ¿Qué cenamos?').text).toBe('Hola. [omitido] ¿Qué cenamos?')
    expect(stripHealthFromWhatsAppText('Pon lentejas\nsin gluten por favor\ny pan').text).toBe('Pon lentejas\n[omitido]\ny pan')
  })
})
