/**
 * Reads a shop's free-text reply ("la merluza a 24 €/kg, 1,4 kg; mejillón
 * hoy no hay; total 36,85") into a per-line quote (specs/shop-orders.md).
 *
 * One Claude Haiku call; its JSON is then normalised by a pure function
 * (unknown keys dropped, "12,50 €" → 12.5, unknown statuses discarded), so
 * a sloppy model answer degrades to "the shop didn't mention this line" —
 * which sends the line to the user — never to an invented price.
 * Extraction never confirms anything by itself: the user approves.
 */

import Anthropic from '@anthropic-ai/sdk'
import type { LineQuote, LineQuoteStatus, ShopKind, ShopOrderLine } from '@ona/shared'
import { env } from '../../config/env.js'
import { recordAnthropicCost } from '../costLedger.js'
import { lineRequestText } from './format.js'

const MODEL = 'claude-haiku-4-5-20251001'
const STATUSES = new Set<LineQuoteStatus>(['ok', 'no_hay', 'sustituto', 'parcial'])

export interface ParsedReply {
  lines: Record<string, LineQuote>
  totalEur: number | null
  pickupText: string | null
  paymentText: string | null
  notes: string | null
}

const SYSTEM_PROMPT = `Lees la respuesta de una tienda de alimentación española (frutería, carnicería, pescadería o súper) a un pedido de un cliente. Te paso las líneas del pedido, cada una con su clave, y el texto que ha contestado la tienda (puede venir de un audio transcrito).

Devuelve SOLO JSON, sin markdown, con esta forma:
{"lines":[{"key":"l1","status":"ok|no_hay|sustituto|parcial","quantity":"1,4 kg"|null,"price_per_kg":24|null,"line_total":33.6|null,"substitute":"pescadilla"|null,"comment":"..."|null}],"total_eur":36.85|null,"pickup":"..."|null,"payment":"..."|null,"notes":"..."|null}

Reglas:
- Incluye una línea SOLO si la tienda dice algo de ella. Si no la menciona, no la incluyas.
- status: "ok" si la tiene en la cantidad pedida (o casi); "no_hay" si no la tiene y no propone nada; "sustituto" si propone otra cosa en su lugar (pon cuál en substitute); "parcial" si da una cantidad claramente distinta de la pedida, menos o más (pon la que da en quantity).
- Si la tienda dice "todo bien" o "lo tengo todo" sin detalle, marca todas las líneas como "ok" sin precios.
- NUNCA inventes precios ni cantidades. Copia solo números que aparezcan en el texto. Si da el precio por kilo y el peso, puedes calcular line_total; si no, déjalo null.
- Números con punto decimal (12.5), sin símbolo de euro.
- pickup: cuándo/cómo se recoge o se entrega, si lo dice. payment: cómo se paga, si lo dice. notes: cualquier otra cosa importante.`

const round2 = (n: number) => Math.round(n * 100) / 100

export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) && v >= 0 ? round2(v) : null
  if (typeof v !== 'string') return null
  const m = v.replace(/\s/g, '').match(/\d+(?:[.,]\d+)?/)
  if (!m) return null
  const n = Number(m[0].replace(',', '.'))
  return Number.isFinite(n) ? round2(n) : null
}

function str(v: unknown, max = 200): string | null {
  return typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null
}

export function normalizeParsedReply(raw: unknown, validKeys: Set<string>): ParsedReply {
  const obj = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const lines: Record<string, LineQuote> = {}
  for (const item of Array.isArray(obj.lines) ? obj.lines : []) {
    if (!item || typeof item !== 'object') continue
    const r = item as Record<string, unknown>
    const key = typeof r.key === 'string' ? r.key : null
    const status = r.status as LineQuoteStatus
    if (!key || !validKeys.has(key) || !STATUSES.has(status)) continue
    lines[key] = {
      status,
      quantityText: str(r.quantity, 40),
      pricePerKg: toNumber(r.price_per_kg),
      lineTotal: toNumber(r.line_total),
      substitute: status === 'sustituto' ? str(r.substitute, 80) : null,
      comment: str(r.comment),
    }
  }
  return {
    lines,
    totalEur: toNumber(obj.total_eur),
    pickupText: str(obj.pickup),
    paymentText: str(obj.payment),
    notes: str(obj.notes, 300),
  }
}

export function extractJson(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    const m = text.match(/\{[\s\S]*\}/)
    if (!m) return null
    try {
      return JSON.parse(m[0])
    } catch {
      return null
    }
  }
}

type CreateFn = (params: Anthropic.MessageCreateParamsNonStreaming) => Promise<Pick<Anthropic.Message, 'content' | 'usage'>>

export interface ParseInput {
  text: string
  kind: ShopKind
  lines: Array<Pick<ShopOrderLine, 'key' | 'name' | 'quantity' | 'unit' | 'note'>>
}

/** Null when the model is unavailable or answers garbage — the caller tells the user to retry. */
export async function parseShopReply(input: ParseInput, deps: { create?: CreateFn } = {}): Promise<ParsedReply | null> {
  let create = deps.create
  if (!create) {
    if (!env.ANTHROPIC_API_KEY) return null
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY })
    create = (p) => client.messages.create(p)
  }
  const order = input.lines.map((l) => `${l.key}: ${lineRequestText(l, input.kind).replace(/^- /, '')}`).join('\n')
  let response
  try {
    response = await create({
      model: MODEL,
      max_tokens: 1500,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: `PEDIDO:\n${order}\n\nRESPUESTA DE LA TIENDA:\n${input.text.slice(0, 4000)}` }],
    })
  } catch (err) {
    console.warn('[shopOrders] quote parse failed:', err)
    return null
  }
  recordAnthropicCost('shop_quote_parse', MODEL, response.usage)
  const block = response.content.find((b) => b.type === 'text')
  if (!block || block.type !== 'text') return null
  const json = extractJson(block.text)
  if (!json) return null
  return normalizeParsedReply(json, new Set(input.lines.map((l) => l.key)))
}
