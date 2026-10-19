/**
 * La cesta del súper para la extensión del navegador (specs/shop-orders.md →
 * «Enviar a la extensión del navegador»). Puro: lo usan el borrador (API), la
 * web y, copiando `extensionKey`, la extensión.
 */
import type { BuyableUnit } from '../types/shopping.js'
import type { ShopOrderLine } from '../types/shopOrders.js'
import type { BasketLine, BasketSendResult } from '../types/basketExtension.js'
import { buyRuleByKey, normalizeBuyName, orderQtyInGrams } from './convert.js'
import { shoppingGroupOf } from './listGroup.js'

/** «Tomate · varias presentaciones» → «Tomate». */
export function basketBaseName(name: string): string {
  return (name.split(' · ')[0] ?? name).trim()
}

/** Clave de la tabla de productos de una cadena: nombre normalizado + « · » + elección normalizada. */
export function extensionKey(name: string, choice: string | null): string {
  const n = normalizeBuyName(basketBaseName(name))
  return choice ? `${n} · ${normalizeBuyName(choice)}` : n
}

export interface OrderMemberInput {
  id: string
  name: string
  quantity: number
  unit: BuyableUnit
  /**
   * Tecleado sin cantidad: el «1 u» por defecto (`source === 'default'` en el
   * borrador). Su cantidad solo cuenta si su grupo no tiene ninguna real; sus
   * ids, siempre.
   */
  placeholder?: boolean
}

export interface OrderMember {
  name: string
  quantity: number
  unit: BuyableUnit
  sourceItemIds: string[]
}

/** El nombre que representa al grupo, como en la lista: el más corto y, a igual longitud, el primero por `localeCompare`. */
function isPreferredName(candidate: string, current: string): boolean {
  return (candidate.length - current.length || candidate.localeCompare(current)) < 0
}

/**
 * Los artículos que junta una línea de pedido, agrupados con el criterio de
 * la lista de la compra (`shoppingGroupOf`). null = todo es el mismo producto.
 * Nada depende del orden de entrada, salvo el orden de `sourceItemIds` y un
 * empate de tamaño (abajo).
 *
 * - Nombre: el representante de la lista (`isPreferredName`).
 * - Cantidades: con la misma unidad se suman; con unidades distintas que se
 *   pueden pesar (`orderQtyInGrams`), el grupo pasa a 'g' con la suma en
 *   gramos. Si una no se puede pesar (u de una regla sin gramos por unidad),
 *   gana la pesable y la otra se pierde (pérdida conocida).
 * - Sin cantidad (`placeholder`): solo cuenta si el grupo no tiene ninguna
 *   cantidad real, y dos no se suman (se queda 1 u, como en el borrador).
 * - El grupo genérico es el grupo de la lista al que va la clave de la regla
 *   (para `huevos`: «huevo», «huevos», «yema de huevo»…). No es un producto
 *   aparte: se suma, con las mismas reglas, al grupo específico más grande,
 *   medido en gramos (si no se puede pesar, por su número; si no tiene
 *   cantidad real, 0). En empate, el primero en orden de entrada.
 *
 * Los ids de todos los artículos quedan siempre en `sourceItemIds`.
 */
export function orderMembers(members: OrderMemberInput[], ruleKey: string | null): OrderMember[] | null {
  if (members.length < 2) return null
  const genericKey = ruleKey ? shoppingGroupOf(ruleKey).key : null
  const grams = (quantity: number, unit: BuyableUnit) => orderQtyInGrams(quantity, unit, ruleKey)
  type Group = OrderMember & { real: boolean; generic: boolean }
  /** Suma una cantidad al grupo; `real` = no viene solo de artículos sin cantidad. */
  const add = (g: Group, quantity: number, unit: BuyableUnit, real: boolean) => {
    if (!real) return
    if (!g.real) {
      // El grupo solo tenía artículos sin cantidad: manda la real.
      g.quantity = quantity
      g.unit = unit
      g.real = true
      return
    }
    if (g.unit === unit) {
      g.quantity += quantity
      return
    }
    const a = grams(g.quantity, g.unit)
    const b = grams(quantity, unit)
    if (b == null) return // La que llega no se puede pesar: se queda la del grupo.
    if (a == null) {
      // La del grupo no se puede pesar: gana la que llega.
      g.quantity = quantity
      g.unit = unit
      return
    }
    g.quantity = a + b
    g.unit = 'g'
  }
  const groups = new Map<string, Group>()
  for (const mem of members) {
    const key = shoppingGroupOf(mem.name).key
    const real = !mem.placeholder
    const g = groups.get(key)
    if (g) {
      add(g, mem.quantity, mem.unit, real)
      g.sourceItemIds.push(mem.id)
      if (isPreferredName(mem.name, g.name)) g.name = mem.name
      continue
    }
    groups.set(key, {
      name: mem.name,
      quantity: mem.quantity,
      unit: mem.unit,
      sourceItemIds: [mem.id],
      real,
      generic: key === genericKey,
    })
  }
  const all = [...groups.values()]
  const specific = all.filter((g) => !g.generic)
  if (specific.length < 2) return null
  const size = (g: Group) => (g.real ? (grams(g.quantity, g.unit) ?? g.quantity) : 0)
  for (const g of all.filter((x) => x.generic)) {
    const target = specific.reduce((a, b) => (size(b) > size(a) ? b : a))
    target.sourceItemIds.push(...g.sourceItemIds)
    add(target, g.quantity, g.unit, g.real)
  }
  return specific.map(({ generic: _generic, real: _real, ...rest }) => rest)
}

export function buildExtensionBasket(_lines: ShopOrderLine[]): BasketLine[] {
  return []
}
export function sourceItemsForBasketKey(_lines: ShopOrderLine[], _key: string): string[] {
  return []
}
export function basketMayBeInCart(_r: { anadidas: number; lineas: Array<{ estado: string }> }): boolean {
  return false
}
