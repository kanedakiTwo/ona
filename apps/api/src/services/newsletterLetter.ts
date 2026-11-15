/**
 * La carta personal de la newsletter (PRO-1123, D-176; specs/newsletter.md →
 * «Carta personal»).
 *
 * Miguel guarda una plantilla con huecos y el producto la rellena para cada
 * persona al componer su correo:
 *
 *   {nombre}  su nombre (el de la lista de espera, o el de usuario si parece
 *             un nombre); sin él, el hueco se va con su coma: «Hola, {nombre}:»
 *             → «Hola:», nunca «estimado usuario».
 *   {receta}  el título de la receta elegida para ella (la suya, PRO-1020, o
 *             la de la semana).
 *   {porque}  una frase de por qué se la ha elegido, por reglas, con lo que el
 *             producto ya sabe de su casa: cuántos sois, que no lleva lo que no
 *             os gusta (sin nombrarlo), la temporada y lo que cocinasteis la
 *             semana pasada. Nunca su salud (D-064, D-110): ni alergias, ni
 *             dietas, ni restricciones; un plato cocinado cuyo nombre las
 *             delata («sin gluten», «para diabéticos»…) no se nombra.
 *   {numeros} lo que su casa ha resuelto con Mimoia esta semana (o este mes),
 *             en una frase (PRO-1199, `newsletterNumbers.ts`); sin números o
 *             en la lista de espera, el hueco se va.
 *
 * Todo puro: lo de la base de datos lo trae `createDbNewsletterLetterRepo`
 * (newsletter.ts lo usa al componer), y aquí solo se decide el texto.
 */
import { and, eq, gte, inArray } from 'drizzle-orm'
import { detectSeason, type Season } from '@ona/shared'
import { db as defaultDb } from '../db/connection.js'
import { cookLogs, recipes, users, waitlistEntries } from '../db/schema.js'
import { loadUserRestrictions } from './withWhatIHave.js'
import { madridParts } from './madridTime.js'
import { loadHouseholdNumbers, type HouseholdNumbers } from './newsletterNumbers.js'

type Db = typeof defaultDb

export const LETTER_PLACEHOLDERS = ['{nombre}', '{receta}', '{porque}', '{numeros}'] as const

/** Lo que el producto sabe de la casa de una persona para escribirle. Ningún dato de salud. */
export interface LetterFacts {
  /** Ya limpio (`cleanFirstName`); null = sin nombre. */
  firstName: string | null
  /** Cuántos coméis en casa (adultos + niños); null = no se sabe. */
  people: number | null
  kids: number
  /** Ha dicho que algo no le gusta (no se nombra). */
  hasDislikes: boolean
  /** La receta más reciente que cocinó la casa en los últimos 7 días. */
  lastCooked: string | null
  /** Lista de espera: improvisa la cena hoy. */
  improvises?: boolean
  /** Lista de espera: «3-4» o «5+» (sin el número exacto). */
  bigHouse?: boolean
}

export const EMPTY_LETTER_FACTS: LetterFacts = { firstName: null, people: null, kids: 0, hasDislikes: false, lastCooked: null }

