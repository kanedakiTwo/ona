/**
 * Recipes Miguel puts first in the catalogue, in this order (PRO-140,
 * 2026-10-15), after the ones more households have in favourites. Ids are
 * production's; staging and fresh databases match by name (accents and case
 * ignored), so a missing id never breaks the order. Change the list here,
 * not the sorting.
 */
export const FEATURED_RECIPES: ReadonlyArray<{ id: string; name: string }> = [
  { id: '82e6cadc-3cd3-463d-b170-7f527f56a160', name: 'Arroz con bacalao' },
  { id: '364b48fa-d920-4a82-ac3b-7150e8b3594f', name: 'Bacalao con tomate' },
  { id: '7f0093d1-40ab-416b-8cf3-ac1236fa365f', name: 'Ceviche' },
  { id: '5baa4f23-e53e-4959-87fe-cd9432f3c008', name: 'Cocido madrileño' },
  { id: '14a98e2e-4f9d-4151-bef4-b151f13236eb', name: 'Conejo confitado con ajo y romero' },
  { id: '701b0145-76a3-47fd-87cf-074b846afd21', name: 'Coliflor gratinada' },
  { id: '0bcb64d0-f244-47e9-aca5-27cd62b7dc0f', name: 'Costillas a la riojana' },
  { id: 'ae2420ae-0a84-4939-a12a-8cd1f44841b2', name: 'Crema de zanahoria con pollo, aguacate y granada' },
  { id: '4a84abe8-ab59-43f1-a7cd-b611a9c29f86', name: 'Ensalada griega' },
  { id: '4a108a5e-06c3-4859-930a-c0c208304f7e', name: 'Judías verdes rehogadas' },
  { id: 'b01c57bf-fad2-4d81-9d56-4ba60cc689be', name: 'Lentejas estofadas' },
  { id: 'aba51442-4e48-4220-9fa6-1a033e599dfd', name: 'Pisto con huevo frito a la Thermomix' },
  { id: '75e05b67-1971-45ad-928f-cf3078dc2ca1', name: 'Pizza de colores con verduras' },
  { id: '716b70d5-c7de-4c70-b09c-9cfc0e8e2963', name: 'Salmón al horno con patatas' },
  { id: '82793aa6-d47c-4292-82ce-6ff57f3ada5f', name: 'Salteado de verduras con salmón marinado' },
  { id: '6b4e52e7-e930-4951-abe8-17658d48277c', name: 'Steak tartar' },
  { id: '11e19a26-836a-433d-b2cc-378bb8b7f605', name: 'Vichyssoise' },
]

/** System recipes tagged with this internal tag are retired (PRO-140): out of the catalogue and the menu, still open by id. */
export const RETIRED_RECIPE_TAG = 'retirada'
