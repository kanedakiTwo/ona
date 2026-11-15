/**
 * PRO-1179 · The week's «···» sheet (propuesta `2026-11-11-producto-hojas-del-menu.md`
 * §1.7 y §3): which options it shows. Pure, so the vitest covers the current,
 * a future and a past week without a browser.
 *
 * - No ‹ › nor «Volver a esta semana»: the header has them.
 * - «Tu semana tipo» first (on desktop it's the header button instead).
 * - «Rehacer la semana…» last, never on a past week; its subsheet holds
 *   «Con mi semana tipo», «Solo con mis favoritas» and, with dishes on the
 *   week, «Vaciarla y rellenar a mano».
 */

export const WEEK_TYPE_HREF = "/profile/semana-tipo"

export type WeekSheetOption = "semana_tipo" | "vista" | "compartir" | "imprimir" | "historial" | "rehacer"
export type WeekRedoOption = "regenerar" | "favoritas" | "vaciar"

export interface WeekSheetInput {
  /** 0 this week, > 0 a future one, < 0 a past one. */
  weeksFromNow: number
  hasMenu: boolean
  /** lg+: no Día/Semana switch, and «Semana tipo» sits in the header. */
  desktop: boolean
}

export function weekSheetOptions({ weeksFromNow, hasMenu, desktop }: WeekSheetInput): {
  main: WeekSheetOption[]
  redo: WeekRedoOption[]
} {
  const past = weeksFromNow < 0
  const main: WeekSheetOption[] = []
  if (!desktop) main.push("semana_tipo", "vista")
  if (hasMenu) main.push("compartir", "imprimir")
  main.push("historial")
  if (past) return { main, redo: [] }
  main.push("rehacer")
  return { main, redo: hasMenu ? ["regenerar", "favoritas", "vaciar"] : ["regenerar", "favoritas"] }
}
