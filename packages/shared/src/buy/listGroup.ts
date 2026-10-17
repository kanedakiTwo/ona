/**
 * Shopping list: which lines are the same product (PRO-177).
 *
 * The list used to join lines only by catalogue ingredient, so «Huevo 4 u» and
 * «Huevos 6 u», «Limón» and «Limon», or «Jamón cocido» and «Jamón de york»
 * came out as separate lines. The buy rules already know they are the same
 * thing, so the list groups by rule (and preset choice: «tomate pera» and
 * «tomate de rama» stay apart); rules whose names are different products
 * (`LIST_SPLIT_RULES`, `{name}` nouns) and names without a rule group by the
 * normalized name, which still joins «Pimentón dulce» twice or «Limón» and
 * «Limon» spelled two ways.
 */

import type { Aisle } from '../constants/enums.js'
import { normalizeBuyName, resolveBuyRule } from './convert.js'
import { BUY_RULES, LIST_SPLIT_RULES, type BuyRule } from './rules.js'

export interface ShoppingGroup {
  /** Lines with the same key are one product on the list. */
  key: string
  /** The rule the line merged by (null when it groups by name). */
  rule: BuyRule | null
  /** Aisle the rule gives the line, beating the catalogue's. */
  aisle: Aisle | null
}

const baseName = (name: string) => normalizeBuyName(name.split(' · ')[0] ?? name)

/** Exact rule names (first rule wins, like `resolveBuyRule`). */
const EXACT = new Map<string, { rule: BuyRule; preset: string | null }>()
for (const rule of BUY_RULES) {
  for (const n of rule.names) {
    const [name, preset] = Array.isArray(n) ? n : [n, null]
    const k = normalizeBuyName(name)
    if (!EXACT.has(k)) EXACT.set(k, { rule, preset })
  }
}

/** Trailing words that don't make another product («salmón fresco», «lomo de salmón sin piel»). */
const HARMLESS = new Set([
  'fresco', 'fresca', 'frescos', 'frescas', 'sin', 'piel', 'espinas', 'hueso', 'limpio', 'limpia', 'limpios', 'limpias',
  'grande', 'grandes', 'mediano', 'mediana', 'medianos', 'medianas', 'pequeno', 'pequena', 'maduro', 'madura', 'maduros', 'maduras',
  'entero', 'entera', 'enteros', 'enteras', 'y', 'con',
])

/**
 * The rule a catalogue name is *exactly* (or plus harmless words). Unlike
 * `resolveBuyRule` it never drops a meaningful word: «aceite de coco» is not
 * olive oil and «pan rallado» is not bread, so they keep their own line.
 */
function exactRule(name: string): { rule: BuyRule; preset: string | null } | null {
  const base = baseName(name).replace(/\s*\(.*\)\s*$/, '').split(',')[0]!.trim()
  const words = base.split(' ')
  for (let i = words.length; i >= 1; i--) {
    if (i < words.length && !HARMLESS.has(words[i]!)) break
    const hit = EXACT.get(words.slice(0, i).join(' '))
    if (hit) return hit
  }
  return null
}

export function shoppingGroupOf(name: string): ShoppingGroup {
  const exact = exactRule(name)
  const aisle = (exact?.rule ?? resolveBuyRule(name)?.rule)?.aisle ?? null
  const rule = exact?.rule ?? null
  if (!rule || LIST_SPLIT_RULES.has(rule.key) || rule.noun.some((n) => n.includes('{name}'))) {
    return { key: `name:${baseName(name)}`, rule: null, aisle }
  }
  return { key: `rule:${rule.key}:${exact?.preset ?? ''}`, rule, aisle }
}

/** Exact names that never go on the list (tap water, salt). */
const NOT_BOUGHT = new Set<string>()
for (const rule of BUY_RULES) {
  if (!rule.notBought) continue
  for (const n of rule.names) NOT_BOUGHT.add(normalizeBuyName(Array.isArray(n) ? n[0] : n))
}

/** «Agua», «agua del grifo», «sal»… — never something to buy. «Agua de coco» or «agua con gas» are. */
export function isNotBought(name: string): boolean {
  return NOT_BOUGHT.has(baseName(name))
}

/** Exact catalogue names whose rule fixes the aisle (huevo, yema, clara, tofu…). */
const AISLE_BY_NAME = new Map<string, Aisle>()
for (const rule of BUY_RULES) {
  if (!rule.aisle) continue
  for (const n of rule.names) AISLE_BY_NAME.set(normalizeBuyName(Array.isArray(n) ? n[0] : n), rule.aisle)
}

/**
 * The aisle a catalogue ingredient should have when the stored one is wrong
 * (PRO-177 data fix): only exact rule names (huevo, huevos, yema, clara,
 * tofu…) filed under `proteinas`. null = leave it as it is.
 */
export function catalogAisleFix(name: string, aisle: string | null): Aisle | null {
  const want = AISLE_BY_NAME.get(normalizeBuyName(name))
  if (!want || aisle === want) return null
  if (aisle !== 'proteinas') return null
  return want
}
