/**
 * «Semana tipo», fase 5 (PRO-1186): desde el menú.
 *
 * - «Guardar en mi semana tipo» (en «Más opciones» de la hoja de una comida)
 *   escribe ese día y esa comida de la semana tipo del hogar: una sola
 *   opción, todas las semanas, con sus comensales y platos.
 * - Y lo aplica a la semana que se ve, salvo que la comida esté fijada
 *   (también lo elegido a mano, PRO-1175), comida o sea un táper: si ya es
 *   eso, solo gana el chip; si no, se sortea una receta del tipo o se pone
 *   esa receta o ese plato escrito.
 * - El chip «<tipo> · semana tipo» y el aviso cuando ningún plato del tipo
 *   encaja, que salen del generador y de «Que elija Mimoia».
 */
import { describe, expect, it } from 'vitest'
import { weekTypeChipOf, type Dish, type MealSlot, type WeekTypeSlot } from '@ona/shared'
import { fromWeekTypeOf, weekTypeMealChange, weekTypeSlotSaving } from '../services/weekType.js'
import { patchDish } from '../services/menuDishes.js'
import { everyWeekday, weekTypeChoices, weekTypeSavedLine } from '../../../web/src/lib/mealSheet'

const LENTEJAS: Dish = { kind: 'recipe', recipeId: 'lentejas', recipeName: 'Lentejas guisadas', course: null }
const slotOf = (dishes: Dish[], over: Partial<MealSlot> = {}): MealSlot => ({ dishes, ...over }) as MealSlot
const LEGUMBRES = { kind: 'type', type: 'legumbres' } as const
const CREMAS = { kind: 'type', type: 'cremas-sopas' } as const
const free = { locked: false, dishTypes: ['legumbres', 'guisos'] }

describe('guardar en la semana tipo', () => {
  it('ese hueco pasa a tener esa opción todas las semanas; comensales y platos se quedan', () => {
    const prev: WeekTypeSlot = { options: [{ kind: 'type', type: 'pizza' }, { kind: 'any' }], together: true, diners: 3, dishes: 2, since: '2026-10-05' }
    expect(weekTypeSlotSaving(prev, LEGUMBRES, '2026-11-09')).toEqual({ options: [LEGUMBRES], diners: 3, dishes: 2, since: '2026-11-09' })
  })

  it('una comida que era «no hay» en la semana tipo vuelve a planificarse', () => {
    expect(weekTypeSlotSaving({ off: true }, LEGUMBRES, '2026-11-09')).toEqual({ options: [LEGUMBRES], since: '2026-11-09' })
  })
})

