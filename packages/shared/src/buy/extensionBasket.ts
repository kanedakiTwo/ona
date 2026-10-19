/**
 * La cesta del súper para la extensión del navegador (specs/shop-orders.md →
 * «Enviar a la extensión del navegador»). Puro: lo usan el borrador (API), la
 * web y, copiando `extensionKey`, la extensión.
 */
import type { BuyableUnit } from '../types/shopping.js'
import type { ShopOrderLine } from '../types/shopOrders.js'
import type { BasketLine, BasketSendResult } from '../types/basketExtension.js'
import { buyRuleByKey, normalizeBuyName, orderQtyInGrams, pieceCount, toOrderQty } from './convert.js'
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

/**
 * El nombre que representa al grupo, como en la lista (que compara nombres de
 * catálogo, sin « · varias presentaciones»): el de nombre base más corto; a
 * igual longitud, el de base primera por `localeCompare`; con la misma base,
 * el nombre completo primero por `localeCompare`.
 */
function isPreferredName(candidate: string, current: string): boolean {
  const a = basketBaseName(candidate)
  const b = basketBaseName(current)
  return (a.length - b.length || a.localeCompare(b) || candidate.localeCompare(current)) < 0
}

/**
 * Los artículos que junta una línea de pedido, agrupados con el criterio de
 * la lista de la compra (`shoppingGroupOf`). null = todo es el mismo producto.
 * Nada depende del orden de entrada, salvo el orden de los grupos del
 * resultado (el de su primer artículo, y con él las claves `l3.1`, `l3.2`… de
 * la cesta), el orden de `sourceItemIds` y un empate de tamaño (abajo).
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

/** Lo que la cesta lee de una línea del pedido, o de un grupo hecho línea. */
type LineLike = Pick<ShopOrderLine, 'key' | 'name' | 'quantity' | 'unit' | 'ruleKey' | 'grams' | 'choice' | 'needsChoice' | 'needsQuantity'>

/** Una línea de la cesta: las líneas del pedido y los grupos salen por aquí, igual. */
function basketLine(l: LineLike): BasketLine {
  const name = basketBaseName(l.name)
  const choice = l.needsChoice ? null : l.choice ?? null
  const grams = l.needsQuantity
    ? l.needsQuantity.grams
    : l.ruleKey
      ? l.grams ?? null
      : l.unit === 'g' || l.unit === 'ml'
        ? l.quantity
        : null
  const rule = l.ruleKey ? buyRuleByKey(l.ruleKey) : null
  // Sus gramos son los que pide el pedido, de pieza entera (n × g): se pesan contra `g`, no contra lo comestible del pescado.
  const piezas = rule?.by === 'pieza' && grams ? pieceCount(rule, grams, 'g', grams, rule.g ?? 100) : null
  return { key: l.key, name, choice, quantity: l.quantity, unit: l.unit, grams, piezas, search: basketSearch(name, choice) }
}

/** Texto de búsqueda: el nombre, más « » + la elección si el nombre no la lleva ya («Jamón serrano» + serrano → «Jamón serrano»). */
export function basketSearch(name: string, choice: string | null): string {
  return choice && !normalizeBuyName(name).includes(normalizeBuyName(choice)) ? `${name} ${choice}` : name
}

/**
 * Un grupo de una línea fusionada, hecho línea: los gramos que pediría el
 * pedido con su cantidad (`toOrderQty`), o los sugeridos si pregunta «¿cuánto?»
 * (una regla al peso que no sabe lo que pesa una unidad). Se piden con el
 * nombre y las notas de la línea, de los que `buildLine` sacó su regla y su
 * variante («pollo» + «pechuga» → pechuga de pollo): con esas notas, el nombre
 * del grupo da la misma regla. Sin «sin cantidad»: un grupo de solo artículos
 * sin cantidad pide su 1 u tal cual. No hereda la elección ni la sugerencia de
 * la línea. Si la regla de la línea no saliera (guardada con otras reglas),
 * los gramos de su cantidad con ella (`orderQtyInGrams`).
 */
function groupAsLine(line: ShopOrderLine, mem: OrderMember, i: number): LineLike {
  const ruleKey = line.ruleKey ?? null
  const ordered = toOrderQty({ name: line.name, quantity: mem.quantity, unit: mem.unit, notes: line.notes })
  return {
    key: `${line.key}.${i + 1}`,
    name: mem.name,
    quantity: mem.quantity,
    unit: mem.unit,
    ruleKey,
    grams: (ordered.ruleKey === ruleKey ? ordered.grams ?? ordered.needsQuantity?.grams ?? null : null) ?? orderQtyInGrams(mem.quantity, mem.unit, ruleKey),
    choice: null,
    needsChoice: null,
    needsQuantity: null,
  }
}

/**
 * La cesta que se manda a la extensión: las líneas incluidas y, de una línea
 * fusionada (`members`), un grupo por producto (`l3.1`, `l3.2`…). Un grupo es
 * una línea más: lleva los gramos y las piezas de una línea del pedido con su
 * cantidad (`groupAsLine`), redondeados a la unidad de compra. Las piezas se
 * cuentan como en el pedido (`pieceCount`), con sus gramos, que ya son piezas
 * enteras de la regla.
 *
 * Limitación conocida: en una línea fusionada en la que nada traía cantidad
 * (todo el «1 u» por defecto), cada producto va como si se pidiera 1 unidad:
 * los gramos que pide el pedido por ella o, en una regla al peso, los
 * sugeridos de «¿cuánto?» para cada uno; la sugerencia de la línea no se
 * reparte entre ellos.
 */
export function buildExtensionBasket(lines: ShopOrderLine[]): BasketLine[] {
  const out: BasketLine[] = []
  for (const line of lines) {
    if (line.included === false) continue
    if (line.members && line.members.length >= 2) line.members.forEach((mem, i) => out.push(basketLine(groupAsLine(line, mem, i))))
    else out.push(basketLine(line))
  }
  return out
}

/**
 * ¿Puede haber algo de este envío en el carro? Sí si entró algo o si hay
 * líneas sin verificar (un envío a medias). Decide si el pedido pasa a «Enviado»
 * y si se ofrece «Quitar lo que añadió Mimoia».
 */
export function basketMayBeInCart(r: Pick<BasketSendResult, 'anadidas' | 'lineas'>): boolean {
  return r.anadidas > 0 || r.lineas.some((l) => l.estado === 'no_verificada')
}

/**
 * Artículos de la lista que hay detrás de una clave de la cesta («l3» o
 * «l3.2»). Estricta: si la parte de grupo no es un entero ≥ 1 escrito como lo
 * escribe `buildExtensionBasket` («l3.», «l3.0», «l3.x», «l3.1.2», «l3.01»),
 * no hay ninguno.
 */
export function sourceItemsForBasketKey(lines: ShopOrderLine[], key: string): string[] {
  const [lineKey, member, ...rest] = key.split('.')
  const line = lines.find((l) => l.key === lineKey)
  if (!line) return []
  if (member === undefined) return line.sourceItemIds ?? (line.sourceItemId ? [line.sourceItemId] : [])
  if (rest.length > 0 || !/^[1-9]\d*$/.test(member)) return []
  return line.members?.[Number(member) - 1]?.sourceItemIds ?? []
}
