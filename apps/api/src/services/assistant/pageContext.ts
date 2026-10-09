/**
 * What the user is looking at when they talk to Mimo from the floating
 * companion (D-023), so "esta receta" or "este menú" mean something. The web
 * sends the path; the note travels with the user's message, never shown.
 */

export type PageKind = 'recipe' | 'cooking' | 'menu' | 'shopping' | 'catalogue' | 'profile' | 'other'

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}'

/** Pure: path → what kind of page (and which recipe). */
export function describePage(path: string | null | undefined): { kind: PageKind; recipeId?: string } {
  const p = (path ?? '').split(/[?#]/)[0]
  let m = p.match(new RegExp(`^/recipes/(${UUID})/cook/?$`, 'i'))
  if (m) return { kind: 'cooking', recipeId: m[1] }
  m = p.match(new RegExp(`^/recipes/(${UUID})(?:/edit)?/?$`, 'i'))
  if (m) return { kind: 'recipe', recipeId: m[1] }
  if (/^\/menu(\/|$)/.test(p)) return { kind: 'menu' }
  if (/^\/(shopping|compra)(\/|$)/.test(p)) return { kind: 'shopping' }
  if (/^\/(recipes|cookbooks)(\/|$)/.test(p)) return { kind: 'catalogue' }
  if (/^\/profile(\/|$)/.test(p)) return { kind: 'profile' }
  return { kind: 'other' }
}

/** Pure: the note added to the message, or null when the page says nothing useful. */
export function pageContextNote(page: { kind: PageKind; recipeId?: string }, recipeName: string | null): string | null {
  // A recipe the user can't see (or that doesn't exist) adds nothing.
  if (page.recipeId && !recipeName) return null
  const recipe = page.recipeId ? `la receta «${recipeName}» (id ${page.recipeId})` : ''
  switch (page.kind) {
    case 'cooking':
      return `Está cocinando ${recipe} en el modo cocina: «siguiente», «temporizador» o «cuánto falta» se refieren a esa receta.`
    case 'recipe':
      return `Está viendo ${recipe}: «esta receta» es esa.`
    case 'menu':
      return 'Está viendo su menú de la semana.'
    case 'shopping':
      return 'Está viendo su lista de la compra y los pedidos a tiendas.'
    case 'catalogue':
      return 'Está en el catálogo de recetas.'
    case 'profile':
      return 'Está en su perfil.'
    default:
      return null
  }
}

/** Pure: the user's message as the model receives it. */
export function withPageContext(message: string, note: string | null): string {
  return note ? `${message}\n\n[Pantalla actual (no lo menciones): ${note}]` : message
}
