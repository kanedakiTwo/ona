'use client'

import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Check, Share2, Package, Sparkles } from 'lucide-react'
import Link from 'next/link'
import type { Aisle } from '@ona/shared'
import { useAuth } from '@/lib/auth'
import {
  useShoppingList,
  useCheckItem,
  useStockItem,
} from '@/hooks/useShopping'
import { useMenu } from '@/hooks/useMenu'
import { haptic } from '@/lib/pwa/haptics'
import { share } from '@/lib/pwa/share'
import { AISLE_LABELS, AISLE_ORDER, aisleLabel } from '@/lib/labels'
import {
  ListTotalBanner,
  AddManualItemForm,
  ItemPriceField,
  ItemDeleteButton,
} from '@/components/shopping/ShoppingExtensions'

function todayIso(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
}

function mondayOfTodayIso(): string {
  const now = new Date()
  const day = now.getDay()
  const diff = day === 0 ? -6 : 1 - day
  const monday = new Date(now)
  monday.setDate(now.getDate() + diff)
  return `${monday.getFullYear()}-${String(monday.getMonth() + 1).padStart(2, '0')}-${String(monday.getDate()).padStart(2, '0')}`
}

function shiftIso(iso: string, days: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function formatRangeLabel(from: string, to: string): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const [, , fd] = from.split('-')
  const [, , td] = to.split('-')
  const fm = months[Number(from.split('-')[1]) - 1]
  const tm = months[Number(to.split('-')[1]) - 1]
  return fm === tm ? `${Number(fd)}–${Number(td)} ${fm}` : `${Number(fd)} ${fm} – ${Number(td)} ${tm}`
}

type Tab = 'list' | 'stock'

