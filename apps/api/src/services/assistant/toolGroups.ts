/**
 * PRO-392 (D-168, D-164): Mimo gets, on each turn, only the tools that turn
 * needs. Until 2026-11-11 every request carried all ~90 tools (≈74 KB of
 * names, descriptions and schemas, more than the rest of the prompt), paid on
 * every round, and so many at once made the choice harder.
 *
 * The choice is made without AI: a small core always goes; then the groups
 * whose words appear in the user's message or in Mimo's previous reply (a
 * «Sí» answers that), the groups of the tools Mimo used in the last turns
 * (⟦hecho: …⟧), and the group of the page the user writes from. If nothing
 * matches, the menu group. And if the model still lacks a tool, `more_tools`
 * (in the core) loads a whole group for the next round of the same turn.
 *
 * The «Sobre Mimoia» block (what Mimoia is, plans, prices, privacy, contact:
 * ≈24 KB of the prompt) goes the same way: only when the conversation asks
 * about the app.
 */
import type { PageKind } from './pageContext.js'
import type { SkillDefinition, SkillResult } from './types.js'

export type ToolGroupId =
  | 'menu'
  | 'sobras'
  | 'fijas'
  | 'compra'
  | 'tiendas'
  | 'despensa'
  | 'recetas'
  | 'cocina'
  | 'salud'
  | 'hogar'
  | 'ficha'

/** Always there: read the menu and recipes, the simplest changes, and `more_tools`. */
export const CORE_TOOLS = [
  'get_todays_menu',
  'get_weekly_menu',
  'get_recipe_details',
  'search_recipes',
  'swap_meal',
  'get_shopping_list',
  'add_shopping_items',
  'more_tools',
] as const

export interface ToolGroup {
  /** What `more_tools` tells the model the group is for. */
  label: string
  tools: string[]
  /** Words (on folded text: lowercase, no accents) that call for the group. */
  words: RegExp
}

const DAYS = 'lunes|martes|miercoles|jueves|viernes|sabado|domingo'

