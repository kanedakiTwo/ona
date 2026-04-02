'use client'

import { useState, useMemo } from 'react'
import { ShoppingCart, Check, Package, ClipboardCopy } from 'lucide-react'
import { useAuth } from '@/lib/auth'
import { useShoppingList } from '@/hooks/useShopping'
import { useMenu } from '@/hooks/useMenu'
import ShoppingList from '@/components/shopping/ShoppingList'
import StockManager from '@/components/shopping/StockManager'
import Link from 'next/link'

function getWeekStart(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

type Tab = 'list' | 'stock'

export default function ShoppingPage() {
  const { user, isLoading: authLoading } = useAuth()

  const weekStart = useMemo(() => getWeekStart(), [])
  const { data: menu, isLoading: menuLoading } = useMenu(user?.id, weekStart)

  const menuId = menu?.id
  const { data: shoppingList, isLoading: listLoading } = useShoppingList(menuId)

  const [activeTab, setActiveTab] = useState<Tab>('list')

  const items = shoppingList?.items ?? []
  const checkedCount = items.filter((i: any) => i.checked).length
  const totalCount = items.length
  const inStockCount = items.filter((i: any) => i.inStock).length

  function handleExport() {
    const activeItems = items.filter((i: any) => !i.inStock && !i.checked)
    const text = activeItems
      .map((i: any) => `- ${i.name}: ${i.quantity}${i.unit}`)
      .join('\n')
    navigator.clipboard.writeText(`Lista de compra ONA\nSemana del ${weekStart}\n\n${text}`)
  }

  if (authLoading || menuLoading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-gray-500">Cargando...</p>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <p className="text-gray-500">Inicia sesion para ver tu lista de compra</p>
      </div>
    )
  }

  if (!menuId) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-gray-400" />
          <h1 className="text-2xl font-bold">Lista de compra</h1>
        </div>
        <div className="mt-12 flex flex-col items-center gap-4 text-center">
          <ShoppingCart className="h-12 w-12 text-gray-300" />
          <p className="text-gray-500">No tienes un menu para esta semana.</p>
          <p className="text-sm text-gray-400">Genera un menu primero.</p>
          <Link
            href="/menu"
            className="mt-2 rounded-lg bg-black px-5 py-2.5 text-sm font-medium text-white hover:bg-gray-800"
          >
            Ir a menu
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-gray-700" />
          <h1 className="text-2xl font-bold">Lista de compra</h1>
        </div>
        <button
          onClick={handleExport}
          className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
        >
          <ClipboardCopy className="h-4 w-4" />
          Exportar
        </button>
      </div>

      <div className="mt-4 flex items-center gap-4 rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
        <div className="flex items-center gap-1.5">
          <Check className="h-4 w-4 text-green-500" />
          <span>{checkedCount}/{totalCount} comprados</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Package className="h-4 w-4 text-amber-500" />
          <span>{inStockCount} en stock</span>
        </div>
        {totalCount > 0 && (
          <div className="ml-auto">
            <div className="h-2 w-24 overflow-hidden rounded-full bg-gray-200">
              <div
                className="h-full rounded-full bg-green-500 transition-all"
                style={{ width: `${((checkedCount + inStockCount) / totalCount) * 100}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <div className="mt-6 flex gap-1 rounded-lg bg-gray-100 p-1">
        <button
          onClick={() => setActiveTab('list')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'list' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Lista
        </button>
        <button
          onClick={() => setActiveTab('stock')}
          className={`flex-1 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
            activeTab === 'stock' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Gestionar stock
        </button>
      </div>

      <div className="mt-4">
        {listLoading ? (
          <div className="py-12 text-center text-gray-400">Generando lista...</div>
        ) : activeTab === 'list' ? (
          <ShoppingList items={items} listId={shoppingList!.id} />
        ) : (
          <StockManager items={items} listId={shoppingList!.id} />
        )}
      </div>
    </div>
  )
}
