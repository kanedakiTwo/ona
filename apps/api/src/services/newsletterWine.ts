/**
 * El vino de cada persona en la newsletter (PRO-395, D-180; specs/newsletter.md
 * → «El vino de cada persona»). El enfoque es de Marketing
 * (`departments/marketing/vino-de-la-semana.md`, v2) y la base la rellena la
 * mujer de Miguel (`departments/marketing/vinos/base.md`, en HQ).
 *
 *   - La base: `parseWineBase(markdown)` lee `vinos/base.md` tal cual llega por
 *     `PUT /admin/newsletter/wines` (nunca está en el repo): su firma, sus
 *     reglas para todos los vinos, el vino del vídeo y los vinos con
 *     `estado: ok`. Cada carga reemplaza la base entera.
 *   - El tipo de plato de cada receta del número: `dishTypeOf` (uno de los 11
 *     de `WINE_DISH_TYPES`, por reglas de su título y sus ingredientes), o el
 *     que Miguel puso en `content.recipes[].dishType`.
 *   - El emparejamiento, con reglas y sin IA: `pickWine`.
 *   - A quién nunca: `wineAllowed` (adultos, sin «sin alcohol» ni halal en la
 *     casa, sin embarazo ni lactancia en la ficha). El dato de salud solo se
 *     usa aquí, para no mandar el vino: ni se guarda ni se nombra.
 *   - Apagado (`wineEnabled`) hasta el sí de Legal (LEG-505, con su línea de
 *     moderación) y la firma con la casilla marcada.
 *   - El registro `newsletter_wine_log` (número, persona, vino): no repetir en
 *     4 números. Solo lo lee el compositor; se borra con la cuenta.
 *
 * Partido como el resto: lo puro aquí arriba (tests/newsletterWine.test.ts),
 * Postgres en `createDbNewsletterWineRepo` (tests/newsletterWine.smoke.ts).
 */
import { createHash } from 'node:crypto'
import { eq, inArray } from 'drizzle-orm'
import { db as defaultDb } from '../db/connection.js'
import {
  householdProfiles,
  ingredients,
  newsletterWineLog,
  newsletterWineSettings,
  newsletterWines,
  profileFacts,
  recipeIngredients,
  recipes,
  userMemories,
  users,
} from '../db/schema.js'
import { compileRestrictions, mergeRestrictions, nameHasTerm, normalizeText } from './dietaryRestrictions.js'
import { loadHouseholdRestrictions } from './householdAllergies.js'
import { PREGNANCY_TEXT_PATTERNS } from './profile/healthText.js'
import { householdMemberIds } from './tasteStore.js'
import { BORDER_SOFT, EYEBROW, INK, INK_MID, MUTED, PAPER, SANS, SERIF, TERRACOTTA_DEEP, esc, row } from './emailBrand.js'

type Db = typeof defaultDb

// ─── La base ─────────────────────────────────────────────────────

/** Los tipos de plato de la base (la tabla «Los tipos de plato» de `vinos/base.md`). */
export const WINE_DISH_TYPES = [
  'pescado-blanco',
  'pescado-azul-marisco',
  'arroces',
  'legumbres-guisos',
  'carnes-blancas',
  'carnes-rojas-caza',
  'verduras',
  'pasta',
  'huevos-diario',
  'quesos-aperitivo',
  'picante-fuera',
] as const
export type WineDishType = (typeof WINE_DISH_TYPES)[number]

export const WINE_TYPES = ['blanco', 'tinto', 'rosado', 'espumoso', 'generoso', 'dulce'] as const
export type WineType = (typeof WINE_TYPES)[number]

export interface Wine {
  /** `v001`… */
  id: string
  num: number | null
  name: string
  winery: string
  type: WineType
  grape: string | null
  zone: string | null
  vintage: string | null
  price: string | null
  whereToBuy: string | null
  /** Sin afiliación; solo https. */
  link: string | null
  categories: WineDishType[]
  /** Palabras clave de «no va con», normalizadas. */
  noGo: string[]
  /** Su frase, tal cual. */
  phrase: string
  relation: string | null
}

/** Una de sus reglas para todos: «tipo de plato o palabra → nunca tal tipo de vino». */
export type WineRule = { category: WineDishType; never: WineType } | { term: string; never: WineType }

