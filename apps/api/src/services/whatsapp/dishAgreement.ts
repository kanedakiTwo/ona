/**
 * Gender and number of a dish name (PRO-274), so the guided writer says
 * «¿Ya están listas las Costillas a la riojana?» and not «¿Ya está lista la
 * Costillas…?». Pure and heuristic: the head noun is the first word that is
 * not an article («Costillas», «Sándwich», «Crema»), read by its ending with
 * a short list of exceptions. Null when it can't tell (the writer then talks
 * about «la cena» and the validator checks nothing).
 */

export type Gender = 'f' | 'm'
export type GrammarNumber = 'sg' | 'pl'
export interface Agreement {
  gender: Gender
  number: GrammarNumber
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/** Exceptions to the ending rule, folded (no accents). */
const EXCEPTIONS: Record<string, Agreement> = {
  // -e / consonant that are feminine
  carne: { gender: 'f', number: 'sg' },
  carnes: { gender: 'f', number: 'pl' },
  leche: { gender: 'f', number: 'sg' },
  quiche: { gender: 'f', number: 'sg' },
  mousse: { gender: 'f', number: 'sg' },
  nuez: { gender: 'f', number: 'sg' },
  nueces: { gender: 'f', number: 'pl' },
  coliflor: { gender: 'f', number: 'sg' },
  crepe: { gender: 'f', number: 'sg' },
  crepes: { gender: 'f', number: 'pl' },
  fideua: { gender: 'f', number: 'sg' },
  // -a that are masculine
  dia: { gender: 'm', number: 'sg' },
  // singular despite the final -s
  hummus: { gender: 'm', number: 'sg' },
  cuscus: { gender: 'm', number: 'sg' },
  couscous: { gender: 'm', number: 'sg' },
  humus: { gender: 'm', number: 'sg' },
  ananas: { gender: 'm', number: 'sg' },
  pancakes: { gender: 'f', number: 'pl' },
}

const SKIP = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'mi', 'mis', 'tu', 'tus', 'nuestro', 'nuestra', 'nuestros', 'nuestras'])

/** Pure: gender and number of a dish name, or null when it can't tell. */
export function dishAgreement(name: string): Agreement | null {
  const words = fold(name)
    .replace(/[^a-zñ0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  const head = words.find((w) => !SKIP.has(w) && !/^\d+$/.test(w))
  if (!head || head.length < 2) return null
  if (EXCEPTIONS[head]) return EXCEPTIONS[head]
  if (/as$/.test(head)) return { gender: 'f', number: 'pl' }
  if (/os$/.test(head)) return { gender: 'm', number: 'pl' }
  if (/(?:cion|sion|dad|tud)es$/.test(head)) return { gender: 'f', number: 'pl' }
  if (/(?:es|is|us)$/.test(head)) return { gender: 'm', number: 'pl' } // macarrones, canelones, espaguetis, nuggets…
  if (/[^aeiou]s$/.test(head)) return { gender: 'm', number: 'pl' } // nuggets, wraps
  if (/(?:cion|sion|dad|tud)$/.test(head)) return { gender: 'f', number: 'sg' }
  if (/a$/.test(head)) return { gender: 'f', number: 'sg' }
  if (/[oe]$/.test(head)) return { gender: 'm', number: 'sg' }
  if (/[^aeiou]$/.test(head)) return { gender: 'm', number: 'sg' } // sándwich, arroz, salmón, pan, curry, wok
  return null
}

const LABEL: Record<Gender, Record<GrammarNumber, string>> = {
  f: { sg: 'femenino singular', pl: 'femenino plural' },
  m: { sg: 'masculino singular', pl: 'masculino plural' },
}
const EXAMPLE: Record<Gender, Record<GrammarNumber, string>> = {
  f: { sg: 'la …, ¿está lista?', pl: 'las …, ¿están listas?' },
  m: { sg: 'el …, ¿está listo?', pl: 'los …, ¿están listos?' },
}

/** One fact line for the writer, or null when the agreement is unknown. */
export function agreementFact(name: string): string | null {
  const a = dishAgreement(name)
  if (!a) return null
  return `«${name}» es ${LABEL[a.gender][a.number]}: concuerda artículos, adjetivos y verbo (${EXAMPLE[a.gender][a.number].replace('…', name)}).`
}

/** Facts for a list of dishes (unknown ones left out), deduplicated. */
export function agreementFacts(names: readonly string[]): string[] {
  return [...new Set(names)].map(agreementFact).filter((f): f is string => f !== null)
}

const DETERMINERS: Record<string, Agreement> = {
  el: { gender: 'm', number: 'sg' },
  del: { gender: 'm', number: 'sg' },
  al: { gender: 'm', number: 'sg' },
  un: { gender: 'm', number: 'sg' },
  este: { gender: 'm', number: 'sg' },
  ese: { gender: 'm', number: 'sg' },
  la: { gender: 'f', number: 'sg' },
  una: { gender: 'f', number: 'sg' },
  esta: { gender: 'f', number: 'sg' },
  esa: { gender: 'f', number: 'sg' },
  los: { gender: 'm', number: 'pl' },
  unos: { gender: 'm', number: 'pl' },
  estos: { gender: 'm', number: 'pl' },
  esos: { gender: 'm', number: 'pl' },
  las: { gender: 'f', number: 'pl' },
  unas: { gender: 'f', number: 'pl' },
  estas: { gender: 'f', number: 'pl' },
  esas: { gender: 'f', number: 'pl' },
}
/** «listo», «hecho», «preparado», «rico» right before the article («¿Está lista la …?»). */
const PARTICIPLE = /^(list|hech|preparad|ric|terminad|acabad)(o|a|os|as)$/

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function agreementOf(word: string): Agreement | null {
  const w = fold(word)
  if (DETERMINERS[w]) return DETERMINERS[w]
  const m = PARTICIPLE.exec(w)
  if (!m) return null
  const end = m[2]
  return { gender: end.startsWith('a') ? 'f' : 'm', number: end.endsWith('s') ? 'pl' : 'sg' }
}
const same = (a: Agreement, b: Agreement) => a.gender === b.gender && a.number === b.number

/**
 * Pure: the first dish whose article (or «listo/lista…» right before it)
 * doesn't agree with it in the text, or null. «la cena (*Costillas…*)» is
 * fine: the article goes with «cena», not with the dish.
 */
export function agreementMismatch(text: string, names: readonly string[]): string | null {
  for (const name of new Set(names)) {
    const a = dishAgreement(name)
    if (!a) continue
    const re = new RegExp(`([A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)[\\s*_«"“]+(?:([A-Za-zÁÉÍÓÚáéíóúÑñÜü]+)[\\s*_«"“]+)?${escapeRe(name)}`, 'gi')
    for (const m of text.matchAll(re)) {
      // m[1] … m[2] NAME: the word right before the name is m[2] when present.
      const near = m[2] ?? m[1]
      const far = m[2] ? m[1] : null
      const nearA = agreementOf(near)
      if (nearA && !same(nearA, a)) return name
      // «lista la Costillas»: the participle before the article.
      if (far && nearA && DETERMINERS[fold(near)]) {
        const farA = PARTICIPLE.test(fold(far)) ? agreementOf(far) : null
        if (farA && !same(farA, a)) return name
      }
    }
  }
  return null
}
