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
 * catalogue names (accents and case ignored); the first one found wins, so
 * production, staging and the seeded CI catalogue all get a full deck. A row
 * with no match is filled by the variety order. Change the deck here.
 */
export const TASTE_STARTER_DECK: ReadonlyArray<{ covers: string; names: readonly string[] }> = [
  { covers: 'cuchara', names: ['Lentejas estofadas', 'Lentejas guisadas'] },
  { covers: 'pescado', names: ['Bacalao con tomate', 'Dorada a la marsellesa', 'Lubina'] },
  { covers: 'carne', names: ['Carrilleras de ternera con vino tinto', 'Costillas a la riojana', 'Ternera a la jardinera'] },
  { covers: 'verdura protagonista', names: ['Coliflor gratinada', 'Tian de verduras', 'Judías verdes rehogadas'] },
  { covers: 'horno', names: ['Salmón al horno con patatas', 'Salmon al horno con brocoli', 'Arroz al horno'] },
  { covers: 'rápido', names: ['Huevos al plato', 'Pollo a la plancha con brócoli', 'Revuelto de espinacas y atún'] },
  { covers: 'frito', names: ['Boquerones fritos', 'Alitas de pollo', 'Migas', 'Albóndigas en salsa española'] },
  { covers: 'largo', names: ['Cocido madrileño', 'Cocido N'] },
  { covers: 'algo de fuera', names: ['Ramen casero', 'Ramen', 'Ceviche', 'Curry de berenjena'] },
  { covers: 'algo de niños', names: ['Pizza de colores con verduras', 'Pizza', 'Fajitas de pollo'] },
]

/** Cards per batch; the next batch is requested in the background at card 5. */
export const TASTE_BATCH_SIZE = 10
export const TASTE_PREFETCH_AT = 5
/** «¿Qué es lo que no?» opens with the first «No para mí» and then every this many. */
export const TASTE_WHY_EVERY = 2
/** «No para mí» in a row of one protein group before the session stops showing it. */
export const TASTE_PROTEIN_STREAK = 3
