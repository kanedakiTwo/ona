'use client'

import { useState } from 'react'
import { Check, Clock, Package } from 'lucide-react'
import { useCheckItem, useStockItem } from '@/hooks/useShopping'
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

interface ShoppingListProps {
  items: ShoppingItem[]
  listId: string
}

export default function ShoppingList({ items, listId }: ShoppingListProps) {
  const [showInStock, setShowInStock] = useState(false)
  const checkItem = useCheckItem()
  const stockItem = useStockItem()
  const { pendingResourceIds } = useOnlineStatus()

  const visibleItems = showInStock
    ? items
    : items.filter((item) => !item.inStock)

  const uncheckedItems = visibleItems
    .filter((item) => !item.checked)
    .sort((a, b) => a.name.localeCompare(b.name))

  const checkedItems = visibleItems
    .filter((item) => item.checked)
    .sort((a, b) => a.name.localeCompare(b.name))

  const sortedItems = [...uncheckedItems, ...checkedItems]

  function handleCheck(itemId: string, currentChecked: boolean) {
    checkItem.mutate({ listId, itemId, checked: !currentChecked })
  }

  function handleStock(itemId: string, currentInStock: boolean) {
    stockItem.mutate({ listId, itemId, inStock: !currentInStock })
  }

  if (items.length === 0) {
    return (
      <div className="py-12 text-center text-gray-400">
        No hay items en la lista
      </div>
    )
  }

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <button
          onClick={() => setShowInStock(!showInStock)}
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
        >
          <Package className="h-4 w-4" />
          {showInStock ? 'Ocultar en stock' : 'Mostrar en stock'}
        </button>
      </div>

      <ul className="divide-y divide-gray-100">
        {sortedItems.map((item) => (
          <li
            key={item.id}
            className={`flex items-center gap-3 py-3 ${
              item.inStock ? 'opacity-40' : ''
            } ${item.checked ? 'opacity-60' : ''}`}
          >
            <button
              onClick={() => handleCheck(item.id, item.checked)}
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors ${
                item.checked
                  ? 'border-green-500 bg-green-500 text-white'
                  : 'border-gray-300 hover:border-gray-400'
              }`}
              aria-label={item.checked ? 'Desmarcar' : 'Marcar como comprado'}
            >
              {item.checked && <Check className="h-4 w-4" />}
            </button>

            <div className="flex-1 min-w-0">
              <span
                className={`flex items-center gap-1.5 text-sm font-medium ${
                  item.checked || item.inStock
                    ? 'text-gray-400 line-through'
                    : 'text-gray-900'
                }`}
              >
                {item.name}
                {pendingResourceIds.has(item.id) && (
                  <Clock
                    size={10}
                    className="text-ink-soft shrink-0"
                    aria-label="Pendiente de sincronizar"
                  />
                )}
              </span>
              {item.category && (
                <span className="text-xs text-gray-400">{item.category}</span>
              )}
            </div>

            <span className="shrink-0 text-sm text-gray-500">
              {item.quantity} {item.unit}
            </span>

            <button
              onClick={() => handleStock(item.id, item.inStock)}
              className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                item.inStock
                  ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                  : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
              }`}
              title={item.inStock ? 'Quitar de stock' : 'Marcar en stock'}
            >
              {item.inStock ? 'En stock' : 'Stock'}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
