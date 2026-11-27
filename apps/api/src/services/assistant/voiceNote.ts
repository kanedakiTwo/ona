/**
 * PRO-1336 (D-1029): a voice note (WhatsApp audio, the web chat's mic) can come
 * back from speech-to-text badly heard, and Mimo's beta has older people, who
 * speech recognition fails more often. So, without any new call to the model:
 *
 *   - empty transcript (or only an STT ghost like «Subtítulos realizados por la
 *     comunidad de Amara.org») → ask to repeat it;
 *   - doubtful (only fillers, or one loose word that answers nothing) → say
 *     what was heard and ask, before Mimo touches anything;
 *   - clear → Mimo answers, told by a note that if it changes the menu, the
 *     list or the ficha the reply opens with «Entendido: …»; and if a tool
 *     changed something and the reply lacks that line, the code puts it, with
 *     the words it heard. No change goes out without it.
 */
import { toolMadeChange } from './claims.js'
import type { ToolTrace } from './types.js'

export type VoiceNoteClarity = 'empty' | 'doubtful' | 'clear'
type Lang = 'es' | 'en'

const fold = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')

/** What some speech-to-text models write over silence or noise: nothing was said. */
const STT_GHOST_RE = /amara\.org|subtitulos (?:realizados|por)|gracias por (?:ver|su atencion)|suscribete|thanks for watching/

/** Sounds that carry no request. */
const FILLERS = new Set(['eh', 'ehh', 'em', 'emm', 'ehm', 'mm', 'mmm', 'hmm', 'ah', 'ahh', 'oh', 'uh', 'um', 'este', 'pues', 'bueno', 'nada', 'osea', 'o', 'sea', 'a', 'ver', 'oye', 'mira'])

/** One word that is a whole message on its own (a greeting, a yes, the cook mode's «siguiente»). */
const ONE_WORD_MESSAGES = new Set([
  'si', 'no', 'vale', 'ok', 'okey', 'okay', 'gracias', 'hola', 'buenas', 'adios', 'claro', 'perfecto', 'genial', 'venga',
  'guay', 'bien', 'listo', 'hecho', 'siguiente', 'anterior', 'repite', 'repetir', 'para', 'espera', 'ayuda', 'menu', 'lista',
  'compra', 'hoy', 'manana', 'yes', 'thanks', 'hello', 'hi', 'next',
])

/**
 * How clear a transcript is. `answering`: Mimo's last message asked something,
 * so one word («jueves», «pescado») is an answer and not a loose word.
 */
export function voiceNoteClarity(transcript: string | null | undefined, answering = false): VoiceNoteClarity {
  const t = fold((transcript ?? '').trim())
  if (!/[\p{L}\p{N}]/u.test(t) || STT_GHOST_RE.test(t)) return 'empty'
  const words = t.split(/[^\p{L}\p{N}]+/u).filter(Boolean)
  const meaningful = words.filter((w) => !FILLERS.has(w))
  if (meaningful.length === 0) return 'doubtful'
  if (meaningful.length === 1 && !answering && !ONE_WORD_MESSAGES.has(meaningful[0]) && !/^\d+$/.test(meaningful[0])) return 'doubtful'
  return 'clear'
}

/** The words heard, as they go between quotes in a reply (one line, bounded). */
export function heardWords(transcript: string, max = 120): string {
  const t = transcript.replace(/\s+/g, ' ').trim().replace(/[.!?¿¡,;:\s]+$/, '').replace(/^[¿¡\s]+/, '')
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t
}

/** Empty transcript: nothing heard. */
export function voiceEmptyReply(lang: Lang = 'es'): string {
  return lang === 'en' ? "I couldn't hear you well. Could you say it again or type it?" : 'No te he oído bien. ¿Me lo repites o me lo escribes?'
}

/** Doubtful transcript: what was heard, and a question instead of a change. */
export function voiceDoubtfulReply(transcript: string, lang: Lang = 'es'): string {
  const heard = heardWords(transcript)
  return lang === 'en'
    ? `I heard “${heard}”, but I'm not sure what you'd like me to do. Could you say it again or type it?`
    : `He oído «${heard}», pero no sé bien qué quieres que haga. ¿Me lo repites o me lo escribes?`
}

/** Goes with a clear voice note to Mimo (in the message, not the system prompt: the cache holds). */
export const VOICE_NOTE_NOTE =
  '[Nota del sistema, no la menciones] Este mensaje es una nota de voz transcrita y puede venir mal entendida. ' +
  'Si vas a cambiar algo (el menu, la lista de la compra, la despensa o la ficha), la respuesta empieza por una linea corta con lo que has entendido, ' +
  '«Entendido: <lo que pide, en pocas palabras>.», y despues lo de siempre («Hecho: …»). ' +
  'Si la frase no tiene sentido, esta cortada o no sabes que cambio pide, no cambies nada: di lo que has oido y pregunta en una linea.'

/** The voice note's words with the note above, as they reach the model. */
export function withVoiceNoteNote(message: string): string {
  return `${VOICE_NOTE_NOTE}\n\n${message}`
}

const UNDERSTOOD_RE = /^[\s*_]*(?:entendido|understood)\b/i

/** Did any tool of the turn change something? (read-only tools, errors and «no he cambiado nada» don't count) */
export function turnChangedSomething(trace: readonly Pick<ToolTrace, 'name' | 'summary' | 'error' | 'unchanged'>[] | undefined): boolean {
  return (trace ?? []).some((t) => !t.unchanged && toolMadeChange(t.name, t.summary, t.error === true))
}

/**
 * The reply to a voice note that changed something opens with what was
 * understood. Mimo usually writes it (VOICE_NOTE_NOTE); when it doesn't, the
 * code puts the words it heard. A reply that changed nothing is left as is.
 */
export function withUnderstoodLine(
  message: string,
  transcript: string,
  trace: readonly Pick<ToolTrace, 'name' | 'summary' | 'error' | 'unchanged'>[] | undefined,
  lang: Lang = 'es',
): string {
  if (!turnChangedSomething(trace) || UNDERSTOOD_RE.test(message)) return message
  const heard = heardWords(transcript)
  const line = lang === 'en' ? `Understood: “${heard}”.` : `Entendido: «${heard}».`
  return message.trim() ? `${line}\n${message}` : line
}
