import type { Aisle } from '../constants/enums.js'

/** Subset of UNITS that are buyable (i.e. show up in shopping lists). */
export type BuyableUnit = 'g' | 'ml' | 'u' | 'cda' | 'cdita'

export interface ShoppingItem {
  id: string
  /** Links back to the global ingredient catalog (drives aisle + conversions). */
  ingredientId: string
  name: string
  quantity: number
  unit: BuyableUnit
  aisle: Aisle
  checked: boolean
  inStock: boolean
}

export interface ShoppingList {
  id: string
  userId: string
  menuId: string | null
  items: ShoppingItem[]
  createdAt: Date
}
