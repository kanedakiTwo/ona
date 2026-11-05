/**
 * Red de tiendas: the life of a Red order (ona-hq D-165, design §4). Pure.
 * draft, cancelled and closed are the same states every order has.
 */
import { RED_HOUSEHOLD_CANCELLABLE, type RedOrderStatus, type ShopOrderStatus } from '@ona/shared'

// The household cancels by itself only before the shop starts (shared with /compra's card).
export { RED_HOUSEHOLD_CANCELLABLE }

/** Every state a Red order can be in → where it may go next. */
const NEXT: Record<'draft' | 'cancelled' | 'closed' | RedOrderStatus, ShopOrderStatus[]> = {
  draft: ['ordered', 'cancelled'],
  ordered: ['accepted', 'rejected', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  // Once preparing, the household cancels only if the shop agrees (tramo 1b).
  preparing: ['ready', 'cancelled'],
  ready: ['charged', 'payment_pending'],
  payment_pending: ['charged', 'cancelled'],
  charged: ['delivered'],
  delivered: ['closed', 'incident'],
  incident: ['closed'],
  rejected: [],
  cancelled: [],
  closed: [],
}

export function canRedTransition(from: string, to: string): boolean {
  return (NEXT[from as keyof typeof NEXT] ?? []).includes(to as ShopOrderStatus)
}

export function householdCanCancelRed(status: string): boolean {
  return RED_HOUSEHOLD_CANCELLABLE.includes(status as ShopOrderStatus)
}

/** Its lines count as «ya está en un pedido abierto» (design §4, the list). */
export const RED_IN_FLIGHT: readonly ShopOrderStatus[] = ['ordered', 'accepted', 'preparing', 'ready', 'payment_pending']

/** Still shown among the open orders on /compra. */
export const RED_LISTED_OPEN: readonly ShopOrderStatus[] = [...RED_IN_FLIGHT, 'charged', 'delivered', 'incident']
