/**
 * PRO-198 — what a compound ingredient contains.
 *
 * A household with «sin cerdo» got «Ropa vieja del cocido», whose ingredient
 * is «Sobras del cocido madrileño»: no word of `PORK_TERMS` is in that name,
 * so the diet filter (which reads ingredient names) let it through. A
 * compound ingredient (leftovers, stocks, generic cured meats…) now carries
 * what it is made of in `ingredients.contains_tags` («cerdo», «ternera»,
 * «pollo», «gluten»…), and `violatesRestrictions` reads those tags like
 * extra words of the name.
 *
 *   - `CONTAINS_TAGS`: the allowed tags (meats, alcohol, the EU allergens and
 *     «vegetal» = reviewed, nothing animal).
 *   - `isCompoundIngredientName`: the names the audit looks at.
 *   - `compoundIngredientsWithoutTags`: the audit (pure) — compounds with no
 *     contains tag, for Cocina to label (`scripts/auditCompoundIngredients.ts`,
 *     and `GET /admin/ingredient-gaps` → `compoundWithoutTags`).
 *   - `applyCompoundIngredientTags`: idempotent data fix run after
 *     `db:migrate` — the obvious compounds of the catalogue get their tags,
 *     only while they have none (a label Cocina sets is never overwritten).
 *
 * Spec: specs/menus.md («Restrictions & allergies»), specs/nutrition.md.
 */
import { sql } from 'drizzle-orm'
import { ingredients } from '../db/schema.js'
import { ALLERGEN_TAGS, nameHasTerm } from './nutrition/allergens.js'

const normalize = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()

/** Tags a compound ingredient can carry. */
export const CONTAINS_TAGS = [
  'cerdo',
  'ternera',
  'pollo',
  'cordero',
  'carne',
  'alcohol',
  'vegetal',
  ...ALLERGEN_TAGS,
] as const

export type ContainsTag = (typeof CONTAINS_TAGS)[number]

/**
 * Words that make an ingredient compound (made of other foods whose name it
 * doesn't say): leftovers, stocks, the dish «cocido», generic cured meats.
 * Same whole-word matcher as the diet terms; ^ = start of the name.
 */
const COMPOUND_TERMS = [
  '^sobra', 'sobras de', 'sobras del', 'caldo', 'fondo de', 'fumet', '^cocido', 'del cocido', 'de cocido',
  'embutido', 'fiambre', 'salchicha', 'pate', 'foie', 'relleno', 'pastilla de caldo', 'cubito',
]

export function isCompoundIngredientName(name: string): boolean {
  const n = normalize(name)
  return COMPOUND_TERMS.some((t) => nameHasTerm(n, t))
}

/**
 * The compounds of the catalogue whose contents are obvious (Producto,
 * PRO-198). Prudent like PRO-61: a cocido always carries pork (tocino,
 * chorizo, hueso de jamón); generic sausages and the spreadable «foie gras»
 * sold in Spain are usually pork. Anything else is labelled by Cocina from
 * the audit.
 */
export const KNOWN_COMPOUND_TAGS: Readonly<Record<string, readonly ContainsTag[]>> = {
  'sobras del cocido madrileno': ['cerdo', 'ternera', 'pollo', 'gluten'],
  'sobras del cocido': ['cerdo', 'ternera', 'pollo', 'gluten'],
  'sobras de cocido': ['cerdo', 'ternera', 'pollo', 'gluten'],
  'caldo de cocido': ['cerdo', 'ternera', 'pollo'],
  'caldo del cocido': ['cerdo', 'ternera', 'pollo'],
  'caldo de pollo': ['pollo'],
  'caldo de gallina': ['pollo'],
  'caldo de pescado': ['pescado'],
  'fumet': ['pescado'],
  'fumet de pescado': ['pescado'],
  'caldo de verduras': ['vegetal'],
  'embutido': ['cerdo'],
  'embutidos': ['cerdo'],
  'embutidos variados': ['cerdo'],
  'salchichas frescas': ['cerdo'],
  'salchichas': ['cerdo'],
  'salchicha': ['cerdo'],
  'foie gras de untar': ['cerdo'],
}

/** The tags `KNOWN_COMPOUND_TAGS` gives this name, or null. */
export function knownCompoundTags(name: string): readonly ContainsTag[] | null {
  return KNOWN_COMPOUND_TAGS[normalize(name)] ?? null
}

export interface AuditableIngredient {
  id?: string
  name: string
  containsTags?: readonly string[] | null
  /** How many recipes use it (optional; for ordering the report). */
  recipeCount?: number
}

/** Compound ingredients with no contains tag, most used first. */
export function compoundIngredientsWithoutTags<T extends AuditableIngredient>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => (r.containsTags ?? []).length === 0 && isCompoundIngredientName(r.name))
    .sort((a, b) => (b.recipeCount ?? 0) - (a.recipeCount ?? 0) || a.name.localeCompare(b.name, 'es'))
}

type Db = typeof import('../db/connection.js').db

export interface CompoundTagsResult {
  set: string[]
}

/** Idempotent: labels the known compounds that still have no contains tag. */
export async function applyCompoundIngredientTags(
  db: Db,
  log: (line: string) => void = console.log,
): Promise<CompoundTagsResult> {
  const rows = await db
    .select({ id: ingredients.id, name: ingredients.name, containsTags: ingredients.containsTags })
    .from(ingredients)
  const set: string[] = []
  for (const r of rows) {
    if ((r.containsTags ?? []).length > 0) continue
    const tags = knownCompoundTags(r.name)
    if (!tags) continue
    await db
      .update(ingredients)
      .set({ containsTags: [...tags] })
      .where(sql`${ingredients.id} = ${r.id} AND cardinality(coalesce(${ingredients.containsTags}, '{}')) = 0`)
    set.push(`«${r.name}» ${tags.join(', ')}`)
  }
  log(set.length ? `[compound-tags] ${set.join('; ')}` : '[compound-tags] nada que cambiar')
  return { set }
}

