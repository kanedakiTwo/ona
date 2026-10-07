/** How a line reads in the message to the shop: "- Ternera: 500 g (picada)". */

import type { ShopKind, ShopOrderLine } from '@ona/shared'
import { capitalize, formatQty, prettyName } from '@ona/shared'
import { wholeWeightGrams } from './fish.js'

export { capitalize, formatQty, prettyName }

export function lineRequestText(line: Pick<ShopOrderLine, 'name' | 'quantity' | 'unit' | 'note'>, kind: ShopKind): string {
  const name = capitalize(prettyName(line.name.trim()))
  const whole = kind === 'pescaderia' && line.unit === 'g' ? wholeWeightGrams(line.name, line.quantity) : null
  if (whole) {
    const tail = line.note ? `, ${line.note}` : ''
    return `- ${name}: ${formatQty(line.quantity, 'g')} en limpio (≈${formatQty(whole, 'g')} en entero)${tail}`
  }
  return `- ${name}: ${formatQty(line.quantity, line.unit)}${line.note ? ` (${line.note})` : ''}`
}
