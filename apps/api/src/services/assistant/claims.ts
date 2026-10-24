/**
 * Spanish "I did it" claims. The engine checks them when no tool that changes
 * something ran this turn (PRO-239): a legit "He cambiado la cena" after
 * swap_meal never trips it. Also "ya está apuntado / ya está corregido" and
 * "ya salía como…" (2026-10-18: «Ya está apuntado como cocinado…» after only
 * `get_shopping_list`; «Los pañales ya salían como…» without touching the list).
 */
const ACTION_CLAIM_RE =
  /\b(?:he|hemos|ya)\s+(?:cambiado|generado|guardado|marcado|a[ñn]adido|actualizado|apuntado|creado|quitado|eliminado|borrado|puesto|sustituido|registrado|corregido|arreglado)\b|\bya\s+(?:est[áa]n?|estaba|estaban)\s+(?:bien\b|apuntad|marcad|a[ñn]adid|cambiad|corregid|arreglad|guardad|quitad|puest|actualizad|registrad)|\bya\s+sal[íi]an?\s+(?:como|bien)\b|(?:^|[.!?,;]\s*)(?:hecho|listo|cambiado|guardado|apuntado)\s*[.!,:]/im

export function claimsAction(text: string): boolean {
  return ACTION_CLAIM_RE.test(text)
}

/**
 * The reply also says what did NOT get done («…y el butter chicken no lo he
 * cambiado», «eso no he podido»): a «He apuntado X» next to it is an honest
 * partial answer, not an unbacked «Hecho» (PRO-349).
 */
const ADMITS_NOT_DONE_RE =
  /\bno (?:lo |la |los |las |te )?(?:he|hemos) (?:podido|cambiado|quitado|hecho|tocado|guardado|apuntado|a[ñn]adido|puesto|borrado|encontrado)\b|\bno (?:est[áa]|queda) (?:hecho|cambiad|guardad|apuntad)|\bno se ha (?:podido|cambiado|hecho|guardado)\b/i

export function admitsNotDone(text: string): boolean {
  return ADMITS_NOT_DONE_RE.test(text)
}

/**
 * Tools that only read (or only answer): running one of them doesn't make a
 * "Hecho:" true. Anything else that ran without error counts as a change.
 * Shared by the engine (PRO-239) and the conversation flags.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_todays_menu', 'get_weekly_menu', 'get_recipe_details', 'get_weekly_nutrition', 'suggest_recipes', 'cook_with_what_i_have',
  'search_recipes', 'nutrition_advice', 'recipe_variation', 'get_pantry_stock', 'get_my_recipes', 'get_menu_history',
  'scale_recipe', 'evaluate_food_health', 'suggest_substitution', 'get_variety_score', 'get_eating_window',
  'get_week_balance', 'start_cooking_mode', 'set_timer', 'cooking_step', 'get_shopping_list', 'get_shop_orders', 'get_fixed_meals', 'get_school_menu', 'get_alerts',
  'get_ficha', 'explain_ficha_fact', 'get_ficha_question',
  'list_taste_verdicts',
])

/** A tool that ran but reported that nothing changed. */
export const NO_CHANGE_RE = /\bno (?:he|se ha|hay|tienes|existe|encuentro|encontr[eé]|estaba en)\b|\bno he (?:cambiado|guardado|encontrado|podido)\b|^error\b/i

/**
 * A summary that opens with «Hecho» / «Cambiado» reports a change, even when
 * it adds «No hay una receta que se llame igual, así que va como nota».
 */
const DONE_OPENING_RE = /^(?:hecho|cambiado)\b/i

/** Pure: did this tool call change something? (not read-only, no error, didn't say "no he encontrado…") */
export function toolMadeChange(name: string, summary: unknown, error: boolean): boolean {
  if (error || READ_ONLY_TOOLS.has(name)) return false
  const s = String(summary ?? '').trim()
  return DONE_OPENING_RE.test(s) || !NO_CHANGE_RE.test(s)
}

export interface ToolOutcome {
  name: string
  summary: unknown
  error: boolean
}

/**
 * PRO-349: the calls of a turn to tools that change things which failed or
 * changed nothing, and that no later call of the same tool fixed. Any of them
 * means a «Hecho» isn't backed in full: Laura's «quita el cilantro del butter
 * chicken» got «Hecho» while the recipe stayed as it was, because another
 * tool of the turn had changed something.
 */
export function unconfirmedCalls<T extends ToolOutcome>(calls: readonly T[]): T[] {
  const changed = (c: ToolOutcome) => toolMadeChange(c.name, c.summary, c.error)
  return calls.filter((c, i) => !READ_ONLY_TOOLS.has(c.name) && !changed(c) && !calls.slice(i + 1).some((l) => l.name === c.name && changed(l)))
}
