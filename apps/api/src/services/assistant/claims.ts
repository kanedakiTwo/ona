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
 * Tools that only read (or only answer): running one of them doesn't make a
 * "Hecho:" true. Anything else that ran without error counts as a change.
 * Shared by the engine (PRO-239) and the conversation flags.
 */
export const READ_ONLY_TOOLS: ReadonlySet<string> = new Set([
  'get_todays_menu', 'get_weekly_menu', 'get_recipe_details', 'get_weekly_nutrition', 'suggest_recipes', 'cook_with_what_i_have',
  'search_recipes', 'nutrition_advice', 'recipe_variation', 'get_pantry_stock', 'get_my_recipes', 'get_menu_history',
  'scale_recipe', 'evaluate_food_health', 'suggest_substitution', 'get_variety_score', 'get_eating_window',
  'get_week_balance', 'start_cooking_mode', 'set_timer', 'cooking_step', 'get_shopping_list', 'get_shop_orders',
])

/** A tool that ran but reported that nothing changed. */
export const NO_CHANGE_RE = /\bno (?:he|se ha|hay|tienes|existe|encuentro)\b|\bno he (?:cambiado|guardado|encontrado|podido)\b|^error\b/i

/** Pure: did this tool call change something? (not read-only, no error, didn't say "no he encontrado…") */
export function toolMadeChange(name: string, summary: unknown, error: boolean): boolean {
  return !error && !READ_ONLY_TOOLS.has(name) && !NO_CHANGE_RE.test(String(summary ?? '').trim())
}
