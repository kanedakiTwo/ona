import { capitalize, formatQty, prettyName, type BuyableUnit, type ShoppingItem } from '@ona/shared'
import type { SkillContext, SkillDefinition, SkillResult } from './types.js'
import { appApiFor, AppApiError, type AppApi } from './appApi.js'
import { bestMatch, toBuyable } from './appSkills.js'

/**
 * Lines of the shopping list, from chat (D-051): what /shopping does on each
 * line without opening anything (PRO-292). Changing the amount in the line's
 * unit and leaving a line out are `change_shopping_item_amount` and
 * `remove_shopping_items` (appSkills.ts); this file adds switching the unit
 * («de cebolla pon 3 unidades», «las patatas en kilos»). Same REST calls as
 * the page, as the user.
 */

const api = (ctx: SkillContext): AppApi =>
  ctx.api ?? appApiFor(ctx.userId, { channel: ctx.channel === 'whatsapp' ? 'whatsapp' : 'web' })
const text = (summary: string): SkillResult => ({ data: null, summary, uiHint: 'text' })

type Line = Pick<ShoppingItem, 'id' | 'name'> &
  Partial<Pick<ShoppingItem, 'ingredientId' | 'quantity' | 'unit' | 'kind' | 'skipped' | 'menuUnit' | 'menuQuantity' | 'unitOptions' | 'amountText'>>
interface ListDoc {
  id: string
  items: Line[]
}

const UNIT_WORD: Record<string, string> = { g: 'gramos', ml: 'mililitros', u: 'unidades', cda: 'cucharadas', cdita: 'cucharaditas' }
const fromMenu = (i: Line) => i.kind !== 'manual' && i.kind !== 'staple' && !!i.ingredientId

/** «unidades» / «kilos» / «litros» / «g» → a buyable unit (kilos and litros are g / ml × 1000). */
function unitOf(word: unknown): { unit: BuyableUnit; factor: number } | null {
  const b = toBuyable(1, String(word ?? '').trim() || 'x')
  if (!b.unit) return null
  return { unit: b.unit as BuyableUnit, factor: b.quantity ?? 1 }
}

const changeShoppingItemUnit: SkillDefinition = {
  name: 'change_shopping_item_unit',
  description:
    'Cambia la UNIDAD en que se compra un producto de la lista de la compra: «de cebolla pon 3 unidades» (si la línea está en gramos), «las patatas en kilos», «la leche en litros», «vuelve a poner la cebolla en gramos». unit: unidades, gramos, kilos, mililitros o litros; quantity (opcional) en esa unidad: sin ella se convierte lo que había. Úsala siempre que la unidad que dice el usuario no sea la de la línea; para cambiar solo la cantidad en la misma unidad, change_shopping_item_amount. Solo se puede pasar a una unidad con equivalencia conocida (unidades↔gramos si se sabe lo que pesa una pieza).',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string' }, unit: { type: 'string' }, quantity: { type: 'number' } },
    required: ['name', 'unit'],
  },
  async handler(p, ctx) {
    const list = await api(ctx)<ListDoc>('GET', '/shopping-list')
    const hit = bestMatch((list.items ?? []).filter((i) => !i.skipped), String(p.name ?? ''), (i) => i.name)
    if (!hit) return text(`"${p.name}" no está en la lista; no he cambiado nada.`)
    const name = capitalize(prettyName(hit.name))
    const target = unitOf(p.unit)
    if (!target) return text(`¿En qué unidad pongo ${name.toLowerCase()}: unidades, gramos o litros?`)
    const quantity = typeof p.quantity === 'number' && p.quantity > 0 ? p.quantity * target.factor : undefined
    if (hit.kind === 'staple') return text(`${name} es uno de tus básicos: su cantidad y su unidad se cambian en tus básicos (manage_staples).`)

    if (!fromMenu(hit)) {
      // Typed by hand: any unit, no conversion (there is no ingredient to convert with).
      await api(ctx)('PATCH', `/shopping-list/${list.id}/item/${hit.id}`, {
        unit: target.unit,
        ...(quantity ? { quantity } : {}),
        ...(hit.amountText ? { amountText: null } : {}),
      })
      return {
        data: { listId: list.id },
        summary: `Hecho: ${name}, ${formatQty(quantity ?? hit.quantity ?? 1, target.unit)}.`,
        uiHint: 'shopping_list',
      }
    }

    const options = hit.unitOptions ?? [hit.menuUnit ?? hit.unit ?? 'g']
    if (!options.includes(target.unit)) {
      return text(
        `${name} no se puede pasar a ${UNIT_WORD[target.unit]}: no sé cuánto pesa o cuánto ocupa. Se compra en ${options.map((u) => UNIT_WORD[u] ?? u).join(' o ')} (ahora ${formatQty(hit.quantity ?? 0, hit.unit ?? 'g')}).`,
      )
    }
    try {
      const next = await api(ctx)<ListDoc>('PUT', `/shopping-list/${list.id}/item/${encodeURIComponent(hit.id)}/edit`, {
        unit: target.unit,
        ...(quantity ? { quantity } : {}),
      })
      const now = next?.items?.find((i) => i.id === hit.id)
      const shown = now?.quantity != null && now.unit ? formatQty(now.quantity, now.unit) : quantity ? formatQty(quantity, target.unit) : UNIT_WORD[target.unit]
      const menuSaid = now?.menuQuantity != null ? ` (el menú pedía ${formatQty(now.menuQuantity, (now.menuUnit ?? now.unit ?? 'g') as BuyableUnit)})` : ' (lo que pide el menú)'
      return { data: { listId: list.id }, summary: `Hecho: ${name}, ${shown}${menuSaid}.`, uiHint: 'shopping_list' }
    } catch (e) {
      if (e instanceof AppApiError && e.status === 400) return text(`No he cambiado nada: ${e.message}`)
      throw e
    }
  },
}

export const shoppingLineSkills: SkillDefinition[] = [changeShoppingItemUnit]
