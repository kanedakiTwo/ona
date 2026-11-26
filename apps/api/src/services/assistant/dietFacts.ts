/**
 * PRO-201 · what a household doesn't eat by diet is a restriction, not a
 * taste. Mimo used to write «vegetariano» as dislikes (carne, pescado, pollo…)
 * and «cocina siempre sin alcohol» as a free note, so «Lo que recuerdo de ti»
 * showed «Restricciones · Añadir» next to «Cosas que no le gustan» and «Tu
 * ficha» said «No te gusta… · Lo he deducido» about what they had said. The
 * menu then read a note it doesn't understand (riñones al jerez for a home
 * that cooks without alcohol, 2026-10-16).
 *
 * `divertDietFacts` takes the diet out of `dislikes` and `notes` and adds it
 * to `restrictions`, in the words the menu compiles
 * (services/dietaryRestrictions.ts). Fixed patterns, anchored: an item or a
 * note that is only the diet («vegetariano», «sin alcohol», «en casa no
 * comemos cerdo»). «No me gusta el cerdo» is a taste and stays a dislike
 * («cerdo» alone); a note about someone else («su hija es vegetariana») stays
 * a note.
 */
import { normalizeText } from '../dietaryRestrictions.js'

export interface DietFactInput {
  key: string
  value: unknown
  confidence?: number
  remove?: string[]
  replace?: boolean
}

/** Who says it, at the start of the item: «en casa», «cocina siempre», «somos»… */
const LEAD = String.raw`^(?:(?:en casa|aqui|nosotros|nosotras|yo)\s+)?(?:(?:cocinar?|cocinamos|cocino|comemos|como|somos|soy)\s+)?(?:(?:siempre|todo|toda la comida)\s+)?`

const DIETS: Array<[RegExp, string]> = [
  [new RegExp(`${LEAD}(?:dieta\\s+)?vegan[oa]s?$`), 'vegano'],
  [new RegExp(`${LEAD}(?:dieta\\s+)?vegetarian[oa]s?$`), 'vegetariano'],
  [new RegExp(`${LEAD}(?:sin|nada de|no comemos|no como|ni) carne ni pescado$`), 'vegetariano'],
  [new RegExp(`${LEAD}(?:sin|nada de|no usamos|no bebemos|no tomamos|no ponemos) alcohol$`), 'sin alcohol'],
  [/^alcohol$/, 'sin alcohol'],
  [new RegExp(`${LEAD}(?:sin|nada de|no comemos|no como) cerdo$`), 'sin cerdo'],
  [new RegExp(`${LEAD}(?:dieta\\s+)?halal$`), 'halal'],
  [new RegExp(`${LEAD}sin gluten$`), 'sin gluten'],
  [new RegExp(`${LEAD}sin lactosa$`), 'sin lactosa'],
]

/** The restriction an item or a note says, or null when it is something else. */
export function dietRestrictionOf(text: string): string | null {
  const t = normalizeText(text).replace(/[.!¡]+$/g, '').trim()
  if (!t) return null
  for (const [re, diet] of DIETS) if (re.test(t)) return diet
  return null
}

/**
 * The facts with the diet moved out of `dislikes` and `notes` into
 * `restrictions` (added to the one in the batch, or a new one). `diverted`
 * lists the restrictions that moved; empty → the facts are the same.
 */
export function divertDietFacts<F extends DietFactInput>(facts: readonly F[]): { facts: F[]; diverted: string[] } {
  const diverted: string[] = []
  const out: F[] = []
  for (const f of facts) {
    if ((f.key !== 'dislikes' && f.key !== 'notes') || !Array.isArray(f.value)) {
      out.push(f)
      continue
    }
    const kept: unknown[] = []
    for (const item of f.value) {
      const diet = typeof item === 'string' ? dietRestrictionOf(item) : null
      if (diet) {
        if (!diverted.includes(diet)) diverted.push(diet)
      } else kept.push(item)
    }
    if (kept.length === f.value.length) out.push(f)
    else if (kept.length > 0 || f.replace || (f.remove?.length ?? 0) > 0) out.push({ ...f, value: kept })
  }
  if (diverted.length === 0) return { facts: [...facts], diverted }
  const at = out.findIndex((f) => f.key === 'restrictions')
  if (at >= 0) {
    const list = Array.isArray(out[at].value) ? (out[at].value as unknown[]) : [out[at].value]
    out[at] = { ...out[at], value: [...list, ...diverted.filter((d) => !list.includes(d))] }
  } else {
    out.push({ key: 'restrictions', value: diverted, confidence: 1 } as F)
  }
  return { facts: out, diverted }
}
