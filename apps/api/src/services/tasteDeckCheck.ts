/**
 * PRO-283: does every row of «Afina tu menú»'s starter deck
 * (`TASTE_STARTER_DECK`) point to a recipe of a given catalogue, and to one a
 * vegetarian household can see? Pure: `scripts/checkTasteDeck.ts` feeds it the
 * public catalogue of an API (staging, a copy of production) and prints the
 * list the Taller pastes in its log; `taste.test.ts` runs it on fixtures.
 *
 * Same name matching as `starterDeck` (accents and case ignored) and same
 * vegetarian test as the deck's own filter (`breaksTasteRules` →
 * `violatesRestrictions` with «vegetariano»: the recipe's name counts as one
 * more ingredient).
 */
import { TASTE_STARTER_DECK } from '@ona/shared'
import { compileRestrictions, normalizeText, violatesRestrictions, type RestrictableRecipe } from './dietaryRestrictions.js'

export type DeckCatalogRecipe = { name: string } & Partial<Omit<RestrictableRecipe, 'name'>>

export interface DeckNameCheck {
  name: string
  exists: boolean
  /** Null when it doesn't exist or its ingredients weren't given. */
  vegetarian: boolean | null
}

export interface DeckRowCheck {
  covers: string
  names: DeckNameCheck[]
  /** The card most households get (first name that exists and no earlier row took). */
  card: string | null
  /** The card a vegetarian household gets (first vegetarian that exists). */
  vegetarianCard: string | null
}

const VEGETARIAN = compileRestrictions(['vegetariano'])

/** Pure: a catalogue recipe a vegetarian household never sees in the deck. */
export function breaksVegetarian(r: DeckCatalogRecipe): boolean | null {
  if (!r.ingredients) return null
  return violatesRestrictions({ ...r, ingredients: [...r.ingredients, { ingredientName: r.name }] } as RestrictableRecipe, VEGETARIAN)
}

export function checkStarterDeck(
  catalog: readonly DeckCatalogRecipe[],
  deck: ReadonlyArray<{ covers: string; names: readonly string[] }> = TASTE_STARTER_DECK,
): { rows: DeckRowCheck[]; ok: boolean; vegetarianOk: boolean } {
  const byName = new Map<string, DeckCatalogRecipe>()
  for (const r of catalog) if (!byName.has(normalizeText(r.name))) byName.set(normalizeText(r.name), r)
  // Like `starterDeck`, a recipe taken by an earlier row is skipped.
  const taken = new Set<string>()
  const takenVeg = new Set<string>()
  const rows = deck.map((row) => {
    const names = row.names.map((name) => {
      const r = byName.get(normalizeText(name))
      const broken = r ? breaksVegetarian(r) : null
      return { name, exists: !!r, vegetarian: broken === null ? null : !broken }
    })
    const card = names.find((n) => n.exists && !taken.has(normalizeText(n.name)))?.name ?? null
    const vegetarianCard = names.find((n) => n.exists && n.vegetarian && !takenVeg.has(normalizeText(n.name)))?.name ?? null
    if (card) taken.add(normalizeText(card))
    if (vegetarianCard) takenVeg.add(normalizeText(vegetarianCard))
    return { covers: row.covers, names, card, vegetarianCard }
  })
  return { rows, ok: rows.every((r) => r.card), vegetarianOk: rows.every((r) => r.vegetarianCard) }
}

/** Pure: the list as the Taller pastes it in its log. */
export function formatDeckCheck(result: ReturnType<typeof checkStarterDeck>, source: string): string {
  const lines = [`Mazo de «Afina tu menú» contra ${source}`]
  for (const r of result.rows) {
    lines.push(`- ${r.covers}: carta «${r.card ?? '—'}» · vegetariano «${r.vegetarianCard ?? '—'}»${r.card ? '' : '  ← FALLA: ningún nombre existe'}${r.vegetarianCard ? '' : '  ← sin carta vegetariana'}`)
    for (const n of r.names) {
      lines.push(`    ${n.exists ? 'existe   ' : 'NO existe'} ${n.name}${n.vegetarian === true ? ' (vegetariana)' : ''}`)
    }
  }
  lines.push(result.ok ? 'OK: todas las filas tienen al menos un nombre que existe.' : 'FALLA: hay filas sin ningún nombre que exista.')
  lines.push(result.vegetarianOk ? 'OK: un hogar vegetariano tiene carta en cada fila.' : 'FALLA: hay filas sin carta para un hogar vegetariano.')
  return lines.join('\n')
}
