/**
 * PRO-1177 · Hueco vacío y «no hay» abren la misma hoja, «Sin plato todavía»
 * (propuesta de Producto 2026-11-11 §1.3, §1.4 y §3; E-72):
 *
 * - las dos pintan «Elegir receta», «Escribir un plato» y «Ya lo tengo
 *   hecho»; el hueco vacío, además, «Quitar <comida> de este día»; con la
 *   semana tipo, el enlace «¿Todos los viernes? Ponlo en tu semana tipo»;
 * - ninguna tiene «Fijar», «Una al azar», «Del congelador» ni «Táper de la
 *   nevera» sueltos;
 * - las cuatro entradas (tarjeta vacía, «no hay», celdas de «La semana» y
 *   fila vacía de la vista semana) y «Añadir comida» usan esa hoja;
 * - «Este día no cocino» y «Volver a cocinar este día» en lugar de «Saltar
 *   día» y «Reactivar día».
 *
 * El recorrido en el navegador está en apps/web/e2e/menu-no-dish-sheet.spec.ts.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_SHEET_ACTIONS } from '@ona/shared'
import { noDishSheetOptions, regenerateMealBody, weekTypeLinkLine } from '../../../web/src/lib/mealSheet'

const MENU = join(__dirname, '../../../web/src/components/menu')
const read = (f: string) => readFileSync(join(MENU, f), 'utf8')

describe('PRO-1177 · «Sin plato todavía»', () => {
  it('el hueco vacío y «no hay» pintan las mismas opciones; el vacío, además, «Quitar»', () => {
    const vacio = noDishSheetOptions({ where: 'vacio' })
    const noHay = noDishSheetOptions({ where: 'no_hay' })
    expect(noHay).toEqual(['elegir_receta', 'escribir_plato', 'ya_hecho'])
    expect(vacio).toEqual([...noHay, 'quitar_comida'])
  })

  it('con la semana tipo, las dos acaban en el enlace «¿Todos los <día>?»', () => {
    expect(noDishSheetOptions({ where: 'no_hay', hasWeekType: true })).toEqual(['elegir_receta', 'escribir_plato', 'ya_hecho', 'semana_tipo'])
    expect(noDishSheetOptions({ where: 'vacio', hasWeekType: true })).toEqual(['elegir_receta', 'escribir_plato', 'ya_hecho', 'quitar_comida', 'semana_tipo'])
    expect(weekTypeLinkLine(4)).toBe('¿Todos los viernes? Ponlo en tu semana tipo')
    expect(weekTypeLinkLine(0)).toBe('¿Todos los lunes? Ponlo en tu semana tipo')
  })

  it('sin «Fijar» ni «Una al azar» ni los tápers sueltos', () => {
    for (const where of ['vacio', 'no_hay'] as const) {
      const o = noDishSheetOptions({ where, hasWeekType: true }) as string[]
      for (const gone of ['fijar', 'desfijar', 'cambiar_azar', 'congelador', 'taper_nevera', 'anadir_plato', 'mas_opciones']) expect(o).not.toContain(gone)
    }
    const sheet = read('NoDishSheets.tsx')
    expect(sheet).not.toMatch(/label="(Fijar|Una al azar|Del congelador|Táper de la nevera)"/)
    expect(sheet).toMatch(/label="Elegir receta"/)
    expect(sheet).toMatch(/label="Escribir un plato"/)
    expect(sheet).toMatch(/label="Ya lo tengo hecho"/)
    // «Ya lo tengo hecho» es el buscador con los chips «Nevera» / «Congelador».
    expect(sheet).toMatch(/taperChips/)
    expect(read('RecipePickerSheet.tsx')).toMatch(/label: "Nevera"[\s\S]*label: "Congelador"/)
  })

  it('las dos hojas cuentan las mismas opciones', () => {
    expect(MENU_SHEET_ACTIONS.vacio).toEqual(MENU_SHEET_ACTIONS.no_hay)
    expect(MENU_SHEET_ACTIONS.vacio).not.toContain('fijar')
    expect(MENU_SHEET_ACTIONS.dia).not.toContain('congelador')
  })

  it('todas las entradas abren esa hoja', () => {
    // El hueco vacío (tarjeta, «···», celda «Añadir» de «La semana»): MealOptionsSheets → NoDishSheets.
    expect(read('MealOptions.tsx')).toMatch(/dishes\.length === 0\)[\s\S]{0,80}<NoDishSheets[\s\S]{0,80}where="vacio"/)
    expect(read('MenuDesktop.tsx')).not.toMatch(/setOpen\("addDish"\)/)
    // «No hay» (tarjeta, celda de «La semana») y «Añadir comida» del pie del día.
    const day = read('DayMeals.tsx')
    expect(day).toMatch(/<NoDishSheets[\s\S]{0,80}where="no_hay"/)
    expect(day).not.toMatch(/onAddMeal\(m\)/)
    // La fila vacía de la vista semana: la hoja de la vista día (PRO-1178), o la de «no hay».
    expect(read('WeekGridView.tsx')).toMatch(/<MealOptionsSheets/)
    expect(read('WeekGridView.tsx')).toMatch(/<AbsentMealSheets/)
  })

  it('«Este día no cocino» y «Volver a cocinar este día»; sigue pidiendo confirmación', () => {
    const day = read('DayMeals.tsx')
    expect(day).toMatch(/Este día no cocino/)
    expect(day).toMatch(/Volver a cocinar este día/)
    expect(day).not.toMatch(/confirmLabel="Saltar día"|\/> (Saltar|Reactivar) día/)
    expect(day).toMatch(/<ConfirmSheet[\s\S]{0,200}onConfirm=\{onSkip\}/)
  })

  it('«Que elija Mimoia» en una comida sin plato manda el tipo del chip al POST', () => {
    expect(regenerateMealBody({ dishType: 'legumbres' })).toEqual({ dishType: 'legumbres' })
    expect(regenerateMealBody({ dishType: null })).toBeUndefined()
    expect(regenerateMealBody({ recipeId: 'r1', dishType: 'legumbres' })).toEqual({ recipeId: 'r1' })
  })
})
