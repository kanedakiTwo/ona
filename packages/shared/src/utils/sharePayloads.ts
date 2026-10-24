import { BRAND_NAME } from '../constants/brand.js'

/**
 * What the app puts in the share sheet ("pásalo"). A share should be able to
 * bring another household: the link must open without an account and say
 * what Mimoia is. Pure, so both the web and the tests use it.
 */
export interface SharePayload {
  title: string
  /** Absent when there is a `url`: some apps glue url + " " + text into one broken link. */
  text?: string
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

/**
 * The household's personal link in its short form (PRO-1016, D-132):
 * `https://www.mimoia.com` + code → `mimoia.com/i/<code>` (no scheme or
 * `www.`; WhatsApp and the share sheets still make it a link). `/i/<code>`
 * takes a household's code to the landing with `?invita=` (PRO-162).
 */
export function shortInviteLink(origin: string, code: string): string {
  return `${strip(origin).replace(/^https?:\/\//, '').replace(/^www\./, '')}/i/${code}`
}

/** The foot of what people forward (D-132): «Hecho con Mimo · mimoia.com/i/<code>». */
export function madeWithMimoLine(origin: string, code: string): string {
  return `Hecho con Mimo · ${shortInviteLink(origin, code)}`
}

/**
 * `inviteCode` is the sharing household's code (`GET /referrals/me`): with
 * it the share carries their invitation (D-132); without it (signed out, or
 * the code hasn't loaded yet) the share is as before.
 */
export function recipeSharePayload(recipe: ShareableRecipe, origin: string, inviteCode?: string | null): SharePayload {
  const base = strip(origin)
  if (recipe.authorId == null) {
    // The recipe page itself (it opens without an account). Title + link
    // only: the link's preview (app/recipes/[id]/layout.tsx) says what Mimoia
    // is, and a `text` next to the `url` gets glued into the link by some
    // receiving apps (`…?ref=receta%20Pollo%20a%20la%20plancha…`). So the
    // invitation rides in the link (`&invita=`): the page shows the foot and
    // a sign-up from it counts for the household.
    return {
      title: recipe.name,
      url: `${base}/recipes/${recipe.id}?ref=receta${inviteCode ? `&invita=${inviteCode}` : ''}`,
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
    text: `${recipe.name}${lines.length ? `\n\nIngredientes:\n${lines.join('\n')}` : ''}\n\n${
      inviteCode ? madeWithMimoLine(origin, inviteCode) : `La organizo con ${BRAND_NAME}, mi menú semanal: ${base}/?ref=receta`
    }`,
  }
}

/** With the household's `inviteCode` the foot is its invitation (D-132); without it, the generic Mimoia link. */
export function withOnaFooter(text: string, origin: string, ref: string, inviteCode?: string | null): string {
  if (inviteCode) return `${text.trimEnd()}\n\n${madeWithMimoLine(origin, inviteCode)}`
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
