/**
 * Recipe need → what you actually ask the shop for (specs/shop-orders.md →
 * Buy rules). Pure; shared by the API (order messages) and the web (cards).
 *
 *   ajo 25 g            → "1 cabeza de ajos"
 *   cebolla 225 g       → "2 cebollas"
 *   jamón 50 g          → "100 g de jamón — ¿serrano o ibérico?" (blocks until chosen)
 *   pescado entero 2 u  → "2 doradas de ración, limpias para el horno (o lubinas, la que esté mejor hoy)"
 *   mantequilla 25 g    → "1 tarrina de mantequilla (250 g)" + "probablemente lo tienes"
 */

import type { BuyableUnit } from '../types/shopping.js'
import { BUY_RULES, type BuyRule, type BuyShop, type BuyTier } from './rules.js'

export function normalizeBuyName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.;:!¡?¿"]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

const BY_NAME = new Map<string, { rule: BuyRule; preset: string | null }>()
const BY_KEY = new Map<string, BuyRule>()
for (const rule of BUY_RULES) {
  BY_KEY.set(rule.key, rule)
  for (const n of rule.names) {
    const [name, preset] = Array.isArray(n) ? n : [n, null]
    const k = normalizeBuyName(name)
    if (!BY_NAME.has(k)) BY_NAME.set(k, { rule, preset })
  }
}

/** Canned / processed forms never take a fresh-shop rule ("pollo en lata", "cebolleta encurtida"). */
const PACKAGED = /\b(en lata|lata|conserva|encurtid\w*|en aceite|en vinagre|congelad\w*|ahumad\w*|deshidratad\w*|en polvo|molid\w*)\b/

/** Family words whose parenthesis lists separate products ("Fruta (fresas, plátanos…)"). */
const FAMILIES = new Set(['fruta', 'frutas', 'verdura', 'verduras', 'hierbas', 'hierbas aromaticas', 'hierbas frescas', 'especias', 'frutos secos', 'marisco', 'mariscos'])

/** Recipe notes that are the shop's job — kept on the line. */
const SHOP_PREP = /\b(picad[oa]s?|en filetes?( finos?| gruesos?)?|fileteado|en dados|en taquitos?|troceado|troceada|deshuesad[oa]|sin piel|sin espinas|en lomos|en rodajas|limpi[oa]s?|para guisar|en tiras|abierta para la plancha|a la espalda|para el horno|en anillas)\b/

function parenList(name: string): { head: string; items: string[] } | null {
  const m = name.match(/^(.*?)\s*\((.+)\)\s*$/)
  if (!m) return null
  const items = m[2]
    .split(/,|\by\b|\bo\b/)
    .map((s) => normalizeBuyName(s))
    .filter((s) => s && s !== 'etc' && s !== 'etc.')
  return { head: normalizeBuyName(m[1]), items }
}

/** "Fruta (fresas, plátanos, naranjas)" → ["fresas", "plátanos", "naranjas"]; null when it isn't a family list. */
export function splitCompound(name: string): string[] | null {
  const p = parenList(name)
  if (!p || !FAMILIES.has(p.head) || p.items.length === 0) return null
  return p.items
}

export interface ResolvedRule {
  rule: BuyRule
  preset: string | null
  /** Options listed in the name itself ("pescado entero (dorada, lubina, gallo)"). */
  options: string[] | null
}

export function resolveBuyRule(rawName: string): ResolvedRule | null {
  // "sal · varias presentaciones": the list's suffix for unit-incompatible lines.
  const name = rawName.split(' · ')[0]
  const full = normalizeBuyName(name)
  const paren = parenList(name)
  const base = paren ? paren.head : normalizeBuyName(name.split(',')[0])
  const packaged = PACKAGED.test(full)
  const accept = (rule: BuyRule) => !packaged || rule.shop === 'supermercado' || rule.shop === 'despensa'
  const hit = (k: string): ResolvedRule | null => {
    const r = BY_NAME.get(k)
    if (r && accept(r.rule)) return { ...r, options: paren && r.rule.choice ? paren.items : null }
    return null
  }
  const exact = hit(full) ?? hit(base)
  if (exact) return exact
  for (const rule of BUY_RULES) {
    if (rule.match && rule.match.test(base) && accept(rule)) return { rule, preset: null, options: paren && rule.choice ? paren.items : null }
  }
  // Drop trailing words: "tomate pera maduro" → "tomate pera".
  const words = base.split(' ')
  for (let i = words.length - 1; i >= 1; i--) {
    const r = hit(words.slice(0, i).join(' '))
    if (r) return r
  }
  return null
}

export function buyRuleByKey(key: string): BuyRule | null {
  return BY_KEY.get(key) ?? null
}

