/**
 * PRO-1176 · Comidas con varios platos: cada plato con su fila y su «···»
 * (propuesta de Producto 2026-11-11 §1.2 y §3, E-72).
 *
 * - La hoja de una comida con 2 recetas y 1 nota: el título es la comida y
 *   el subtítulo, «3 platos · 2 comensales»; «Ver receta» ya no va arriba.
 * - Las opciones de cada fila: una receta (ver, cambiar, ya está hecho, no
 *   repetir, quitar), unas sobras, un táper y una nota (sin «Cambiar»).
 * - «Marcar la comida como cocinada» apunta todas sus recetas.
 * - «Cambiar este plato» manda la receta elegida a `…/dish/:position`.
 * - `DishRow` ya no tiene el «Cambiar» al azar.
 *
 * El recorrido en el navegador está en apps/web/e2e/meal-multi-dish.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isMenuSheetAction, type MealSlot } from '@ona/shared'
import {
  dishSheetOptions,
  isMultiDishMeal,
  mealCookRecipeIds,
  mealSheetHeading,
  mealSheetOptions,
  regenerateDishBody,
} from '../../../web/src/lib/mealSheet'

const WEB = join(__dirname, '../../../web/src')
const read = (f: string) => readFileSync(join(WEB, f), 'utf8')

const ensalada = { kind: 'recipe' as const, recipeId: 'r-ensalada', recipeName: 'Ensalada de tomate', course: 'starter' as const }
const merluza = { kind: 'recipe' as const, recipeId: 'r-merluza', recipeName: 'Merluza en salsa', course: 'main' as const }
const pan = { kind: 'note' as const, text: 'Pan' }
const twoAndNote = { servings: null, dishes: [ensalada, merluza, pan] } as MealSlot

describe('PRO-1176 · la hoja de una comida con 2 recetas y 1 nota', () => {
  it('es una comida de varios platos; una sola receta no', () => {
    expect(isMultiDishMeal(twoAndNote)).toBe(true)
    expect(isMultiDishMeal({ dishes: [ensalada, merluza] } as MealSlot)).toBe(true)
    expect(isMultiDishMeal({ dishes: [pan] } as MealSlot)).toBe(true)
    expect(isMultiDishMeal({ dishes: [merluza] } as MealSlot)).toBe(false)
    expect(isMultiDishMeal({ dishes: [] } as MealSlot)).toBe(false)
  })

  it('título: la comida; subtítulo: «N platos · N comensales»', () => {
    expect(mealSheetHeading({ slot: twoAndNote, mealLabel: 'Comida', dayLabel: 'jueves 13', diners: 2 })).toEqual({
      title: 'Comida · jueves 13',
      subtitle: '3 platos · 2 comensales',
    })
    // «Solo hoy: 1» manda sobre los de la casa.
    expect(mealSheetHeading({ slot: { ...twoAndNote, servings: 1 }, mealLabel: 'Cena', dayLabel: 'viernes 14', diners: 4 }).subtitle).toBe(
      '3 platos · 1 comensal',
    )
    expect(mealSheetHeading({ slot: { dishes: [pan] } as MealSlot, mealLabel: 'Cena', dayLabel: 'viernes 14', diners: 3 }).subtitle).toBe(
      '1 plato · 3 comensales',
    )
  })

  it('con un plato, como hasta ahora: la comida encima y la receta de título', () => {
    expect(mealSheetHeading({ slot: { dishes: [merluza] } as MealSlot, mealLabel: 'Comida', dayLabel: 'jueves 13', diners: 2 })).toEqual({
      eyebrow: 'Comida · jueves 13',
      title: 'Merluza en salsa',
    })
    expect(mealSheetHeading({ slot: { dishes: [] } as MealSlot, mealLabel: 'Cena', dayLabel: 'viernes 14', diners: 2 }).title).toBe('Sin plato todavía')
  })

  it('debajo, lo de la comida: añadir plato, marcarla cocinada (hoy y pasados), más opciones y quitar; ni «Ver receta» ni «Cambiar»', () => {
    expect(mealSheetOptions({ slot: twoAndNote, when: 'today', canTaper: false }).first).toEqual([
      'anadir_plato', 'cocinada', 'mas_opciones', 'quitar_comida',
    ])
    expect(mealSheetOptions({ slot: twoAndNote, when: 'future', canTaper: false }).first).toEqual(['anadir_plato', 'mas_opciones', 'quitar_comida'])
    expect(mealSheetOptions({ slot: { ...twoAndNote, eaten: true }, when: 'past', canTaper: false }).first).toContain('desmarcar_cocinada')
    // Más opciones: comensales y que no cambie.
    expect(mealSheetOptions({ slot: twoAndNote, when: 'today', canTaper: false }).more).toEqual(['comensales', 'fijar'])
  })

  it('las opciones de cada fila: las recetas, todas; la nota, editar y quitar (sin «Cambiar»)', () => {
    const rows = twoAndNote.dishes.map((d) => dishSheetOptions(d))
    expect(rows[0]).toEqual(['ver_receta', 'cambiar_plato', 'ya_hecho', 'vetar', 'quitar_plato'])
    expect(rows[1]).toEqual(rows[0])
    expect(rows[2]).toEqual(['editar_nota', 'quitar_plato'])
    expect(rows[2]).not.toContain('cambiar_plato')
  })

  it('unas sobras no se cambian ni se vetan; un táper solo vuelve a la compra; la tanda de unas sobras no es «ya está hecho»', () => {
    expect(dishSheetOptions({ ...merluza, variant: 'leftover', leftoverOf: { day: 0, meal: 'dinner' } } as never)).toEqual(['ver_receta', 'quitar_plato'])
    for (const variant of ['fridge', 'freezer', 'cooked'] as const) {
      expect(dishSheetOptions({ ...merluza, variant }), variant).toEqual(['ver_receta', 'no_hecho', 'quitar_plato'])
    }
    expect(dishSheetOptions(merluza, { feedsLeftovers: true })).toEqual(['ver_receta', 'cambiar_plato', 'vetar', 'quitar_plato'])
  })

  it('«Marcar la comida como cocinada» apunta cada receta una vez; la nota, no', () => {
    expect(mealCookRecipeIds(twoAndNote)).toEqual(['r-ensalada', 'r-merluza'])
    expect(mealCookRecipeIds({ dishes: [merluza, pan, merluza] } as MealSlot)).toEqual(['r-merluza'])
  })

  it('«Cambiar este plato» manda la receta elegida (o el chip de «Que elija Mimoia») a …/dish/:position', () => {
    expect(regenerateDishBody({ recipeId: 'r-crema', expect: 'k' })).toEqual({ expect: 'k', recipeId: 'r-crema' })
    expect(regenerateDishBody({ dishType: 'legumbres' })).toEqual({ dishType: 'legumbres' })
    expect(regenerateDishBody({ recipeId: 'r-crema', dishType: 'legumbres' })).toEqual({ recipeId: 'r-crema' })
    expect(regenerateDishBody({})).toEqual({})
  })
})

describe('PRO-1176 · en el código', () => {
  it('DishRow deja el «Cambiar» al azar y cada fila tiene su «···»', () => {
    const row = read('components/menu/DishRow.tsx')
    expect(row).not.toMatch(/onRegenerate|>\s*Cambiar\s*</)
    expect(row).toMatch(/Opciones de/)
  })

  it('la hoja del plato: sus cinco opciones y la hoja de la comida, las suyas', () => {
    const sheet = read('components/menu/MealOptions.tsx')
    for (const label of ['Cambiar este plato', 'Ya está hecho / táper', 'No lo pongas más esta semana', 'Quitar este plato', 'Editar nota', 'Quitar nota']) {
      expect(sheet, label).toContain(label)
    }
    expect(sheet).toMatch(/como cocinada/)
    expect(sheet).toMatch(/Arrastrar para ordenar/)
  })

  it('las opciones de la hoja del plato se cuentan (`menu_sheet_action`, hoja `plato`)', () => {
    for (const a of ['ver_receta', 'elegir_receta', 'cambiar_azar', 'sobras_si', 'sobras_no', 'vetar', 'quitar_plato', 'editar_nota']) {
      expect(isMenuSheetAction('plato', a), a).toBe(true)
    }
  })

  it('la ruta del plato acepta una receta elegida y el chip de tipo', () => {
    const routes = readFileSync(join(__dirname, '../routes/menus.ts'), 'utf8')
    const route = routes.slice(routes.indexOf("dish/:position/regenerate'"))
    expect(route.slice(0, 6000)).toMatch(/req\.body\?\.recipeId/)
    expect(route.slice(0, 6000)).toMatch(/isDishType\(req\.body\?\.dishType\)/)
  })
})
