/**
 * PRO-1175 · La hoja «···» de una comida: cinco opciones y «Más opciones»
 * (propuesta de Producto 2026-11-11 §2 y §3, respuestas de Miguel, D-182).
 *
 * - Qué sale en el primer nivel según el hueco: hoy, un día pasado, uno
 *   futuro, unas sobras, un táper y una comida que no cambia al rehacer.
 * - «Cambiar al azar» y «Tipo de comida» ya no salen en la hoja.
 * - «Que elija Mimoia» con un chip de tipo manda ese tipo a la API.
 * - El bloqueo implícito: elegir a mano deja la comida fijada, y fijar nunca
 *   impide cambiarla (`withLock`, `swapLocks`).
 *
 * El recorrido en el navegador está en apps/web/e2e/meal-sheet-options.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { displaceTargets, swapLocks, withLock, type MealSlot } from '@ona/shared'
import { poolOfChipType } from '../services/weekType.js'
import { mealSheetOptions, mealWhen, regenerateMealBody } from '../../../web/src/lib/mealSheet'
import { buildQueryString } from '../../../web/src/lib/recipeQuery'
import { lockIn, moveSlotIn, pickRecipeIn, removeDishIn, removeSlotIn } from '../../../web/src/lib/menuOptimistic'

const WEB = join(__dirname, '../../../web/src')
const read = (f: string) => readFileSync(join(WEB, f), 'utf8')

const lentejas = { kind: 'recipe' as const, recipeId: 'r-lentejas', recipeName: 'Lentejas con verduras' }
const one = (over: Partial<MealSlot> = {}, dish: Record<string, unknown> = {}): MealSlot => ({ dishes: [{ ...lentejas, ...dish }], ...over }) as MealSlot

describe('PRO-1175 · primer nivel de la hoja de una comida', () => {
  it('una cena futura: cinco opciones, sin «Marcar como cocinada»', () => {
    const o = mealSheetOptions({ slot: one(), when: 'future', canTaper: false })
    expect(o.first).toEqual(['ver_receta', 'cambiar_plato', 'anadir_plato', 'vetar', 'mas_opciones', 'quitar_comida'])
    expect(o.first.filter((x) => x !== 'quitar_comida')).toHaveLength(5)
  })

  it('hoy y un día pasado: «Marcar como cocinada» también', () => {
    for (const when of ['today', 'past'] as const) {
      expect(mealSheetOptions({ slot: one(), when, canTaper: false }).first).toEqual([
        'ver_receta', 'cambiar_plato', 'anadir_plato', 'cocinada', 'vetar', 'mas_opciones', 'quitar_comida',
      ])
    }
  })

  it('una comida ya comida dice «Desmarcar», sea el día que sea', () => {
    expect(mealSheetOptions({ slot: one({ eaten: true }), when: 'future', canTaper: false }).first).toContain('desmarcar_cocinada')
    expect(mealSheetOptions({ slot: one({ eaten: true }), when: 'today', canTaper: false }).first).not.toContain('cocinada')
  })

  it('unas sobras (de otra comida o el táper de mañana): ni cambiar ni vetar', () => {
    const sobras = one({}, { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } })
    const o = mealSheetOptions({ slot: sobras, when: 'today', canTaper: false })
    expect(o.first).toEqual(['ver_receta', 'anadir_plato', 'cocinada', 'mas_opciones', 'quitar_comida'])
    expect(o.more).not.toContain('ya_hecho')
    // El táper de mañana: «Quitar táper» en «Ya está hecho / táper…».
    const taper = mealSheetOptions({ slot: one({ taper: 1 }, { variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } }), when: 'future', canTaper: true })
    expect(taper.first).not.toContain('cambiar_plato')
    expect(taper.more).toContain('ya_hecho')
    expect(taper.done).toEqual(['taper_no'])
  })

  it('un táper de la nevera o del congelador: ni cambiar ni vetar; «No lo tengo hecho» lo devuelve a la compra', () => {
    for (const variant of ['fridge', 'freezer', 'cooked']) {
      const o = mealSheetOptions({ slot: one({}, { variant }), when: 'future', canTaper: false })
      expect(o.first, variant).toEqual(['ver_receta', 'anadir_plato', 'mas_opciones', 'quitar_comida'])
      expect(o.done, variant).toEqual(['sobras_no'])
    }
  })

  it('una comida que no cambia al rehacer la semana no deja nada gris', () => {
    // `mealSheetOptions` ni recibe el candado; y la hoja no desactiva nada por él.
    expect(read('components/menu/MealOptions.tsx')).not.toMatch(/disabled=\{locked|lockedHint|Desfíjala/)
  })

  it('«Más opciones»: comensales, ya está hecho, que no cambie; «Guardar en mi semana tipo» solo cuando esté conectado', () => {
    const o = mealSheetOptions({ slot: one(), when: 'future', canTaper: true })
    expect(o.more).toEqual(['comensales', 'ya_hecho', 'fijar'])
    expect(o.done).toEqual(['sobras_si', 'taper_si'])
    expect(mealSheetOptions({ slot: one(), when: 'future', canTaper: false, canSaveToWeekType: true }).more).toContain('semana_tipo')
    // La tanda de unas sobras planificadas no puede ser «Lo tengo hecho».
    expect(mealSheetOptions({ slot: one(), when: 'future', canTaper: false, feedsLeftovers: true }).more).toEqual(['comensales', 'fijar'])
  })

  it('un hueco vacío: añadir, más opciones (solo comensales) y quitar', () => {
    const o = mealSheetOptions({ slot: { dishes: [] } as MealSlot, when: 'future', canTaper: false })
    expect(o.first).toEqual(['anadir_plato', 'mas_opciones', 'quitar_comida'])
    expect(o.more).toEqual(['comensales'])
  })

  it('mealWhen: semana pasada, esta (antes, hoy, después) y futura', () => {
    expect(mealWhen(-1, 6, -1)).toBe('past')
    expect(mealWhen(0, 1, 3)).toBe('past')
    expect(mealWhen(0, 3, 3)).toBe('today')
    expect(mealWhen(0, 4, 3)).toBe('future')
    expect(mealWhen(2, 0, -1)).toBe('future')
  })
})

describe('PRO-1175 · lo que sale de la hoja', () => {
  const sheet = read('components/menu/MealOptions.tsx')

  it('«Cambiar al azar» y «Tipo de comida» ya no están en la hoja', () => {
    expect(sheet).not.toMatch(/Cambiar al azar/)
    expect(sheet).not.toMatch(/Tipo de comida/)
    expect(sheet).not.toMatch(/PinTypeSheet|pinnedType/)
    expect(sheet).toMatch(/label="Cambiar plato"/)
    expect(sheet).toMatch(/label="No la pongas más esta semana"/)
    expect(sheet).toMatch(/label="Más opciones"/)
  })

  it('«Que elija Mimoia» vive en el buscador, con los chips de tipo', () => {
    const picker = read('components/menu/RecipePickerSheet.tsx')
    expect(picker).toMatch(/Que elija Mimoia/)
    expect(picker).toMatch(/DISH_TYPES\.map/)
    expect(picker).toMatch(/onPickAuto\(dishType\)/)
    expect(sheet).toMatch(/onPickAuto=\{async \(dishType\) =>/)
    expect(sheet).toMatch(/handlers\.regenerate\(dishType\)/)
  })
})

describe('PRO-1175 · «Que elija Mimoia» con un chip manda el tipo', () => {
  it('con el chip «Cremas y sopas», el PUT lleva dishType', () => {
    expect(regenerateMealBody({ dishType: 'cremas-sopas' })).toEqual({ dishType: 'cremas-sopas' })
  })
  it('sin chip, el PUT va sin cuerpo (Mimoia elige libre); una receta elegida va como siempre', () => {
    expect(regenerateMealBody({})).toBeUndefined()
    expect(regenerateMealBody({ dishType: null })).toBeUndefined()
    expect(regenerateMealBody({ recipeId: 'r1', from: 'receta' })).toEqual({ recipeId: 'r1', from: 'receta' })
    expect(regenerateMealBody({ recipeId: 'r1', dishType: 'pasta' })).toEqual({ recipeId: 'r1' })
  })
  it('el chip filtra la lista del buscador: GET /recipes?fitsMe=1&dishType=…', () => {
    expect(buildQueryString({ perPage: 100, fitsMe: true, dishType: 'legumbres' })).toBe('?perPage=100&fitsMe=1&dishType=legumbres')
  })
  it('Mimoia elige solo recetas de ese tipo, nunca la que ya está; sin ninguna, la ruta da 409', () => {
    const pool = [
      { id: 'lentejas', dishTypes: ['legumbres', 'guisos'] },
      { id: 'falafel', dishTypes: ['legumbres'] },
      { id: 'crema', dishTypes: ['cremas-sopas'] },
      { id: 'sin-tipo', dishTypes: null },
    ]
    expect(poolOfChipType(pool, 'legumbres', 'lentejas').map((r) => r.id)).toEqual(['falafel'])
    expect(poolOfChipType(pool, 'legumbres', null).map((r) => r.id)).toEqual(['lentejas', 'falafel'])
    // Ninguna de ese tipo: vacío (no «cualquier receta», como hace la semana tipo).
    expect(poolOfChipType(pool, 'pizza', null)).toEqual([])
    expect(poolOfChipType(pool, 'cremas-sopas', 'crema')).toEqual([])
  })
  it('la ruta lee el tipo del cuerpo y la lista lo filtra', () => {
    const routes = readFileSync(join(__dirname, '../routes/menus.ts'), 'utf8')
    expect(routes).toMatch(/isDishType\(req\.body\?\.dishType\)/)
    expect(routes).toMatch(/NO_RECIPE_OF_TYPE/)
    const recipes = readFileSync(join(__dirname, '../routes/recipes.ts'), 'utf8')
    expect(recipes).toMatch(/arrayContains\(recipes\.dishTypes, \[dishType\]\)/)
  })
})

describe('PRO-1175 · bloqueo implícito', () => {
  it('withLock pone y quita sin tocar lo demás', () => {
    const l = withLock({ '1': { dinner: true } }, 2, 'lunch', true)
    expect(l).toEqual({ '1': { dinner: true }, '2': { lunch: true } })
    expect(withLock(l, 1, 'dinner', false)).toEqual({ '2': { lunch: true } })
    expect(withLock(null, 0, 'lunch', false)).toEqual({})
  })

  it('swapLocks: al arrastrar, el candado va con la comida', () => {
    expect(swapLocks({ '0': { lunch: true } }, { day: 0, meal: 'lunch' }, { day: 3, meal: 'dinner' })).toEqual({ '3': { dinner: true } })
    expect(swapLocks({ '0': { lunch: true }, '3': { dinner: true } }, { day: 0, meal: 'lunch' }, { day: 3, meal: 'dinner' })).toEqual({
      '0': { lunch: true },
      '3': { dinner: true },
    })
  })

  it('en pantalla: elegir a mano fija; quitar la comida le quita el candado; arrastrar lo lleva', () => {
    const week = { id: 'm1', days: [{ lunch: one() }, { dinner: one() }, {}, {}, {}, {}, {}], locked: {} }
    const picked = lockIn(pickRecipeIn(week, 1, 'dinner', { id: 'r-crema', name: 'Crema de calabaza' }), 1, 'dinner', true)
    expect(picked.locked).toEqual({ '1': { dinner: true } })
    expect(removeSlotIn(picked, 1, 'dinner').locked).toEqual({})
    expect(moveSlotIn(picked, { day: 1, meal: 'dinner' }, { day: 2, meal: 'dinner' }).locked).toEqual({ '2': { dinner: true } })
    // Quitar el último plato también le quita el candado; con platos, se queda.
    expect(removeDishIn(picked, 1, 'dinner', 0).locked).toEqual({})
    const two = lockIn({ ...week, days: [{}, { dinner: { dishes: [lentejas, { kind: 'note', text: 'Pan' }] } }, {}, {}, {}, {}, {}] } as never, 1, 'dinner', true)
    expect(removeDishIn(two, 1, 'dinner', 1).locked).toEqual({ '1': { dinner: true } })
  })

  it('«Cocinar ahora» puede pasar el plato a un día con esa comida fijada; un día sin cocinar, no', () => {
    const days = [{ lunch: { dishes: [lentejas] } }, { lunch: { dishes: [lentejas] } }, {}, {}, {}, {}, {}] as never
    const t = displaceTargets(days, 0, 'lunch', [2])
    expect(t[0]).toMatchObject({ day: 1, disabled: false })
    expect(t[1]).toMatchObject({ day: 2, disabled: true })
  })

  it('las rutas del menú no rechazan una comida fijada (el recorrido real, en mealLockRoute.smoke.ts)', () => {
    const routes = readFileSync(join(__dirname, '../routes/menus.ts'), 'utf8')
    expect(routes).not.toMatch(/Meal slot is locked|Cannot move a locked slot/)
  })
})
