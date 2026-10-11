import { BRAND_NAME } from '../constants/brand.js'

/**
 * What the app puts in the share sheet ("pásalo"). A share should be able to
 * bring another household: the link must open without an account and say
 * what Mimoia is. Pure, so both the web and the tests use it.
 */
export interface SharePayload {
  title: string
  text: string
  url?: string
}

interface ShareableRecipe {
  id: string
  name: string
  /** null = Mimoia catalogue (has a public page); otherwise a private recipe. */
  authorId: string | null
  ingredients?: Array<{ name?: string | null; ingredientName?: string | null; quantity?: number | null; unit?: string | null }>
}

const strip = (origin: string) => origin.replace(/\/+$/, '')

export function recipeSharePayload(recipe: ShareableRecipe, origin: string): SharePayload {
  const base = strip(origin)
  if (recipe.authorId == null) {
    return {
      title: recipe.name,
      text: `${recipe.name} — receta de ${BRAND_NAME}, el planificador de menús semanales.`,
      url: `${base}/recipes-ona/${recipe.id}?ref=receta`,
    }
  }
  // Private recipes have no public page: share the recipe itself as text.
  const lines = (recipe.ingredients ?? [])
    .map((i) => {
      const name = i.ingredientName ?? i.name ?? ''
      if (!name) return null
      const qty = i.quantity && i.unit && !['al_gusto', 'pizca'].includes(i.unit) ? ` (${i.quantity} ${i.unit})` : ''
      return `- ${name}${qty}`
    })
    .filter((l): l is string => !!l)
  return {
    title: recipe.name,
    text: `${recipe.name}${lines.length ? `\n\nIngredientes:\n${lines.join('\n')}` : ''}\n\nLa organizo con ${BRAND_NAME}, mi menú semanal: ${base}/?ref=receta`,
  }
}

export function withOnaFooter(text: string, origin: string, ref: string): string {
  return `${text.trimEnd()}\n\n— Hecho con ${BRAND_NAME}, el menú semanal que hace la lista de la compra: ${strip(origin)}/?ref=${ref}`
}

const DAY_NAMES = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
const MEAL_NAMES: Record<string, string> = { breakfast: 'desayuno', lunch: 'comida', snack: 'merienda', dinner: 'cena' }
const MEAL_ORDER = ['breakfast', 'lunch', 'snack', 'dinner']

/** "Mi menú de la semana" as plain text, one line per meal, + the Mimoia footer. */
export function menuShareText(
  days: ReadonlyArray<Record<string, { dishes?: Array<{ kind?: string; recipeName?: string; text?: string }> } | undefined>>,
  origin: string,
): string {
  const out: string[] = ['Mi menú de la semana', '']
  days.forEach((day, i) => {
    const meals = MEAL_ORDER.filter((m) => day?.[m]?.dishes?.length)
    if (meals.length === 0) return
    out.push(`*${DAY_NAMES[i] ?? `Día ${i + 1}`}*`)
    for (const m of meals) {
      const names = (day![m]!.dishes ?? [])
        .map((d) => (d.kind === 'note' ? d.text : d.recipeName))
        .filter((n): n is string => !!n)
      if (names.length) out.push(`- ${MEAL_NAMES[m] ?? m}: ${names.join(' · ')}`)
    }
  })
  return withOnaFooter(out.join('\n'), origin, 'menu')
}