export interface WineSettings {
  signatureName: string | null
  signatureAbout: string | null
  signatureAccepted: boolean
  rules: WineRule[]
  videoWineId: string | null
  /** LEG-505 hecha, con su sí. */
  legalApproved: boolean
  legalRef: string | null
  moderationLine: string | null
}

export interface ParsedWineBase {
  settings: Omit<WineSettings, 'legalApproved' | 'legalRef' | 'moderationLine'>
  wines: Wine[]
  /** Los vinos que no entran, con por qué (sin visto bueno, sin tipo…). */
  skipped: Array<{ id: string; reason: string }>
  /** Las reglas que no caben en «… → nunca tal tipo de vino» (se le preguntan a ella). */
  unparsedRules: string[]
}

const isDishType = (s: string): s is WineDishType => (WINE_DISH_TYPES as readonly string[]).includes(s)
const isWineType = (s: string): s is WineType => (WINE_TYPES as readonly string[]).includes(s)

/** «(sin guardar)», «—», «(ninguna todavía)»: vacío. */
function clean(v: string | undefined): string | null {
  const s = (v ?? '').trim()
  if (!s || /^[—–-]+$/.test(s) || /^\(.*\)$/.test(s)) return null
  return s
}

function yes(v: string | undefined): boolean {
  return /^(si|sí|yes|true|ok|x|\[x\])$/i.test((v ?? '').trim())
}

/** «- clave: valor» → [clave, valor]. */
function field(line: string): [string, string] | null {
  const m = /^\s*[-*]\s+([A-Za-zñÑáéíóú]+)\s*:\s?(.*)$/.exec(line)
  return m ? [m[1], m[2].trim()] : null
}

/** «[alcachofa, vinagre]» (puede haber texto alrededor) → las palabras, normalizadas. */
export function noGoKeywords(v: string): string[] {
  const out: string[] = []
  for (const m of v.matchAll(/\[([^\]]*)\]/g)) {
    for (const w of m[1].split(/[,;]/)) {
      const n = normalizeText(w)
      if (n && !out.includes(n)) out.push(n)
    }
  }
  return out
}

/** «tinto», «Tintos», «vino tinto» → `tinto`. */
function wineTypeOf(v: string): WineType | null {
  const n = normalizeText(v).replace(/^vinos? /, '')
  for (const t of WINE_TYPES) if (n === t || n === `${t}s`) return t
  return null
}

