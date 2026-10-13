/**
 * Strip what could identify a person from a text before a Mimoia HQ agent
 * sees it (company rule: agents only see aggregated or anonymised data).
 * Used by GET /admin/assistant-reviews/flags on Mimo's replies and on the
 * reviewer's notes.
 *
 * Deterministic and deliberately over-eager: a recipe or shop name masked by
 * mistake costs a little context; a person's name let through is a leak.
 *
 *   - emails → [email]; links → [enlace] (shop-order links and wa.me links
 *     carry tokens and phone numbers);
 *   - phone numbers (9–15 digits, with +, spaces, dots or dashes) → [teléfono];
 *   - DNI / NIE → [documento]; IBAN → [cuenta];
 *   - street addresses ("calle Mayor 12", "Avda. de la Constitución, 3") →
 *     [dirección]; Spanish postcodes → [cp];
 *   - names: every `knownNames` token (usernames, WhatsApp profile names,
 *     household names of the people in the window), and any capitalised word
 *     right after a cue such as "soy", "me llamo", "mi marido", "para", "a",
 *     "con", "de", "y", "hola" → [nombre].
 */

const NAME_STOPWORDS = new Set(
  [
    // The product, its pieces and the tools around it.
    'mimo', 'mimoia', 'whatsapp', 'google', 'instagram', 'tiktok', 'youtube', 'android', 'iphone', 'ios',
    // Supermarkets and shops named as places, not people.
    'mercadona', 'carrefour', 'lidl', 'aldi', 'dia', 'alcampo', 'eroski', 'consum', 'hipercor', 'bonpreu', 'caprabo', 'ahorramas',
    // Days, months, meals, pronouns and words a sentence can capitalise after a cue.
    'lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes', 'sábado', 'sabado', 'domingo',
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
    'el', 'la', 'los', 'las', 'un', 'una', 'mi', 'mis', 'tu', 'tus', 'su', 'sus', 'yo', 'ti', 'él', 'ella', 'ellos', 'ellas', 'usted',
    'hecho', 'listo', 'vale', 'sí', 'si', 'no', 'ok', 'hola', 'gracias', 'eso', 'esto', 'esta', 'este', 'ese', 'esa',
    'menú', 'menu', 'lista', 'compra', 'receta', 'recetas', 'perfil', 'casa', 'hogar',
  ].map((w) => w.toLowerCase()),
)

const WORD = '\\p{Lu}[\\p{L}\\p{M}\'’-]+'
/** Words after which a capitalised word is very likely a person's name. */
const NAME_CUES = [
  'soy', 'me llamo', 'se llama', 'llamada', 'llamado', 'hola', 'gracias', 'para', 'a', 'con', 'de', 'y', 'e',
  'mi (?:marido|mujer|pareja|novi[oa]|hij[oa]|niñ[oa]|beb[eé]|madre|padre|herman[oa]|suegr[oa]|abuel[oa]|ti[oa]|prim[oa]|amig[oa]|compañer[oa])',
]
/** "soy" → "[sS]oy": cues may open a sentence, but no `i` flag (it would make \p{Lu} match lowercase too). */
const anyCaseFirst = (cue: string) => `[${cue[0]}${cue[0].toUpperCase()}]${cue.slice(1)}`
const CUE_RE = new RegExp(
  `(?<![\\p{L}\\p{M}])((?:${NAME_CUES.map(anyCaseFirst).join('|')})[,:]?\\s+)(${WORD}(?:\\s+${WORD})?)`,
  'gu',
)