export interface OrderQtyInput {
  name: string
  quantity: number
  unit: BuyableUnit
  /** Recipe notes ("picada", "morada en juliana"). */
  notes?: string[]
  /** 'default' = typed by the user without an amount. */
  quantitySource?: 'recipe' | 'user' | 'default'
  /** Explicit choice (line edit) — beats preset, household preference and default. */
  choice?: string | null
  /** Shop prep typed by the user on the line. */
  note?: string | null
}

export interface OrderQty {
  ruleKey: string | null
  shop: BuyShop | null
  tier: BuyTier | null
  /** The phrase as written to the shop, without the leading "- ". */
  text: string
  /** Approximate grams (or ml) bought — feeds the € estimate. */
  grams: number | null
  choice: string | null
  /** Options when the product has a choice (to switch it later). */
  options: string[] | null
  needsChoice: { question: string; options: string[] } | null
  needsQuantity: { suggestion: string; grams: number } | null
  /** Fridge staple in a tiny amount: offered unticked ("probablemente lo tienes"). */
  maybeHave: boolean
  eci: string | null
  volatile: boolean
}

const orList = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} o ${xs[xs.length - 1]}` : xs[0] ?? '')
const plural = (w: string) => (/[aeiouáéó]$/.test(w) ? `${w}s` : `${w}es`)

function num(n: number): string {
  return String(Math.round(n * 100) / 100).replace('.', ',')
}

/** 250 → "un cuarto de kilo", 500 → "medio kilo", 1500 → "kilo y medio"… */
export function weightPhrase(grams: number): string {
  if (grams === 250) return 'un cuarto de kilo'
  if (grams === 500) return 'medio kilo'
  if (grams === 750) return 'tres cuartos de kilo'
  if (grams === 1500) return 'kilo y medio'
  if (grams >= 1000 && grams % 250 === 0) return `${num(grams / 1000)} kg`
  return grams >= 1000 ? `${num(grams / 1000)} kg` : `${Math.round(grams)} g`
}

function toGrams(rule: BuyRule | null, q: number, unit: BuyableUnit): number | null {
  if (!(q > 0)) return null
  switch (unit) {
    case 'g':
    case 'ml':
      return q
    case 'cda':
      return q * 15
    case 'cdita':
      return q * 5
    case 'u': {
      const per = rule?.ug ?? rule?.g
      return per ? q * per : null
    }
  }
}

function roundUp(grams: number, step: number, min: number): number {
  return Math.max(min, Math.ceil(grams / step - 1e-9) * step)
}

function eggsPhrase(eggs: number): string {
  const sixes = Math.max(1, Math.ceil(eggs / 6))
  if (sixes === 1) return 'media docena de huevos'
  if (sixes === 2) return '1 docena de huevos'
  if (sixes === 3) return 'docena y media de huevos'
  return `${num(sixes / 2)} docenas de huevos`
}

/** Prep + alternative suffix for the line. */
function suffix(rule: BuyRule, many: boolean, prep: string | null, choice: string | null, options: string[]): string {
  const parts: string[] = []
  let p = prep ?? (rule.prep ? rule.prep[many ? 1 : 0] : null)
  if (p && choice && normalizeBuyName(choice).includes(normalizeBuyName(p))) p = null
  let out = p ? `, ${p}` : ''
  if (rule.alt && choice) {
    const other = options.find((o) => o !== choice && o !== 'que me recomienden')
    if (other) parts.push(rule.alt.replace('{alt}', plural(other)))
  }
  if (parts.length) out += ` ${parts.join(' ')}`
  return out
}

export function toOrderQty(input: OrderQtyInput, prefs: Record<string, string> = {}): OrderQty {
  const resolved = resolveBuyRule(input.name)
  const pretty = input.name.trim()
  if (!resolved) {
    return {
      ruleKey: null,
      shop: null,
      tier: null,
      text: '',
      grams: input.unit === 'g' || input.unit === 'ml' ? input.quantity : null,
      choice: null,
      options: null,
      needsChoice: null,
      needsQuantity: null,
      maybeHave: false,
      eci: null,
      volatile: false,
    }
  }

  // Recipe notes can turn this into another product or carry the shop's prep.
  let { rule, preset } = resolved
  let options = resolved.options?.length ? resolved.options : rule.choice?.options ?? []
  let prep: string | null = input.note?.trim() || null
  for (const note of input.notes ?? []) {
    const n = normalizeBuyName(note)
    const v = rule.variants?.find(([re]) => re.test(n))
    if (v) {
      const next = resolveBuyRule(v[1])
      if (next) {
        rule = next.rule
        preset = next.preset
        options = rule.choice?.options ?? []
        continue
      }
    }
    const opt = options.find((o) => n.includes(normalizeBuyName(o)))
    if (opt && !preset) preset = opt
    if (!prep && (rule.shop === 'carniceria' || rule.shop === 'pescaderia')) {
      const m = n.match(SHOP_PREP)
      if (m) prep = m[0]
    }
  }

  // Choice: explicit > preset in the name > household preference > rule default.
  let choice: string | null = null
  let needsChoice: OrderQty['needsChoice'] = null
  if (rule.choice) {
    const pref = prefs[rule.key]
    choice = input.choice ?? preset ?? (pref && (options.includes(pref) || !resolved.options) ? pref : null) ?? (options.includes(rule.choice.def ?? '') || !resolved.options ? rule.choice.def : options[0] ?? null)
    if (!choice) needsChoice = { question: rule.choice.question, options }
  }
  const fill = (s: string, many = false) =>
    (choice ? s : s.replace(/\{c\}s? de /, ''))
      .replace('{c}s', choice ? plural(choice) : '')
      .replace('{c}', choice ?? '')
      .replace('{name}', pretty.toLowerCase())
      .replace(/\s+/g, ' ')
      .trim() + (many ? '' : '')
  const ask = needsChoice ? ` — ¿${orList(needsChoice.options)}?` : ''

  const grams = input.quantitySource === 'default' ? null : toGrams(rule, input.quantity, input.unit)
  const base: Omit<OrderQty, 'text' | 'grams'> = {
    ruleKey: rule.key,
    shop: rule.shop,
    tier: rule.tier ?? null,
    choice,
    options: rule.choice ? options : null,
    needsChoice,
    needsQuantity: null,
    maybeHave: false,
    eci: rule.eci ? fill(rule.eci) : null,
    volatile: !!rule.volatile || (rule.key === 'pescado entero' && choice === 'gallo'),
  }

  if (rule.by === 'pieza') {
    const g = rule.g ?? 100
    let n: number
    if (grams == null) n = rule.defaultN ?? rule.min ?? 1
    else if (input.unit === 'u' && !rule.ug) n = Math.ceil(input.quantity - 1e-9)
    else n = Math.ceil(grams / (rule.edibleG ?? g) - 0.15)
    n = Math.max(rule.min ?? 1, n)
    if (rule.half && grams != null && grams <= 0.55 * g) {
      return { ...base, text: rule.half + suffix(rule, false, prep, choice, options) + ask, grams: g / 2 }
    }
    // Lots of loose fruit/veg: by weight ("1 kg de naranjas de zumo"); a "no amount" piece of those = 1 kg.
    if (rule.kgAbove && (n > rule.kgAbove || (grams == null && input.quantitySource === 'default'))) {
      const w = grams == null ? 1000 : roundUp(grams, 250, 500)
      return { ...base, text: `${weightPhrase(w)} de ${fill(rule.noun[1], true)}${suffix(rule, true, prep, choice, options)}${ask}`, grams: w }
    }
    const many = n !== 1
    const what = rule.unit ? `${n} ${rule.unit[many ? 1 : 0]} de ${fill(rule.noun[1], true)}` : `${n} ${fill(rule.noun[many ? 1 : 0], many)}`
    return { ...base, text: what + suffix(rule, many, prep, choice, options) + ask, grams: n * g }
  }

  if (rule.by === 'peso') {
    const step = rule.step ?? 250
    const min = rule.min ?? step
    const isCharcu = rule.shop === 'charcuteria'
    if (grams == null) {
      if (rule.shop === 'fruteria') {
        return { ...base, text: `${weightPhrase(min)} de ${fill(rule.noun[0])}${suffix(rule, true, prep, choice, options)}${ask}`, grams: min }
      }
      const suggestion = isCharcu ? `${min} g` : weightPhrase(min)
      return {
        ...base,
        needsQuantity: { suggestion, grams: min },
        text: `${fill(rule.noun[0])}${suffix(rule, true, prep, choice, options)} — ¿cuánto?${ask}`,
        grams: null,
      }
    }
    const w = roundUp(grams, step, min)
    const amount = isCharcu ? `${w} g` : weightPhrase(w)
    return { ...base, text: `${amount} de ${fill(rule.noun[0])}${suffix(rule, true, prep, choice, options)}${ask}`, grams: w }
  }

  // envase
  if (rule.key === 'huevos') {
    const eggs = grams == null ? 6 : input.unit === 'u' ? input.quantity : Math.ceil(grams / 50)
    const tiny = grams != null && eggs <= 1
    return { ...base, text: eggsPhrase(eggs), grams: Math.max(6, Math.ceil(eggs / 6) * 6) * 50, maybeHave: tiny }
  }
  const pg = rule.g ?? 1
  const packs = grams == null ? 1 : Math.max(1, Math.ceil(grams / pg - 0.1))
  const many = packs !== 1
  const unit = rule.pack!.unit[many ? 1 : 0]
  const size = rule.pack!.size ? ` (${rule.pack!.size})` : ''
  const maybeHave = rule.tier === 'nevera' && grams != null && grams < 0.25 * pg
  const noun = fill(rule.noun[0])
  return { ...base, text: `${packs} ${unit}${noun ? ` de ${noun}` : ''}${size}${ask}`, grams: grams == null ? null : packs * pg, maybeHave }
}