/** «arroces → nunca tinto», «alcachofa -> nunca tintos». */
function parseRule(line: string): WineRule | null {
  const m = /^(.+?)\s*(?:→|->|=>)\s*nunca\s+(.+?)\.?$/i.exec(line.trim())
  if (!m) return null
  const never = wineTypeOf(m[2])
  if (!never) return null
  const left = normalizeText(m[1]).replace(/^[«"']|[»"']$/g, '')
  if (!left) return null
  return isDishType(left) ? { category: left, never } : { term: left, never }
}

const HTTPS_RE = /^https:\/\/[^\s<>"']+$/

/**
 * Puro: `vinos/base.md` → la firma, sus reglas, el vídeo y los vinos con su
 * visto bueno. Lo que dice ella es dato (D-094): aquí solo se copia, nunca se
 * interpreta como una orden. Los bloques de código (la plantilla) no cuentan.
 */
export function parseWineBase(markdown: string): ParsedWineBase {
  const lines = markdown.split(/\r?\n/)
  let section = ''
  let fenced = false
  let current: { id: string; title: string; fields: Record<string, string> } | null = null
  const raw: Array<{ id: string; title: string; fields: Record<string, string> }> = []
  const signature: Record<string, string> = {}
  const ruleLines: string[] = []
  const videoLines: string[] = []
  for (const line of lines) {
    if (/^\s*```/.test(line)) {
      fenced = !fenced
      continue
    }
    if (fenced) continue
    const h2 = /^##\s+(.+?)\s*$/.exec(line)
    if (h2 && !line.startsWith('###')) {
      section = normalizeText(h2[1])
      current = null
      continue
    }
    const h3 = /^###\s+(v\d{1,4})\b\s*(.*)$/i.exec(line)
    if (h3 && section === 'vinos') {
      current = { id: h3[1].toLowerCase(), title: h3[2], fields: {} }
      raw.push(current)
      continue
    }
    const f = field(line)
    if (section === 'firma' && f) signature[normalizeText(f[0])] = f[1]
    else if (section.startsWith('sus reglas') && /^\s*[-*]\s+/.test(line)) ruleLines.push(line.replace(/^\s*[-*]\s+/, ''))
    else if (section.startsWith('vino del video') && line.trim()) videoLines.push(line)
    else if (current && f) current.fields[f[0]] = f[1]
  }

  const wines: Wine[] = []
  const skipped: ParsedWineBase['skipped'] = []
  for (const w of raw) {
    const g = (k: string) => clean(w.fields[k])
    // «### v001 · Nombre del vino · Bodega»: el nombre y la bodega, si no vienen en sus campos.
    const [titleName, titleWinery] = w.title.replace(/^\s*·\s*/, '').split(/\s+·\s+/)
    const estado = normalizeText(w.fields.estado ?? '').split(/\s/)[0]
    if (estado !== 'ok') {
      skipped.push({ id: w.id, reason: 'sin visto bueno' })
      continue
    }
    const type = wineTypeOf(g('tipo') ?? '')
    const categories = (g('categorias') ?? '')
      .split(/[,;]/)
      .map((c) => normalizeText(c).replace(/[`]/g, ''))
      .filter(isDishType)
    const name = g('nombre') ?? clean(titleName)
    const winery = g('bodega') ?? clean(titleWinery)
    const phrase = (g('frase') ?? '').replace(/^«\s*|\s*»$/g, '').trim()
    const problem = !name || !winery ? 'sin nombre o bodega' : !type ? 'sin tipo' : categories.length === 0 ? 'sin tipo de plato' : !phrase || phrase === '…' ? 'sin su frase' : null
    if (problem) {
      skipped.push({ id: w.id, reason: problem })
      continue
    }
    const link = g('enlace')
    const num = Number.parseInt(g('num') ?? '', 10)
    wines.push({
      id: w.id,
      num: Number.isFinite(num) ? num : null,
      name: name!,
      winery: winery!,
      type: type!,
      grape: g('uva'),
      zone: g('zona'),
      vintage: g('anada'),
      price: g('precio')?.replace(/\s*(€|euros?)\s*$/i, '').trim() || null,
      whereToBuy: g('donde'),
      link: link && HTTPS_RE.test(link) ? link : null,
      categories: [...new Set(categories)],
      noGo: noGoKeywords(w.fields.noVa ?? ''),
      phrase,
      relation: g('relacion'),
    })
  }

  const rules: WineRule[] = []
  const unparsedRules: string[] = []
  for (const l of ruleLines) {
    if (!clean(l)) continue
    const r = parseRule(l)
    if (r) rules.push(r)
    else unparsedRules.push(l.trim())
  }

  // El vídeo: «v003 · …», «- vinoId: v003» o «- num: 3».
  let videoWineId: string | null = null
  for (const l of videoLines) {
    const id = /\b(v\d{1,4})\b/i.exec(l)?.[1]?.toLowerCase()
    const num = /^\s*[-*]\s+num\s*:\s*(\d+)/i.exec(l)?.[1]
    if (id) videoWineId = id
    else if (num && !videoWineId) videoWineId = wines.find((w) => w.num === Number(num))?.id ?? null
    if (videoWineId) break
  }

  return {
    settings: {
      signatureName: clean(signature.nombre),
      signatureAbout: clean(signature.sobre),
      signatureAccepted: yes(signature.acepta),
      rules,
      videoWineId: videoWineId && wines.some((w) => w.id === videoWineId) ? videoWineId : null,
    },
    wines,
    skipped,
    unparsedRules,
  }
}

/** Puro: ¿puede salir algún vino? Sin el sí de Legal (con su línea), sin la firma con la casilla, no. */
export function wineEnabled(s: WineSettings | null): s is WineSettings & { signatureName: string; moderationLine: string } {
  return !!s && s.legalApproved && !!s.moderationLine?.trim() && s.signatureAccepted && !!s.signatureName?.trim()
}

// ─── El tipo de plato de una receta ──────────────────────────────

export interface WineRecipe {
  title: string
  /** Los nombres de sus ingredientes. */
  ingredients: readonly string[]
}

// Por orden: lo que decide la forma del plato antes que su proteína («arroz con
// bacalao» es un arroz, «lentejas con chorizo» una legumbre).
const TITLE_RULES: ReadonlyArray<[WineDishType, readonly string[]]> = [
  ['picante-fuera', ['curry', 'taco', 'tacos', 'burrito', 'fajita', 'wok', 'teriyaki', 'kimchi', 'sriracha', 'tikka', 'masala', 'pad thai', 'ramen', 'jalapeno', 'chili', 'picante', 'thai', 'tandoori', 'gochujang', 'nachos', 'sushi', 'poke', 'yakisoba', 'satay', 'harissa', 'mole']],
  ['arroces', ['arroz', 'paella', 'risotto', 'fideua']],
  ['pasta', ['pasta', 'espagueti', 'espaguetis', 'spaghetti', 'macarron', 'macarrones', 'lasana', 'canelon', 'canelones', 'tallarin', 'tallarines', 'pizza', 'nioqui', 'noquis', 'gnocchi', 'ravioli', 'raviolis', 'tortellini', 'penne', 'fusilli', 'tagliatelle', 'fideos']],
  ['legumbres-guisos', ['lenteja', 'lentejas', 'garbanzo', 'garbanzos', 'alubia', 'alubias', 'judiones', 'fabada', 'fabes', 'cocido', 'potaje', 'puchero', 'pochas', 'olla', 'escudella', 'caparrones', 'hummus']],
  ['huevos-diario', ['tortilla', 'revuelto', 'revueltos', 'croqueta', 'croquetas', 'empanada', 'empanadillas', 'quiche', 'huevos', 'flamenquin', 'sandwich', 'bocadillo']],
  ['quesos-aperitivo', ['tabla', 'queso', 'quesos', 'embutido', 'embutidos', 'tapa', 'tapas', 'aperitivo', 'montadito', 'tosta', 'tostas', 'pincho', 'pinchos', 'fondue']],
]

// Por orden: el pescado, después el animal y, al final, el corte (que puede ser de varios).
const PROTEIN_RULES: ReadonlyArray<[WineDishType, readonly string[]]> = [
  ['pescado-blanco', ['merluza', 'pescadilla', 'bacalao', 'lubina', 'dorada', 'rape', 'lenguado', 'mero', 'besugo', 'abadejo', 'rodaballo', 'corvina', 'panga', 'cabracho', 'rosada', 'pescado blanco']],
  ['pescado-azul-marisco', ['sardina', 'salmon', 'atun', 'bonito', 'caballa', 'boqueron', 'anchoa', 'jurel', 'chicharro', 'trucha', 'emperador', 'pez espada', 'mejillon', 'gamba', 'langostino', 'calamar', 'chipiron', 'sepia', 'pulpo', 'almeja', 'berberecho', 'navaja', 'cigala', 'bogavante', 'marisco', 'vieira', 'zamburina', 'surimi', 'pescado azul']],
  ['pescado-blanco', ['pescado']],
  ['carnes-blancas', ['pollo', 'pavo', 'conejo', 'cerdo', 'cochinillo']],
  ['carnes-rojas-caza', ['ternera', 'buey', 'vaca', 'cordero', 'cabrito', 'lechazo', 'rabo de toro', 'jabali', 'venado', 'ciervo', 'corzo', 'perdiz', 'codorniz', 'pato', 'liebre', 'caza']],
  ['carnes-blancas', ['lomo', 'costilla', 'secreto', 'presa', 'pluma', 'panceta', 'chorizo', 'salchicha', 'codillo', 'muslo', 'pechuga', 'contramuslo', 'magro']],
  ['carnes-rojas-caza', ['chuleton', 'entrecot', 'carrillera', 'morcillo', 'rabo', 'hamburguesa', 'albondiga', 'solomillo', 'carne picada', 'carne']],
]

const VEG_TITLE = ['ensalada', 'crema', 'pure', 'pisto', 'menestra', 'gazpacho', 'salmorejo', 'verdura', 'verduras', 'sopa', 'parrillada de verduras', 'escalivada', 'berenjena', 'calabacin', 'calabaza', 'alcachofa', 'alcachofas', 'esparrago', 'esparragos', 'champinon', 'champinones', 'setas', 'coliflor', 'brocoli', 'espinacas', 'acelgas', 'puerros', 'vichyssoise', 'samfaina', 'tumbet', 'zanahoria']

const hasAny = (normalized: string, terms: readonly string[]) => terms.some((t) => nameHasTerm(normalized, t))

/**
 * Puro: el tipo de plato de una receta, por reglas de su título y sus
 * ingredientes (la forma del plato, después la proteína principal del título,
 * las verduras y, al final, la proteína de sus ingredientes). Siempre uno de
 * los 11; sin nada que lo diga, `huevos-diario` («platos de diario»).
 */
export function dishTypeOf(r: WineRecipe): WineDishType {
  const title = normalizeText(r.title)
  for (const [type, terms] of TITLE_RULES) if (hasAny(title, terms)) return type
  for (const [type, terms] of PROTEIN_RULES) if (hasAny(title, terms)) return type
  if (hasAny(title, VEG_TITLE)) return 'verduras'
  const ings = r.ingredients.map(normalizeText)
  // Lo que pica, aunque no lo diga el título.
  if (ings.some((i) => hasAny(i, ['curry', 'sriracha', 'jalapeno', 'gochujang', 'harissa', 'chile chipotle', 'pasta de curry']))) return 'picante-fuera'
  for (const [type, terms] of PROTEIN_RULES) if (ings.some((i) => hasAny(i, terms))) return type
  if (ings.some((i) => hasAny(i, ['lenteja', 'garbanzo', 'alubia', 'judia blanca', 'judia pinta']))) return 'legumbres-guisos'
  if (ings.some((i) => hasAny(i, ['huevo']))) return 'huevos-diario'
  return ings.length > 0 ? 'verduras' : 'huevos-diario'
}

// ─── El emparejamiento ───────────────────────────────────────────

/** No se repite en este número de números. */
export const WINE_NO_REPEAT_ISSUES = 4

/** Un vino que se le mandó (una fila de `newsletter_wine_log`). */
export interface WineShown {
  wineId: string
  issueId: string
  shownAt: Date
}

/** La receta de esa persona, como la mira el emparejamiento. */
export interface WinePairingRecipe extends WineRecipe {
  dishType: WineDishType
}

function recipeMentions(recipe: WineRecipe, term: string): boolean {
  const t = normalizeText(term)
  return [recipe.title, ...recipe.ingredients].some((s) => nameHasTerm(normalizeText(s), t))
}

/**
 * Puro: el vino de esta persona para su receta, o null (= sin vino). De los
 * vinos de su tipo de plato, fuera los que tienen una palabra de «no va con»
 * en el título o los ingredientes, los que choquen con una de sus reglas y los
 * que le salieron en sus últimos 4 números; entre los que quedan, primero el
 * del vídeo de esa semana, después el que menos le ha salido y, al final, un
 * orden fijo por persona y número (sha256, como `pickRecipe`).
 */
export function pickWine(
  recipe: WinePairingRecipe,
  wines: readonly Wine[],
  settings: Pick<WineSettings, 'rules' | 'videoWineId'>,
  shown: readonly WineShown[],
  seed: string,
): Wine | null {
  const lastIssues = [...new Map([...shown].sort((a, b) => b.shownAt.getTime() - a.shownAt.getTime()).map((s) => [s.issueId, s])).values()]
    .slice(0, WINE_NO_REPEAT_ISSUES)
    .map((s) => s.wineId)
  const recent = new Set(lastIssues)
  const breaksRule = (w: Wine) =>
    settings.rules.some((r) => r.never === w.type && ('category' in r ? r.category === recipe.dishType : recipeMentions(recipe, r.term)))
  const ok = wines.filter(
    (w) => w.categories.includes(recipe.dishType) && !w.noGo.some((t) => recipeMentions(recipe, t)) && !breaksRule(w) && !recent.has(w.id),
  )
  if (ok.length === 0) return null
  const times = (w: Wine) => shown.filter((s) => s.wineId === w.id).length
  const rank = (w: Wine) => createHash('sha256').update(`${seed}|${w.id}`).digest('hex')
  return [...ok].sort(
    (a, b) =>
      Number(b.id === settings.videoWineId) - Number(a.id === settings.videoWineId) ||
      times(a) - times(b) ||
      rank(a).localeCompare(rank(b)),
  )[0]
}

// ─── A quién nunca ───────────────────────────────────────────────

/** La edad mínima del vino (hasta que LEG-505 diga otra cosa). */
export const WINE_MIN_AGE = 18

/** Lo que mira `wineAllowed` de una cuenta y su casa. Nada de esto se guarda. */
export interface WineAudience {
  /** La edad del perfil de la cuenta; null = sin edad. */
  age: number | null
  /** Las restricciones de toda la casa (perfiles y memoria de cada miembro). */
  householdRestrictions: readonly string[]
  /** Los textos de la ficha de la casa y de la memoria de cada miembro. */
  householdTexts: readonly string[]
}

/** Puro: ¿habla de embarazo o lactancia? (los patrones de `healthText.ts`). */
export function mentionsPregnancy(text: string): boolean {
  const n = normalizeText(text)
  return PREGNANCY_TEXT_PATTERNS.some((re) => re.test(n))
}

/**
 * Puro: solo a adultos (18 años o más en el perfil; sin edad, no); nunca a una
 * casa con «sin alcohol» o halal (`compileRestrictions(...).alcohol`) ni con
 * embarazo o lactancia en la ficha de alguien. Sin datos (la comprobación
 * falló), no.
 */
export function wineAllowed(a: WineAudience | null | undefined): boolean {
  if (!a) return false
  if (a.age === null || !Number.isFinite(a.age) || a.age < WINE_MIN_AGE) return false
  const rules = compileRestrictions(a.householdRestrictions)
  if (rules.alcohol || rules.halal) return false
  return !a.householdTexts.some(mentionsPregnancy)
}

// ─── Cómo sale ───────────────────────────────────────────────────

const TYPE_LABEL: Record<WineType, string> = {
  blanco: 'Blanco',
  tinto: 'Tinto',
  rosado: 'Rosado',
  espumoso: 'Espumoso',
  generoso: 'Generoso',
  dulce: 'Dulce',
}

/** Lo que sale en el correo: el vino, su firma, la línea de moderación y el enlace (ya con su contador). */
export interface WineBlock {
  wine: Wine
  signatureName: string
  moderationLine: string
  url?: string
}

/** El bloque en texto, línea a línea (el orden de «Cómo sale en la newsletter»). */
export function wineBlockLines(b: WineBlock): { eyebrow: string; title: string; meta: string; phrase: string; buy: string | null; relation: string | null; moderation: string } {
  const w = b.wine
  const buy = [w.price ? `Unos ${w.price} €` : null, w.whereToBuy].filter(Boolean).join(' · ')
  return {
    eyebrow: `El vino, por ${b.signatureName}`,
    title: `${w.name} · ${w.winery}`,
    meta: [TYPE_LABEL[w.type], w.zone, w.grape, w.vintage].filter(Boolean).join(' · '),
    phrase: w.phrase,
    buy: buy || null,
    relation: w.relation ? `${b.signatureName} lo cuenta: ${w.relation.replace(/[.\s]+$/, '')}.` : null,
    moderation: b.moderationLine,
  }
}

/** El bloque del vino, justo debajo de la receta de esa persona. */
export function wineBlockHtml(b: WineBlock): string {
  const l = wineBlockLines(b)
  const buy = l.buy
    ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:15px;line-height:1.5;color:${INK};">${
        b.url ? `<a href="${esc(b.url)}" style="color:${TERRACOTTA_DEEP};font-weight:600;">${esc(l.buy)}</a>` : esc(l.buy)
      }</p>`
    : b.url
      ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:15px;"><a href="${esc(b.url)}" style="color:${TERRACOTTA_DEEP};font-weight:600;">Dónde se compra</a></p>`
      : ''
  return row(
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAPER};border:1px solid ${BORDER_SOFT};border-radius:16px;"><tr><td style="padding:22px 22px 14px;">
<p style="${EYEBROW}color:${TERRACOTTA_DEEP};">${esc(l.eyebrow)}</p>
<p style="margin:0 0 6px;font-family:${SERIF};font-size:22px;line-height:1.2;font-weight:650;letter-spacing:-0.01em;color:${INK};">${esc(l.title)}</p>
${l.meta ? `<p style="margin:0 0 14px;font-family:${SANS};font-size:14px;line-height:1.45;color:${MUTED};">${esc(l.meta)}</p>` : ''}
<p style="margin:0 0 14px;font-family:${SANS};font-size:16px;line-height:1.6;font-style:italic;color:${INK_MID};">«${esc(l.phrase)}»</p>
${buy}${l.relation ? `<p style="margin:0 0 10px;font-family:${SANS};font-size:14px;line-height:1.5;color:${INK_MID};">${esc(l.relation)}</p>` : ''}
<p style="margin:6px 0 4px;font-family:${SANS};font-size:12px;line-height:1.45;color:${MUTED};">${esc(l.moderation)}</p>
</td></tr></table>`,
    '0 28px 28px',
  )
}

export function wineBlockText(b: WineBlock): string[] {
  const l = wineBlockLines(b)
  return [
    `${l.eyebrow.toUpperCase()}: ${l.title}`,
    ...(l.meta ? [l.meta] : []),
    `«${l.phrase}»`,
    ...(l.buy ? [l.buy] : []),
    ...(b.url ? [b.url] : []),
    ...(l.relation ? [l.relation] : []),
    l.moderation,
    '',
  ]
}

/**
 * Adónde va un clic en el vino (la ranura `vino`, `?v=<id>`): el enlace de la
 * base, sin afiliación, con `utm_source=newsletter&utm_medium=email&utm_campaign=vino-<número>`.
 * Nunca una URL de la petición.
 */
export function wineDestination(link: string, issueId: string): string {
  const u = new URL(link)
  u.searchParams.set('utm_source', 'newsletter')
  u.searchParams.set('utm_medium', 'email')
  u.searchParams.set('utm_campaign', `vino-${issueId}`)
  return u.toString()
}

export const WINE_ID_RE = /^v\d{1,4}$/

// ─── Repo ────────────────────────────────────────────────────────

export interface NewsletterWineRepo {
  /** La base (null = nunca se cargó). */
  base(): Promise<{ settings: WineSettings; wines: Wine[] } | null>
  /** Título e ingredientes de las recetas del número. */
  recipes(ids: string[]): Promise<Map<string, WineRecipe>>
  /** Lo que mira `wineAllowed` de cada cuenta; una que no se pudo leer no está. */
  audiences(userIds: string[]): Promise<Map<string, WineAudience>>
  /** Los vinos ya mandados a cada cuenta. */
  shown(userIds: string[]): Promise<Map<string, WineShown[]>>
  record(issueId: string, rows: Array<{ userId: string; householdId: string; wineId: string }>): Promise<void>
  /** Reemplaza la base entera. */
  replace(parsed: ParsedWineBase, legal: Pick<WineSettings, 'legalApproved' | 'legalRef' | 'moderationLine'>): Promise<void>
  /** El enlace de un vino (para la ranura `vino`). */
  link(wineId: string): Promise<string | null>
}

export function createDbNewsletterWineRepo(db: Db = defaultDb): NewsletterWineRepo {
  return {
    async base() {
      const [s] = await db.select().from(newsletterWineSettings).where(eq(newsletterWineSettings.id, 1)).limit(1)
      if (!s) return null
      const rows = await db.select().from(newsletterWines)
      return {
        settings: {
          signatureName: s.signatureName,
          signatureAbout: s.signatureAbout,
          signatureAccepted: s.signatureAccepted,
          rules: (s.rules as WineRule[]) ?? [],
          videoWineId: s.videoWineId,
          legalApproved: s.legalApproved,
          legalRef: s.legalRef,
          moderationLine: s.moderationLine,
        },
        wines: rows
          .filter((r) => isWineType(r.type))
          .map((r) => ({
            id: r.id,
            num: r.num,
            name: r.name,
            winery: r.winery,
            type: r.type as WineType,
            grape: r.grape,
            zone: r.zone,
            vintage: r.vintage,
            price: r.price,
            whereToBuy: r.whereToBuy,
            link: r.link,
            categories: (r.categories ?? []).filter(isDishType),
            noGo: r.noGo ?? [],
            phrase: r.phrase,
            relation: r.relation,
          })),
      }
    },
    async recipes(ids) {
      const out = new Map<string, WineRecipe>()
      if (ids.length === 0) return out
      const rs = await db.select({ id: recipes.id, name: recipes.name }).from(recipes).where(inArray(recipes.id, ids))
      const ing = await db
        .select({ recipeId: recipeIngredients.recipeId, name: ingredients.name })
        .from(recipeIngredients)
        .innerJoin(ingredients, eq(recipeIngredients.ingredientId, ingredients.id))
        .where(inArray(recipeIngredients.recipeId, ids))
      for (const r of rs) out.set(r.id, { title: r.name, ingredients: ing.filter((i) => i.recipeId === r.id).map((i) => i.name) })
      return out
    },
    async audiences(userIds) {
      const out = new Map<string, WineAudience>()
      for (const userId of userIds) {
        // Cada cuenta por separado: si falla una, esa va sin vino y las demás siguen.
        try {
          const [u] = await db
            .select({ age: users.age, householdId: users.primaryHouseholdId })
            .from(users)
            .where(eq(users.id, userId))
            .limit(1)
          if (!u) continue
          const memberIds = await householdMemberIds(userId, db)
          const restrictions = await loadHouseholdRestrictions(userId, db)
          const members = await db.select({ restrictions: users.restrictions }).from(users).where(inArray(users.id, memberIds))
          const memories = await db.select({ value: userMemories.value }).from(userMemories).where(inArray(userMemories.userId, memberIds))
          const texts: string[] = [...members.flatMap((m) => m.restrictions ?? []), ...memories.map((m) => JSON.stringify(m.value))]
          if (u.householdId) {
            const facts = await db
              .select({ value: profileFacts.value, status: profileFacts.status })
              .from(profileFacts)
              .where(eq(profileFacts.householdId, u.householdId))
            texts.push(...facts.filter((f) => f.status === 'active').map((f) => JSON.stringify(f.value)))
            const portraits = await db
              .select({ portrait: householdProfiles.portrait })
              .from(householdProfiles)
              .where(eq(householdProfiles.householdId, u.householdId))
            texts.push(...portraits.map((p) => p.portrait))
          }
          out.set(userId, { age: u.age, householdRestrictions: mergeRestrictions(restrictions), householdTexts: texts })
        } catch (err: any) {
          console.warn('[newsletter] wine check failed for an account (no wine):', err?.message ?? err)
        }
      }
      return out
    },
    async shown(userIds) {
      const out = new Map<string, WineShown[]>()
      if (userIds.length === 0) return out
      const rows = await db
        .select({ userId: newsletterWineLog.userId, wineId: newsletterWineLog.wineId, issueId: newsletterWineLog.issueId, shownAt: newsletterWineLog.shownAt })
        .from(newsletterWineLog)
        .where(inArray(newsletterWineLog.userId, userIds))
      for (const r of rows) {
        const list = out.get(r.userId) ?? []
        list.push({ wineId: r.wineId, issueId: r.issueId, shownAt: r.shownAt })
        out.set(r.userId, list)
      }
      return out
    },
    async record(issueId, rows) {
      for (let i = 0; i < rows.length; i += 500) {
        await db
          .insert(newsletterWineLog)
          .values(rows.slice(i, i + 500).map((r) => ({ issueId, ...r })))
          .onConflictDoNothing()
      }
    },
    async replace(parsed, legal) {
      await db.transaction(async (tx) => {
        await tx.delete(newsletterWines)
        if (parsed.wines.length > 0) await tx.insert(newsletterWines).values(parsed.wines.map((w) => ({ ...w, loadedAt: new Date() })))
        const values = { ...parsed.settings, ...legal, rules: parsed.settings.rules, loadedAt: new Date() }
        await tx
          .insert(newsletterWineSettings)
          .values({ id: 1, ...values })
          .onConflictDoUpdate({ target: newsletterWineSettings.id, set: values })
      })
    },
    async link(wineId) {
      const [w] = await db.select({ link: newsletterWines.link }).from(newsletterWines).where(eq(newsletterWines.id, wineId)).limit(1)
      return w?.link ?? null
    },
  }
}
