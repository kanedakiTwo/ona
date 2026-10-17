/**
 * Health out of WhatsApp text, for the household's ficha (PRO-151, LEG-03).
 *
 * Over WhatsApp Mimoia never stores health data (Meta's terms 4.2, LEG-03,
 * PRO-24): the skills refuse it (`whatsappHealthData.test.ts`). The ficha's
 * daily signals carry what was said in the chat, so the same rule applies to
 * the text itself: before a WhatsApp message (either direction) reaches the
 * signals, every sentence that talks about health is replaced by «[omitido]».
 *
 * Deterministic and deliberately over-eager, like `anonymise.ts`: a sentence
 * about «comida sin gluten» lost by mistake costs a little context; a
 * «soy celíaca» let through would be a health fact the refiner could learn
 * from WhatsApp.
 *
 * Health here = the categories the health consent covers (allergies,
 * intolerances, restrictions for medical reasons, body data) plus illnesses,
 * medication, pregnancy and religion-based diets (special-category data, RGPD
 * art. 9). Vegetarian / vegan are taste, not health: they stay.
 *
 * The refiner (PRO-152) reuses `HEALTH_TEXT_PATTERNS` to reject a deduced
 * health fact.
 */
import { normalizeText } from '../dietaryRestrictions.js'

/** Matched against `normalizeText` (lowercase, no accents). */
export const HEALTH_TEXT_PATTERNS: ReadonlyArray<RegExp> = [
  // Allergies, intolerances, coeliac disease.
  /\balergi/, /\balergic/, /\bintoleran/, /\bceliac/, /\bgluten\b/, /\blactosa\b/, /\bfodmap/, /\banafila/, /\bepipen\b/,
  // Illnesses and conditions.
  /\bdiabet/, /\binsulina\b/, /\bglucosa\b/, /\bazucar en (la )?sangre\b/, /\bcolesterol/, /\bhipertens/, /\btension (alta|baja)\b/,
  /\btrigliceridos\b/, /\bacido urico\b/, /\benferm[oa]s?\b/, /\benfermedad/, /\bcancer\b/, /\bquimio/, /\bcrohn\b/,
  /\bcolon irritable\b/, /\breflujo\b/, /\bgastritis\b/, /\banemi/, /\btiroid/, /\bhipotiroid/, /\bhipertiroid/, /\binsuficiencia\b/,
  /\bfenilceton/, /\bhistamina\b/, /\bsalud\b/,
  // Medication and professionals.
  /\bmedicacion\b/, /\bmedicamento/, /\bpastillas?\b/, /\btratamiento\b/, /\bmedic[oa]s?\b/, /\bdoctor[a]?\b/, /\bendocrin/,
  /\bnutricionista\b/, /\bdietista\b/, /\bpediatra\b/,
  // Pregnancy and breastfeeding.
  /\bembaraz/, /\blactancia\b/, /\bdando el pecho\b/,
  // Body data.
  /\b(peso|pesa|pesamos|pesan|mido|mide|medimos)\s+(unos?\s+|mas de\s+|menos de\s+)?\d/, /\b\d+([.,]\d+)?\s*(kg|kilos)\s+de\s+(mas|menos)\b/,
  /\bkilos de mas\b/, /\b(perder|bajar|subir|ganar) (de )?peso\b/, /\badelgaz/, /\bsobrepeso\b/, /\bobesidad\b/, /\bimc\b/,
  /\bcalorias (diarias|al dia)\b/,
  // Religion-based diets.
  /\bhalal\b/, /\bkosher\b/,
]

/** What a removed sentence becomes. */
export const HEALTH_OMITTED = '[omitido]'

/** Pure: does this text talk about health (any pattern above)? */
export function mentionsHealth(text: string): boolean {
  const n = normalizeText(text)
  return HEALTH_TEXT_PATTERNS.some((re) => re.test(n))
}

/**
 * Pure: the text with every health sentence replaced by «[omitido]»
 * (consecutive ones collapse into one). Sentences end at . ! ? ; or a line
 * break; the punctuation stays with its sentence.
 */
export function stripHealthFromWhatsAppText(text: string): { text: string; removed: number } {
  const parts = text.match(/[^.!?;\n]+[.!?;]*|\n+/g) ?? []
  let removed = 0
  const out: string[] = []
  for (const part of parts) {
    if (/^\n+$/.test(part)) {
      out.push(part)
      continue
    }
    if (mentionsHealth(part)) {
      removed++
      const last = out.length ? out[out.length - 1].trim() : ''
      if (last !== HEALTH_OMITTED) out.push(`${/^\s/.test(part) && out.length ? ' ' : ''}${HEALTH_OMITTED}`)
      continue
    }
    out.push(part)
  }
  if (!removed) return { text, removed: 0 }
  return { text: out.join('').trim(), removed }
}
