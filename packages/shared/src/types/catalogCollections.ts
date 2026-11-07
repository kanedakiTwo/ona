import { z } from 'zod'
import { SEASONS, type Season } from '../constants/enums.js'

/**
 * Catalogue collections (PRO-374, specs/recipes.md → «Colecciones»,
 * specs/catalog-import.md → «Colecciones»): an editorial row of the catalogue
 * («Vuelta al cole», «Invitados en casa», «Otoño»), made by Cocina as a JSON
 * file and uploaded from Admin → «Recetas pendientes» → «Subir colección».
 * Shared so the page checks the file with the very same schema
 * `POST /admin/catalog-collections` uses.
 *
 * The file: `{ slug, title, subtitle?, season?, published?, recipes: [...] }`,
 * each recipe its id or its exact name in the catalogue. Only published
 * catalogue recipes (the API checks that). No collection by health (§6 of the
 * constitution): the title and subtitle can't carry `HEALTH_CLAIM_WORDS`.
 */

/** The page's address: `/recipes/coleccion/<slug>`. */
export const CATALOG_COLLECTION_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,59}$/
export const CATALOG_COLLECTION_MAX_RECIPES = 60
export const CATALOG_COLLECTION_PATH = '/recipes/coleccion'

/**
 * Words of health that a collection can't be about (constitution §6: effects
 * on health, diseases, and the life stages that go to a professional). Written
 * without accents and in lower case; `healthClaimWordsIn` reads the text the
 * same way. A phrase matches as whole words; a single word also with a plural
 * or feminine ending («diabéticos», «embarazadas»).
 */
export const HEALTH_CLAIM_WORDS = [
  'perder peso',
  'pierde peso',
  'pierdes peso',
  'perder grasa',
  'pierde grasa',
  'quemar grasa',
  'quema grasa',
  'quemagrasas',
  'adelgazar',
  'adelgaza',
  'adelgazante',
  'antiinflamatorio',
  'antiinflamatoria',
  'antinflamatorio',
  'antinflamatoria',
  'inflamacion',
  'menopausia',
  'embarazo',
  'embarazada',
  'lactancia',
  'diabetes',
  'diabetico',
  'diabetica',
  'glucosa',
  'insulina',
  'colesterol',
  'hipertension',
  'cancer',
  'cardiovascular',
  'corazon sano',
  'detox',
  'depurativo',
  'depurativa',
  'desintoxicar',
  'microbioma',
  'salud intestinal',
  'defensas',
  'sistema inmune',
  'inmunidad',
  'previene',
  'cura',
  'curar',
  'saludable',
] as const

function fold(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const HEALTH_PATTERNS = HEALTH_CLAIM_WORDS.map((w) => ({
  word: w,
  re: new RegExp(`(^|[^a-z0-9])${escape(w).replace(/ /g, '\\s+')}${w.includes(' ') ? '' : '(s|es|a|as)?'}(?![a-z0-9])`),
}))

/** The health words of `HEALTH_CLAIM_WORDS` that `text` uses (empty when none). */
export function healthClaimWordsIn(text: string | null | undefined): string[] {
  if (!text) return []
  const t = fold(text)
  return HEALTH_PATTERNS.filter((p) => p.re.test(t)).map((p) => p.word)
}

export const catalogCollectionFileSchema = z.object({
  slug: z.string().regex(CATALOG_COLLECTION_SLUG_RE),
  title: z.string().trim().min(1).max(80),
  subtitle: z.string().trim().max(200).nullish(),
  season: z.enum(SEASONS).nullish(),
  published: z.boolean().optional(),
  recipes: z.array(z.string().trim().min(1).max(200)).min(1).max(CATALOG_COLLECTION_MAX_RECIPES),
})
export type CatalogCollectionFile = z.infer<typeof catalogCollectionFileSchema>

export type CatalogCollectionCheck =
  | { ok: true; collection: CatalogCollectionFile }
  | { ok: false; problems: string[] }

const FIELD_PROBLEMS: Record<string, string> = {
  slug: 'El «slug»: solo minúsculas, números y guiones, hasta 60 (por ejemplo, vuelta-al-cole).',
  title: 'El título falta o pasa de 80 letras.',
  subtitle: 'El subtítulo pasa de 200 letras.',
  season: 'La temporada: spring, summer, autumn o winter (o nada).',
  published: '«published» va con true o false.',
  recipes: `Las recetas: una lista de 1 a ${CATALOG_COLLECTION_MAX_RECIPES}, cada una su id o su nombre exacto en el catálogo.`,
}

/**
 * The file checked: its shape, the same recipe twice, and the §6 rule on the
 * title and subtitle. The problems in Spanish, as the page and the API show them.
 */
export function checkCatalogCollection(input: unknown): CatalogCollectionCheck {
  const parsed = catalogCollectionFileSchema.safeParse(input)
  if (!parsed.success) {
    const fields = [...new Set(parsed.error.issues.map((i) => String(i.path[0] ?? '')))]
    const problems = fields.map((f) => FIELD_PROBLEMS[f] ?? 'La colección no tiene el formato esperado.')
    return { ok: false, problems: [...new Set(problems)] }
  }
  const c = parsed.data
  const problems: string[] = []
  for (const [label, text] of [['El título', c.title], ['El subtítulo', c.subtitle]] as const) {
    const words = healthClaimWordsIn(text)
    if (words.length > 0) {
      problems.push(`${label} habla de salud («${words.join('», «')}»): no hacemos colecciones por salud (§6 de la constitución).`)
    }
  }
  const seen = new Set<string>()
  for (const r of c.recipes) {
    const key = fold(r).trim()
    if (seen.has(key)) problems.push(`La receta «${r}» está dos veces.`)
    seen.add(key)
  }
  return problems.length ? { ok: false, problems } : { ok: true, collection: c }
}

/** A collection on the `/recipes` row. */
export interface CatalogCollectionCard {
  slug: string
  title: string
  subtitle: string | null
  season: Season | null
  recipeCount: number
  /** The first recipe's photo. */
  imageUrl: string | null
}

/** `GET /admin/catalog-collections`: every collection, published or not. */
export interface CatalogCollectionAdminView extends CatalogCollectionCard {
  published: boolean
  createdAt: string
}