describe('y aplicarlo a la semana que se ve', () => {
  it('si la comida ya es de ese tipo, no cambia: solo gana el chip', () => {
    const c = weekTypeMealChange(slotOf([LENTEJAS]), LEGUMBRES, free)
    expect(c).toEqual({ kind: 'mark', dishes: [{ ...LENTEJAS, fromWeekType: { type: 'legumbres' } }] })
    // También fijada o comida: no se toca el plato, solo se marca.
    expect(weekTypeMealChange(slotOf([LENTEJAS], { eaten: true }), LEGUMBRES, { ...free, locked: true }).kind).toBe('mark')
  })

  it('«Siempre esta receta» con esa misma receta, o el plato escrito que ya está: solo el chip', () => {
    expect(weekTypeMealChange(slotOf([LENTEJAS]), { kind: 'recipe', recipeId: 'lentejas', name: 'Lentejas guisadas' }, free)).toEqual({
      kind: 'mark',
      dishes: [{ ...LENTEJAS, fixedDish: true }],
    })
    const note: Dish = { kind: 'note', text: 'Tortilla de patatas' }
    expect(weekTypeMealChange(slotOf([note]), { kind: 'fixed', label: 'tortilla de patatas', items: [] }, free)).toEqual({
      kind: 'mark',
      dishes: [{ ...note, fixedDish: true }],
    })
  })

  it('otro tipo en una comida libre: se sortea una receta de ese tipo en el plato principal', () => {
    expect(weekTypeMealChange(slotOf([{ kind: 'note', text: '+ pan' }, LENTEJAS]), CREMAS, free)).toEqual({ kind: 'draw', type: 'cremas-sopas', at: 1 })
    // Un hueco vacío: se añade.
    expect(weekTypeMealChange(slotOf([]), CREMAS, { locked: false })).toEqual({ kind: 'draw', type: 'cremas-sopas', at: 0 })
  })

  it('una comida que es solo una nota (la «Pizza» escrita, un «Fijo: …»): la receta ocupa su sitio, no se añade al lado', () => {
    const pizza: Dish = { kind: 'note', text: 'Pizza', fixedDish: true, fromWeekType: { type: 'pizza', missing: true } }
    expect(weekTypeMealChange(slotOf([pizza]), LEGUMBRES, { locked: false })).toEqual({ kind: 'draw', type: 'legumbres', at: 0 })
  })

  it('una nota larga se guarda cortada a 60 y sigue siendo la misma: solo el chip, no se sustituye', () => {
    const text = 'Tortilla de patatas con cebolla caramelizada y pimientos asados al horno'
    const c = weekTypeMealChange(slotOf([{ kind: 'note', text }]), { kind: 'fixed', label: text.slice(0, 60), items: [] }, free)
    expect(c).toEqual({ kind: 'mark', dishes: [{ kind: 'note', text, fixedDish: true }] })
  })

  it('otro tipo en una comida fijada (o elegida a mano): esta semana se queda como está', () => {
    expect(weekTypeMealChange(slotOf([LENTEJAS]), CREMAS, { ...free, locked: true })).toEqual({ kind: 'kept' })
  })

  it('otro tipo en una comida ya comida: se queda como está', () => {
    expect(weekTypeMealChange(slotOf([LENTEJAS], { eaten: true }), CREMAS, free)).toEqual({ kind: 'kept' })
  })

  it('un táper o unas sobras no se tocan', () => {
    for (const variant of ['fridge', 'freezer', 'cooked', 'leftover'] as const) {
      expect(weekTypeMealChange(slotOf([{ ...LENTEJAS, variant }]), CREMAS, free), variant).toEqual({ kind: 'kept' })
    }
  })

  it('una receta concreta en una comida libre la pone en el plato principal; fijada, no', () => {
    const option = { kind: 'recipe', recipeId: 'crema', name: 'Crema de calabaza' } as const
    const recipe = { id: 'crema', name: 'Crema de calabaza', course: 'starter' as const }
    expect(weekTypeMealChange(slotOf([LENTEJAS]), option, { ...free, recipe })).toEqual({
      kind: 'put',
      dishes: [{ kind: 'recipe', recipeId: 'crema', recipeName: 'Crema de calabaza', course: 'starter', fixedDish: true }],
    })
    expect(weekTypeMealChange(slotOf([LENTEJAS]), option, { ...free, locked: true, recipe })).toEqual({ kind: 'kept' })
  })

  it('algo fijo con lo que lleva es toda la comida, como en el generador', () => {
    const c = weekTypeMealChange(slotOf([LENTEJAS]), { kind: 'fixed', label: 'Yogur con cereales', items: [{ name: 'yogur', quantity: 1, unit: 'u' }] }, free)
    expect(c.kind).toBe('put')
    expect(c.kind === 'put' && c.dishes).toEqual([{ kind: 'note', text: expect.stringContaining('Yogur con cereales'), fixed: { items: [{ name: 'yogur', quantity: 1, unit: 'u' }] } }])
  })
})