const EMAIL_RE = /[\p{L}0-9._%+-]+@[\p{L}0-9.-]+\.[\p{L}]{2,}/gu
const URL_RE = /\b(?:https?:\/\/|www\.|wa\.me\/)[^\s<>"'()]+/gi
const IBAN_RE = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,3})?\b/g
const DNI_RE = /\b(?:\d{8}|[XYZxyz]-?\d{7})-?[A-Za-z]\b/g
// 9–15 digits overall, optionally with a leading + and separators.
const PHONE_RE = /(?<![\p{L}\d])\+?\d(?:[\s.-]?\d){8,14}(?![\p{L}\d])/gu
const STREET_TYPES = '(?:[Cc]alle|[Cc]/|[Aa]venida|[Aa]vda\\.?|[Aa]v\\.|[Pp]laza|[Pp]za\\.?|[Pp]aseo|[Cc]amino|[Cc]arretera|[Cc]tra\\.?|[Rr]onda|[Tt]raves[ií]a|[Gg]lorieta|[Uu]rbanizaci[oó]n|[Uu]rb\\.)'
const ADDRESS_RE = new RegExp(
  `${STREET_TYPES}\\s+(?:(?:de|del|la|las|los|el)\\s+)*${WORD}(?:\\s+(?:(?:de|del|la|las|los|el|y)\\s+)*${WORD})*(?:,?\\s*(?:n[º°o]\\.?\\s*)?\\d+[A-Za-z]?(?:,?\\s*\\d+[ºª°]?\\s*[A-Za-z]?)?)?`,
  'gu',
)
const POSTCODE_RE = /(?<!\d)(?:0[1-9]|[1-4]\d|5[0-2])\d{3}(?!\d)(?!\s?(?:g|gr|kg|ml|l|€|kcal|cal|mg|min)\b)/g

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Pure: the name tokens worth masking from usernames, profile and household names. */
export function nameTokens(sources: ReadonlyArray<string | null | undefined>): string[] {
  const out = new Set<string>()
  for (const s of sources) {
    if (!s) continue
    const local = s.includes('@') ? s.split('@')[0] : s
    for (const t of local.split(/[^\p{L}\p{M}]+/u)) {
      if (t.length >= 3 && !NAME_STOPWORDS.has(t.toLowerCase())) out.add(t)
    }
    // The whole handle too ("pepe_garcia91" as written).
    const handle = local.trim()
    if (handle.length >= 3 && /[^\p{L}\p{M}\s]/u.test(handle)) out.add(handle)
  }
  return [...out].sort((a, b) => b.length - a.length)
}

/**
 * Pure: names a text reveals through its cues ("para Antonio", "mi hija
 * Lucía", "soy Marta"). Callers harvest them from every text of a batch —
 * including the users' own messages, which never leave — so a name masked in
 * one place ("para Antonio") is also masked where no cue precedes it
 * ("- Antonio ya tiene merluza").
 */
export function discoverNames(text: string | null | undefined): string[] {
  if (!text) return []
  const out = new Set<string>()
  for (const m of text.matchAll(CUE_RE)) {
    for (const w of m[2].split(/\s+/)) {
      if (w.length >= 3 && !NAME_STOPWORDS.has(w.toLowerCase())) out.add(w)
      else break
    }
  }
  return [...out]
}

export function anonymise(text: string | null | undefined, knownNames: ReadonlyArray<string> = []): string {
  if (!text) return ''
  let s = text
  s = s.replace(EMAIL_RE, '[email]')
  s = s.replace(URL_RE, '[enlace]')
  s = s.replace(IBAN_RE, '[cuenta]')
  s = s.replace(DNI_RE, '[documento]')
  s = s.replace(PHONE_RE, '[teléfono]')
  s = s.replace(ADDRESS_RE, '[dirección]')
  s = s.replace(POSTCODE_RE, '[cp]')
  for (const name of knownNames) {
    if (!name || name.length < 3) continue
    s = s.replace(new RegExp(`(?<![\\p{L}\\p{M}\\d_])${escapeRe(name)}(?![\\p{L}\\p{M}\\d_])`, 'giu'), '[nombre]')
  }
  s = s.replace(CUE_RE, (m, cue: string, words: string) => {
    const parts = words.split(/\s+/)
    if (NAME_STOPWORDS.has(parts[0].toLowerCase())) return m
    const kept = parts.length > 1 && NAME_STOPWORDS.has(parts[1].toLowerCase()) ? ` ${parts[1]}` : ''
    return `${cue}[nombre]${kept}`
  })
  // "[nombre] y Leo" / "Leo y [nombre]": the other one of a pair of names.
  s = s.replace(new RegExp(`\\[nombre\\](\\s+(?:y|e)\\s+)(${WORD})`, 'gu'), (m, sep: string, w: string) =>
    NAME_STOPWORDS.has(w.toLowerCase()) ? m : `[nombre]${sep}[nombre]`,
  )
  s = s.replace(new RegExp(`(${WORD})(\\s+(?:y|e)\\s+)\\[nombre\\]`, 'gu'), (m, w: string, sep: string) =>
    NAME_STOPWORDS.has(w.toLowerCase()) ? m : `[nombre]${sep}[nombre]`,
  )
  return s
}
