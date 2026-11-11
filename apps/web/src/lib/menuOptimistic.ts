/**
 * What each menu change does to the week, computed in the browser so the
 * screen changes at once (2026-11-10, Miguel: «hago cambios sobre el menú y
 * tardan mucho en mostrarse en pantalla, por ejemplo elegir una receta o
 * crear una nota»). `useMenu.ts` applies these to the cached week before the
 * request goes out and puts the week back if the API says no; the server's
 * answer (or the refetch) then replaces it. Each one mirrors its route in
 * `apps/api/src/routes/menus.ts` (and `services/menuDishes.ts`).
 *
 * No React, no `@/` aliases: the API's vitest suite imports this file by a
 * relative path (`apps/api/src/tests/menuOptimistic.test.ts`).
 */
import { moveSlotInWeek, type DayMenu, type Dish, type MealSlot, type RecipeDish } from "@ona/shared"

export interface OptimisticMenu {
  id: string
  days: DayMenu[]
  locked?: Record<string, Record<string, boolean>> | null
  skippedDays?: number[] | null
}

/** Name and photo of a recipe, when the page already has them (the picker's list). */
export interface RecipeLook {
  id: string
  name?: string | null
  imageUrl?: string | null
  course?: "starter" | "main" | "dessert" | null
}

function withDays<M extends OptimisticMenu>(menu: M, edit: (days: DayMenu[]) => void, unskip?: number): M {
  const days = (menu.days ?? []).map((d) => ({ ...(d ?? {}) }))
  edit(days)
  const skippedDays = unskip == null ? menu.skippedDays : (menu.skippedDays ?? []).filter((d) => d !== unskip)
  return { ...menu, days, skippedDays }
}

function recipeDish(r: RecipeLook): RecipeDish {
  return { kind: "recipe", recipeId: r.id, recipeName: r.name ?? undefined, imageUrl: r.imageUrl ?? null, course: r.course ?? null }
}

const isFixedNote = (d: Dish) => d.kind === "note" && Boolean((d as { fixedDish?: boolean }).fixedDish)

/** «Elegir otra receta» (`PUT …/meal/:meal { recipeId }`): every recipe dish becomes it; notes stay. */
export function pickRecipeIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, recipe: RecipeLook): M {
  return withDays(
    menu,
    (days) => {
      const slot = days[day]?.[meal]
      if (!slot) return
      const kept = (slot.dishes ?? []).filter((d) => !isFixedNote(d)).map((d) => (d.kind === "recipe" ? recipeDish(recipe) : d))
      const dishes = kept.some((d) => d.kind === "recipe") ? kept : [...kept, recipeDish(recipe)]
      days[day] = { ...days[day], [meal]: { ...slot, dishes } }
    },
    day,
  )
}

/** `POST …/meal/:meal/dish`: one more dish at the end (the slot is created if the day lacked it). */
export function addDishIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, dish: Dish): M {
  return withDays(
    menu,
    (days) => {
      const slot: MealSlot = days[day]?.[meal] ?? { servings: null, dishes: [] }
      days[day] = { ...(days[day] ?? {}), [meal]: { ...slot, dishes: [...(slot.dishes ?? []), dish] } }
    },
    day,
  )
}

/** `DELETE …/dish/:position`. */
export function removeDishIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, position: number): M {
  return withDays(menu, (days) => {
    const slot = days[day]?.[meal]
    if (!slot || position < 0 || position >= (slot.dishes ?? []).length) return
    days[day] = { ...days[day], [meal]: { ...slot, dishes: slot.dishes.filter((_, i) => i !== position) } }
  })
}

/** `PATCH …/dish/:position`: a reorder (`newPosition`) or the note's text / the táper variant. */
export function patchDishIn<M extends OptimisticMenu>(
  menu: M,
  day: number,
  meal: string,
  position: number,
  patch: { text?: string; newPosition?: number; variant?: "planned" | "freezer" | "cooked" },
): M {
  return withDays(menu, (days) => {
    const slot = days[day]?.[meal]
    const dishes = [...(slot?.dishes ?? [])]
    if (!slot || position < 0 || position >= dishes.length) return
    if (patch.newPosition != null) {
      if (patch.newPosition < 0 || patch.newPosition >= dishes.length) return
      const [moved] = dishes.splice(position, 1)
      dishes.splice(patch.newPosition, 0, moved)
    } else {
      const d = dishes[position]
      if (d.kind === "note" && patch.text !== undefined) dishes[position] = { ...d, text: patch.text }
      if (d.kind === "recipe" && patch.variant !== undefined && d.variant !== "leftover") dishes[position] = { ...d, variant: patch.variant }
    }
    days[day] = { ...days[day], [meal]: { ...slot, dishes } }
  })
}

/** «Quitar <comida>» (`DELETE …/meal/:meal`). */
export function removeSlotIn<M extends OptimisticMenu>(menu: M, day: number, meal: string): M {
  return withDays(menu, (days) => {
    if (!days[day]?.[meal]) return
    const { [meal]: _gone, ...rest } = days[day]
    days[day] = rest
  })
}

/** «Añadir comida» with a chosen recipe (`POST …/meal/:meal { recipeId }`). Without one the matcher picks: not guessed. */
export function addSlotIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, recipe: RecipeLook): M {
  return withDays(
    menu,
    (days) => {
      days[day] = { ...(days[day] ?? {}), [meal]: { servings: null, dishes: [recipeDish(recipe)] } }
    },
    day,
  )
}

/**
 * Drag and drop (`POST /move-slot`): the server's own `moveSlotInWeek`
 * (`@ona/shared`): swap with a slot that has dishes, else move (the source
 * slot goes away), and the leftovers of a moved slot follow it.
 */
export function moveSlotIn<M extends OptimisticMenu>(
  menu: M,
  from: { day: number; meal: string },
  to: { day: number; meal: string },
): M {
  if (!menu.days?.[from.day]?.[from.meal]) return menu
  const days = moveSlotInWeek(menu.days, from, to)
  return { ...menu, days, skippedDays: (menu.skippedDays ?? []).filter((d) => d !== to.day) }
}

/**
 * «Usar "<lo escrito>" como plato» (`PUT …/meal/:meal { note }`): the meal's
 * dishes become that text; «Solo hoy» stays.
 */
export function replaceWithNoteIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, text: string): M {
  return withDays(
    menu,
    (days) => {
      const slot = days[day]?.[meal]
      days[day] = { ...(days[day] ?? {}), [meal]: { servings: slot?.servings ?? null, dishes: [{ kind: "note", text }] } }
    },
    day,
  )
}

/** «Comensales» (`PATCH …/meal/:meal { servings }`) and «Marcar como cocinada» (`{ eaten }`). */
export function patchSlotIn<M extends OptimisticMenu>(
  menu: M,
  day: number,
  meal: string,
  patch: { servings?: number | null; eaten?: boolean },
): M {
  return withDays(menu, (days) => {
    const slot = days[day]?.[meal]
    if (!slot) return
    const next: MealSlot = { ...slot }
    if (patch.servings !== undefined) next.servings = patch.servings
    if (patch.eaten !== undefined) next.eaten = patch.eaten
    days[day] = { ...days[day], [meal]: next }
  })
}

/** «Fijar» / «Desfijar» (`PUT …/lock`). */
export function lockIn<M extends OptimisticMenu>(menu: M, day: number, meal: string, locked: boolean): M {
  const all = { ...(menu.locked ?? {}) }
  all[String(day)] = { ...(all[String(day)] ?? {}), [meal]: locked }
  return { ...menu, locked: all }
}
