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
}

export interface OrderMember {
  name: string
  quantity: number
  unit: BuyableUnit
  sourceItemIds: string[]
}

/**
 * Los artículos que junta una línea de pedido, agrupados con el criterio de
 * la lista de la compra (`shoppingGroupOf`). null = todo es el mismo producto.
 *
 * El grupo genérico es el grupo de la lista al que va la clave de la regla
 * (para `huevos`: «huevo», «huevos», «yema de huevo»…), vengan en el orden que
 * vengan. No es un producto aparte: su cantidad y sus artículos se suman al
 * grupo específico más grande, medido en gramos (`orderQtyInGrams`; si no se
 * puede pesar, por su número). En empate, el primero en orden de entrada.
 *
 * Cantidades: con la misma unidad se suman; con unidades distintas que se
 * pueden pesar, el grupo pasa a 'g' con la suma en gramos. Si una no se puede
 * pesar (1 u de una regla sin gramos por unidad), el grupo se queda con su
 * cantidad y la otra se pierde (pérdida conocida); sus artículos sí quedan en
 * `sourceItemIds`.
 */
export function orderMembers(members: OrderMemberInput[], ruleKey: string | null): OrderMember[] | null {
  if (members.length < 2) return null
  const genericKey = ruleKey ? shoppingGroupOf(ruleKey).key : null
  const grams = (quantity: number, unit: BuyableUnit) => orderQtyInGrams(quantity, unit, ruleKey)
  const add = (g: OrderMember, quantity: number, unit: BuyableUnit) => {
    if (g.unit === unit) {
      g.quantity += quantity
      return
    }
    const a = grams(g.quantity, g.unit)
    const b = grams(quantity, unit)
    if (a == null || b == null) return
    g.quantity = a + b
    g.unit = 'g'
  }
  const groups = new Map<string, OrderMember & { generic: boolean }>()
  for (const mem of members) {
    const key = shoppingGroupOf(mem.name).key
    const g = groups.get(key)
    if (g) {
      add(g, mem.quantity, mem.unit)
      g.sourceItemIds.push(mem.id)
      continue
    }
    groups.set(key, {
      name: mem.name,
      quantity: mem.quantity,
      unit: mem.unit,
      sourceItemIds: [mem.id],
      generic: key === genericKey,
    })
  }
  const all = [...groups.values()]
  const specific = all.filter((g) => !g.generic)
  if (specific.length < 2) return null
  const size = (g: OrderMember) => grams(g.quantity, g.unit) ?? g.quantity
  for (const g of all.filter((x) => x.generic)) {
    const target = specific.reduce((a, b) => (size(b) > size(a) ? b : a))
    target.sourceItemIds.push(...g.sourceItemIds)
    add(target, g.quantity, g.unit)
  }
  return specific.map(({ generic: _generic, ...rest }) => rest)
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