export default function ShoppingPage() {
  const { user, isLoading: authLoading } = useAuth()

  // Rolling date range. Default: today → end of next week. The user can
  // narrow it via the inputs above the list; pressing "Esta + sig" resets
  // to the default.
  const today = useMemo(() => todayIso(), [])
  const defaultTo = useMemo(() => shiftIso(mondayOfTodayIso(), 13), [])
  const [from, setFrom] = useState<string>(today)
  const [to, setTo] = useState<string>(defaultTo)
  const range = useMemo(() => ({ from, to }), [from, to])

  // The /menu hook is still used by the empty-state to confirm whether the
  // user has any menu at all — but the shopping list itself no longer
  // depends on a single menuId.
  const weekStart = useMemo(() => mondayOfTodayIso(), [])
  const { data: menu, isLoading: menuLoading } = useMenu(user?.id, weekStart)
  const menuId = menu?.id
  const { data: shoppingList, isLoading: listLoading } = useShoppingList(range)

  const [activeTab, setActiveTab] = useState<Tab>('list')

  const items = (shoppingList?.items ?? []) as any[]
  const checkedCount = items.filter((i) => i.checked).length
  const totalCount = items.length
  const inStockCount = items.filter((i) => i.inStock).length
  const progress = totalCount > 0 ? (checkedCount + inStockCount) / totalCount : 0

  async function handleExport() {
    haptic.light()
    const buyable = items.filter((i) => !i.checked && !i.inStock)
    const grouped = groupByAisle(buyable)
    const sections = AISLE_ORDER.flatMap((aisle) => {
      const rows = grouped[aisle] ?? []
      if (rows.length === 0) return []
      const lines = rows
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => `- ${i.name}: ${i.quantity} ${i.unit}`)
        .join('\n')
      return [`## ${AISLE_LABELS[aisle]}`, lines, '']
    })
    const text = `Lista de compra ONA\nSemana del ${weekStart}\n\n${sections.join('\n')}`
    await share({ title: 'Lista de compra ONA', text })
  }

  if (authLoading || menuLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#FAF6EE]">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!user) return null

  if (!menuId) {
    return (
      <div className="bg-[#FAF6EE] min-h-screen px-5 pt-8">
        <div className="text-eyebrow mb-2">La logistica</div>
        <h1 className="font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
          <span className="font-italic italic text-[#C65D38]">Lista</span><br />de la compra.
        </h1>

        <div className="mt-12 rounded-2xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-6 py-12 text-center">
          <div className="font-display text-5xl leading-none text-[#C65D38]/30">∅</div>
          <p className="mt-4 font-display text-xl text-[#1A1612]">
            Necesitas un menú <span className="font-italic italic">primero</span>.
          </p>
          <p className="mt-2 max-w-xs mx-auto text-[13px] text-[#7A7066]">
            La lista de la compra sale automática de tu menú semanal.
          </p>
          <Link
            href="/menu"
            className="mt-6 inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2.5 text-[13px] font-medium text-[#FAF6EE] transition-all hover:gap-3 hover:bg-[#1A1612]"
          >
            <Sparkles size={14} />
            Generar menú
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-[#FAF6EE] min-h-screen pb-12">
      {/* Editorial header */}
      <header className="px-5 pt-8 pb-5">
        <div className="flex items-baseline justify-between">
          <div className="text-eyebrow">La logística</div>
          <div className="flex items-center gap-3">
            {/* The list now regenerates automatically on every fetch + any
                time the menu changes (the menu mutation hooks invalidate
                `shopping-list`). The previous "Regenerar" button is gone
                because there's nothing left for the user to trigger
                manually. */}
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.18em] text-[#7A7066] hover:text-[#1A1612]"
            >
              <Share2 size={12} />
              Compartir
            </button>
          </div>
        </div>
        <h1 className="mt-2 font-display text-[2.4rem] leading-[0.95] text-[#1A1612]">
          <span className="font-italic italic text-[#C65D38]">Lista</span><br />de la compra.
        </h1>

        {/* Date range selector. Two date inputs + a "Esta + sig" preset that
            resets to today → end of next week. The list regenerates on
            every change (the rolling endpoint always returns fresh
            aggregation; user-checked state survives via overlay). */}
        <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2">
          <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="rounded-md border border-[#DDD6C5] bg-transparent px-2 py-1 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
          </label>
          <label className="flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-[#7A7066]">
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="rounded-md border border-[#DDD6C5] bg-transparent px-2 py-1 text-[12px] text-[#1A1612] focus:border-[#1A1612] focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              haptic.light()
              setFrom(today)
              setTo(defaultTo)
            }}
            className="ml-auto rounded-full border border-[#DDD6C5] px-3 py-1 text-[10px] uppercase tracking-[0.12em] text-[#1A1612] transition-colors hover:border-[#1A1612] hover:bg-[#1A1612] hover:text-[#FAF6EE]"
          >
            Esta + sig
          </button>
        </div>
        <p className="mt-2 text-[11px] italic text-[#7A7066]">
          {formatRangeLabel(from, to)} · los platos del día de hoy ya pasados se excluyen automáticamente
        </p>
      </header>

      {/* Progress strip */}
      <div className="px-5">
        <div className="rounded-2xl bg-[#FFFEFA] p-5 border border-[#DDD6C5]">
          <div className="flex items-end justify-between">
            <div>
              <div className="font-display text-[2.5rem] leading-none text-[#1A1612]">
                {checkedCount + inStockCount}<span className="text-[#7A7066]/40">/{totalCount}</span>
              </div>
              <div className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#7A7066]">
                completados
              </div>
            </div>
            <div className="text-right">
              <div className="font-italic italic text-2xl text-[#C65D38]">
                {Math.round(progress * 100)}<span className="text-base">%</span>
              </div>
              <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066] mt-0.5">
                listo
              </div>
            </div>
          </div>
          <div className="mt-3 h-px overflow-hidden bg-[#DDD6C5]">
            <motion.div
              animate={{ scaleX: progress }}
              initial={{ scaleX: 0 }}
              style={{ originX: 0 }}
              transition={{ duration: 1, ease: [0.19, 1, 0.22, 1] }}
              className="h-full bg-[#1A1612]"
            />
          </div>
          <div className="mt-3 flex gap-3 text-[11px]">
            <div className="flex items-center gap-1.5 text-[#2D6A4F]">
              <Check size={12} />
              <span>{checkedCount} comprados</span>
            </div>
            <div className="flex items-center gap-1.5 text-[#C65D38]">
              <Package size={12} />
              <span>{inStockCount} en casa</span>
            </div>
          </div>
        </div>
      </div>

      {/* PR 10A — total banner + add manual item */}
      {shoppingList && (
        <div className="px-5 mt-5 space-y-3">
          <ListTotalBanner listId={shoppingList.id} />
          <AddManualItemForm listId={shoppingList.id} />
        </div>
      )}

      {/* Tabs */}
      <div className="px-5 mt-5">
        <div className="flex gap-1 border-b border-[#DDD6C5]">
          <TabButton active={activeTab === 'list'} onClick={() => setActiveTab('list')}>
            Por comprar
          </TabButton>
          <TabButton active={activeTab === 'stock'} onClick={() => setActiveTab('stock')}>
            Ya en casa
          </TabButton>
        </div>
      </div>

      {/* Content */}
      <div className="px-5 mt-5">
        {listLoading ? (
          <div className="py-12 text-center font-italic italic text-[#7A7066]">Generando lista...</div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={activeTab}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.3 }}
            >
              {activeTab === 'list' ? (
                <BuyList items={items} listId={shoppingList!.id} />
              ) : (
                <StockList items={items} listId={shoppingList!.id} />
              )}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
    </div>
  )
}

