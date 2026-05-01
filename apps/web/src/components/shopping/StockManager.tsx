'use client'

import { Clock, Package } from 'lucide-react'
import { useStockItem } from '@/hooks/useShopping'
import { useOnlineStatus } from '@/lib/pwa/useOnlineStatus'

interface ShoppingItem {
  id: string
  name: string
  quantity: string
  unit: string
  category: string
  checked: boolean
  inStock: boolean
}

interface StockManagerProps {
  items: ShoppingItem[]
  listId: string
}

export default function StockManager({ items, listId }: StockManagerProps) {
  const stockItem = useStockItem()
  const { pendingResourceIds } = useOnlineStatus()

  const sortedItems = [...items].sort((a, b) => {
    if (a.inStock === b.inStock) return a.name.localeCompare(b.name)
    return a.inStock ? 1 : -1
  })

  function handleToggle(itemId: string, currentInStock: boolean) {
    stockItem.mutate({ listId, itemId, inStock: !currentInStock })
  }

  if (items.length === 0) {
    return (
      <div className="py-8 text-center text-gray-400">
        No hay items para gestionar
      </div>
    )
  }

  const inStockCount = items.filter((i) => i.inStock).length

  return (
    <div>
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Package className="h-4 w-4" />
        <span>
          {inStockCount} de {items.length} items ya en stock
        </span>
      </div>

      <ul className="divide-y divide-gray-100">
        {sortedItems.map((item) => (
          <li key={item.id} className="flex items-center justify-between py-3">
            <div className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                {item.name}
                {pendingResourceIds.has(item.id) && (
                  <Clock
                    size={10}
                    className="text-ink-soft shrink-0"
                    aria-label="Pendiente de sincronizar"
                  />
                )}
              </span>
              <span className="text-xs text-gray-400">
                {item.quantity} {item.unit}
                {item.category ? ` · ${item.category}` : ''}
              </span>
            </div>

            <button
              onClick={() => handleToggle(item.id, item.inStock)}
              role="switch"
              aria-checked={item.inStock}
              className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
                item.inStock ? 'bg-[#2D6A4F]' : 'bg-[#DDDDDD]'
              }`}
            >
              <span
                className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform ${
                  item.inStock ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
