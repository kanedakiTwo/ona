/**
 * PRO-283: checks «Afina tu menú»'s starter deck (`TASTE_STARTER_DECK`)
 * against the public catalogue of a running API. Read only: anonymous GETs to
 * `/recipes` (published catalogue recipes, 100 per page) and `/recipes/:id`
 * for the deck's names (to tell which are vegetarian). No token, no DB.
 *
 *   pnpm --filter @ona/api exec tsx scripts/checkTasteDeck.ts [--api=https://ona-api-staging.up.railway.app]
 *
 * Prints every name of every row with «existe» / «NO existe», the card a
 * household gets and the one a vegetarian household gets; exits 1 when a row
 * has no name that exists, or no vegetarian card (`services/tasteDeckCheck.ts`).
 */
import { TASTE_STARTER_DECK } from '@ona/shared'
import { normalizeText } from '../src/services/dietaryRestrictions.js'
import { checkStarterDeck, formatDeckCheck, type DeckCatalogRecipe } from '../src/services/tasteDeckCheck.js'

const arg = process.argv.find((a) => a.startsWith('--api='))
const API = (arg ? arg.slice('--api='.length) : 'https://ona-api-staging.up.railway.app').replace(/\/+$/, '')

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(30_000) })
  if (!r.ok) throw new Error(`GET ${path} → HTTP ${r.status}`)
  return (await r.json()) as T
}

type ListRow = { id: string; name: string; authorId: string | null }
type Detail = { name: string; allergens?: string[] | null; ingredients?: Array<{ ingredientName: string; allergenTags?: string[] | null; containsTags?: string[] | null }> }

async function main() {
  const list: ListRow[] = []
  for (let page = 1; page <= 50; page++) {
    const rows = await get<ListRow[]>(`/recipes?perPage=100&page=${page}`)
    list.push(...rows.filter((r) => r.authorId === null))
    if (rows.length < 100) break
  }
  const wanted = new Set(TASTE_STARTER_DECK.flatMap((r) => r.names).map(normalizeText))
  const catalog: DeckCatalogRecipe[] = []
  for (const r of list) {
    if (!wanted.has(normalizeText(r.name))) {
      catalog.push({ name: r.name })
      continue
    }
    const d = await get<Detail>(`/recipes/${r.id}`)
    catalog.push({
      name: d.name,
      allergens: d.allergens ?? [],
      ingredients: (d.ingredients ?? []).map((i) => ({ ingredientName: i.ingredientName, allergenTags: i.allergenTags ?? null, containsTags: i.containsTags ?? null })),
    })
  }
  const result = checkStarterDeck(catalog)
  console.log(formatDeckCheck(result, `${API} (${list.length} recetas publicadas del catálogo)`))
  if (!result.ok || !result.vegetarianOk) process.exit(1)
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(2)
})