describe('el chip «<tipo> · semana tipo» y el aviso', () => {
  it('un plato sorteado para un tipo lleva ese tipo; si no era de ese tipo, el aviso', () => {
    expect(fromWeekTypeOf('legumbres', { dishTypes: ['legumbres'] })).toEqual({ fromWeekType: { type: 'legumbres' } })
    expect(fromWeekTypeOf('carne', { dishTypes: ['guisos'] })).toEqual({ fromWeekType: { type: 'carne', missing: true } })
    expect(fromWeekTypeOf(null, { dishTypes: ['guisos'] })).toEqual({})
  })

  it('lo que dice el chip', () => {
    expect(weekTypeChipOf([{ ...LENTEJAS, fromWeekType: { type: 'legumbres' } }])).toEqual({ label: 'Legumbres · semana tipo', missing: false, type: 'legumbres' })
    expect(weekTypeChipOf([{ ...LENTEJAS, fixedDish: true }])).toEqual({ label: 'Semana tipo', missing: false, type: null })
    // Pasado a táper («Lo tengo hecho»): ya no es lo que pidió la semana tipo.
    expect(weekTypeChipOf([{ ...LENTEJAS, variant: 'cooked', fromWeekType: { type: 'legumbres' } }])).toBeNull()
    expect(weekTypeChipOf([{ kind: 'note', text: 'Pizza', fixedDish: true, fromWeekType: { type: 'pizza', missing: true } }])).toEqual({
      label: 'Ninguna receta de «Pizza» encaja: lo dejo escrito',
      missing: true,
      type: 'pizza',
    })
    expect(weekTypeChipOf([{ ...LENTEJAS, fromWeekType: { type: 'carne', missing: true } }])).toEqual({ label: 'Ninguna receta de «Carne» encaja: he puesto otra', missing: true, type: 'carne' })
    // Una comida libre, un «Fijo: …» (ya lo dice su texto) o unas sobras copiadas de otra comida: sin chip.
    expect(weekTypeChipOf([LENTEJAS])).toBeNull()
    expect(weekTypeChipOf([{ kind: 'note', text: 'Fijo: yogur', fixed: { items: [] } }])).toBeNull()
    expect(weekTypeChipOf([{ ...LENTEJAS, fixedDish: true, variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner', dishPosition: 0 } }])).toBeNull()
  })
})

describe('qué ofrece «Guardar en mi semana tipo» (la hoja de la web)', () => {
  it('los tipos de la receta (primero el que pidió la semana tipo) y «Siempre esta receta»', () => {
    const dish: Dish = { ...LENTEJAS, dishTypes: ['guisos', 'legumbres', 'no-es-un-tipo'], fromWeekType: { type: 'legumbres' } }
    expect(weekTypeChoices(slotOf([dish])).map((c) => [c.label, c.option])).toEqual([
      ['Legumbres', { kind: 'type', type: 'legumbres' }],
      ['Guisos', { kind: 'type', type: 'guisos' }],
      ['Siempre esta receta', { kind: 'recipe', recipeId: 'lentejas', name: 'Lentejas guisadas' }],
    ])
  })

  it('la «Pizza» escrita porque no había receta ofrece primero el tipo, para que siga pidiendo una pizza', () => {
    const pizza: Dish = { kind: 'note', text: 'Pizza', fixedDish: true, fromWeekType: { type: 'pizza', missing: true } }
    expect(weekTypeChoices(slotOf([pizza])).map((c) => c.option)).toEqual([{ kind: 'type', type: 'pizza' }, { kind: 'fixed', label: 'Pizza', items: [] }])
  })

  it('un plato escrito se guarda tal cual; un táper o un hueco vacío no ofrecen nada (solo «Otro tipo de plato»)', () => {
    expect(weekTypeChoices(slotOf([{ kind: 'note', text: 'Tortilla de patatas' }])).map((c) => c.option)).toEqual([{ kind: 'fixed', label: 'Tortilla de patatas', items: [] }])
    expect(weekTypeChoices(slotOf([{ ...LENTEJAS, variant: 'freezer' }]))).toEqual([])
    expect(weekTypeChoices(slotOf([]))).toEqual([])
  })

  it('lo que dice al guardarlo, según lo que pasó con esta semana', () => {
    expect(everyWeekday(5)).toBe('los sábados')
    const base = { day: 3, mealLabel: 'Cena', label: 'Legumbres' }
    expect(weekTypeSavedLine({ ...base, applied: 'changed' })).toBe('Guardado en tu semana tipo: los jueves, cena, «Legumbres».')
    expect(weekTypeSavedLine({ ...base, applied: 'kept' })).toBe('Guardado en tu semana tipo: los jueves, cena, «Legumbres». Esta semana se queda como está.')
    expect(weekTypeSavedLine({ ...base, applied: 'missing' })).toMatch(/ninguna receta de ese tipo encaja aquí: se queda como está\.$/)
  })
})

describe('cambiarlo a mano quita el chip', () => {
  it('editar el texto de la «Pizza» escrita la deja como una nota cualquiera', () => {
    const pizza: Dish = { kind: 'note', text: 'Pizza', fixedDish: true, fromWeekType: { type: 'pizza', missing: true } }
    expect(patchDish([pizza], 0, { text: 'Tortilla' })).toEqual([{ kind: 'note', text: 'Tortilla' }])
    expect(patchDish([pizza], 0, { text: 'Pizza' })).toEqual([pizza])
  })
})
