/**
 * «Semana tipo» (D-182 §3): the dish types of a recipe (`DISH_TYPES`), by
 * fixed rules on its name, its tags and its main ingredients. Set on save
 * and import (`refreshRecipeDishTypes`), and filled on boot for every recipe
 * still without them (`applyRecipeDishTypes`). Replaces
 * `scripts/tagRecipesByType.ts`, whose rules counted soja as a pulse and as
 * Asian. A wrong one is fixed by Cocina when editing the recipe.
 */
import { eq, inArray, isNull } from 'drizzle-orm'
import { DISH_TYPE_KEYS, type DishType } from '@ona/shared'
import { ingredients as ingredientsTable, recipeIngredients, recipes } from '../db/schema.js'

export interface DishTypeInput {
  name: string
  tags?: readonly string[] | null
  ingredients: ReadonlyArray<{ ingredientName: string; quantity?: number | null; unit?: string | null }>
}

const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()

/** What isn't a main ingredient, however much of it there is. */
const STAPLE = /^(agua|sal|aceite|pimienta|caldo|vinagre|azucar|harina|vino|perejil|ajo|cebolla|especias?|comino|pimenton|oregano|laurel|limon|mantequilla)\b/

const GRAMS: Record<string, number> = { g: 1, gr: 1, ml: 1, kg: 1000, l: 1000, u: 100, unidad: 100, cda: 15, cdta: 5 }

/** The (up to) three heaviest ingredients that aren't salt, oil, water, broth… */
function mainIngredients(input: DishTypeInput): string[] {
  return input.ingredients
    .map((i) => ({ name: fold(i.ingredientName ?? ''), grams: (Number(i.quantity) || 0) * (GRAMS[fold(i.unit ?? 'g')] ?? 1) }))
    .filter((i) => i.name && !STAPLE.test(i.name))
    .sort((a, b) => b.grams - a.grams)
    .slice(0, 3)
    .map((i) => i.name)
}

const FISH = /\b(bacalao|merluza|salmon|lubina|dorada|atun|bonito|sepia|calamar(es)?|gambas?|langostinos?|mejillon(es)?|pescad(o|illa)|rape|sardinas?|boquerones?|caballa|pulpo|almejas?|trucha|lenguado|rodaballo|emperador|corvina|marisco|anchoas?|chipirones?|vieiras?)\b/
const POULTRY = /\b(pollo|pavo|pechugas?|muslos?|contramuslos?|alitas|gallina|capon)\b/
const MEAT = /\b(ternera|vacuno|buey|cerdo|cordero|conejo|carne|lomo|costillas?|solomillo|carrilleras?|osobuco|albondigas|hamburguesas?|chuleton|chuletas?|entrecot|secreto|presa|magret|pato|cochinita|chorizo|morcilla|panceta|bacon|jamon|salchichas?|picada|picadillo)\b/
const LEGUME = /\b(lentejas?|garbanzos?|alubias?|judiones?|fabes|fabada|frijol(es)?|hummus|humus|falafel|dal)\b/
const EGG_DISH = /\b(huevos?|tortillas? (de|francesa|espanola)|tortilla$|revuelto|shakshuka|frittata|quiche)\b/