/* ─────────────────────────────────────────── */

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={`relative px-4 py-2.5 text-[12px] uppercase tracking-[0.15em] transition-colors ${
        active ? 'text-[#1A1612] font-medium' : 'text-[#7A7066]'
      }`}
    >
      {children}
      {active && (
        <motion.div
          layoutId="tab-underline"
          className="absolute -bottom-px left-0 right-0 h-px bg-[#1A1612]"
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
        />
      )}
    </button>
  )
}

function groupByAisle<T extends { aisle?: Aisle | string | null }>(
  items: T[],
): Partial<Record<Aisle, T[]>> {
  const out: Partial<Record<Aisle, T[]>> = {}
  for (const item of items) {
    const key = (AISLE_ORDER as readonly string[]).includes(item.aisle as string)
      ? (item.aisle as Aisle)
      : ('otros' as Aisle)
    if (!out[key]) out[key] = []
    out[key]!.push(item)
  }
  return out
}

function AisleHeader({ aisle }: { aisle: Aisle }) {
  return (
    <li className="pt-5 pb-2 first:pt-0">
      <div className="text-[10px] uppercase tracking-[0.18em] text-[#7A7066]">
        {aisleLabel(aisle)}
      </div>
    </li>
  )
}

function BuyList({ items, listId }: { items: any[]; listId: string }) {
  const checkItem = useCheckItem()
  const stockItem = useStockItem()

  const buyable = items.filter((i) => !i.inStock)
  const grouped = groupByAisle(buyable)

  if (buyable.length === 0) {
    return (
      <div className="rounded-2xl bg-[#FFFEFA] border border-dashed border-[#DDD6C5] py-12 text-center">
        <div className="font-display text-3xl text-[#C65D38]/30">∅</div>
        <p className="mt-3 font-italic italic text-[#7A7066]">Nada que comprar.</p>
      </div>
    )
  }

  let runningIndex = 0
  return (
    <ul className="divide-y divide-dashed divide-[#DDD6C5]">
      {AISLE_ORDER.flatMap((aisle) => {
        const rows = grouped[aisle]
        if (!rows || rows.length === 0) return []
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
        return [
          <AisleHeader key={`hdr-${aisle}`} aisle={aisle} />,
          ...sorted.map((item) => {
            const i = runningIndex++
            return (
              <ItemRow
                key={item.id}
                item={item}
                index={i}
                listId={listId}
                variant="buy"
                onCheck={() => checkItem.mutate({ listId, itemId: item.id, checked: !item.checked })}
                onStock={() => stockItem.mutate({ listId, itemId: item.id, inStock: true })}
              />
            )
          }),
        ]
      })}
    </ul>
  )
}