export const TOOL_GROUPS: Record<ToolGroupId, ToolGroup> = {
  menu: {
    label: 'cambiar el menu: generar la semana, añadir, quitar, mover, vaciar o fijar comidas, comensales, notas, vetos, comido o cocinado, quien cocina, historial',
    tools: [
      'generate_weekly_menu', 'add_dish', 'remove_dish', 'clear_meal', 'set_day_skipped', 'set_meal_note',
      'set_meal_servings', 'lock_meal', 'move_meal', 'ban_recipe_this_week', 'mark_meal_eaten', 'log_cooked',
      'set_cook_today', 'suggest_recipes', 'get_menu_history', 'update_weekly_template',
    ],
    words: new RegExp(
      `\\b(menus?|semana|hoy|manana|ayer|finde|${DAYS}|comidas?|cenas?|cenamos|comemos|desayun\\w*|meriend\\w*|almuerz\\w*|platos?|cambia\\w*|quita\\w*|pon|ponme|ponlo|ponla|pongas|mete\\w*|anade\\w*|anadir|mueve|mover|pasa|intercambia\\w*|fuera|invitad\\w*|comensales|raciones|somos|seremos|vienen|genera\\w*|haz|hazme|hazlo|planifica\\w*|repit\\w*|veta\\w*|harto|bloquea\\w*|deja\\w*|cocinad[oa]|cocina|cocino|cocinas|hice|hizo|hecho|hecha|historial|ultima vez|semana pasada|sugier\\w*|sugerencias?|ideas?|propon\\w*|apunta\\w*|nota)\\b`,
    ),
  },
  sobras: {
    label: 'platos que ya estan hechos, sobras, taper y congelador en el menu',
    tools: ['add_freezer_dish', 'set_leftovers', 'set_taper', 'plan_freezer_items'],
    words: /\b(sobr\w*|resto\w*|taper\w*|tupper\w*|tuper\w*|congel\w*|hech[oa]s?|aprovech\w*|metelo|metelos)\b/,
  },
  fijas: {
    label: 'comidas fijas (siempre lo mismo) y el menu del comedor escolar',
    tools: ['get_fixed_meals', 'set_fixed_meal', 'get_school_menu', 'set_school_menu_days'],
    words: /\b(fij\w*|siempre|todos los dias|cada dia|cole|colegio|comedor|escolar|guarderia)\b/,
  },
  compra: {
    label: 'la lista de la compra: quitar, cantidades, unidades, habituales, basicos, marcar comprado, rehacerla',
    tools: [
      'remove_shopping_items', 'change_shopping_item_amount', 'change_shopping_item_unit', 'set_shopping_habitual',
      'manage_staples', 'regenerate_shopping_list', 'check_shopping_item',
    ],
    words: /\b(compra\w*|compro|compre|lista|super\w*|mercad\w*|kilos?|kg|gramos?|litros?|unidades|paquetes?|habitual\w*|basicos?|cantidad\w*|tacha\w*|comprad[oa]s?|cesta|carro)\b/,
  },
  tiendas: {
    label: 'pedidos a las tiendas del hogar: tiendas, preparar, cambiar, respuesta de la tienda, confirmar, cerrar',
    tools: ['manage_shops', 'prepare_shop_orders', 'edit_shop_order', 'register_shop_reply', 'approve_shop_order', 'close_shop_order', 'get_shop_orders'],
    words: /\b(tiendas?|pedidos?|fruter\w*|carnicer\w*|pescader\w*|charcuter\w*|panader\w*|tender\w*|recog\w*|domicilio|encarg\w*|envia\w*|precios?|euros?|total|te pongo|no queda|no hay|haz la compra|hazme la compra)\b|€/,
  },
  despensa: {
    label: 'la despensa: que hay en casa, lo que se acaba o caduca, que cocinar con lo que hay',
    tools: ['get_pantry_stock', 'mark_in_stock', 'update_pantry', 'cook_with_what_i_have'],
    words: /\b(despensa|nevera|frigo\w*|congelador|tengo|tenemos|queda|quedan|acab\w*|caduc\w*|en casa|armario|stock|con lo que|que hago|que puedo hacer|que cocino)\b/,
  },
  recetas: {
    label: 'recetas: crear, editar, importar de un enlace, mis recetas, recetarios, favoritos, notas y valoraciones, escalar, sustituciones, variaciones, foto, receta del dia, modo cocina',
    tools: [
      'create_recipe', 'edit_recipe', 'add_recipe_to_mine', 'import_recipe_from_url', 'get_my_recipes', 'delete_recipe',
      'manage_cookbook', 'regenerate_recipe_image', 'update_recipe_notes', 'toggle_favorite', 'scale_recipe',
      'recipe_variation', 'suggest_substitution', 'get_recipe_of_the_day', 'start_cooking_mode',
    ],
    words: /\b(recetas?|recetario\w*|crea\w*|guarda\w*|importa\w*|enlace|link|youtube|instagram|tiktok|video|foto\w*|favorit\w*|valora\w*|estrellas?|repetir|estuvo|gusto|edita\w*|ingredientes?|quitale|sustitu\w*|en vez|en lugar|no tengo|variaci\w*|version|personas|escala\w*|como se hace|como la hago|como lo hago|como hago|pasos?|borra\w*|imagen|cocinar)\b|https?:\/\//,
  },
  cocina: {
    label: 'el modo cocina de la app: abrirlo, temporizadores, pasos',
    tools: ['start_cooking_mode', 'set_timer', 'cooking_step'],
    words: /\b(modo cocina|temporizador\w*|timer|alarma|siguiente|anterior|repite|voy a cocinar|empiezo a cocinar|cocinando)\b/,
  },
  salud: {
    label: 'nutricion y equilibrio: balance de la semana, variedad, ventana de comidas, si un alimento es sano, sustitutos',
    tools: ['get_weekly_nutrition', 'nutrition_advice', 'evaluate_food_health', 'get_variety_score', 'get_eating_window', 'get_week_balance', 'suggest_substitution'],
    words: /\b(nutri\w*|sano|sana|saludable\w*|calorias?|proteinas?|macros?|equilibr\w*|variedad|verduras?|legumbres?|fritos?|procesad\w*|azucar\w*|sal|ventana|ayuno|salud|medico|diabet\w*|colesterol|tension|peso|adelgaz\w*|engord\w*|bueno para|malo para)\b/,
  },
  hogar: {
    label: 'el hogar y el perfil: cuantos sois, restricciones, memoria (gustos, equipo, presupuesto), invitar, avisos, como cocinais, opiniones para el equipo',
    tools: [
      'update_household', 'update_profile', 'update_memory', 'invite_to_household', 'share_invite_link',
      'set_whatsapp_notifications', 'get_alerts', 'set_alerts', 'set_cooking_style', 'leave_feedback',
    ],
    words: /\b(hogar|adult\w*|ninos?|ninas?|hij[oa]s?|bebes?|familia|invit\w*|compart\w*|pareja|perfil|restricci\w*|alergi\w*|alergic\w*|intoleran\w*|vegetarian\w*|vegan\w*|celiac\w*|gluten|lactosa|gusta|gustan|odio|odiamos|recuerda\w*|memoria|olvida\w*|avisos?|notificaci\w*|mensajes?|baja|alta|batch|tandas|opinion|sugerencia|queja|falla\w*|error|funciona|presupuesto|horno|freidora|robot|thermomix|olla|microondas)\b/,
  },
  ficha: {
    label: 'la ficha del hogar (lo que Mimoia sabe y aprende de la casa) y las valoraciones de «Afina tu menu»',
    tools: [
      'get_ficha', 'explain_ficha_fact', 'note_ficha_fact', 'forget_ficha_fact', 'set_ficha_learning',
      'get_ficha_question', 'answer_ficha_question', 'list_taste_verdicts', 'forget_taste_verdicts', 'update_memory',
    ],
    words: /\b(ficha|sabes de|por que crees|de donde sacas|aprend\w*|afina|me apetece|me encanta|no para mi|valoraciones|cartas|olvida\w*|recuerda que|apunta que|en casa)\b/,
  },
}

