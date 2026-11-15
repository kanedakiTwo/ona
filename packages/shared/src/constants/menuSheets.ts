/**
 * Las hojas «···» del menú y sus opciones (PRO-1174, propuesta
 * `2026-11-11-producto-hojas-del-menu.md` §1): el evento de uso
 * `menu_sheet_action` lleva una hoja (`sheet`) y una opción (`action`) de
 * esta lista cerrada. La web la usa para mandar el evento y la API para
 * validarlo: una opción que no es de su hoja no se guarda.
 *
 * - `comida`: la hoja de una comida con un plato (`MealOptions`).
 * - `comida_varios`: la de una comida con varios platos o con una nota.
 * - `plato`: la hoja del «···» de cada plato de esa lista (PRO-1176).
 * - `vacio`: la de una comida sin plato («Añadir plato» en la tarjeta).
 * - `no_hay`: «El viernes no hay cena» → «Sin plato todavía».
 *   PRO-1177: `vacio` y `no_hay` son la misma hoja, «Sin plato todavía»
 *   (`NoDishSheets`); `vacio` tiene además «Quitar <comida> de este día».
 * - `dia`: el pie del día («Añadir comida», «Este día no cocino» —antes
 *   «Saltar día»—, «Volver a cocinar este día» —antes «Reactivar día»—,
 *   «Levantar veto»).
 * - `semana`: la hoja «···» de la semana (`WeekActionsSheet`).
 * - `semana_fila`: el menú «···» de cada fila de la vista semana.
 *
 * Añadir una opción = añadirla aquí, en su hoja (y en specs/feature-usage.md).
 */

/**
 * Las opciones de la hoja de una comida: las comparten `comida` y `comida_varios`.
 * PRO-1175: «Cambiar plato» sigue contando como `elegir_receta` y «Que elija
 * Mimoia» (dentro del buscador) como `cambiar_azar`, para no partir la serie.
 * `mas_opciones` y `ya_hecho` abren sus subhojas.
 */
const MEAL_SHEET_ACTIONS = [
  'ver_receta',
  'elegir_receta',
  'cambiar_azar',
  'mas_opciones',
  'ya_hecho',
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
  // PRO-1186: «Guardar en mi semana tipo» (opens its sheet; the save itself is a `template_changed`).
  'semana_tipo',
] as const

/**
 * PRO-1177 · «Sin plato todavía», la hoja del hueco vacío y de «no hay»:
 * «Elegir receta» (`elegir_receta`; «Que elija Mimoia», dentro, es
 * `cambiar_azar`), «Escribir un plato», «Ya lo tengo hecho» (abre el buscador;
 * la receta elegida cuenta como `congelador` o `taper_nevera`, según el chip),
 * «Quitar <comida> de este día» (solo el hueco vacío) y el enlace a la semana tipo.
 */
const NO_DISH_SHEET_ACTIONS = [
  'elegir_receta',
  'cambiar_azar',
  'escribir_plato',
  'ya_hecho',
  'congelador',
  'taper_nevera',
  'quitar_comida',
  'semana_tipo',
] as const

export const MENU_SHEET_ACTIONS = {
  comida: MEAL_SHEET_ACTIONS,
  comida_varios: [...MEAL_SHEET_ACTIONS, 'ordenar_platos'],
<<<<<<< a873db7b500b6f6c1c8e4d97020bd6ef2b7d6dba
  plato: ['ver_receta', 'cambiar_azar', 'quitar_plato', 'editar_nota'],
  vacio: NO_DISH_SHEET_ACTIONS,
  no_hay: NO_DISH_SHEET_ACTIONS,
  // PRO-1177: «Añadir comida» → la comida → «Sin plato todavía» (`no_hay`); ya no lleva sus tápers sueltos.
  dia: ['anadir_comida', 'saltar_dia', 'reactivar_dia', 'levantar_veto'],
=======
  // PRO-1176: el «···» de cada plato. «Cambiar este plato» cuenta como `elegir_receta` y su «Que elija Mimoia», como `cambiar_azar`.
  plato: ['ver_receta', 'elegir_receta', 'cambiar_azar', 'sobras_si', 'sobras_no', 'vetar', 'quitar_plato', 'editar_nota'],
  vacio: MEAL_SHEET_ACTIONS,
  no_hay: ['elegir_receta', 'cambiar_azar', 'congelador', 'taper_nevera'],
  dia: ['anadir_comida', 'congelador', 'taper_nevera', 'saltar_dia', 'reactivar_dia', 'levantar_veto'],
>>>>>>> 3d5ed34ed276f08600e9f8199b614326b7d08f4c
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
