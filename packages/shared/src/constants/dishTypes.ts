/**
 * «Semana tipo» (D-182, docs/superpowers/specs/2026-11-11-semana-tipo-design.md §3):
 * the closed list of dish types a slot of the week type can ask for
 * («los viernes, pizza»; «los jueves, una semana ceviche y otra carpaccio»).
 *
 * `kind`: a **dish** (Pizza, Ceviche…) is something you can write when no
 * recipe fits; a **broad** type (Carne, Indio…) falls back to any recipe.
 * Keys are accent-free and stable: they are stored in `recipes.dish_types`
 * and in `household_week_types.slots`. Replaces MEAL_TYPE_TAGS.
 */
export const DISH_TYPE_FAMILIES = ['cuchara', 'proteina', 'bases', 'frescos', 'mundo', 'desayunos'] as const
export type DishTypeFamily = (typeof DISH_TYPE_FAMILIES)[number]

export const DISH_TYPE_FAMILY_LABELS: Record<DishTypeFamily, string> = {
  cuchara: 'Cuchara',
  proteina: 'Pescado, carne y huevo',
  bases: 'Bases',
  frescos: 'Frescos y crudos',
  mundo: 'Del mundo',
  desayunos: 'Desayunos',
}

export interface DishTypeInfo {
  key: string
  label: string
  family: DishTypeFamily
  /** One emoji for now; drawn icons come later (§8). */
  icon: string
  kind: 'dish' | 'broad'
}

export const DISH_TYPES = [
  { key: 'legumbres', label: 'Legumbres', family: 'cuchara', icon: '🫘', kind: 'dish' },
  { key: 'cremas-sopas', label: 'Cremas y sopas', family: 'cuchara', icon: '🥣', kind: 'dish' },
  { key: 'guisos', label: 'Guisos', family: 'cuchara', icon: '🍲', kind: 'dish' },
  { key: 'pescado', label: 'Pescado', family: 'proteina', icon: '🐟', kind: 'broad' },
  { key: 'pollo', label: 'Pollo', family: 'proteina', icon: '🍗', kind: 'broad' },
  { key: 'carne', label: 'Carne', family: 'proteina', icon: '🥩', kind: 'broad' },
  { key: 'huevos', label: 'Huevos y tortillas', family: 'proteina', icon: '🍳', kind: 'dish' },
  { key: 'plancha-brasa', label: 'Plancha y brasa', family: 'proteina', icon: '🔥', kind: 'broad' },
  { key: 'pasta', label: 'Pasta', family: 'bases', icon: '🍝', kind: 'dish' },
  { key: 'arroz', label: 'Arroz', family: 'bases', icon: '🍚', kind: 'dish' },
  { key: 'pizza', label: 'Pizza', family: 'bases', icon: '🍕', kind: 'dish' },
  { key: 'bocadillos', label: 'Bocadillos y sándwiches', family: 'bases', icon: '🥪', kind: 'dish' },
  { key: 'ensaladas', label: 'Ensaladas', family: 'frescos', icon: '🥗', kind: 'dish' },
  { key: 'verduras', label: 'Verduras', family: 'frescos', icon: '🥦', kind: 'broad' },
  { key: 'ceviche', label: 'Ceviche', family: 'frescos', icon: '🍋', kind: 'dish' },
  { key: 'carpaccio-tartar', label: 'Carpaccio y tartar', family: 'frescos', icon: '🔪', kind: 'dish' },
  { key: 'italiano', label: 'Italiano', family: 'mundo', icon: '🇮🇹', kind: 'broad' },
  { key: 'japones', label: 'Japonés', family: 'mundo', icon: '🍣', kind: 'broad' },
  { key: 'chino-wok', label: 'Chino y wok', family: 'mundo', icon: '🥡', kind: 'broad' },
  { key: 'indio', label: 'Indio', family: 'mundo', icon: '🍛', kind: 'broad' },
  { key: 'mexicano', label: 'Mexicano', family: 'mundo', icon: '🌮', kind: 'broad' },
  { key: 'sudamericano', label: 'Sudamericano', family: 'mundo', icon: '🫓', kind: 'broad' },
  { key: 'oriente-medio', label: 'Oriente Medio', family: 'mundo', icon: '🧆', kind: 'broad' },
  { key: 'tostadas', label: 'Tostadas', family: 'desayunos', icon: '🍞', kind: 'dish' },
  { key: 'cereales-avena', label: 'Cereales y avena', family: 'desayunos', icon: '🥣', kind: 'dish' },
  { key: 'yogur-fruta', label: 'Yogur y fruta', family: 'desayunos', icon: '🍓', kind: 'dish' },
  { key: 'dulce-finde', label: 'Dulce de finde', family: 'desayunos', icon: '🥞', kind: 'dish' },
] as const satisfies readonly DishTypeInfo[]

export type DishType = (typeof DISH_TYPES)[number]['key']

export const DISH_TYPE_KEYS = DISH_TYPES.map((t) => t.key) as readonly DishType[]

export function isDishType(s: unknown): s is DishType {
  return typeof s === 'string' && (DISH_TYPE_KEYS as readonly string[]).includes(s)
}

export function dishTypeInfo(key: string): DishTypeInfo | null {
  return (DISH_TYPES as readonly DishTypeInfo[]).find((t) => t.key === key) ?? null
}
