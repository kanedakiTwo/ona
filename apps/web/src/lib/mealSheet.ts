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
import { dishTypeInfo, isTaperDish, type MealSlot, type RecipeDish, type WeekTypeOption } from "@ona/shared"

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

// ─── «Sin plato todavía» (PRO-1177): el hueco vacío y «no hay» ─────────────

/** Dónde se abre: una comida sin plato (`vacio`) o una que el día no tiene (`no_hay`). */
export type NoDishWhere = "vacio" | "no_hay"

export type NoDishOption = "elegir_receta" | "escribir_plato" | "ya_hecho" | "quitar_comida" | "semana_tipo"

/**
 * Puro: lo que pinta la hoja «Sin plato todavía», igual en la vista día, la
 * vista semana y el escritorio (propuesta §1.3, §1.4 y §3): «Elegir receta»
 * (el buscador con chips y «Que elija Mimoia»), «Escribir un plato» y «Ya lo
 * tengo hecho» (nevera o congelador); en el hueco vacío, además, «Quitar
 * <comida> de este día»; con la semana tipo, el enlace «¿Todos los <día>?
 * Ponlo en tu semana tipo». Nunca «Fijar»: en un hueco sin plato no protege nada.
 */
export function noDishSheetOptions({ where, hasWeekType = false }: { where: NoDishWhere; hasWeekType?: boolean }): NoDishOption[] {
  const out: NoDishOption[] = ["elegir_receta", "escribir_plato", "ya_hecho"]
  if (where === "vacio") out.push("quitar_comida")
  if (hasWeekType) out.push("semana_tipo")
  return out
}

/** «¿Todos los viernes? Ponlo en tu semana tipo». */
export function weekTypeLinkLine(day: number): string {
  return `¿Todos ${everyWeekday(day)}? Ponlo en tu semana tipo`
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

// ─── «Guardar en mi semana tipo» (semana tipo, fase 5, PRO-1186) ───────────

/** One thing «Guardar en mi semana tipo» offers: what the meal is (its types, its recipe, its written dish). */
export interface WeekTypeChoice {
  option: WeekTypeOption
  label: string
  hint: string
}

/**
 * Pure: what the meal on screen can be saved as — each dish type of its
 * recipe (the one the week type already asked for first), «Siempre esta
 * receta», or a written dish as it is. A táper or leftover offers none (it
 * isn't what that meal usually is). «Otro tipo de plato» comes after these.
 */
export function weekTypeChoices(slot: MealSlot): WeekTypeChoice[] {
  const dishes = slot.dishes ?? []
  const recipe = dishes.find((d): d is RecipeDish => d.kind === "recipe") ?? null
  if (recipe) {
    if (recipe.variant === "leftover" || isTaperDish(recipe)) return []
    const asked = recipe.fromWeekType && !recipe.fromWeekType.missing ? [recipe.fromWeekType.type] : []
    const types = [...new Set([...asked, ...(recipe.dishTypes ?? [])])].filter((t) => dishTypeInfo(t))
    return [
      ...types.map((t) => ({ option: { kind: "type", type: t } as WeekTypeOption, label: dishTypeInfo(t)!.label, hint: "Cada semana, una receta de este tipo que encaje" })),
      ...(recipe.recipeName
        ? [{ option: { kind: "recipe", recipeId: recipe.recipeId, name: recipe.recipeName } as WeekTypeOption, label: "Siempre esta receta", hint: recipe.recipeName }]
        : []),
    ]
  }
  const note = dishes.find((d) => d.kind === "note" && !d.fixed)
  if (note?.kind === "note" && note.text.trim()) {
    // The week type's type written by its name (no recipe fitted): saving it keeps asking for that type.
    const asked = note.fromWeekType && dishTypeInfo(note.fromWeekType.type)
      ? [{ option: { kind: "type", type: note.fromWeekType.type } as WeekTypeOption, label: dishTypeInfo(note.fromWeekType.type)!.label, hint: "Cada semana, una receta de este tipo que encaje" }]
      : []
    return [...asked, { option: { kind: "fixed", label: note.text.trim().slice(0, 60), items: [] }, label: `Siempre «${note.text.trim()}»`, hint: "Escrito, sin receta" }]
  }
  return []
}

const WEEKDAYS_PLURAL = ["los lunes", "los martes", "los miércoles", "los jueves", "los viernes", "los sábados", "los domingos"]

/** «los jueves», «los sábados». */
export function everyWeekday(day: number): string {
  return WEEKDAYS_PLURAL[day] ?? ""
}

/** What the server did with the meal on screen (`POST …/meal/:meal/week-type`). */
export type WeekTypeApplied = "mark" | "changed" | "kept" | "missing"

/** Pure: the line that says it was saved, and what happened to this week. */
export function weekTypeSavedLine(p: { day: number; mealLabel: string; label: string; applied: WeekTypeApplied }): string {
  const saved = `Guardado en tu semana tipo: ${everyWeekday(p.day)}, ${p.mealLabel.toLowerCase()}, «${p.label}».`
  if (p.applied === "kept") return `${saved} Esta semana se queda como está.`
  if (p.applied === "missing") return `${saved} Esta semana ninguna receta de ese tipo encaja aquí: se queda como está.`
  return saved
}
