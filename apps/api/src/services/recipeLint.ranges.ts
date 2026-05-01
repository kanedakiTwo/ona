/**
 * Per-ingredient sanity ranges for lint validation.
 *
 * Each entry is keyed by the lowercase canonical ingredient name as it appears
 * in the ONA catalog. Values are the acceptable range of grams **per serving**
 * for a typical preparation. Curators can extend this file as new staples enter
 * the catalog.
 *
 * Ingredients not in this map fall back to the global ceiling below — a soft
 * cap to catch obvious typos like "10 kg of flour".
 *
 * Source of truth: specs/recipe-quality.md → "Quantity Sanity Ranges"
 */

export interface QuantityRange {
  /** Inclusive lower bound (g per serving) */
  minPerServingG: number
  /** Inclusive upper bound (g per serving) */
  maxPerServingG: number
}

export const globalCeiling = 2000

/**
 * Keys are the normalized ingredient name (lowercased, diacritics stripped).
 * The lint validator normalizes ingredient names the same way before lookup,
 * so entries here should already be in their stripped form (e.g. `salmon`,
 * not `salmón`).
 */
export const INGREDIENT_RANGES: Record<string, QuantityRange> = {
  // Carnes
  ternera: { minPerServingG: 80, maxPerServingG: 250 },
  pollo: { minPerServingG: 80, maxPerServingG: 250 },
  cerdo: { minPerServingG: 80, maxPerServingG: 250 },
  cordero: { minPerServingG: 80, maxPerServingG: 250 },
  pavo: { minPerServingG: 80, maxPerServingG: 250 },
  conejo: { minPerServingG: 80, maxPerServingG: 250 },

  // Pescados y mariscos
  pescado: { minPerServingG: 80, maxPerServingG: 250 },
  salmon: { minPerServingG: 80, maxPerServingG: 250 },
  bacalao: { minPerServingG: 80, maxPerServingG: 250 },
  atun: { minPerServingG: 80, maxPerServingG: 250 },
  merluza: { minPerServingG: 80, maxPerServingG: 250 },
  gambas: { minPerServingG: 50, maxPerServingG: 200 },
  langostinos: { minPerServingG: 50, maxPerServingG: 200 },
  mejillones: { minPerServingG: 80, maxPerServingG: 300 },

  // Huevos (≈ 50 g cada uno)
  huevo: { minPerServingG: 25, maxPerServingG: 150 },
  huevos: { minPerServingG: 25, maxPerServingG: 150 },

  // Legumbres cocidas
  garbanzos: { minPerServingG: 50, maxPerServingG: 200 },
  lentejas: { minPerServingG: 50, maxPerServingG: 200 },
  judias: { minPerServingG: 50, maxPerServingG: 200 },
  alubias: { minPerServingG: 50, maxPerServingG: 200 },

  // Granos / cereales (crudos)
  arroz: { minPerServingG: 40, maxPerServingG: 100 },
  pasta: { minPerServingG: 60, maxPerServingG: 120 },
  quinoa: { minPerServingG: 40, maxPerServingG: 100 },
  cuscus: { minPerServingG: 40, maxPerServingG: 100 },

  // Verduras
  cebolla: { minPerServingG: 30, maxPerServingG: 250 },
  zanahoria: { minPerServingG: 30, maxPerServingG: 250 },
  patata: { minPerServingG: 50, maxPerServingG: 400 },
  tomate: { minPerServingG: 30, maxPerServingG: 400 },
  pimiento: { minPerServingG: 30, maxPerServingG: 250 },
  calabacin: { minPerServingG: 30, maxPerServingG: 300 },
  berenjena: { minPerServingG: 30, maxPerServingG: 300 },
  espinaca: { minPerServingG: 20, maxPerServingG: 250 },
  espinacas: { minPerServingG: 20, maxPerServingG: 250 },
  brocoli: { minPerServingG: 30, maxPerServingG: 300 },
  coliflor: { minPerServingG: 30, maxPerServingG: 300 },
  lechuga: { minPerServingG: 20, maxPerServingG: 200 },
  ajo: { minPerServingG: 1, maxPerServingG: 20 },

  // Grasas
  'aceite de oliva': { minPerServingG: 5, maxPerServingG: 30 },
  aceite: { minPerServingG: 5, maxPerServingG: 30 },
  mantequilla: { minPerServingG: 5, maxPerServingG: 50 },

  // Cocina seca
  harina: { minPerServingG: 5, maxPerServingG: 250 },
  azucar: { minPerServingG: 1, maxPerServingG: 100 },
  sal: { minPerServingG: 0.5, maxPerServingG: 15 },
  pan: { minPerServingG: 20, maxPerServingG: 200 },

  // Lácteos
  queso: { minPerServingG: 10, maxPerServingG: 100 },
  leche: { minPerServingG: 50, maxPerServingG: 500 },
  nata: { minPerServingG: 50, maxPerServingG: 500 },
  yogur: { minPerServingG: 50, maxPerServingG: 250 },
}