function StockList({ items, listId }: { items: any[]; listId: string }) {
  const stockItem = useStockItem()
  const inStock = items.filter((i) => i.inStock)
  const grouped = groupByAisle(inStock)

  if (inStock.length === 0) {
    return (
      <div className="rounded-2xl bg-[#FFFEFA] border border-dashed border-[#DDD6C5] py-12 text-center">
        <div className="font-display text-3xl text-[#C65D38]/30">∅</div>
        <p className="mt-3 font-italic italic text-[#7A7066]">No tienes nada marcado como "en casa".</p>
        <p className="mt-1 text-[12px] text-[#7A7066]">Marca con el icono de paquete los items que ya tienes.</p>
      </div>
    )
  }

  let runningIndex = 0
  return (
    <ul className="divide-y divide-dashed divide-[#DDD6C5]">
      {AISLE_ORDER.flatMap((aisle) => {
        const rows = grouped[aisle]
        if (!rows || rows.length === 0) return []
        const sorted = [...rows].sort((a, b) => a.name.localeCompare(b.name))
        return [
          <AisleHeader key={`hdr-${aisle}`} aisle={aisle} />,
          ...sorted.map((item) => {
            const i = runningIndex++
            return (
              <ItemRow
                key={item.id}
                item={item}
                index={i}
                listId={listId}
                variant="stock"
                onCheck={() => {}}
                onStock={() => stockItem.mutate({ listId, itemId: item.id, inStock: false })}
              />
            )
          }),
        ]
      })}
    </ul>
  )
}

function ItemRow({
  item,
  index,
  variant,
  listId,
  onCheck,
  onStock,
}: {
  item: any
  index: number
  variant: 'buy' | 'stock'
  listId: string
  onCheck: () => void
  onStock: () => void
}) {
  const isManual = item.kind === 'manual'
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: index * 0.03, duration: 0.4 }}
      className={`flex items-center gap-3 py-3.5 ${item.checked ? 'opacity-50' : ''}`}
    >
      {variant === 'buy' ? (
        <button
          onClick={onCheck}
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition-all ${
            item.checked
              ? 'border-[#2D6A4F] bg-[#2D6A4F] text-[#FAF6EE]'
              : 'border-[#DDD6C5] bg-transparent hover:border-[#1A1612]'
          }`}
          aria-label="Marcar como comprado"
        >
          {item.checked && <Check size={13} strokeWidth={2.5} />}
        </button>
      ) : (
        <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[#C65D38]/10">
          <Package size={12} className="text-[#C65D38]" />
        </div>
      )}

      <div className="flex-1 min-w-0">
        <div className={`text-[15px] capitalize text-[#1A1612] ${item.checked ? 'line-through' : ''}`}>
          {item.name}
          {isManual && (
            <span className="ml-1.5 text-[9px] uppercase tracking-[0.15em] text-[#C65D38] not-italic">
              · manual
            </span>
          )}
        </div>
      </div>

      <div className="font-mono text-[11px] tracking-tight text-[#7A7066] tabular-nums shrink-0">
        {item.quantity} {item.unit}
      </div>

      {variant === 'buy' && <ItemPriceField listId={listId} item={item} />}
      {variant === 'buy' && isManual && <ItemDeleteButton listId={listId} itemId={item.id} />}

      <button
        onClick={onStock}
        className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-[0.12em] transition-colors ${
          variant === 'stock'
            ? 'bg-[#C65D38] text-[#FAF6EE]'
            : 'bg-[#F2EDE0] text-[#7A7066] hover:bg-[#1A1612] hover:text-[#FAF6EE]'
        }`}
        aria-label={variant === 'stock' ? 'Quitar de en casa' : 'Marcar en casa'}
      >
        {variant === 'stock' ? 'Quitar' : 'En casa'}
      </button>
    </motion.li>
  )
}
