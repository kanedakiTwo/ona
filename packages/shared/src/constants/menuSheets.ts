/**
 * Las hojas «···» del menú y sus opciones (PRO-1174, propuesta
 * `2026-11-11-producto-hojas-del-menu.md` §1): el evento de uso
 * `menu_sheet_action` lleva una hoja (`sheet`) y una opción (`action`) de
 * esta lista cerrada. La web la usa para mandar el evento y la API para
 * validarlo: una opción que no es de su hoja no se guarda.
 *
 * - `comida`: la hoja de una comida con un plato (`MealOptions`).
 * - `comida_varios`: la de una comida con varios platos o con una nota.
 * - `plato`: cada plato de la lista de esa hoja (cambiar, quitar, nota…).
 * - `vacio`: la de una comida sin plato («Añadir plato» en la tarjeta).
 * - `no_hay`: «El viernes no hay cena» → «Sin plato todavía».
 * - `dia`: el pie del día («Añadir comida», «Saltar día», «Reactivar día»,
 *   «Levantar veto»).
 * - `semana`: la hoja «···» de la semana (`WeekActionsSheet`).
 * - `semana_fila`: el menú «···» de cada fila de la vista semana.
 *
 * Añadir una opción = añadirla aquí, en su hoja (y en specs/feature-usage.md).
 */

/** Las opciones de la hoja de una comida: las comparten `comida`, `comida_varios` y `vacio`. */
const MEAL_SHEET_ACTIONS = [
  'ver_receta',
  'elegir_receta',
  'cambiar_azar',
  'sobras_si',
  'sobras_no',
  'anadir_plato',
  'fijar',
  'desfijar',
  'vetar',
  'cocinada',
  'desmarcar_cocinada',
  'taper_si',
  'taper_no',
  'comensales_menos',
  'comensales_mas',
  'comensales_quitar',
  'quitar_comida',
] as const

export const MENU_SHEET_ACTIONS = {
  comida: MEAL_SHEET_ACTIONS,
  comida_varios: [...MEAL_SHEET_ACTIONS, 'ordenar_platos'],
  plato: ['ver_receta', 'cambiar_azar', 'quitar_plato', 'editar_nota'],
  vacio: MEAL_SHEET_ACTIONS,
  no_hay: ['elegir_receta', 'cambiar_azar', 'congelador', 'taper_nevera'],
  dia: ['anadir_comida', 'congelador', 'taper_nevera', 'saltar_dia', 'reactivar_dia', 'levantar_veto'],
  semana: [
    'semana_anterior',
    'semana_siguiente',
    'volver_semana',
    'regenerar',
    'favoritas',
    'compartir',
    'imprimir',
    'vista_semana',
    'vista_dia',
    'historial',
    'vaciar',
  ],
  semana_fila: ['elegir_receta', 'cambiar_azar', 'anadir_plato', 'fijar', 'desfijar', 'vetar', 'quitar_comida'],
} as const satisfies Record<string, readonly string[]>

export type MenuSheetName = keyof typeof MENU_SHEET_ACTIONS
export type MenuSheetAction = (typeof MENU_SHEET_ACTIONS)[MenuSheetName][number]

export const MENU_SHEETS = Object.keys(MENU_SHEET_ACTIONS) as MenuSheetName[]

/** Puro: si `action` es una opción de la hoja `sheet`. */
export function isMenuSheetAction(sheet: unknown, action: unknown): sheet is MenuSheetName {
  if (typeof sheet !== 'string' || typeof action !== 'string') return false
  if (!Object.prototype.hasOwnProperty.call(MENU_SHEET_ACTIONS, sheet)) return false
  return (MENU_SHEET_ACTIONS[sheet as MenuSheetName] as readonly string[]).includes(action)
}