/** Pure: the dish types of a recipe, in `DISH_TYPES` order. */
export function dishTypesOf(input: DishTypeInput): DishType[] {
  const n = fold(input.name)
  const tags = (input.tags ?? []).map(fold)
  const main = mainIngredients(input)
  const mainText = main.join(' | ')
  const out = new Set<DishType>()
  const meatInName = MEAT.test(n) || POULTRY.test(n)
  const fishInName = FISH.test(n)

  // Cuchara
  if (LEGUME.test(n) || (main[0] && LEGUME.test(main[0]))) out.add('legumbres')
  if (/^(crema|sopa|vichy|vichisoisse|gazpacho|salmorejo|caldo|consome|pure|potaje|ajoblanco)\b|\bramen\b|\bsopa\b/.test(n)) out.add('cremas-sopas')
  if (/\b(guis(o|os|ad[oa]s?)|estofad\w*|cocido|ragu|ragout|caldereta|carrilleras?|osobuco|marmitako|jardinera|tajin|tagine|fabada|chili|potaje|fricando|rabo de toro|callos|mole)\b/.test(n)) out.add('guisos')

  // Pescado, carne y huevo (the broad ones by name or main ingredient)
  if (fishInName || (!meatInName && FISH.test(mainText))) out.add('pescado')
  if (POULTRY.test(n) || (!fishInName && main[0] && POULTRY.test(main[0]))) out.add('pollo')
  if (MEAT.test(n) || (!fishInName && main.slice(0, 2).some((i) => MEAT.test(i) && !/\b(jamon|bacon|panceta|chorizo)\b/.test(i)))) out.add('carne')
  if (EGG_DISH.test(n) && !/\btortillas? de (maiz|trigo)\b/.test(n)) out.add('huevos')
  if (/\b(plancha|parrilla|brasa|barbacoa|churrasco|brochetas?|pinchos?|a la piedra|grill)\b/.test(n)) out.add('plancha-brasa')

  // Bases
  const italianPasta = /\b(pasta|espagu\w*|spaghetti|macarron\w*|lasana|lasagna|tallarin\w*|penne|ravioli|noquis|gnocchi|canelones|carbonara|tortellini|fusilli|linguine|tagliatelle|orzo|boloñesa|bolonesa)\b/
  if (italianPasta.test(n) || /\b(fideua|fideos)\b/.test(n)) out.add('pasta')
  if (/\b(arroz|paella|risotto|sushi|onigir\w*|poke|biryani|bibimbap)\b/.test(n)) out.add('arroz')
  if (/\bpizzas?\b/.test(n)) out.add('pizza')
  if (/\b(bocadillos?|sandwich|sandwiches|montaditos?|hamburguesas?|bikini|pepito|mollete|burritos?|wraps?)\b/.test(n) && !/\bwraps? de lechuga\b/.test(n)) out.add('bocadillos')

  // Frescos y crudos
  if (/^ensalada|\b(ensalada|tabule|tabbouleh|caprese|pipirrana|salpicon|poke)\b/.test(n)) out.add('ensaladas')
  if (/\b(ceviche|aguachile|tiradito|leche de tigre)\b/.test(n)) out.add('ceviche')
  if (/\b(carpaccio|tartar|tartare)\b/.test(n)) out.add('carpaccio-tartar')
  const anyProtein = [...out].some((t) => t === 'pescado' || t === 'pollo' || t === 'carne' || t === 'huevos' || t === 'legumbres')
  if (!anyProtein && !/\b(pizza|pasta|arroz)\b/.test(n) && !out.has('pasta') && !out.has('arroz') && !out.has('bocadillos')) {
    if (/\b(verduras?|menestra|pisto|tian|acelgas|espinacas|brocoli|coliflor|romanescu|calabac\w*|berenjenas?|judias verdes|guisantes|alcachofas?|esparragos|setas|champinones|puerros?|calabaza|zanahorias?|pimientos?|tomates?|parrillada de verduras)\b/.test(n)) out.add('verduras')
  }

  // Del mundo
  if (out.has('pizza') || italianPasta.test(n) || /\b(risotto|milanesa|caprese|pesto|parmigiana|focaccia|bruschetta|minestrone|saltimbocca|vitello|italian[ao])\b/.test(n)) out.add('italiano')
  if (/\b(sushi|onigir\w*|ramen|miso|teriyaki|tempura|gyozas?|yakitori|udon|soba|katsu|donburi|okonomiyaki|japones\w*|nigiri|maki)\b/.test(n)) out.add('japones')
  if (/\b(wok|salteado|agridulce|pekin\w*|chow mein|tres delicias|noodles|fideos de arroz|kung pao|dim sum|rollitos?|chin[oa])\b/.test(n)) out.add('chino-wok')
  if (/\b(curry|tikka|masala|dal|biryani|tandoori|korma|samosas?|naan|chana|paneer|vindaloo|indi[oa])\b/.test(n) && !/\b(thai|tailandes\w*|verde|rojo)\b/.test(n)) out.add('indio')
  if (/\b(tacos?|fajitas?|quesadillas?|burritos?|enchiladas?|nachos|guacamole|cochinita|mole|chili con carne|tamales?|pozole|chilaquiles|aguachile|mexican[oa])\b/.test(n)) out.add('mexicano')
  if (/\b(ceviche|tiradito|arepas?|churrasco|chimichurri|causa|lomo saltado|aji de gallina|feijoada|picanha|anticuchos?|peruan[oa]|argentin[oa]|venezolan[oa]|colombian[oa]|brasilen[oa])\b/.test(n)) out.add('sudamericano')
  if (/\b(hummus|humus|falafel|tabule|tabbouleh|shawarma|kebab|tajin|tagine|shakshuka|baba ganoush|cuscus|couscous|chermoula|fattoush|fatush|kofta|pastela|libanes\w*|marroqui|turc[oa])\b/.test(n)) out.add('oriente-medio')

  // Desayunos
  if (/\b(tostadas?|tostas?|pan con tomate|pan tumaca|tumaca)\b/.test(n) && !/\btostada francesa\b/.test(n)) out.add('tostadas')
  if (/\b(avena|porridge|granola|muesli|cereales|overnight oats)\b/.test(n)) out.add('cereales-avena')
  if (/\b(yogur|yogurt|kefir|macedonia|bol de fruta|fruta con|smoothie bowl|acai)\b/.test(n)) out.add('yogur-fruta')
  if (/\b(tortitas|pancakes?|crepes?|gofres?|waffles?|torrijas?|bizcocho|magdalenas?|churros|tostada francesa|french toast|bollos?|croissants?)\b/.test(n)) out.add('dulce-finde')

  // A tag the recipe already carries with a type's own key counts too.
  for (const t of tags) if (isKnown(t)) out.add(t as DishType)
  return ORDER.filter((k) => out.has(k))
}

