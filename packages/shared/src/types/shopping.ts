export interface ShoppingItem {
  id: string
  ingredientId: string
  name: string
  quantity: number
  unit: string
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
