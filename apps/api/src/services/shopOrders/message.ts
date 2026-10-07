/**
 * The texts and links ONA hands the user (specs/shop-orders.md).
 *
 * v1 never messages a shop itself: the order is written in the customer's
 * voice and opened in THEIR WhatsApp / mail app (wa.me / mailto) so they
 * send it. That keeps Meta's opt-in rule, LSSI and the AI-disclosure duty
 * out of the picture, and the shop talks to a person it already knows.
 */

import type { ShopChannel, ShopFulfilment, ShopKind, ShopOrderLine } from '@ona/shared'
import { lineRequestText, prettyName } from './format.js'

/** Beyond this, prefilled wa.me texts get cut on some phones — offer "copy" instead. */
export const MAX_PREFILL_CHARS = 1200

export interface OrderMessageInput {
  kind: ShopKind
  /** Web shops get a plain checklist the user follows on the shop's site. */
  channel: ShopChannel
  customerName: string | null
  fulfilment: ShopFulfilment
  address: string | null
  lines: Array<Pick<ShopOrderLine, 'name' | 'quantity' | 'unit' | 'note'>>
}

export function buildOrderMessage(input: OrderMessageInput): string {
  const lines = input.lines.map((l) => lineRequestText(l, input.kind))
  if (input.channel === 'web') return ['Lista de la compra:', '', ...lines].join('\n')
  const hello = input.customerName ? `Hola, soy ${input.customerName}.` : 'Hola.'
  const how =
    input.fulfilment === 'domicilio' && input.address
      ? `Os paso un pedido para que me lo traigáis a ${input.address}:`
      : 'Os paso un pedido para recoger en la tienda:'
  const tail: string[] = []
  if (input.kind === 'pescaderia' || input.kind === 'carniceria') {
    tail.push('Si no hay algo, decidme qué me recomendáis en su lugar.')
  }
  tail.push('¿Me decís qué hay, el precio por kilo y el total aproximado antes de prepararlo? Gracias.')
  return [hello, how, '', ...lines, '', ...tail].join('\n')
}

export interface ConfirmationInput {
  lines: Array<Pick<ShopOrderLine, 'name' | 'decision' | 'quote'>>
  capEur: number | null
}

export function buildConfirmationMessage(input: ConfirmationInput): string {
  const live = input.lines.filter((l) => l.quote?.status !== 'no_hay')
  const removed = live.filter((l) => l.decision === 'remove').map((l) => prettyName(l.name))
  const substitutes = live
    .filter((l) => l.decision === 'keep' && l.quote?.status === 'sustituto' && l.quote.substitute)
    .map((l) => `Sí a ${l.quote!.substitute} en lugar de ${prettyName(l.name)}.`)
  const out: string[] = []
  out.push(removed.length || substitutes.length ? 'Perfecto, adelante con el pedido.' : 'Perfecto, adelante con todo.')
  if (removed.length) out.push(`Quita: ${removed.join(', ')}.`)
  out.push(...substitutes)
  if (input.capEur) out.push(`Si el total pasa de ${input.capEur} €, avisadme antes, por favor.`)
  out.push('¡Gracias!')
  return out.join('\n')
}

export function waLink(phoneDigits: string, text: string): string {
  return `https://wa.me/${phoneDigits.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`
}

export function mailtoLink(email: string, subject: string, body: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`
}

export function isTooLongToPrefill(text: string): boolean {
  return text.length > MAX_PREFILL_CHARS
}

/**
 * Product search on the shop's own web, for the shops whose search URL we
 * have verified (El Corte Inglés, 2026-10-07). Others get no per-line link.
 */
export function shopSearchUrl(webUrl: string | null, query: string): string | null {
  if (!webUrl) return null
  let host: string
  try {
    host = new URL(webUrl).hostname
  } catch {
    return null
  }
  if (host.endsWith('elcorteingles.es')) {
    return `https://www.elcorteingles.es/supermercado/buscar?question=${encodeURIComponent(query)}&catalog=supermercado`
  }
  return null
}
