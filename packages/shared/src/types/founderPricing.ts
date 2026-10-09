/**
 * Founder pricing signal on the waitlist (PRO-26, D-020 / D-021). After
 * joining, people may answer four Van Westendorp price questions (€/month)
 * and only **then** see the plans and reserve a founder place. Nothing is
 * charged. No struck-through prices, no fake quotas (constitution §8.3).
 */
import { z } from 'zod'

/** The four questions, asked before the plans so the prices don't anchor them. */
export const PRICE_QUESTIONS = [
  { key: 'tooCheap', text: '¿A qué precio al mes Mimoia te parecería tan barato que dudarías de que funcione bien?' },
  { key: 'good', text: '¿A qué precio te parecería una buena compra?' },
  { key: 'expensive', text: '¿A qué precio empezaría a parecerte caro, aunque te lo pensarías?' },
  { key: 'tooExpensive', text: '¿A qué precio sería tan caro que no lo pagarías?' },
] as const

export type PriceQuestionKey = (typeof PRICE_QUESTIONS)[number]['key']

export const FOUNDER_PLAN_IDS = ['esencial-mensual', 'plus-anual', 'plus-mensual'] as const
export type FounderPlanId = (typeof FOUNDER_PLAN_IDS)[number]

export interface FounderPlan {
  id: FounderPlanId
  plan: 'esencial' | 'plus'
  period: 'mensual' | 'anual'
  name: string
  price: string
  /** Short line under the price («Plus por 5 €/mes»). */
  note?: string
  featured: boolean
  bullets: [string, string, string]
  /** The usage caps, in small print. */
  finePrint: string
}

/** In this order (D-021): Esencial, Plus anual (featured), Plus. */
export const FOUNDER_PLANS: readonly FounderPlan[] = [
  {
    id: 'esencial-mensual',
    plan: 'esencial',
    period: 'mensual',
    name: 'Esencial',
    price: '4,99 €/mes',
    featured: false,
    bullets: ['Menú de la semana y lista de la compra', 'Pedidos a tus tiendas de barrio', 'Importar recetas y Mimo por chat'],
    finePrint: 'Importar recetas y chatear con Mimo tienen un tope de uso al mes.',
  },
  {
    id: 'plus-anual',
    plan: 'plus',
    period: 'anual',
    name: 'Plus anual',
    price: '59,99 €/año',
    note: 'Plus por 5 €/mes',
    featured: true,
    bullets: ['Todo lo de Esencial', 'Habla con Mimo por voz', 'Mimo te escribe por WhatsApp'],
    finePrint: 'Un pago al año. La voz y los avisos por WhatsApp tienen un tope de uso al mes.',
  },
  {
    id: 'plus-mensual',
    plan: 'plus',
    period: 'mensual',
    name: 'Plus',
    price: '8,99 €/mes',
    featured: false,
    bullets: ['Todo lo de Esencial', 'Habla con Mimo por voz', 'Mimo te escribe por WhatsApp'],
    finePrint: 'La voz y los avisos por WhatsApp tienen un tope de uso al mes.',
  },
]

export const FOUNDER_TITLE = 'Reserva tu precio de fundador'
export const FOUNDER_SUBTITLE = 'No pagas nada ahora'
export const FOUNDER_HOUSEHOLD = 'para todo tu hogar'
export const FOUNDER_CTA = 'Reservar mi plaza de fundador'
export const FOUNDER_RESERVE_NOTE =
  'Sin pagar nada ahora: te guardamos este precio para siempre y te avisamos antes de cobrar'
export const FOUNDER_FOOTER =
  'Abrimos el 12 de enero. Empiezas con 14 días gratis con todo, sin tarjeta. Si te convence, eliges plan y pagas tu precio de fundador, que no subirá mientras sigas suscrito. Si no, no pagas nada. Puedes anular la reserva cuando quieras'
/** Beta households: no trial sentence. */
export const FOUNDER_FOOTER_BETA =
  'Tu beta sigue gratis hasta el 12 de enero. Si te convence, eliges plan y pagas tu precio de fundador, que no subirá mientras sigas suscrito. Si no, no pagas nada. Puedes anular la reserva cuando quieras'

export const FOUNDER_NONE = 'Ninguno me encaja'
export const FOUNDER_DECLINE_REASONS = ['caro', 'no_lo_usaria', 'me_falta_algo', 'otro'] as const
export type FounderDeclineReason = (typeof FOUNDER_DECLINE_REASONS)[number]
export const FOUNDER_DECLINE_LABELS: Record<FounderDeclineReason, string> = {
  caro: 'Es caro',
  no_lo_usaria: 'No lo usaría tanto',
  me_falta_algo: 'Me falta algo',
  otro: 'Otro motivo',
}

const token = z.string().trim().min(16).max(128)
/** €/month, optional, 0–500 with cents. */
const eur = z
  .number()
  .min(0)
  .max(500)
  .transform((n) => Math.round(n * 100) / 100)
  .nullish()
  .transform((v) => v ?? null)

export const waitlistPricingSchema = z.object({
  token,
  tooCheap: eur,
  good: eur,
  expensive: eur,
  tooExpensive: eur,
})
export type WaitlistPricingAnswers = z.output<typeof waitlistPricingSchema>

/** A plan, «Ninguno me encaja» (with its reason) or cancelling the reservation. */
export const waitlistReservationSchema = z.discriminatedUnion('choice', [
  z.object({ token, choice: z.enum(FOUNDER_PLAN_IDS) }),
  z.object({ token, choice: z.literal('ninguno'), reason: z.enum(FOUNDER_DECLINE_REASONS) }),
  z.object({ token, choice: z.literal('anular') }),
])
export type WaitlistReservation = z.output<typeof waitlistReservationSchema>

export function founderPlanById(id: string): FounderPlan | undefined {
  return FOUNDER_PLANS.find((p) => p.id === id)
}
