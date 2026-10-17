/**
 * Ingredients whose weight doesn't change a recipe's nutrition: salt, water,
 * spices and dried/fresh herbs used to season, and anything «al gusto».
 *
 * PRO-176: when the aggregator has to skip an ingredient (no unit weight, no
 * density, no catalogue row), the recipe is marked «nutrición incompleta»
 * unless every skipped line is one of these.
 *
 * Spec: ../../../../../specs/nutrition.md ("Incomplete nutrition")
 */

function normalize(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}+/gu, '')
    .toLowerCase()
    .trim()
}

/** Whole names, or the first words of the name («sal gorda», «pimienta negra molida»). */
const NEGLIGIBLE_NAMES = [
  'sal',
  'agua',
  'hielo',
  'pimienta',
  'pimenton',
  'comino',
  'oregano',
  'tomillo',
  'romero',
  'laurel',
  'hoja de laurel',
  'hojas de laurel',
  'canela',
  'nuez moscada',
  'clavo',
  'clavos',
  'clavo de olor',
  'curcuma',
  'curry',
  'curry en polvo',
  'azafran',
  'colorante',
  'cayena',
  'guindilla',
  'chile en polvo',
  'jengibre molido',
  'ajo en polvo',
  'cebolla en polvo',
  'perejil',
  'cilantro',
  'albahaca',
  'menta',
  'hierbabuena',
  'eneldo',
  'cebollino',
  'estragon',
  'salvia',
  'mejorana',
  'hierbas provenzales',
  'hierbas aromaticas',
  'especias',
  'ras el hanout',
  'garam masala',
  'cardamomo',
  'anis',
  'anis estrellado',
  'semillas de hinojo',
  'hinojo en semillas',
  'vainilla',
  'extracto de vainilla',
  'esencia de vainilla',
]

const NEGLIGIBLE_SET = new Set(NEGLIGIBLE_NAMES)
/** First words that make any name negligible («sal gorda», «pimienta negra»). */
const NEGLIGIBLE_HEADS = ['sal', 'pimienta', 'pimenton', 'comino', 'oregano', 'tomillo', 'romero', 'laurel', 'canela', 'curcuma', 'azafran', 'agua']

/** True when skipping this line doesn't make the recipe's nutrition wrong. */
export function isNegligibleForNutrition(name: string | null | undefined, note?: string | null): boolean {
  if (note && normalize(note).includes('al gusto')) return true
  if (!name) return false
  const n = normalize(name)
  if (NEGLIGIBLE_SET.has(n)) return true
  const head = n.split(/[\s,]+/)[0]
  if (!NEGLIGIBLE_HEADS.includes(head)) return false
  // «agua de coco», «sal de ajo»… stay negligible; «salsa»/«salmón» never get here (head is the whole first word).
  return true
}
