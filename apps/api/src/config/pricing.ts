/**
 * Provider price table for the cost ledger (`cost_events`, see
 * services/costLedger.ts) and the advisor budget (services/advisorBudget.ts).
 * The ONE place prices live: change a rate here (or via the
 * `COST_PRICE_OVERRIDES` env JSON) and every recorded cost follows.
 *
 * Prices are kept in the provider's billing currency (USD list prices, EUR for
 * Meta's Spain rate card) and converted with the single FX knob
 * `ADVISOR_EUR_PER_USD`. Amounts are stored as integer micro-euros (1e-6 €),
 * the same unit the advisor budget already uses.
 *
 * Keys are `${provider}/${model}` with dated snapshot suffixes stripped
 * (`claude-haiku-4-5-20251001` → `claude-haiku-4-5`).
 *
 * Anything marked `// UNVERIFIED` could not be checked against an official
 * price page on 2026-10-07 — override it with `COST_PRICE_OVERRIDES` once known,
 * e.g. `{"openai/gpt-realtime":{"perMinute":0.15}}`.
 */
import { env } from './env.js'

export type CostProvider = 'anthropic' | 'openai' | 'meta_whatsapp' | 'aikit'

export interface Price {
  currency: 'USD' | 'EUR'
  /** Per million tokens. */
  inputPerMTok?: number
  outputPerMTok?: number
  /** 5-minute ephemeral cache write (what engine.ts uses). */
  cacheWritePerMTok?: number
  cacheReadPerMTok?: number
  /** Audio input tokens (transcription); falls back to `inputPerMTok`. */
  audioInputPerMTok?: number
  perMinute?: number
  perMessage?: number
  perImage?: number
}

/** What one paid call consumed. Every field optional; absent = 0. */
export interface CostUnits {
  inputTokens?: number
  outputTokens?: number
  cacheWriteTokens?: number
  cacheReadTokens?: number
  audioInputTokens?: number
  minutes?: number
  messages?: number
  images?: number
}

export type PriceTable = Record<string, Price>

export const PRICES: PriceTable = {
  // ── Anthropic ────────────────────────────────────────────────
  // Source: Anthropic pricing via the claude-api model table (cached
  // 2026-09-25). Cache writes (5 min) = 1.25× input; cache reads = 0.1× input
  // except Opus 5.5 (0.05×).
  'anthropic/claude-haiku-4-5': { currency: 'USD', inputPerMTok: 1, outputPerMTok: 5, cacheWritePerMTok: 1.25, cacheReadPerMTok: 0.1 },
  'anthropic/claude-sonnet-4-6': { currency: 'USD', inputPerMTok: 3, outputPerMTok: 15, cacheWritePerMTok: 3.75, cacheReadPerMTok: 0.3 },
  'anthropic/claude-sonnet-5-5': { currency: 'USD', inputPerMTok: 2, outputPerMTok: 10, cacheWritePerMTok: 2.5, cacheReadPerMTok: 0.2 },
  'anthropic/claude-opus-4-6': { currency: 'USD', inputPerMTok: 5, outputPerMTok: 25, cacheWritePerMTok: 6.25, cacheReadPerMTok: 0.5 },
  'anthropic/claude-opus-5-5': { currency: 'USD', inputPerMTok: 4, outputPerMTok: 20, cacheWritePerMTok: 5, cacheReadPerMTok: 0.2 },

  // ── OpenAI ───────────────────────────────────────────────────
  // Source: developers.openai.com/api/docs/pricing + the gpt-4o-transcribe
  // model page, checked 2026-10-07. Transcription bills audio tokens in /
  // text tokens out ($2.50 / $10 per MTok; "≈ $0.006 / minute").
  'openai/gpt-4o-transcribe': { currency: 'USD', inputPerMTok: 2.5, audioInputPerMTok: 2.5, outputPerMTok: 10, perMinute: 0.006 },
  'openai/gpt-4o-mini-transcribe': { currency: 'USD', inputPerMTok: 1.25, audioInputPerMTok: 1.25, outputPerMTok: 5, perMinute: 0.003 },
  'openai/whisper-1': { currency: 'USD', perMinute: 0.006 },
  // Realtime voice is billed per token (verified 2026-10-07: audio $32 in /
  // $0.40 cached / $64 out, text $4 / $0.40 / $16 per MTok), but the server
  // only learns the session length the client reports — so we charge a blended
  // per-session-minute estimate. UNVERIFIED: derived from ~40 % user audio
  // (600 tok/min) + ~40 % assistant audio (1200 tok/min) + the cached ~5k-token
  // instructions/tools prefix re-read every response ≈ $0.05–0.15 / min.
  'openai/gpt-realtime': { currency: 'USD', perMinute: 0.1 }, // UNVERIFIED (blended estimate)

  // ── Meta WhatsApp (Spain rate card, EUR, VAT excluded) ───────
  // Free-form ("service") replies inside the 24 h window are free and are not
  // recorded; only templates sent outside the window cost money. Utility
  // €0.0166 from the brief + third-party Spain rate cards (July 2026); Meta's
  // official rate-card CSV not checked.
  'meta_whatsapp/utility_template': { currency: 'EUR', perMessage: 0.0166 }, // UNVERIFIED against Meta's official CSV
  'meta_whatsapp/marketing_template': { currency: 'EUR', perMessage: 0.0585 }, // UNVERIFIED (not sent by ONA today)

  // ── AIKIT image generation (Imagen via fal, behind AiKit's CMS) ──
  'aikit/imagen-fal': { currency: 'USD', perImage: 0.04 }, // UNVERIFIED (fal Imagen list price; AiKit's own markup unknown)
  // gpt-image-1, quality medium, 1536×1024: ~1,570 output image tokens at $40/MTok (measured 2026-10-08).
  'openai/gpt-image-1': { currency: 'USD', perImage: 0.063 },
}