/** Page the user writes from (web companion) → the groups it implies. */
export const PAGE_GROUPS: Partial<Record<PageKind, ToolGroupId[]>> = {
  menu: ['menu'],
  shopping: ['compra', 'tiendas'],
  recipe: ['recetas'],
  cooking: ['cocina', 'recetas'],
  catalogue: ['recetas'],
  profile: ['hogar', 'ficha'],
}

/** When nothing in the turn points anywhere: the menu, what most turns are about. */
export const DEFAULT_GROUPS: ToolGroupId[] = ['menu']

/** Questions about Mimoia itself: the «Sobre Mimoia» block (and prices) goes in. */
const ABOUT_WORDS = /\b(mimoia|precios?|cuesta|cuestan|cuanto vale|planes|plan|gratis|esencial|plus|pagar|pago|pagos|tarjeta|suscrip\w*|cancela\w*|prueba|beta|cobr\w*|factura\w*|recibos?|privacidad|mis datos|datos personales|mi cuenta|la cuenta|contacto|telefono|email|correo|humano|persona|equipo|quien eres|que eres|que puedes|que sabes hacer|como funciona\w*|para que sirve|mision|vision|empresa|lanzamiento|telegram|instala\w*|app|aplicacion|web|iphone|android|stripe|link)\b/

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Tool names in the ⟦hecho: name {…} → … · name … ⟧ marks of a past reply. */
export function tracedTools(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/⟦hecho:([^⟧]*)⟧/g)) {
    for (const item of m[1].split(/ · |; /)) {
      const name = item.trim().match(/^([a-z_]+)\b/)?.[1]
      if (name) out.push(name)
    }
  }
  return out
}

function groupsOfTool(name: string): ToolGroupId[] {
  return (Object.keys(TOOL_GROUPS) as ToolGroupId[]).filter((g) => TOOL_GROUPS[g].tools.includes(name))
}

