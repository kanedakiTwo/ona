/**
 * PRO-1233: in a week with no dishes yet (this one or a later one), every
 * empty slot of «La semana» and of the day view shows, quietly, what the
 * semana tipo will put there **that week** — the turn it takes, as the
 * skeleton while generating (PRO-1186) — with its icon and its name. The
 * «Añadir» stays. Once the week has dishes, nothing of this.
 */
import { fixedNoteText, weekTypeOptionLabel, weekTypeOptionsFor, weekTypeSlotAt, type Meal, type WeekTypeDays, type WeekTypeOption } from "@ona/shared"

export interface WeekTypeHint {
  /** `DishTypeIcon`'s key: a dish type or a wildcard (`any`, `recipe`, `fixed`, `taper`). */
  icon: string
  /** «Legumbres», «Fijo: Sobras», «Cualquier receta». */
  label: string
}

function optionText(o: WeekTypeOption): string {
  return o.kind === "fixed" ? fixedNoteText(o) : weekTypeOptionLabel(o)
}

/**
 * Pure: what the semana tipo puts in a slot the week of `weekStart`, or null
 * when it isn't loaded yet or that meal is «no hay» there. Options taken
 * together read «Pizza + Ensalada»; by turns, only the one of that week.
 */
export function weekTypeHint(days: WeekTypeDays | null | undefined, day: number, meal: Meal, weekStart: string): WeekTypeHint | null {
  if (!days) return null
  const slot = weekTypeSlotAt(days, day, meal)
  if (slot.off) return null
  const options = weekTypeOptionsFor(slot, weekStart)
  if (options.length === 0) return { icon: "any", label: "Cualquier receta" }
  const first = options[0]
  return { icon: first.kind === "type" ? first.type : first.kind, label: options.map(optionText).join(" + ") }
}
