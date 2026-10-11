/**
 * The texts and links Mimoia hands the user (specs/shop-orders.md).
 *
 * v1 never messages a shop itself: the order is written in the customer's
 * voice and opened in THEIR WhatsApp / mail app (wa.me / mailto) so they
 * send it. That keeps Meta's opt-in rule, LSSI and the AI-disclosure duty
 * out of the picture, and the shop talks to a person it already knows.
 */

import { BUY_RULES, type ShopChannel, type ShopFulfilment, type ShopKind, type ShopOrderLine } from '@ona/shared'
import { prettyName } from './format.js'
import { lineText } from './lines.js'

/** Beyond this, prefilled wa.me texts get cut on some phones — offer "copy" instead. */
export const MAX_PREFILL_CHARS = 1200

export interface OrderMessageInput {
  kind: ShopKind
  /** Web shops get a plain checklist the user follows on the shop's site. */
  channel: ShopChannel
  customerName: string | null
  fulfilment: ShopFulfilment
  address: string | null
  lines: ShopOrderLine[]
}

function joinEs(parts: string[]): string {
  return parts.length > 1 ? `${parts.slice(0, -1).join(', ')} y ${parts[parts.length - 1]}` : parts[0] ?? ''
}

/**
 * The order in the customer's voice. Delivery always carries the address and
 * asks roughly when it will arrive; pickup asks from what time to go. Meat and
 * fish ask the price per kilo and what to bring instead if something's missing
 * (not for a charcutería-only order).
 */
export function buildOrderMessage(input: OrderMessageInput): string {
  const live = input.lines.filter((l) => l.included !== false)
  const lines = live.map((l) => `- ${lineText(l, input.kind)}`)
  if (input.channel === 'web') return ['Lista de la compra:', '', ...lines].join('\n')
  const hello = input.customerName ? `Hola, soy ${input.customerName}.` : 'Hola.'
  const delivery = input.fulfilment === 'domicilio'
  const how = delivery
    ? `Os paso un pedido para que me lo traigáis a ${input.address ?? '[dirección]'}:`
    : 'Os paso un pedido para recoger en la tienda:'
  const fresh = input.kind === 'carniceria' || input.kind === 'pescaderia'
  const onlyCharcuteria = live.length > 0 && live.every((l) => l.ruleKey && CHARCUTERIA_KEYS.has(l.ruleKey))
  const tail: string[] = []
  if (fresh && !onlyCharcuteria) tail.push('Si no hay algo, decidme qué me recomendáis en su lugar.')
  const asks = [...(fresh ? ['el precio por kilo'] : []), 'el total aproximado', delivery ? 'más o menos a qué hora llegaría' : 'a partir de qué hora puedo pasar a recogerlo']
  tail.push(`Antes de prepararlo, ¿me decís ${joinEs(asks)}? Gracias.`)
  return [hello, how, '', ...lines, '', ...tail].join('\n')
}

const CHARCUTERIA_KEYS = new Set(BUY_RULES.filter((r) => r.shop === 'charcuteria').map((r) => r.key))

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
