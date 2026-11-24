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
  /**
   * Aisle of the shop the name is bought at (fish and meat → «Carnes y
   * pescados», PRO-1092), only for a catalogue line filed under «Otros» or
   * with no aisle: Carmen's pescadilla and pescado blanco were in «Otros».
   */
  shopAisle: Aisle | null
}

const baseName = (name: string) => normalizeBuyName(name.split(' · ')[0] ?? name)

/**
 * Names that are the same product on the list though no rule joins them
 * (PRO-1092, Familia Ruiz: «Levadura» and «Levadura quimica» in two lines
 * for one bizcocho). A bare «levadura» in a recipe is the chemical one; bread
 * says «levadura de panadería» or «fresca».
 */
const SAME_NAME: Record<string, string> = { levadura: 'levadura quimica' }
const nameKey = (name: string) => {
  const n = baseName(name)
  return SAME_NAME[n] ?? n
}

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
  const shopAisle = rule && (rule.shop === 'pescaderia' || rule.shop === 'carniceria') ? 'proteinas' : null
  if (!rule || LIST_SPLIT_RULES.has(rule.key) || rule.noun.some((n) => n.includes('{name}'))) {
    return { key: `name:${nameKey(name)}`, rule: null, aisle, shopAisle }
  }
  return { key: `rule:${rule.key}:${exact?.preset ?? ''}`, rule, aisle, shopAisle }
}

/** «Huevo» = «huevos», «limón» = «limones», «hueso» = «huesos». */
function sameWord(a: string, b: string): boolean {
  return a === b || `${a}s` === b || `${b}s` === a || `${a}es` === b || `${b}es` === a
}

/** Words of a name as the list compares them: no accents, no «(1 sobre)», no « · MANUAL». */
const words = (name: string) => baseName(name).replace(/\s*\(.*?\)\s*/g, ' ').trim().split(' ').filter(Boolean)

/**
 * Whether a line typed by hand (or by Mimo) is the same product as a line of
 * the menu (PRO-1092): «Jamón cocido» and «Jamón de york», «Hueso de pollo»
 * and «Huesos de pollo», «Levadura química (1 sobre)» and «Levadura», or a
 * shorter name of the same rule: «Leche» and «Leche entera». Never two
 * different products of a rule: «Leche desnatada» is not «Leche entera», and
 * «Pan» is not «Pan rallado».
 */
export function sameListProduct(a: string, b: string): boolean {
  const wa = words(a)
  const wb = words(b)
  if (wa.length === 0 || wb.length === 0) return false
  if (shoppingGroupOf(wa.join(' ')).key === shoppingGroupOf(wb.join(' ')).key) return true
  const [short, long] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (!short.every((w, i) => sameWord(w, long[i]!))) return false
  if (short.length === long.length) return true
  const rs = exactRule(short.join(' '))?.rule
  const rl = exactRule(long.join(' '))?.rule
  return !!rs && rs === rl
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
