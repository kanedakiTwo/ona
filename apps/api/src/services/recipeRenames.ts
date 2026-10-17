/**
 * Catalogue recipes renamed on 2026-10-15 (PRO-140, Miguel): no «Gipsy» in
 * names and accents put back. Production and staging were renamed in a
 * session; the seed uses the new names. `[old, new]`: the seed renames an
 * old row before upserting (so a re-seed doesn't duplicate it) and the
 * boot-time source-link backfill still finds the original link under the old
 * Notion name.
 */
export const CATALOG_RENAMES: ReadonlyArray<readonly [oldName: string, newName: string]> = [
  ['Albondigas gipsy', 'Albóndigas express'],
  ['Hamburguesa perfecta de Gipsy Chef', 'Hamburguesa casera'],
  ['Vegan butter chicken', 'Curry cremoso de tofu'],
  ['Vegan butter chicken (con tofu)', 'Curry cremoso de tofu'],
  ['Fidegua gipsy', 'Fideuá'],
  ['Pastela vegetariana Gipsy', 'Pastela vegetariana'],
  ['Tacos gipsy', 'Tacos caseros'],
  ['Pollo agridulce gipsy', 'Pollo agridulce'],
  ['Albondigas en salsa espanola', 'Albóndigas en salsa española'],
  ['Ensalada de atun', 'Ensalada de atún'],
  ['Cocido madrileno', 'Cocido madrileño'],
  ['Crema de calabacin', 'Crema de calabacín'],
  ['Guisantes lagrima', 'Guisantes lágrima'],
  ['Judias verdes rehogadas', 'Judías verdes rehogadas'],
  ['Pollo a la plancha con brocoli', 'Pollo a la plancha con brócoli'],
  ['Porridge de avena con platano', 'Porridge de avena con plátano'],
  ['Revuelto de calabacin', 'Revuelto de calabacín'],
  ['Salmon al horno con patatas', 'Salmón al horno con patatas'],
  ['Sandwich vegetal', 'Sándwich vegetal'],
  ['Steak Tartar', 'Steak tartar'],
]

/** New name → the old names it had (for matching data keyed by the old one). */
export function oldNamesOf(newName: string): string[] {
  return CATALOG_RENAMES.filter(([, n]) => n === newName).map(([o]) => o)
}
