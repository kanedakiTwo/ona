/**
 * Kitchen equipment vocabulary (PRO-1140). Two closed lists:
 *
 * - **Appliances** (`KITCHEN_APPLIANCES`): what a kitchen may or may not
 *   have — oven, air fryer, kitchen robot… The menu only takes a recipe out
 *   when it needs an appliance the household doesn't have.
 * - **Basic utensils** (`BASIC_UTENSILS`): pans, pots, bowls, knives… Every
 *   household is assumed to have them; they never filter a recipe.
 *
 * Anything that is neither (a word nobody has listed yet) doesn't filter
 * either: `unknownEquipmentCounts` gathers those for Cocina.
 *
 * Every entry is folded (lowercase, no accents). A recipe line matches a
 * name when it is that name or starts with it plus a space («horno
 * precalentado», «sartén grande», «cazuela de barro»). Appliances are
 * checked first, longest name first, so «olla express» is never «olla».
 */

/** Appliance canonical name → the folded ways recipes and households write it. */
export const KITCHEN_APPLIANCES: Readonly<Record<string, readonly string[]>> = {
  horno: ['horno', 'horno electrico', 'horno de gas'],
  'freidora de aire': ['freidora de aire', 'freidora sin aceite', 'air fryer', 'airfryer'],
  freidora: ['freidora', 'freidora electrica'],
  'robot de cocina': ['robot de cocina', 'thermomix', 'mambo', 'monsieur cuisine', 'robot de cocina multifuncion'],
  microondas: ['microondas', 'micro'],
  'olla express': ['olla express', 'olla expres', 'olla rapida', 'olla a presion', 'olla de presion'],
  'olla de coccion lenta': ['olla de coccion lenta', 'slow cooker', 'crockpot'],
  batidora: ['batidora', 'batidora de mano', 'batidora de brazo', 'batidora de vaso', 'minipimer', 'turmix', 'licuadora'],
  'batidora de varillas': ['batidora de varillas', 'varillas electricas', 'amasadora', 'robot de reposteria', 'robot amasador'],
  picadora: ['picadora', 'picadora electrica', 'procesador', 'procesador de alimentos'],
  'plancha electrica': ['plancha electrica', 'grill electrico'],
  sandwichera: ['sandwichera'],
  gofrera: ['gofrera'],
  tostadora: ['tostadora'],
  panificadora: ['panificadora'],
  yogurtera: ['yogurtera'],
  heladera: ['heladera', 'maquina de helados'],
  deshidratador: ['deshidratador', 'deshidratadora'],
  roner: ['roner', 'sous vide'],
  'exprimidor electrico': ['exprimidor electrico'],
}

/** Utensils every kitchen has (folded). Never filter a recipe. */
export const BASIC_UTENSILS: readonly string[] = [
  'fuegos', 'placa', 'vitroceramica', 'vitro', 'induccion', 'cocina',
  'sarten', 'sartenes', 'wok', 'plancha', 'parrilla',
  'cazuela', 'cazuelas', 'olla', 'ollas', 'cazo', 'cacerola', 'puchero', 'paellera', 'perol',
  'bol', 'boles', 'bowl', 'cuenco', 'ensaladera', 'fuente', 'bandeja', 'rustidera', 'molde', 'moldes', 'flanera',
  'tabla', 'tabla de cortar', 'cuchillo', 'cuchillos', 'pelador', 'rallador', 'mandolina', 'tijeras',
  'espumadera', 'cucharon', 'cuchara', 'cuchara de madera', 'espatula', 'lengua', 'pinzas', 'tenedor',
  'varillas', 'batidor', 'colador', 'escurridor', 'tamiz', 'mortero', 'pasapures', 'chino', 'prensa ajos',
  'rodillo', 'brocha', 'pincel', 'manga pastelera', 'aro', 'aro de emplatar', 'tarro', 'tarros', 'tapa',
  'vaporera', 'cestillo de vapor', 'papel de horno', 'papel sulfurizado', 'papel de aluminio', 'papel film',
  'film', 'rejilla', 'termometro', 'bascula', 'vaso medidor', 'jarra', 'plato', 'platos', 'taper', 'tuper',
  'recipiente', 'fiambrera', 'trapo', 'pano', 'exprimidor', 'abrelatas', 'sacacorchos', 'palillos', 'brochetas',
]

export type EquipmentKind =
  | { kind: 'appliance'; name: string }
  | { kind: 'utensil' }
  | { kind: 'unknown'; name: string }

/** Lowercase, no accents, single spaces. */
export function foldEquipment(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ').trim()
}

const APPLIANCE_NAMES: Array<[string, string]> = Object.entries(KITCHEN_APPLIANCES)
  .flatMap(([canonical, names]) => names.map((n): [string, string] => [n, canonical]))
  .sort((a, b) => b[0].length - a[0].length)
const UTENSIL_NAMES = [...BASIC_UTENSILS].sort((a, b) => b.length - a.length)

const startsWithName = (s: string, name: string) => s === name || s.startsWith(`${name} `)

/** Pure: what one equipment line is («Horno precalentado» → appliance «horno», «Sartén grande» → utensil). */
export function classifyEquipment(raw: string): EquipmentKind {
  const s = foldEquipment(raw)
  for (const [name, canonical] of APPLIANCE_NAMES) if (startsWithName(s, name)) return { kind: 'appliance', name: canonical }
  for (const name of UTENSIL_NAMES) if (startsWithName(s, name)) return { kind: 'utensil' }
  return { kind: 'unknown', name: s }
}

/** Pure: the appliances (canonical names) in a list; utensils and unknown words are dropped. */
export function appliancesIn(list: readonly string[]): string[] {
  const out: string[] = []
  for (const e of list) {
    const k = classifyEquipment(e)
    if (k.kind === 'appliance' && !out.includes(k.name)) out.push(k.name)
  }
  return out
}

/** Pure: equipment words neither list knows, with how many recipes use each (most used first). */
export function unknownEquipmentCounts(recipes: ReadonlyArray<{ equipment?: readonly string[] | null }>): Array<{ name: string; recipes: number }> {
  const counts = new Map<string, number>()
  for (const r of recipes) {
    const seen = new Set<string>()
    for (const e of r.equipment ?? []) {
      const k = classifyEquipment(e)
      if (k.kind === 'unknown' && k.name && !seen.has(k.name)) {
        seen.add(k.name)
        counts.set(k.name, (counts.get(k.name) ?? 0) + 1)
      }
    }
  }
  return [...counts.entries()]
    .map(([name, n]) => ({ name, recipes: n }))
    .sort((a, b) => b.recipes - a.recipes || a.name.localeCompare(b.name, 'es'))
}
