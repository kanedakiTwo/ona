import type { ShoppingItem } from '@ona/shared'

/**
 * Pure: the shopping list → the compact WhatsApp summary that follows the
 * reply when the user asks for it, so they read it (and add/remove things)
 * without opening the app. Pending items grouped by aisle, in the app's aisle
 * order; ticked items left out; what's already at home in one short line.
 */

const AISLE_ORDER = ['produce', 'proteinas', 'lacteos', 'panaderia', 'despensa', 'congelados', 'otros'] as const
const AISLE_LABEL: Record<string, string> = {
  produce: 'Frutas y verduras',
  proteinas: 'Carnes y pescados',
  lacteos: 'Lácteos y huevos',
  panaderia: 'Panadería',
  despensa: 'Despensa',
  congelados: 'Congelados',
  otros: 'Otros',
}

export const SHOPPING_DIGEST_INVITE =
  '¿Añado o quito algo? Dímelo aquí, por ejemplo «añade leche» o «quita el pan».'

const trim = (n: number) => n.toFixed(2).replace(/\.?0+$/, '')

/** Same rules as the app: 1500 g → "1.5 kg", 2000 ml → "2 L", 6 u → "6". */
export function shoppingQuantity(quantity: number, unit: string): string {
  if (!Number.isFinite(quantity) || quantity <= 0) return ''
  if (unit === 'g' && quantity >= 1000) return `${trim(quantity / 1000)} kg`
  if (unit === 'ml' && quantity >= 1000) return `${trim(quantity / 1000)} L`
  if (unit === 'u') return trim(quantity)
  return `${trim(quantity)} ${unit}`
}

export function isShoppingItemList(value: unknown): value is ShoppingItem[] {
  return Array.isArray(value) && value.every((i) => i && typeof i === 'object' && typeof (i as any).name === 'string' && 'aisle' in (i as any))
}

export function shoppingListDigest(items: ShoppingItem[]): string {
  const pending = items.filter((i) => !i.checked && !i.inStock)
  const atHome = items.filter((i) => !i.checked && i.inStock)
  if (pending.length === 0) {
    return items.length === 0
      ? 'Tu lista de la compra está vacía.'
      : 'No te falta nada: lo de la lista ya está marcado o lo tienes en casa.'
  }
  const aisles = [...AISLE_ORDER, ...new Set(pending.map((i) => i.aisle).filter((a) => !(AISLE_ORDER as readonly string[]).includes(a)))]
  const lines = [`*Tu lista de la compra* · ${pending.length} ${pending.length === 1 ? 'cosa' : 'cosas'}`]
  for (const aisle of aisles) {
    const inAisle = pending.filter((i) => (i.aisle ?? 'otros') === aisle)
    if (inAisle.length === 0) continue
    const parts = inAisle.map((i) => {
      const q = shoppingQuantity(i.quantity, i.unit)
      return q ? `${i.name} (${q})` : i.name
    })
    lines.push(`*${AISLE_LABEL[aisle] ?? aisle}:* ${parts.join(', ')}`)
  }
  if (atHome.length > 0) {
    const names = atHome.slice(0, 10).map((i) => i.name)
    lines.push(`Ya tienes en casa: ${names.join(', ')}${atHome.length > 10 ? '…' : ''}`)
  }
  return [...lines, '', SHOPPING_DIGEST_INVITE].join('\n')
}
