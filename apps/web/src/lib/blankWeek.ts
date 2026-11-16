/**
 * PRO-1180 · «Configurar pesa más que pedirle a la IA» (propuesta de Producto
 * 2026-11-11 §5, E-72): what the blank week says, and the household's
 * semana tipo in two lines.
 *
 * - With a semana tipo (anything the household said: a dish, a «no hay», a
 *   meal it added, more dishes): its two summary lines, «Editar» and
 *   **«Llenar con mi semana tipo»**.
 * - Without one (lunch and dinner every day, any recipe — what every
 *   household has until it says something): **«Hacer mi menú»** and the link
 *   «Primero, cuéntame cómo coméis».
 */
import { COOKING_WEEKDAYS, MEALS, defaultWeekTypeSlot, weekTypeOptionLabel, weekTypeSlotAt, weekTypeSlotView, type Meal, type WeekTypeDays, type WeekTypeOption } from "@ona/shared"

const DAY_NAMES = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"] as const
const MEAL_NAMES: Record<Meal, string> = { breakfast: "desayuno", lunch: "comida", snack: "merienda", dinner: "cena" }
/** How many dish groups the second line shows before «y N más». */
const MAX_GROUPS = 3

/** «a», «a y b», «a, b y c». */
function joinEs(items: string[]): string {
  if (items.length <= 1) return items.join("")
  return `${items.slice(0, -1).join(", ")} y ${items[items.length - 1]}`
}

const capitalize = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)

/** Pure: did the household say anything about its week (not just the default lunch and dinner)? */
export function weekTypeConfigured(days: WeekTypeDays | null | undefined): boolean {
  if (!days) return false
  for (let d = 0; d < COOKING_WEEKDAYS.length; d++) {
    for (const m of MEALS) {
      const slot = weekTypeSlotAt(days, d, m)
      if (!!slot.off !== !!defaultWeekTypeSlot(m).off) return true
      if (slot.off) continue
      if ((slot.options ?? []).some((o) => o.kind !== "any")) return true
      if (slot.dishes && slot.dishes > 1) return true
    }
  }
  return false
}

/** A dish type reads in lower case in the middle of a line («legumbres»); a recipe keeps its name. */
function optionText(o: WeekTypeOption): string {
  const label = weekTypeOptionLabel(o)
  return o.kind === "type" || o.kind === "taper" ? label.toLowerCase() : label
}

/**
 * Pure: the semana tipo in two lines, e.g. «Comida y cena» and «legumbres
 * lunes y miércoles · viernes cena: pizza». The first says which meals the
 * week has; the second, what the household asked for and when (a lunch
 * without its meal, any other meal before «:»), at most three and «y N más».
 * `dishes` is null when no slot asks for anything.
 */
export function weekTypeSummary(days: WeekTypeDays | null | undefined): { meals: string; dishes: string | null } {
  const used = MEALS.filter((m) => COOKING_WEEKDAYS.some((_, d) => !weekTypeSlotAt(days, d, m).off))
  const meals = used.length ? capitalize(joinEs(used.map((m) => MEAL_NAMES[m]))) : "Sin comidas"

  // Same dish and same meal → one group with its days, in the order they first appear.
  const groups = new Map<string, { meal: Meal; text: string; days: number[] }>()
  for (let d = 0; d < COOKING_WEEKDAYS.length; d++) {
    for (const m of MEALS) {
      const slot = weekTypeSlotAt(days, d, m)
      if (slot.off) continue
      const view = weekTypeSlotView(slot)
      const options = view.options.filter((o) => o.kind !== "any")
      if (options.length === 0) continue
      let text = options.map(optionText).join(view.together ? " + " : " o ")
      if (view.every > 1) text += ` cada ${view.every} semanas`
      const key = `${m}|${text}`
      const group = groups.get(key) ?? { meal: m, text, days: [] }
      group.days.push(d)
      groups.set(key, group)
    }
  }
  const parts = [...groups.values()].map((g) => {
    const when = joinEs(g.days.map((d) => DAY_NAMES[d]))
    return g.meal === "lunch" ? `${g.text} ${when}` : `${when} ${MEAL_NAMES[g.meal]}: ${g.text}`
  })
  if (parts.length === 0) return { meals, dishes: null }
  const shown = parts.slice(0, MAX_GROUPS)
  const rest = parts.length - shown.length
  return { meals, dishes: shown.join(" · ") + (rest > 0 ? ` · y ${rest} más` : "") }
}

export interface BlankWeekCopy {
  /** The main button. */
  primary: "Llenar con mi semana tipo" | "Hacer mi menú"
  /** The line under the title. */
  lead: string
  /** The semana tipo's two lines, with «Editar» (only with a semana tipo). */
  summary: { meals: string; dishes: string | null } | null
  /** «Primero, cuéntame cómo coméis» → /profile/semana-tipo (only without one). */
  setupLink: boolean
}

/** Pure: what the blank week of a future or current week says and offers. */
export function blankWeekCopy(days: WeekTypeDays | null | undefined): BlankWeekCopy {
  if (weekTypeConfigured(days)) {
    return {
      primary: "Llenar con mi semana tipo",
      lead: "Se llena con tu semana tipo y la lista de la compra sale sola. O rellena tú los huecos.",
      summary: weekTypeSummary(days),
      setupLink: false,
    }
  }
  return {
    primary: "Hacer mi menú",
    lead: "Te hacemos la semana y la lista de la compra sale sola. O rellena tú los huecos.",
    summary: null,
    setupLink: true,
  }
}

/** The link to «Tu semana tipo». */
export const WEEK_TYPE_HREF = "/profile/semana-tipo"