/** Strip dated snapshot suffixes: `-20251001`, `-2025-08-28`. */
export function normalizeModel(model: string): string {
  return model.replace(/-\d{4}-\d{2}-\d{2}$/, '').replace(/-\d{8}$/, '')
}

const NUMERIC_FIELDS: Array<keyof Price> = [
  'inputPerMTok',
  'outputPerMTok',
  'cacheWritePerMTok',
  'cacheReadPerMTok',
  'audioInputPerMTok',
  'perMinute',
  'perMessage',
  'perImage',
]

/**
 * Pure: merge `COST_PRICE_OVERRIDES` (JSON `{ "provider/model": Partial<Price> }`)
 * over the base table. Malformed JSON or non-numeric values are ignored with
 * a warning — a typo in an env var must never crash boot.
 */
export function parsePriceOverrides(raw: string, base: PriceTable): PriceTable {
  if (!raw.trim()) return base
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    console.warn('[pricing] COST_PRICE_OVERRIDES is not valid JSON — ignored')
    return base
  }
  if (!parsed || typeof parsed !== 'object') return base
  const out: PriceTable = { ...base }
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue
    const v = value as Record<string, unknown>
    const next: Price = { ...(base[key] ?? { currency: 'USD' }) }
    if (v.currency === 'USD' || v.currency === 'EUR') next.currency = v.currency
    for (const field of NUMERIC_FIELDS) {
      const n = v[field]
      if (typeof n === 'number' && Number.isFinite(n) && n >= 0) (next as any)[field] = n
      else if (n !== undefined) console.warn(`[pricing] override ${key}.${field} is not a non-negative number — ignored`)
    }
    out[key] = next
  }
  return out
}

/** The live table: base prices + env overrides (read once at boot). */
export const ACTIVE_PRICES: PriceTable = parsePriceOverrides(env.COST_PRICE_OVERRIDES, PRICES)

export function priceFor(provider: string, model: string, table: PriceTable = ACTIVE_PRICES): Price | null {
  return table[`${provider}/${normalizeModel(model)}`] ?? null
}

/**
 * Pure: cost of one call in integer micro-euros, or `null` when the model is
 * not in the table (the ledger keeps the row, flagged as unpriced).
 */
export function computeCostMicros(
  provider: string,
  model: string,
  units: CostUnits,
  opts: { eurPerUsd: number; table: PriceTable } = { eurPerUsd: env.ADVISOR_EUR_PER_USD, table: ACTIVE_PRICES },
): number | null {
  const price = priceFor(provider, model, opts.table)
  if (!price) return null
  const n = (x: number | undefined) => (Number.isFinite(x) ? (x as number) : 0)
  const native =
    (n(units.inputTokens) * n(price.inputPerMTok) +
      n(units.outputTokens) * n(price.outputPerMTok) +
      n(units.cacheWriteTokens) * n(price.cacheWritePerMTok) +
      n(units.cacheReadTokens) * n(price.cacheReadPerMTok) +
      n(units.audioInputTokens) * n(price.audioInputPerMTok ?? price.inputPerMTok)) /
      1_000_000 +
    n(units.minutes) * n(price.perMinute) +
    n(units.messages) * n(price.perMessage) +
    n(units.images) * n(price.perImage)
  const eur = price.currency === 'USD' ? native * opts.eurPerUsd : native
  return Math.round(eur * 1_000_000)
}
