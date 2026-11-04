/**
 * Red de tiendas: the life of a Red order (ona-hq D-165, design §4). Pure.
 * draft, cancelled and closed are the same states every order has.
 */
import type { ShopOrderStatus } from '@ona/shared'

const NEXT: Partial<Record<ShopOrderStatus, ShopOrderStatus[]>> = {
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
}

export function canRedTransition(from: string, to: string): boolean {
  return (NEXT[from as ShopOrderStatus] ?? []).includes(to as ShopOrderStatus)
}

/** The household cancels by itself only before the shop starts. */
export function householdCanCancelRed(status: string): boolean {
  return status === 'draft' || status === 'ordered' || status === 'accepted'
}

/** Its lines count as «ya está en un pedido abierto» (design §4, the list). */
export const RED_IN_FLIGHT: ShopOrderStatus[] = ['ordered', 'accepted', 'preparing', 'ready', 'payment_pending']

/** Still shown among the open orders on /compra. */
export const RED_LISTED_OPEN: ShopOrderStatus[] = [...RED_IN_FLIGHT, 'charged', 'delivered', 'incident']
