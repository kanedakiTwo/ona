/**
 * «Afina tu menú» (PRO-146, specs/taste.md): recipes shown one by one, the
 * user says «Me encanta» / «Me apetece» / «No para mí» or skips it. Each
 * answer is a verdict (`recipe_verdicts`, one per user and recipe, the last
 * one wins) that the menu generator reads.
 */
import { z } from 'zod'

export const TASTE_VERDICTS = ['love', 'like', 'nope', 'skip'] as const
export type TasteVerdict = (typeof TASTE_VERDICTS)[number]

/** Why a recipe is «No para mí» (the «¿Qué es lo que no?» sheet). */
export const TASTE_REASON_KINDS = ['ingredient', 'dish', 'long', 'other', 'none'] as const
export type TasteReasonKind = (typeof TASTE_REASON_KINDS)[number]

export const tasteReasonSchema = z.object({
  kind: z.enum(TASTE_REASON_KINDS),
  /** The ingredient picked («cilantro») or the free text («no tengo horno»). */
  text: z.string().trim().min(1).max(280).optional(),
})
export type TasteReason = z.infer<typeof tasteReasonSchema>

export const tasteVerdictSchema = z.object({
  recipeId: z.string().uuid(),
  verdict: z.enum(TASTE_VERDICTS),
  reason: tasteReasonSchema.optional(),
})
export type TasteVerdictInput = z.infer<typeof tasteVerdictSchema>

/** Broad protein groups the deck adapts on (3 «No para mí» in a row → stop showing it). */
export const TASTE_PROTEIN_GROUPS = ['carne', 'pescado'] as const
export type TasteProteinGroup = (typeof TASTE_PROTEIN_GROUPS)[number]

/** One card of the deck, as `GET /taste/next` returns it. */
export interface TasteCard {
  recipeId: string
  name: string
  imageUrl: string | null
  /** «Cuchara · 28 min» */
  meta: string
  /** Up to 3 main ingredients with article («el cilantro»), basics never included. */
  mainIngredients: Array<{ name: string; label: string }>
  /** Protein group, when the recipe has meat or fish (session adaptation). */
  protein: TasteProteinGroup | null
}

export interface TasteNextResponse {
  cards: TasteCard[]
  /** Where this batch came from: the starter deck, Claude's pick or the variety fallback. */
  source: 'starter' | 'ai' | 'variety'
  rated: number
  total: number
}

export interface TasteStatus {
  /** Recipes with a verdict other than «skip». */
  rated: number
  /** Catalogue recipes the user can rate. */
  total: number
  /** Full-screen «Novedad: afina tu menú en un minuto» (once, for accounts that onboarded without it). */
  showIntro: boolean
  /** «Afina tu menú en un minuto» card above the menu (after «Ahora no» on the intro). */
  showCard: boolean
  /** The sign-up step was already shown (never shown twice, e.g. after a reload). */
  offeredInOnboarding: boolean
  /** Protein groups the deck stopped showing after 3 «No para mí» in a row (to confirm in the profile). */
  flags: TasteProteinGroup[]
}

export interface TasteVerdictRow {
  recipeId: string
  name: string
  imageUrl: string | null
  verdict: TasteVerdict
  reason: TasteReason | null
  updatedAt: string
}

/**
 * The first ten cards anyone sees («mazo de arranque»): chosen to learn the
 * most with few cards — one per row below, in this order. Each entry lists
 * catalogue names (accents and case ignored); the first one found wins (a
 * recipe already taken by an earlier row is skipped), so production, staging
 * and the seeded CI catalogue all get a full deck. A row with no match is
 * filled by the variety order. Change the deck here.
 *
 * PRO-283 (Cocina, COC-10, 2026-10-20): only names of the published
 * catalogue (`scripts/checkTasteDeck.ts` checks them against an API); «largo»
 * is not the cocido while it is incomplete (COC-15), so carrilleras and fabada
 * go first; the last name of each row is vegetarian, so a vegetarian
 * household (whose catalogue loses meat and fish) still gets a card in every
 * row; «Macarrones de casa» and «Pollo empanado» before the fajitas. Names
 * that come back with Cocina's next batch (`cocina-01`: «Huevos al plato…»,
 * «Lubina a la plancha…») go in when they're published.
 */
export const TASTE_STARTER_DECK: ReadonlyArray<{ covers: string; names: readonly string[] }> = [
  { covers: 'cuchara', names: ['Lentejas estofadas', 'Lentejas guisadas'] },
  { covers: 'pescado', names: ['Bacalao con tomate', 'Dorada a la marsellesa', 'Tortilla de patatas'] },
  { covers: 'carne', names: ['Carrilleras de ternera con vino tinto', 'Costillas a la riojana', 'Ternera a la jardinera', 'Berenjenas con queso'] },
  { covers: 'verdura protagonista', names: ['Coliflor gratinada', 'Judías verdes rehogadas'] },
  { covers: 'horno', names: ['Salmón al horno con patatas', 'Arroz al horno', 'Lasaña de verduras'] },
  { covers: 'rápido', names: ['Pollo a la plancha con brócoli', 'Revuelto de espinacas y atún', 'Revuelto de calabacín'] },
  { covers: 'frito', names: ['Boquerones fritos', 'Migas', 'Albóndigas en salsa española', 'Falafel'] },
  { covers: 'largo', names: ['Carrilleras de ternera con vino tinto', 'Fabada asturiana', 'Cocido madrileño', 'Garbanzos con espinacas'] },
  { covers: 'algo de fuera', names: ['Ramen casero', 'Ceviche', 'Curry de berenjena'] },
  { covers: 'algo de niños', names: ['Pizza de colores con verduras', 'Macarrones de casa', 'Pollo empanado', 'Fajitas de pollo'] },
]

/** Cards per batch; the next batch is requested in the background at card 5. */
export const TASTE_BATCH_SIZE = 10
export const TASTE_PREFETCH_AT = 5
/** «¿Qué es lo que no?» opens with the first «No para mí» and then every this many. */
export const TASTE_WHY_EVERY = 2
/** «No para mí» in a row of one protein group before the session stops showing it. */
export const TASTE_PROTEIN_STREAK = 3
