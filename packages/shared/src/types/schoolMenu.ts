/**
 * Menú del comedor escolar (PRO-224, D-069). The household sends the school's
 * monthly menu (photo or PDF); Mimo reads, per school day, the main dish and
 * its group, and the menu's dinner that day doesn't repeat the group
 * («si los niños comieron lentejas, la cena no es de legumbres»). It is said
 * as «para no repetir», never as a health claim (constitution §6).
 */
import { z } from 'zod'

export const FOOD_GROUPS = ['legumbre', 'pescado', 'carne', 'huevo', 'pasta_arroz', 'verdura'] as const
export type FoodGroup = (typeof FOOD_GROUPS)[number]

export const FOOD_GROUP_LABELS: Record<FoodGroup, string> = {
  legumbre: 'Legumbre',
  pescado: 'Pescado',
  carne: 'Carne',
  huevo: 'Huevo',
  pasta_arroz: 'Pasta o arroz',
  verdura: 'Verdura',
}

export function isFoodGroup(v: unknown): v is FoodGroup {
  return typeof v === 'string' && (FOOD_GROUPS as readonly string[]).includes(v)
}

/** One school day: the main dish at lunch and its group (null = unknown). */
export interface SchoolLunch {
  /** `YYYY-MM-DD`. */
  date: string
  dish: string
  group: FoodGroup | null
}

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime()) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'fecha no válida')

export const SCHOOL_DISH_MAX = 120
/** A month of school days, with room for a two-month sheet. */
export const SCHOOL_MENU_MAX_DAYS = 62

export const schoolLunchSchema = z.object({
  date: isoDate,
  dish: z.string().trim().min(1).max(SCHOOL_DISH_MAX),
  group: z.enum(FOOD_GROUPS).nullable(),
})

/** `PUT /school-menu`: the days to save (replace those dates). `clear` dates are removed. */
export const schoolMenuSaveSchema = z.object({
  days: z.array(schoolLunchSchema).max(SCHOOL_MENU_MAX_DAYS),
  clear: z.array(isoDate).max(SCHOOL_MENU_MAX_DAYS).optional(),
})
export type SchoolMenuSave = z.infer<typeof schoolMenuSaveSchema>

// ─── Groups from a dish name ─────────────────────────────────────

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

/**
 * Words per group, matched as whole words on the folded text. `judias verdes`
 * is a vegetable, `judias` alone a pulse.
 */
const GROUP_PATTERNS: Record<FoodGroup, RegExp> = {
  legumbre: /\b(lentejas?|garbanzos?|alubias?|judias(?! verdes)|habas|fabada|potaje|cocido|hummus|humus|frijoles?|soja)\b/,
  pescado: /\b(pescados?|merluza|bacalao|salmon|atun|lubina|dorada|sardinas?|boquerones?|calamar(es)?|sepia|rape|pescadilla|abadejo|gallo|bonito|caballa|panga|lenguado|mejillones|gambas|langostinos|emperador|palometa|trucha)\b/,
  huevo: /\b(huevos?|tortilla|revuelto|frittata)\b/,
  pasta_arroz: /\b(pasta|macarrones|espaguetis|spaghetti|tallarines|fideos|fideua|lasana|canelones|ravioli|tortellini|noodles|arroz|paella|risotto|cuscus)\b/,
  carne: /\b(carnes?|pollo|ternera|cerdo|lomo|filetes?|albondigas|hamburguesas?|pavo|jamon|chorizo|salchichas?|cordero|conejo|chuletas?|solomillo|costillas|longaniza|pechuga|muslos?|estofado de ternera|ragu|bolonesa|carrillada|secreto|presa)\b/,
  verdura: /\b(verduras?|menestra|judias verdes|ensaladas?|crema de|pure de|brocoli|coliflor|calabacin|calabaza|espinacas|acelgas|pisto|berenjenas?|puerros?|zanahorias?|gazpacho|salmorejo|alcachofas?|champinones|setas|ratatouille|guisantes|patatas?)\b/,
}

/**
 * Pure: the group of a dish from its name — the group whose word comes first
 * («Arroz con pollo» → pasta o arroz, «Pollo con arroz» → carne). Null when
 * nothing matches.
 */
export function dishFoodGroup(name: string | null | undefined): FoodGroup | null {
  if (!name) return null
  const text = fold(name)
  let best: { group: FoodGroup; at: number } | null = null
  for (const group of FOOD_GROUPS) {
    const m = GROUP_PATTERNS[group].exec(text)
    if (m && (best === null || m.index < best.at)) best = { group, at: m.index }
  }
  return best?.group ?? null
}

/** Ingredient-only fallback order: the protein or base that defines a dish. */
const INGREDIENT_ORDER: FoodGroup[] = ['legumbre', 'pescado', 'carne', 'pasta_arroz', 'huevo']

/**
 * Pure: a recipe's group — from its name, else from its ingredients (the
 * first of legumbre, pescado, carne, pasta o arroz, huevo found). Null when
 * neither says.
 */
export function recipeFoodGroup(recipe: { name: string; ingredients?: ReadonlyArray<{ ingredientName: string }> }): FoodGroup | null {
  const byName = dishFoodGroup(recipe.name)
  if (byName) return byName
  const names = (recipe.ingredients ?? []).map((i) => fold(i.ingredientName))
  for (const group of INGREDIENT_ORDER) {
    if (names.some((n) => GROUP_PATTERNS[group].test(n))) return group
  }
  return null
}

export class NotASchoolMenuError extends Error {
  constructor() {
    super('No he encontrado un menú escolar en ese archivo.')
  }
}

/**
 * A file the reader can't take (PRO-355): a HEIC photo (the iPhone format;
 * our image library can't decode it) or a PDF / image too big for the model.
 * Each channel says what to do instead (web, WhatsApp).
 */
export type SchoolMenuFileProblem = 'heic' | 'too_big'
export class SchoolMenuFileError extends Error {
  constructor(public readonly reason: SchoolMenuFileProblem) {
    super(reason === 'heic' ? 'school menu file is HEIC' : 'school menu file is too big for the reader')
  }
}

/** «lunes 3: Lentejas (legumbre)» lines, for Mimo and WhatsApp. */
export function schoolLunchLines(days: SchoolLunch[]): string[] {
  const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado']
  return days.map((d) => {
    const dt = new Date(`${d.date}T00:00:00Z`)
    const group = d.group ? ` (${FOOD_GROUP_LABELS[d.group].toLowerCase()})` : ''
    return `${DAYS[dt.getUTCDay()]} ${dt.getUTCDate()}: ${d.dish}${group}`
  })
}
