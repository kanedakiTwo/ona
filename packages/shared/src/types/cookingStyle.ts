/**
 * How the household cooks (PRO-217, D-069; specs/household-profile.md).
 *
 * Not how often (`cookingFreq`) but how: every day, some days with leftovers
 * for others, batch cooking for the week, or deciding each day. Asked in the
 * sign-up (web and WhatsApp), in Perfil and by Mimo (`set_cooking_style`), and
 * kept in the household's ficha as the fact `cooking_style`. Today it is only
 * collected and shown; the menu reads it with PRO-219.
 *
 * Since 2026-11-03 (Miguel: the questions overlapped) the sign-up no longer
 * asks «¿Cuántas veces a la semana cocinas?»: `cookingFreq` comes from this
 * answer (`cookingFreqForStyle`).
 */
import { z } from 'zod'
import type { CookingFrequency } from '../constants/enums.js'

export const COOKING_STYLES = ['daily', 'cook_and_reuse', 'batch', 'improvise'] as const
export type CookingStyle = (typeof COOKING_STYLES)[number]

/**
 * How often a household cooks, read from how it cooks: batch cooking is
 * cooking once or twice a week («poco», so weekday dishes stay quick when
 * there is no time answer, `weekTimeBudgets`); deciding each day says nothing
 * about how often, so it is the usual «3-4 veces».
 */
const COOKING_FREQ_FOR_STYLE: Record<CookingStyle, CookingFrequency> = {
  daily: 'daily',
  cook_and_reuse: '3_4_times',
  batch: 'rarely',
  improvise: '3_4_times',
}

export function cookingFreqForStyle(style: CookingStyle): CookingFrequency {
  return COOKING_FREQ_FOR_STYLE[style]
}

export const COOKING_STYLE_QUESTION = '¿Cómo cocináis en casa?'

/** The four answers, word for word (D-069). */
export const COOKING_STYLE_LABELS: Record<CookingStyle, string> = {
  daily: 'Cocino cada día',
  cook_and_reuse: 'Cocino unos días y aprovecho para otros',
  batch: 'Batch cooking: cocino una o dos veces y dejo hecha la semana',
  improvise: 'Improviso: decido cada día',
}

/** The answer split for a card: the part before «:» as the title, the rest below. */
export function cookingStyleParts(style: CookingStyle): { title: string; detail: string | null } {
  const label = COOKING_STYLE_LABELS[style]
  const i = label.indexOf(':')
  if (i < 0) return { title: label, detail: null }
  const rest = label.slice(i + 1).trim()
  return { title: label.slice(0, i), detail: rest.charAt(0).toUpperCase() + rest.slice(1) }
}

export function isCookingStyle(v: unknown): v is CookingStyle {
  return typeof v === 'string' && (COOKING_STYLES as readonly string[]).includes(v)
}

export const cookingStyleSchema = z.enum(COOKING_STYLES)

/** The value of a `cooking_style` fact in the ficha. */
export const cookingStyleFactValueSchema = z.object({ style: cookingStyleSchema }).strict()

/** Perfil and Mimo's `set_cooking_style` both write through this route. */
export const COOKING_STYLE_PATH = '/household/cooking-style'

/** `PUT /household/cooking-style` (Perfil and Mimo). */
export const setCookingStyleSchema = z.object({ style: cookingStyleSchema }).strict()