/** Un nombre de pila que se puede poner en un saludo: letras, espacios, guion o apóstrofo, hasta 30. */
export function cleanFirstName(raw: string | null | undefined): string | null {
  const n = raw?.trim().replace(/\s+/g, ' ')
  if (!n || !/^\p{L}[\p{L} '’-]{0,29}$/u.test(n)) return null
  return n.charAt(0).toLocaleUpperCase('es-ES') + n.slice(1)
}

/** El nombre de usuario solo vale si parece un nombre («miguel» sí; «mmartin84» o «ana_g» no). */
export function nameFromUsername(username: string | null | undefined): string | null {
  const u = username?.trim()
  if (!u || !/^\p{L}{2,20}$/u.test(u)) return null
  return cleanFirstName(u.toLocaleLowerCase('es-ES'))
}

/**
 * Lo que delata salud o dieta en el nombre de un plato: si lo cocinado lleva
 * algo así, no se nombra en la carta (D-064, D-110).
 */
const HEALTHY_WORDS =
  /\b(sin\s+(gluten|lactosa|az[uú]car|sal|huevo|frutos|leche|grasa)|cel[ií]ac|diab[eé]t|keto|cetog|vegan|vegetarian|light|bajo\s+en|apt[oa]\s+para|hipo|intoleran|alerg|fodmap|paleo|detox|dieta|adelgaz|s[aá]n[oa]s?\b)/i

export function safeDishName(name: string | null | undefined): string | null {
  const n = name?.trim()
  if (!n || n.length > 80 || HEALTHY_WORDS.test(n)) return null
  return n
}

const COUNT_WORDS = ['', '', 'los dos', 'los tres', 'los cuatro', 'los cinco', 'los seis', 'los siete', 'los ocho']

const SEASON_LINE: Record<Season, string> = {
  spring: 'es de primavera',
  summer: 'es de verano',
  autumn: 'es muy de otoño',
  winter: 'es de invierno, de las que reconfortan',
}

function joinEs(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? ''
  return `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}`
}

/**
 * Puro: la frase de por qué se le ha elegido la receta. `recipeSeasons`: las
 * temporadas de la receta elegida (vacío o sin dato = no se dice); `now`, la
 * fecha del envío (la temporada de Madrid).
 */
export function reasonLine(f: LetterFacts, recipeSeasons: readonly string[] | undefined, now: Date): string {
  const solo = f.people === 1
  const who =
    f.people === null
      ? f.bigHouse
        ? 'para toda la casa'
        : 'pensando en tu casa'
      : solo
        ? 'para ti'
        : f.people <= 8
          ? `para ${COUNT_WORDS[f.people]}${f.kids > 0 ? ', peques incluidos' : ''}`
          : 'para toda la casa'
  const reasons: string[] = []
  const [y, m, d] = madridParts(now).isoDate.split('-').map(Number)
  const season = detectSeason(new Date(y, m - 1, d))
  if (recipeSeasons?.includes(season)) reasons.push(SEASON_LINE[season])
  if (f.hasDislikes) reasons.push(solo ? 'no lleva nada de lo que me dijiste que no te gusta' : 'no lleva nada de lo que me dijisteis que no os gusta')
  const dish = safeDishName(f.lastCooked)
  if (dish) reasons.push(`cambia de registro después de «${dish}» la semana pasada`)
  if (reasons.length === 0 && f.improvises) reasons.push('para que esta semana no toque improvisar la cena')
  return reasons.length > 0 ? `La he elegido ${who}: ${joinEs(reasons)}.` : `La he elegido ${who}.`
}

export interface LetterVars {
  name: string | null
  recipe: string
  reason: string
  /** PRO-1199: «Tu semana con Mimoia: …» (`numbersSentence`); vacío = el hueco se va. */
  numbers?: string
}

/**
 * Puro: rellena los huecos de un texto. Sin nombre, «{nombre}» se va con la
 * coma que lo acompaña («Hola, {nombre}:» → «Hola:», «{nombre}, esta semana…»
 * → «Esta semana…»).
 */
export function fillLetter(text: string, v: LetterVars): string {
  let out = text
  if (v.name) {
    out = out.split('{nombre}').join(v.name)
  } else {
    out = out
      .replace(/[ \t]*,[ \t]*\{nombre\}/g, '')
      .replace(/\{nombre\}[ \t]*,?[ \t]*/g, '')
      // Lo que quedó al principio de una frase, en mayúscula.
      .replace(/(^|[.!?¡¿:]\s+|\n\s*)(\p{Ll})/gu, (_m, pre: string, c: string) => `${pre}${c.toLocaleUpperCase('es-ES')}`)
  }
  return (
    out
      .split('{receta}')
      .join(v.recipe)
      .split('{porque}')
      .join(v.reason)
      .split('{numeros}')
      .join(v.numbers ?? '')
      .replace(/[ \t]{2,}/g, ' ')
      // Un párrafo que solo era un hueco vacío no deja un hueco en blanco.
      .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
      .trim()
  )
}

/** ¿Lleva algún hueco? (el editor lo avisa si no: la carta saldría igual para todos). */
export function hasPlaceholders(text: string | undefined): boolean {
  return !!text && LETTER_PLACEHOLDERS.some((p) => text.includes(p))
}

// ─── Repo ────────────────────────────────────────────────────────

export interface NewsletterLetterRepo {
  /** Lo que se sabe de la casa de cada cuenta (sin salud). */
  accountFacts(userIds: string[], now: Date): Promise<Map<string, LetterFacts>>
  /** Las temporadas de estas recetas. */
  recipeSeasons(recipeIds: string[]): Promise<Map<string, string[]>>
  /** PRO-1199: lo que la casa de cada cuenta ha hecho con Mimoia (solo cifras). Sin él, no hay números. */
  numbers?(userIds: string[], now: Date): Promise<Map<string, HouseholdNumbers>>
}

const DAY_MS = 24 * 60 * 60 * 1000

export function createDbNewsletterLetterRepo(db: Db = defaultDb): NewsletterLetterRepo {
  return {
    async accountFacts(userIds, now) {
      const out = new Map<string, LetterFacts>()
      if (userIds.length === 0) return out
      const people = await db
        .select({
          id: users.id,
          username: users.username,
          adults: users.adults,
          kids: users.kidsCount,
          householdId: users.primaryHouseholdId,
          email: users.email,
        })
        .from(users)
        .where(inArray(users.id, userIds))
      // The name they gave on the waitlist (entries keep the email lowercase).
      const emails = [...new Set(people.map((p) => p.email.trim().toLowerCase()))]
      const listed =
        emails.length > 0
          ? await db
              .select({ email: waitlistEntries.email, firstName: waitlistEntries.firstName })
              .from(waitlistEntries)
              .where(inArray(waitlistEntries.email, emails))
          : []
      const hids = [...new Set(people.flatMap((p) => (p.householdId ? [p.householdId] : [])))]
      const cooked =
        hids.length > 0
          ? await db
              .select({ householdId: cookLogs.householdId, name: recipes.name, at: cookLogs.cookedAt })
              .from(cookLogs)
              .innerJoin(recipes, eq(recipes.id, cookLogs.recipeId))
              .where(and(inArray(cookLogs.householdId, hids), gte(cookLogs.cookedAt, new Date(now.getTime() - 7 * DAY_MS))))
          : []
      for (const p of people) {
        // Solo si hay algo que no le gusta, nunca qué (ni sus restricciones).
        const { dislikes } = await loadUserRestrictions(p.id, db).catch(() => ({ dislikes: [] as string[] }))
        const last = cooked
          .filter((c) => c.householdId === p.householdId && safeDishName(c.name))
          .sort((a, b) => b.at.getTime() - a.at.getTime())[0]
        out.set(p.id, {
          firstName:
            cleanFirstName(listed.find((w) => w.email === p.email.trim().toLowerCase())?.firstName) ?? nameFromUsername(p.username),
          people: Math.max(1, (p.adults ?? 1) + (p.kids ?? 0)),
          kids: p.kids ?? 0,
          hasDislikes: dislikes.length > 0,
          lastCooked: last?.name ?? null,
        })
      }
      return out
    },
    async recipeSeasons(recipeIds) {
      const out = new Map<string, string[]>()
      if (recipeIds.length === 0) return out
      const rows = await db.select({ id: recipes.id, seasons: recipes.seasons }).from(recipes).where(inArray(recipes.id, recipeIds))
      for (const r of rows) out.set(r.id, r.seasons ?? [])
      return out
    },
    numbers: (userIds, now) => loadHouseholdNumbers(userIds, now, db),
  }
}

/** Lo que se sabe de alguien de la lista de espera (su nombre, cuántos sois, si improvisa). */
export function waitlistLetterFacts(e: { firstName?: string | null; householdSize?: string | null; currentMethod?: string | null }): LetterFacts {
  const size = e.householdSize === '1' ? 1 : e.householdSize === '2' ? 2 : null
  return {
    firstName: cleanFirstName(e.firstName),
    people: size,
    kids: 0,
    hasDislikes: false,
    lastCooked: null,
    improvises: e.currentMethod === 'improviso',
    bigHouse: e.householdSize === '3-4' || e.householdSize === '5+',
  }
}
