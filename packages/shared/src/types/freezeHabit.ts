/**
 * «¿Congeláis la carne o el pescado cuando compráis?» (PRO-221, D-069;
 * specs/user-memory.md, specs/notifications.md). One tap in the sign-up,
 * next to «¿Cómo cocináis en casa?». The answer is a habit in the memory
 * (`prep_habits`), which is what turns on «hoy toca descongelar»:
 *   - «Sí, casi siempre» → «Congelo la carne y el pescado»;
 *   - «A veces» → «A veces congelo la carne y el pescado», and the alert
 *     says «Si lo tienes congelado, sácalo hoy.»;
 *   - «No» → nothing (and removes either sentence if it was there).
 * It can be changed in Perfil → «Lo que recuerdo de ti» and by Mimo
 * (`update_memory`, «siempre congelo el pescado»).
 */
import { z } from 'zod'

export const FREEZE_ANSWERS = ['yes', 'sometimes', 'no'] as const
export type FreezeAnswer = (typeof FREEZE_ANSWERS)[number]

export const FREEZE_QUESTION = '¿Congeláis la carne o el pescado cuando compráis?'

export const FREEZE_ANSWER_LABELS: Record<FreezeAnswer, string> = {
  yes: 'Sí, casi siempre',
  sometimes: 'A veces',
  no: 'No',
}

export const FREEZE_HABIT_ALWAYS = 'Congelo la carne y el pescado'
export const FREEZE_HABIT_SOMETIMES = 'A veces congelo la carne y el pescado'

/** The text of the thaw alert when the household only freezes «a veces». */
export const THAW_CONDITIONAL_TEXT = 'Si lo tienes congelado, sácalo hoy.'

export const freezeAnswerSchema = z.enum(FREEZE_ANSWERS)

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const THAW_HABIT_RE = /congel|descongel/
const SOMETIMES_RE = /\b(a veces|algunas veces|de vez en cuando)\b/

/**
 * The habits once the answer is saved. The answer replaces every habit that
 * mentions freezing («siempre congelo el pescado» too), because any of them
 * turns the thaw alert on; the other habits stay.
 */
export function applyFreezeAnswer(habits: readonly string[] | null | undefined, answer: FreezeAnswer): string[] {
  const rest = (habits ?? []).filter((h) => typeof h === 'string' && !THAW_HABIT_RE.test(norm(h)))
  if (answer === 'yes') return [...rest, FREEZE_HABIT_ALWAYS]
  if (answer === 'sometimes') return [...rest, FREEZE_HABIT_SOMETIMES]
  return rest
}

/**
 * What the alerts do today, as an answer (for Perfil): «Sí» when a freezing
 * habit turns the thaw alert on, «A veces» when it is conditional, null when
 * there is none (nothing answered, or «No»).
 */
export function freezeAnswerFromHabits(habits: readonly string[] | null | undefined): FreezeAnswer | null {
  const list = (habits ?? []).filter((h): h is string => typeof h === 'string')
  if (!list.some((h) => THAW_HABIT_RE.test(norm(h)))) return null
  return thawIsConditional(list) ? 'sometimes' : 'yes'
}

/**
 * The thaw alert is conditional: every habit that turns it on says «a veces»
 * (so «A veces congelo…» alone → «Si lo tienes congelado, sácalo hoy.»;
 * with «siempre congelo el pescado» too, the usual text).
 */
export function thawIsConditional(habits: readonly string[]): boolean {
  const thaw = habits.map(norm).filter((h) => THAW_HABIT_RE.test(h))
  return thaw.length > 0 && thaw.every((h) => SOMETIMES_RE.test(h))
}
