/**
 * PRO-1175 · La hoja «···» de una comida: qué opciones salen en el primer
 * nivel, cuáles en «Más opciones» y cuáles en «Ya está hecho / táper…»
 * (propuesta de Producto `2026-11-11-producto-hojas-del-menu.md`, §2 y §3,
 * con las respuestas de Miguel del 2026-11-11, D-182).
 *
 * Puro, sin React ni alias `@/`: lo prueba la suite de la API
 * (`apps/api/src/tests/mealSheetOptions.test.ts`) por ruta relativa.
 *
 * - Primer nivel: Ver receta, Cambiar plato, Añadir plato, Marcar como
 *   cocinada (solo hoy y días pasados), «No la pongas más esta semana»
 *   (vetar), Más opciones y, aparte, Quitar comida.
 * - Más opciones: Comensales, «Ya está hecho / táper…», «Que no cambie si
 *   rehago la semana» y, cuando la conecte la fase 5 de la semana tipo
 *   (PRO-1186), «Guardar en mi semana tipo».
 * - Ya está hecho / táper: «Lo tengo hecho (nevera, congelador…)» o su
 *   contrario, y «Sobras de la cena de ayer» o «Quitar táper».
 *
 * Ya no salen «Cambiar al azar» (pasa a «Que elija Mimoia», dentro del
 * buscador) ni «Tipo de comida» (los chips de tipo del buscador). Fijar ya no
 * deja gris nada: solo dice qué se queda al rehacer la semana.
 */
import { isTaperDish, type MealSlot, type RecipeDish } from "@ona/shared"

/** Cuándo cae la comida respecto a hoy. */
export type MealWhen = "past" | "today" | "future"

export type MealSheetFirst =
  | "ver_receta"
  | "cambiar_plato"
  | "anadir_plato"
  | "cocinada"
  | "desmarcar_cocinada"
  | "vetar"
  | "mas_opciones"
  | "quitar_comida"

export type MealSheetMore = "comensales" | "ya_hecho" | "fijar" | "semana_tipo"

export type MealSheetDone = "sobras_si" | "sobras_no" | "taper_si" | "taper_no"

export interface MealSheetInput {
  slot: MealSlot
  when: MealWhen
  /** Hay una cena el día antes con receta: esta comida puede ser su táper (PRO-223). */
  canTaper: boolean
  /** Otros días comen sobras de esta comida: es la tanda, no un táper. */
  feedsLeftovers?: boolean
  /** «Guardar en mi semana tipo» está conectado (fase 5, PRO-1186). */
  canSaveToWeekType?: boolean
}

export interface MealSheetOptions {
  first: MealSheetFirst[]
  more: MealSheetMore[]
  done: MealSheetDone[]
}

export function mealSheetOptions({ slot, when, canTaper, feedsLeftovers = false, canSaveToWeekType = false }: MealSheetInput): MealSheetOptions {
  const dishes = slot.dishes ?? []
  const first = dishes.find((d): d is RecipeDish => d.kind === "recipe") ?? null
  const isSingleRecipe = dishes.length === 1 && dishes[0].kind === "recipe"
  const isLeftover = first?.variant === "leftover"
  const taperDish = isTaperDish(first)
  // Un plato dado (sobras de otro día, táper de nevera o congelador, sobras planificadas) no se cambia ni se veta.
  const canReshape = isSingleRecipe && !isLeftover && !taperDish
  // «Lo tengo hecho»: cualquier plato ya cocinado, salvo la tanda de unas sobras planificadas.
  const canMarkCooked = isSingleRecipe && !isLeftover && (taperDish || !feedsLeftovers)

  const done: MealSheetDone[] = []
  if (canMarkCooked) done.push(taperDish ? "sobras_no" : "sobras_si")
  if (slot.taper) done.push("taper_no")
  else if (canTaper) done.push("taper_si")

  const top: MealSheetFirst[] = []
  if (first) top.push("ver_receta")
  if (canReshape) top.push("cambiar_plato")
  top.push("anadir_plato")
  if (first) {
    if (slot.eaten) top.push("desmarcar_cocinada")
    else if (when !== "future") top.push("cocinada")
  }
  if (canReshape) top.push("vetar")
  top.push("mas_opciones", "quitar_comida")

  const more: MealSheetMore[] = ["comensales"]
  if (done.length > 0) more.push("ya_hecho")
  // En un hueco vacío no hay nada que guardar al rehacer la semana.
  if (dishes.length > 0) more.push("fijar")
  if (canSaveToWeekType) more.push("semana_tipo")

  return { first: top, more, done }
}

/** Cuándo cae el día `day` (0 = lunes) de una semana: `weeksFromNow` < 0 pasada, 0 esta, > 0 futura. */
export function mealWhen(weeksFromNow: number, day: number, todayIndex: number): MealWhen {
  if (weeksFromNow < 0) return "past"
  if (weeksFromNow > 0) return "future"
  if (todayIndex < 0) return "future"
  return day < todayIndex ? "past" : day === todayIndex ? "today" : "future"
}

/** 409 de «Que elija Mimoia» cuando ninguna receta del tipo elegido encaja (`PUT …/meal/:meal { dishType }`). */
export const NO_RECIPE_OF_TYPE = "NO_RECIPE_OF_TYPE"

/** Cuerpo de `PUT /menu/:menuId/day/:day/meal/:meal`: una receta elegida, o «Que elija Mimoia» con el tipo del chip si lo hay. */
export function regenerateMealBody(p: { recipeId?: string; dishType?: string | null; from?: "receta" }): Record<string, string> | undefined {
  if (p.recipeId) return { recipeId: p.recipeId, ...(p.from ? { from: p.from } : {}) }
  if (p.dishType) return { dishType: p.dishType }
  return undefined
}
