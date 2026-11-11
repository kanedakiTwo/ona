/**
 * PRO-1174: medir cada opción de las hojas «···» del menú. Por hoja: cada
 * opción de MENU_SHEET_ACTIONS es un `menu_sheet_action` válido con su
 * `sheet` y su `action`, y el componente de esa hoja la manda (la web solo
 * cuenta lo que está en la lista: si una opción desaparece del código, el
 * test lo dice). Una opción fuera de la lista no se guarda. `/admin/usage`
 * desglosa `meal_swapped` por `how` y `target`, y cruza las hojas.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MENU_SHEETS, MENU_SHEET_ACTIONS, type MenuSheetName } from '@ona/shared'
import { CLIENT_USAGE_EVENTS, USAGE_EVENTS, clientEventProps, routeUsageEvent, sanitizeProps } from '../services/usageEvents.js'
import { BREAKDOWN_EVENTS, USAGE_DEFINITIONS, buildMenuSheetActions, buildPropBreakdown } from '../services/usageReport.js'

const MENU_DIR = join(__dirname, '../../../web/src/components/menu')
const read = (f: string) => readFileSync(join(MENU_DIR, f), 'utf8')

/** Dónde vive cada hoja en la web. */
const SHEET_FILES: Record<MenuSheetName, string[]> = {
  comida: ['MealOptions.tsx'],
  comida_varios: ['MealOptions.tsx'],
  plato: ['MealOptions.tsx'],
  vacio: ['MealOptions.tsx'],
  no_hay: ['DayMeals.tsx'],
  dia: ['DayMeals.tsx', 'BannedRecipesPanel.tsx', 'MenuDesktop.tsx', 'WeekGridView.tsx'],
  semana: ['WeekActionsSheet.tsx'],
  semana_fila: ['WeekGridView.tsx'],
}

const req = (method: string, path: string, body: any = {}) => ({ method, path, body, query: {} as any, get: () => undefined })

describe('PRO-1174 · menu_sheet_action', () => {
  it('es un evento de la web, sin hojas ni opciones repetidas', () => {
    expect(USAGE_EVENTS).toContain('menu_sheet_action')
    expect(CLIENT_USAGE_EVENTS).toContain('menu_sheet_action')
    expect(MENU_SHEETS).toEqual(['comida', 'comida_varios', 'plato', 'vacio', 'no_hay', 'dia', 'semana', 'semana_fila'])
    for (const s of MENU_SHEETS) expect(new Set(MENU_SHEET_ACTIONS[s]).size, s).toBe(MENU_SHEET_ACTIONS[s].length)
  })

  for (const sheet of Object.keys(SHEET_FILES) as MenuSheetName[]) {
    it(`hoja «${sheet}»: tocar cada opción deja un menu_sheet_action con su sheet y su action`, () => {
      const src = SHEET_FILES[sheet].map(read).join('\n')
      // La hoja se nombra en su componente (`sheet="…"`, `sheet = … "…"` o `trackSheetAction("…", …)`).
      expect(src, `${sheet} no se nombra en ${SHEET_FILES[sheet].join(', ')}`).toMatch(new RegExp(`["']${sheet}["']`))
      for (const action of MENU_SHEET_ACTIONS[sheet]) {
        expect(clientEventProps('menu_sheet_action', { sheet, action })).toEqual({ name: 'menu_sheet_action', props: { sheet, action } })
        // Y la web la manda: la opción está escrita en el componente de la hoja.
        expect(src, `${sheet}.${action} no se manda`).toMatch(new RegExp(`["']${action}["']`))
        // Pasa también el filtro general de props (slugs cortos).
        expect(sanitizeProps({ sheet, action })).toEqual({ sheet, action })
      }
    })
  }

  it('una opción fuera de la lista (o de otra hoja) no se guarda', () => {
    expect(clientEventProps('menu_sheet_action', { sheet: 'comida', action: 'borrar_todo' })).toBeNull()
    expect(clientEventProps('menu_sheet_action', { sheet: 'semana', action: 'ver_receta' })).toBeNull()
    expect(clientEventProps('menu_sheet_action', { sheet: 'cocina', action: 'ver_receta' })).toBeNull()
    expect(clientEventProps('menu_sheet_action', { sheet: 'comida' })).toBeNull()
    expect(clientEventProps('menu_sheet_action', { sheet: 'comida', action: 'Lentejas con verduras' })).toBeNull()
    expect(clientEventProps('menu_sheet_action', { sheet: 'toString', action: 'ver_receta' })).toBeNull()
    // Solo sheet y action: nada de lo que venga de más.
    expect(clientEventProps('menu_sheet_action', { sheet: 'comida', action: 'vetar', recipe: 'lentejas' })?.props).toEqual({ sheet: 'comida', action: 'vetar' })
  })

  it('/admin/usage desglosa meal_swapped por how (al azar o elegida) y por target', () => {
    expect(BREAKDOWN_EVENTS).toContain('meal_swapped')
    expect(BREAKDOWN_EVENTS).toContain('menu_sheet_action')
    // Lo que dejan las rutas: elegir otra receta, cambiar al azar, cambiar un plato.
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner', { recipeId: 'r1' }))?.props).toEqual({ target: 'meal', how: 'picked' })
    expect(routeUsageEvent(req('PUT', '/menu/m1/day/2/meal/dinner', {}))?.props).toEqual({ target: 'meal', how: 'auto' })
    expect(routeUsageEvent(req('POST', '/menu/m1/day/2/meal/dinner/dish/1/regenerate'))?.props).toEqual({ target: 'dish', how: 'auto' })
    // Y lo que devuelve la consulta del informe (una fila por evento, clave y valor).
    const breakdown = buildPropBreakdown([
      { name: 'meal_swapped', key: 'how', value: 'auto', count: 7 },
      { name: 'meal_swapped', key: 'how', value: 'picked', count: 3 },
      { name: 'meal_swapped', key: 'target', value: 'meal', count: 9 },
      { name: 'meal_swapped', key: 'target', value: 'dish', count: 1 },
    ])
    expect(breakdown.meal_swapped).toEqual({ how: { auto: 7, picked: 3 }, target: { meal: 9, dish: 1 } })
    expect(USAGE_DEFINITIONS.breakdown).toMatch(/meal_swapped \(how/)
  })

  it('/admin/usage cuenta las hojas por sheet y action: todas las hojas, las más tocadas primero', () => {
    const out = buildMenuSheetActions([
      { sheet: 'comida', action: 'ver_receta', count: 5 },
      { sheet: 'comida', action: 'cambiar_azar', count: 8 },
      { sheet: 'semana', action: 'regenerar', count: 2 },
      // Fuera de la lista: no cuenta.
      { sheet: 'comida', action: 'regenerar', count: 4 },
      { sheet: 'otra', action: 'ver_receta', count: 1 },
    ])
    expect(Object.keys(out)).toEqual(MENU_SHEETS)
    expect(out.comida).toEqual({ total: 13, actions: { cambiar_azar: 8, ver_receta: 5 } })
    expect(Object.keys(out.comida.actions)).toEqual(['cambiar_azar', 'ver_receta'])
    expect(out.semana).toEqual({ total: 2, actions: { regenerar: 2 } })
    expect(out.no_hay).toEqual({ total: 0, actions: {} })
    expect(USAGE_DEFINITIONS.menuSheetActions).toMatch(/comida_varios/)
  })
})
