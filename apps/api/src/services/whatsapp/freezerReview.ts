import { madridParts, type MadridParts } from '../madridTime.js'
import type { GuideSpec } from './guided.js'
import type { OutboundMessage } from './render.js'

/**
 * PRO-228 · «Repaso del congelador», once a month: what has been in the
 * freezer for 4 weeks or more (`freezerItemsDue`, @ona/shared) and «¿Lo meto
 * en el menú de estas semanas?». «Sí, mételo» → Mimo calls
 * `plan_freezer_items`, which places it over the next two weeks.
 *
 * Weekly cap of messages (PRO-215, D-069): this is **priority 2** («lo que se
 * estropea: caducidades, sobras, congelador»). It is an ordinary proactive
 * message (an outbound row of kind `freezer_review`), so it spends one
 * message of the household's weekly budget like any other.
 */
export const FREEZER_REVIEW_KIND = 'freezer_review' as const
export const FREEZER_REVIEW_PRIORITY = 2 as const

/** Sunday 11:00–13:59 Madrid: before the evening planning message. */
export function isFreezerReviewWindow(p: MadridParts): boolean {
  return p.weekday === 6 && p.hour >= 11 && p.hour < 14
}

/** «Once a month»: nothing of this kind sent yet this (Madrid) calendar month. */
export function freezerReviewDue(p: MadridParts, lastSentAt: Date | null): boolean {
  if (!lastSentAt) return true
  return madridParts(lastSentAt).isoDate.slice(0, 7) !== p.isoDate.slice(0, 7)
}

export interface FreezerItem {
  name: string
  quantity: number
  unit: string
  storedAt: string
}

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre']
function sinceLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} de ${MONTHS[d.getUTCMonth()]}`
}
function itemLabel(i: FreezerItem): string {
  const qty = i.quantity > 0 && !(i.unit === 'u' && i.quantity === 1) ? ` (${i.quantity} ${i.unit})` : ''
  return `${i.name}${qty}`
}

export const FREEZER_REVIEW_QUESTION = '¿Lo meto en el menú de estas semanas?'

export function formatFreezerReview(items: FreezerItem[]): string {
  const shown = items.slice(0, 8)
  const lines = shown.map((i) => `- ${itemLabel(i)}, desde el ${sinceLabel(i.storedAt)}`)
  const more = items.length > shown.length ? `\n- y ${items.length - shown.length} más` : ''
  return `En el congelador tienes:\n${lines.join('\n')}${more}\n\n${FREEZER_REVIEW_QUESTION}`
}

export function freezerReviewMessages(items: FreezerItem[]): OutboundMessage[] {
  return [
    {
      type: 'buttons',
      text: formatFreezerReview(items),
      buttons: [
        { id: 'freezer:yes', title: 'Sí, mételo' },
        { id: 'freezer:no', title: 'Ahora no' },
      ],
    },
  ]
}

export function freezerReviewGuide(items: FreezerItem[]): GuideSpec {
  const shown = items.slice(0, 8)
  return {
    kind: FREEZER_REVIEW_KIND,
    facts: [
      ...shown.map((i) => `En el congelador desde el ${sinceLabel(i.storedAt)}: ${itemLabel(i)}`),
      ...(items.length > shown.length ? [`Y ${items.length - shown.length} cosas más`] : []),
      `Pregunta, tal cual: «${FREEZER_REVIEW_QUESTION}»`,
      'Botones debajo: «Sí, mételo» / «Ahora no»',
    ],
    required: [...shown.map((i) => i.name), FREEZER_REVIEW_QUESTION],
  }
}
