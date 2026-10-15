/**
 * PRO-74 — a home dish that isn't in the user's recipes nor the catalogue
 * («pizza casera», «pollo empanado») becomes a household recipe so its
 * ingredients reach the shopping list. Before, swap_meal / add_dish left it
 * as a note and the list never got its fish or its flour (test households,
 * 2026-10-11/14). The model sends a simple estimated version in `newRecipe`;
 * the recipe is saved with servings marked «Estimado» (PRO-32). If there is
 * no usable `newRecipe` or saving fails, the caller keeps the note.
 */
import { createRecipeFromParts } from '../recipeImport.js'

/** «pizza casera» → «Pizza casera» (same as appSkills' dishNoteText; kept here to avoid an import cycle). */
function dishName(name: unknown): string {
  const t = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, 120)
  return t.charAt(0).toLocaleUpperCase('es') + t.slice(1)
}

export interface NewRecipeParam {
  servings?: number
  ingredients?: Array<{ name: string; quantity?: number; unit?: string }>
  steps?: string[]
}

/** JSON-schema of the `newRecipe` tool parameter (swap_meal, add_dish). */
export const NEW_RECIPE_PROP = {
  type: 'object',
  description:
    'Solo para un plato de casa que puede no estar en sus recetas ni en el catalogo (pizza casera, pollo empanado, tortilla francesa…): una version sencilla y razonable que te inventas tu, con raciones, ingredientes con cantidades y pasos. Si el plato no existe, lo guardo como receta del hogar (raciones e ingredientes estimados) y la pongo en el menu, asi sus ingredientes salen en la lista de la compra. Si ya existe, se ignora.',
  properties: {
    servings: { type: 'number', description: 'Raciones de la receta (por defecto 2)' },
    ingredients: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          quantity: { type: 'number' },
          unit: { type: 'string', description: 'g, ml, u, cda, cdita' },
        },
        required: ['name'],
      },
    },
    steps: { type: 'array', items: { type: 'string' } },
  },
  required: ['ingredients'],
} as const

/** Creates the household recipe for `name`; null when there's nothing usable or saving fails. */
export async function createDishRecipe(
  userId: string,
  name: string,
  newRecipe: NewRecipeParam | undefined | null,
): Promise<{ id: string; name: string } | null> {
  const ingredients = (newRecipe?.ingredients ?? []).filter((i) => i && typeof i.name === 'string' && i.name.trim())
  if (ingredients.length === 0) return null
  const steps = (newRecipe?.steps ?? []).map((s) => String(s).trim()).filter(Boolean)
  try {
    const saved = await createRecipeFromParts(
      {
        name: dishName(name),
        servings: newRecipe?.servings ?? null,
        ingredients,
        steps: steps.length ? steps : ['Prepáralo como lo haces en casa.'],
      },
      userId,
      { estimated: true },
    )
    return { id: saved.recipeId, name: saved.name }
  } catch (err) {
    console.error('[assistant] createDishRecipe failed:', err)
    return null
  }
}

/** Text the tools add when they had to leave a note (no `newRecipe` or it failed). */
export const NOTE_THEN_RECIPE_HINT =
  'Para que llegue a la lista de la compra, vuelve a llamar a esta herramienta con el mismo recipeName y newRecipe (una version sencilla estimada: raciones, ingredientes con cantidades y pasos): creare la receta del hogar y sustituira la nota. No preguntes antes.'