function groupsByWords(text: string): ToolGroupId[] {
  const t = fold(text)
  return (Object.keys(TOOL_GROUPS) as ToolGroupId[]).filter((g) => TOOL_GROUPS[g].words.test(t))
}

export interface ToolSelectionInput {
  message: string
  history?: readonly { role: 'user' | 'assistant'; content: string }[]
  page?: PageKind | null
  mode?: string
  onboarding?: boolean
}

export interface ToolSelection {
  groups: ToolGroupId[]
  /** Tool names for this turn, in registry order when built with `toolsForTurn`. */
  tools: Set<string>
  /** Whether the «Sobre Mimoia» block goes in the prompt. */
  about: boolean
}

/** Pure: which groups (and whether «Sobre Mimoia») this turn gets. */
export function selectToolGroups(input: ToolSelectionInput): ToolSelection {
  // Voice onboarding: its prompt allows update_memory and nothing else.
  if (input.mode === 'onboarding') return { groups: [], tools: new Set(['update_memory']), about: false }

  const history = input.history ?? []
  const lastAssistant = [...history].reverse().find((m) => m.role === 'assistant')?.content ?? ''
  const groups = new Set<ToolGroupId>(groupsByWords(input.message))
  const fromMessage = groups.size > 0
  // A short answer («sí», «el segundo») is about Mimo's last question.
  for (const g of groupsByWords(lastAssistant.replace(/⟦[^⟧]*⟧/g, ''))) groups.add(g)
  // What Mimo did in the last two turns (follow-ups: «y el viernes también»).
  for (const m of history.filter((x) => x.role === 'assistant').slice(-2)) {
    for (const name of tracedTools(m.content)) for (const g of groupsOfTool(name)) groups.add(g)
  }
  for (const g of PAGE_GROUPS[input.page ?? 'other'] ?? []) groups.add(g)
  if (!fromMessage && groups.size === 0) for (const g of DEFAULT_GROUPS) groups.add(g)

  const tools = new Set<string>(CORE_TOOLS)
  for (const g of groups) for (const name of TOOL_GROUPS[g].tools) tools.add(name)
  if (input.onboarding) tools.add('complete_onboarding')

  // Only the user's words: Mimo's own replies say «Mimoia» when it introduces itself.
  const about = input.onboarding === true || ABOUT_WORDS.test(fold(input.message))
  return { groups: [...groups], tools, about }
}

/**
 * `more_tools`: the model asks for a group it doesn't have; the engine adds
 * its tools for the next round of the same turn (see `runToolLoop`).
 */
export const MORE_TOOLS_NAME = 'more_tools'

export const moreToolsSkill: SkillDefinition = {
  name: MORE_TOOLS_NAME,
  description: `En este turno solo tienes las herramientas mas probables. Si para lo que pide el usuario te falta una, pide su grupo y la tendras en la siguiente ronda: ${(Object.keys(TOOL_GROUPS) as ToolGroupId[]).map((g) => `${g} (${TOOL_GROUPS[g].label})`).join('; ')}.`,
  parameters: {
    type: 'object',
    properties: {
      groups: { type: 'array', items: { type: 'string', enum: Object.keys(TOOL_GROUPS) }, description: 'Grupos que necesitas.' },
    },
    required: ['groups'],
  },
  // The engine answers it (it changes the tools); this only runs outside the engine.
  handler: async (params: { groups?: unknown }): Promise<SkillResult> => ({ data: null, summary: moreToolsSummary(validGroups(params?.groups)), uiHint: 'text' }),
}

export function validGroups(value: unknown): ToolGroupId[] {
  return Array.isArray(value) ? value.filter((g): g is ToolGroupId => typeof g === 'string' && g in TOOL_GROUPS) : []
}

export function moreToolsSummary(groups: ToolGroupId[]): string {
  if (groups.length === 0) return `No conozco ese grupo. Los grupos son: ${Object.keys(TOOL_GROUPS).join(', ')}.`
  return `Ya tienes las herramientas de ${groups.join(', ')}: ${groups.flatMap((g) => TOOL_GROUPS[g].tools).join(', ')}. Usalas ahora.`
}