const ORDER = DISH_TYPE_KEYS as readonly DishType[]
const isKnown = (s: string) => (ORDER as readonly string[]).includes(s)

type Db = any

async function ingredientLines(db: Db, ids: string[]) {
  const rows = ids.length
    ? await db
      .select({ recipeId: recipeIngredients.recipeId, ingredientName: ingredientsTable.name, quantity: recipeIngredients.quantity, unit: recipeIngredients.unit })
      .from(recipeIngredients)
      .innerJoin(ingredientsTable, eq(recipeIngredients.ingredientId, ingredientsTable.id))
      .where(inArray(recipeIngredients.recipeId, ids))
    : []
  const by = new Map<string, DishTypeInput['ingredients'][number][]>()
  for (const r of rows) (by.get(r.recipeId) ?? by.set(r.recipeId, []).get(r.recipeId)!).push(r)
  return by
}

/** Recompute and save the dish types of some recipes (after a save or an import). Never throws. */
export async function refreshRecipeDishTypes(db: Db, recipeIds: string | string[]): Promise<void> {
  const ids = (Array.isArray(recipeIds) ? recipeIds : [recipeIds]).filter(Boolean)
  if (!ids.length) return
  try {
    const rows = await db.select({ id: recipes.id, name: recipes.name, tags: recipes.tags }).from(recipes).where(inArray(recipes.id, ids))
    const lines = await ingredientLines(db, ids)
    for (const r of rows) {
      await db.update(recipes).set({ dishTypes: dishTypesOf({ name: r.name, tags: r.tags, ingredients: lines.get(r.id) ?? [] }) }).where(eq(recipes.id, r.id))
    }
  } catch (err) {
    console.warn('[dish-types] refresh failed:', (err as Error)?.message ?? err)
  }
}

/**
 * Boot (idempotent): every recipe whose `dish_types` is still null gets them.
 * A second boot changes nothing. Logs a summary for Cocina.
 */
export async function applyRecipeDishTypes(db: Db): Promise<number> {
  const rows = await db.select({ id: recipes.id, name: recipes.name, tags: recipes.tags }).from(recipes).where(isNull(recipes.dishTypes))
  if (!rows.length) return 0
  const lines = await ingredientLines(db, rows.map((r: { id: string }) => r.id))
  let typed = 0
  for (const r of rows) {
    const types = dishTypesOf({ name: r.name, tags: r.tags, ingredients: lines.get(r.id) ?? [] })
    if (types.length) typed++
    await db.update(recipes).set({ dishTypes: types }).where(eq(recipes.id, r.id))
  }
  console.log(`[dish-types] ${rows.length} recetas con su tipo de plato (${typed} con al menos uno)`)
  return rows.length
}
