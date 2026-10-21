'use client'

/**
 * /shopping — "D · Luz y foto" (PRO-38, 2026-10-10): lista y despensa.
 *
 * Compact header (date-range eyebrow + Fraunces 650 h1 + one "···"), ONE
 * chip row (the date range — opens the dates sheet — then the aisles, which
 * filter the list), a slim progress card + the € total, the "Por comprar" /
 * "Ya en casa" tabs and the aisles. Rows read like the recipe detail's
 * ingredient rows: dashed dividers, 16 px name, JetBrains quantity, a big
 * check. Secondary actions (Compartir lo que queda, Añadir a mano, Pedir a
 * mis tiendas, Cambiar fechas) live in the "···" sheet (`MenuSheet`).
 * The first time the list opens, once, «Compártela con quien compra contigo»
 * (PRO-261, `FamilyInviteOffer`) under the header.
 * Desktop (lg+): 1180 px container, aisles as paper cards in 2–3 columns.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { CalendarDays, Check, ChevronLeft, ChevronRight, MoreHorizontal, Package, Plus, Share2, Sparkles, Store } from 'lucide-react'
import Link from 'next/link'
import type { Aisle } from '@ona/shared'
import { useAuth } from '@/lib/auth'
import {
  useShoppingList,
  useCheckItem,
  useStockItem,
  useEditMenuLine,
  useHaveAtHome,
  usePatchShoppingItem,
  useDeleteShoppingItem,
} from '@/hooks/useShopping'
import { useMenu } from '@/hooks/useMenu'
import { haptic } from '@/lib/pwa/haptics'
import { share } from '@/lib/pwa/share'
import { InviteHouseholdButton } from '@/components/referrals/InviteHouseholdButton'
import { AISLE_LABELS, AISLE_ORDER, aisleLabel } from '@/lib/labels'
import { activeQuickRange, quickRanges, shiftIso, spansWeeks, totalTitle, type QuickRangeKey } from '@/lib/shoppingRange'
import { LineWeek, LineWeekContext } from '@/components/shopping/LineWeek'
import { FamilyInviteOffer, useFamilyOfferOnce } from '@/components/household/FamilyInviteOffer'
import {
  ListTotalBanner,
  AddManualItemForm,
  ItemPriceField,
} from '@/components/shopping/ShoppingExtensions'
import { AddToListField, LineAmount, RemoveLineButton, UNIT_LABEL, useRemoveWithUndo } from '@/components/shopping/LineControls'
import { HabitualStar, HabitualSwitch, HabitualTag, isHabitual } from '@/components/shopping/HabitualToggle'
import { MenuSheet, SheetAction } from '@/components/menu/MenuSheet'
import { ingredientDisplayName, missingQuantity, parseShoppingAmount, shoppingProgress, withOnaFooter } from '@ona/shared'

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

function formatRangeLabel(from: string, to: string): string {
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic']
  const [, , fd] = from.split('-')
  const [, , td] = to.split('-')
  const fm = months[Number(from.split('-')[1]) - 1]
  const tm = months[Number(to.split('-')[1]) - 1]
  if (from === to) return `${Number(fd)} ${fm}`
  return fm === tm ? `${Number(fd)}–${Number(td)} ${fm}` : `${Number(fd)} ${fm} – ${Number(td)} ${tm}`
}

type Tab = 'list' | 'stock'

/** Fraunces 650 at its natural optical size — same cut as /menu and /recipes titles. */
const TITLE = 'font-serif-text font-[650] text-ink'

export default function ShoppingPage() {
  const { user, isLoading: authLoading } = useAuth()

  // Rolling date range. Default: today → end of next week. The user can
  // narrow it in the dates sheet; «Dos semanas» resets to the default.
  const today = useMemo(() => todayIso(), [])
  const defaultTo = useMemo(() => shiftIso(mondayOfTodayIso(), 13), [])
  const [from, setFrom] = useState<string>(today)
  const [to, setTo] = useState<string>(defaultTo)
  const range = useMemo(() => ({ from, to }), [from, to])
  const rangeLabel = formatRangeLabel(from, to)
  // «Hoy» · «Mañana» · «Esta semana» · «La que viene» · «Dos semanas» (PRO-33,
  // PRO-269): one tap instead of the dates sheet; the chip says what it shows.
  const shortcuts = useMemo(() => quickRanges(today), [today])
  const [tappedShortcut, setTappedShortcut] = useState<QuickRangeKey | null>('dos')
  const activeShortcut = activeQuickRange(shortcuts, from, to, tappedShortcut)
  // PRO-269: with more than one week on screen, each line says its week.
  const lineWeek = useMemo(() => ({ show: spansWeeks(from, to), today }), [from, to, today])
  // PRO-69: slide the pressed shortcut fully into view once the row has
  // re-rendered with the new range (the date chip changes width, so doing it
  // in the click handler left «Esta semana» half cut on a phone).
  const chipRowRef = useRef<HTMLDivElement>(null)
  const shortcutTapped = useRef(false)
  useEffect(() => {
    if (!shortcutTapped.current) return
    shortcutTapped.current = false
    const pressed = chipRowRef.current?.querySelector<HTMLElement>('[data-shortcut][aria-pressed="true"]')
    pressed?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
  }, [activeShortcut, from, to])

  // The /menu hook is still used by the empty-state to confirm whether the
  // user has any menu at all — but the shopping list itself no longer
  // depends on a single menuId.
  const weekStart = useMemo(() => mondayOfTodayIso(), [])
  const { data: menu, isLoading: menuLoading } = useMenu(user?.id, weekStart)
  const menuId = menu?.id
  const { data: shoppingList, isLoading: listLoading, isFetching: listFetching } = useShoppingList(range)

  const [activeTab, setActiveTab] = useState<Tab>('list')
  const [aisleFilter, setAisleFilter] = useState<Aisle | null>(null)
  const [sheet, setSheet] = useState<null | 'actions' | 'dates' | 'add'>(null)

  const allItems = (shoppingList?.items ?? []) as any[]
  // «No lo compro esta semana» (PRO-175): out of the list, in its own section to put back.
  const items = allItems.filter((i) => !i.skipped)
  const skippedItems = allItems.filter((i) => i.skipped)
  // Each row counts once: bought-then-at-home is "en casa" (never > 100 %).
  const { total: totalCount, bought: checkedCount, atHome: inStockCount, done: doneCount, ratio: progress } = shoppingProgress(items)

  // Aisle chips: only the aisles that have rows in the current tab.
  const tabItems = items.filter((i) => (activeTab === 'list' ? !i.inStock : i.inStock))
  const tabGroups = groupByAisle(tabItems)
  const aislesInTab = AISLE_ORDER.filter((a) => (tabGroups[a]?.length ?? 0) > 0)
  const effectiveAisle = aisleFilter && aislesInTab.includes(aisleFilter) ? aisleFilter : null

  // «Familia en el mismo hogar» (PRO-261): once, the first time the list is on screen.
  const familyOffer = useFamilyOfferOnce('compra', !!user && !authLoading && !menuLoading && !!menuId && !!shoppingList)

  async function handleExport() {
    haptic.light()
    const buyable = items.filter((i) => !i.checked && !i.inStock)
    const grouped = groupByAisle(buyable)
    const sections = AISLE_ORDER.flatMap((aisle) => {
      const rows = grouped[aisle] ?? []
      if (rows.length === 0) return []
      const lines = rows
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((i) => `- ${i.name}: ${i.amountText ?? `${i.quantity} ${i.unit}`}`)
        .join('\n')
      return [`## ${AISLE_LABELS[aisle]}`, lines, '']
    })
    const text = withOnaFooter(
      `Lista de compra · Mimoia\nSemana del ${weekStart}\n\n${sections.join('\n')}`,
      window.location.origin,
      'lista',
    )
    await share({ title: 'Lista de compra · Mimoia', text })
  }

  if (authLoading || menuLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-cream">
        <div className="text-eyebrow">Cargando...</div>
      </div>
    )
  }

  if (!user) return null

  const h1 = (
    <h1 className={`${TITLE} text-[30px] leading-[1.1] lg:text-[40px] lg:leading-[1.05]`}>
      Lista de la <span className="font-medium italic text-terracotta-deep">compra</span>
    </h1>
  )

  if (!menuId) {
    return (
      <div className="min-h-screen bg-cream">
        <div className="mx-auto w-full max-w-[1180px] px-5 pt-3 pb-12 lg:px-12 lg:pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
            La logística
          </p>
          <div className="mt-0.5">{h1}</div>

          <div className="mt-6 rounded-[22px] border border-dashed border-border bg-paper px-6 py-10 text-center lg:mx-auto lg:max-w-[560px]">
            <p className={`${TITLE} text-xl`}>
              Necesitas un menú <span className="italic">primero</span>.
            </p>
            <p className="mx-auto mt-2 max-w-xs text-[14px] text-ink-soft">
              La lista de la compra sale automática de tu menú semanal.
            </p>
            <Link
              href="/menu"
              className="mt-6 inline-flex min-h-[44px] items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid"
            >
              <Sparkles size={15} />
              Generar menú
            </Link>
          </div>
        </div>
      </div>
    )
  }

  function switchTab(tab: Tab) {
    setActiveTab(tab)
    setAisleFilter(null)
  }

  return (
    <LineWeekContext.Provider value={lineWeek}>
    <div className="min-h-screen bg-cream">
      <div className="mx-auto w-full max-w-[1180px] pb-12 lg:px-12 lg:pt-8">
        {/* Compact header: range eyebrow + title + "···" */}
        <header className="flex items-start justify-between gap-2 px-5 pt-3 lg:items-end lg:px-0 lg:pt-0">
          <div className="flex min-w-0 flex-col gap-0.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted lg:text-[12px]">
              {rangeLabel}
            </p>
            {h1}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href="/compra"
              className="hidden h-11 items-center gap-2 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink transition-colors hover:border-ink lg:inline-flex"
            >
              <Store size={15} /> Pedir a mis tiendas
            </Link>
            <button
              type="button"
              onClick={() => setSheet('actions')}
              aria-label="Opciones de la compra"
              aria-haspopup="dialog"
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors hover:bg-cream-deep focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              <MoreHorizontal size={20} strokeWidth={2} />
            </button>
          </div>
        </header>

        {/* PRO-261: the first time the list opens, once: «Compártela con quien compra contigo». */}
        {familyOffer.show && (
          <div className="mt-3 px-5 lg:mt-5 lg:px-0">
            <FamilyInviteOffer moment="compra" onDismiss={familyOffer.dismiss} />
          </div>
        )}

        {/* ONE chip row: date range (opens the dates sheet) + aisles (filter).
            On a phone it slides sideways; the trailing spacer keeps a visible
            margin after the last chip (scroll containers may drop the end
            padding), and the pressed shortcut slides into view (PRO-69). */}
        <div
          className="scrollbar-none mt-3 flex gap-2 overflow-x-auto pl-5 py-1 lg:mt-5 lg:flex-wrap lg:overflow-visible lg:px-0"
          aria-label="Filtrar la lista"
          role="group"
          data-testid="shopping-chip-row"
          ref={chipRowRef}
        >
          <WeekStep
            dir="prev"
            disabled={from <= today}
            onClick={() => {
              haptic.light()
              const nextFrom = shiftIso(from, -7) < today ? today : shiftIso(from, -7)
              const nextTo = shiftIso(to, -7)
              setFrom(nextFrom)
              setTo(nextTo < nextFrom ? nextFrom : nextTo)
            }}
          />
          <Chip active={false} onClick={() => setSheet('dates')} ariaHaspopup>
            <CalendarDays size={15} className="-ml-0.5 mr-1.5 inline-block align-[-2px]" aria-hidden="true" />
            <span className="sr-only">Fechas: </span>
            <span data-testid="shopping-range">{rangeLabel}</span>
          </Chip>
          <WeekStep
            dir="next"
            onClick={() => {
              haptic.light()
              setFrom(shiftIso(from, 7))
              setTo(shiftIso(to, 7))
            }}
          />
          {shortcuts.map((r) => (
            <Chip
              key={r.key}
              active={activeShortcut === r.key}
              onClick={() => {
                haptic.light()
                shortcutTapped.current = true
                setTappedShortcut(r.key)
                setFrom(r.from)
                setTo(r.to)
              }}
              pressable
              shortcut
            >
              {r.label}
            </Chip>
          ))}
          {aislesInTab.length > 1 && (
            <>
              <span aria-hidden="true" className="my-2 w-px shrink-0 bg-border" />
              <Chip active={effectiveAisle === null} onClick={() => setAisleFilter(null)} pressable>
                Todo
              </Chip>
              {aislesInTab.map((a) => (
                <Chip
                  key={a}
                  active={effectiveAisle === a}
                  onClick={() => {
                    haptic.light()
                    setAisleFilter(effectiveAisle === a ? null : a)
                  }}
                  pressable
                >
                  {aisleLabel(a)}
                  <span className="ml-1.5 font-mono text-[12px] tabular-nums opacity-70">{tabGroups[a]!.length}</span>
                </Chip>
              ))}
            </>
          )}
          <span aria-hidden="true" className="w-3 shrink-0 lg:hidden" />
        </div>

        {/* Progress + € total */}
        <div className="mt-3 grid gap-3 px-5 lg:mt-5 lg:grid-cols-2 lg:px-0">
          <div className="rounded-[20px] border border-border-soft bg-paper px-5 py-4">
            <div className="flex items-baseline justify-between gap-3">
              <p className="flex items-baseline gap-2">
                <span className={`${TITLE} text-[28px] leading-none tabular-nums`}>
                  <span data-testid="shopping-done">{doneCount}</span>
                  <span className="text-ink-light">/<span data-testid="shopping-total">{totalCount}</span></span>
                </span>
                <span className="text-[13px] text-ink-muted">completados</span>
              </p>
              <p className="text-[13px] text-ink-muted">
                <span className="font-serif-text text-[20px] font-medium italic text-terracotta-deep">
                  {Math.round(progress * 100)}%
                </span>{' '}
                listo
              </p>
            </div>
            <div className="mt-3 h-1 overflow-hidden rounded-full bg-cream-deep">
              <motion.div
                animate={{ scaleX: progress }}
                initial={{ scaleX: 0 }}
                style={{ originX: 0 }}
                transition={{ duration: 1, ease: [0.19, 1, 0.22, 1] }}
                className="h-full rounded-full bg-ink"
              />
            </div>
            <div className="mt-3 flex gap-4 text-[13px] text-ink-mid">
              <span className="flex items-center gap-1.5">
                <Check size={14} strokeWidth={2.2} aria-hidden="true" />
                {checkedCount} comprados
              </span>
              <span className="flex items-center gap-1.5">
                <Package size={14} className="text-terracotta-deep" aria-hidden="true" />
                <span data-testid="shopping-athome">{inStockCount}</span> en casa
              </span>
            </div>
          </div>
          {shoppingList && <ListTotalBanner listId={shoppingList.id} title={totalTitle(activeShortcut)} />}
        </div>

        {/* Tabs: lista / despensa */}
        <div className="mt-4 px-5 lg:mt-6 lg:px-0">
          <div role="tablist" aria-label="Lista o despensa" className="flex gap-6 border-b border-border-soft">
            <TabButton active={activeTab === 'list'} onClick={() => switchTab('list')}>
              Por comprar
            </TabButton>
            <TabButton active={activeTab === 'stock'} onClick={() => switchTab('stock')}>
              Ya en casa
            </TabButton>
          </div>
        </div>

        {/* Content */}
        <div className="mt-4 px-5 lg:mt-5 lg:px-0">
          {listLoading ? (
            <div className="py-12 text-center font-italic italic text-ink-muted">Generando lista...</div>
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
                  <BuyList items={items} skipped={skippedItems} listId={shoppingList!.id} aisle={effectiveAisle} busy={listFetching} />
                ) : (
                  <StockList items={items} listId={shoppingList!.id} aisle={effectiveAisle} busy={listFetching} />
                )}
              </motion.div>
            </AnimatePresence>
          )}
          {/* PRO-163: «Invitar a otro hogar», under the list. */}
          <InviteHouseholdButton place="compra" className="mt-8" />
        </div>
      </div>

      {/* "···" — the list's secondary actions */}
      <MenuSheet open={sheet === 'actions'} onClose={() => setSheet(null)} eyebrow={rangeLabel} title="Tu compra">
        <div className="flex flex-col gap-0.5">
          <SheetAction
            icon={Share2}
            label="Compartir lo que queda"
            hint="Lo que te falta por comprar, como texto"
            onClick={() => {
              setSheet(null)
              void handleExport()
            }}
          />
          {shoppingList && (
            <SheetAction
              icon={Plus}
              label="Añadir a mano"
              hint="Algo que no sale del menú: pan, café, detergente…"
              onClick={() => setSheet('add')}
            />
          )}
          <SheetAction
            icon={Store}
            label="Pedir a mis tiendas"
            hint="Un pedido por tienda, por WhatsApp"
            href="/compra"
          />
          <SheetAction icon={CalendarDays} label="Cambiar fechas" hint={rangeLabel} onClick={() => setSheet('dates')} />
        </div>
      </MenuSheet>

      {/* Date range. The list regenerates on every change (the rolling
          endpoint always returns fresh aggregation; checked state survives
          via overlay). */}
      <MenuSheet open={sheet === 'dates'} onClose={() => setSheet(null)} eyebrow={rangeLabel} title="Fechas de la lista">
        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Desde
            <input
              type="date"
              value={from}
              max={to}
              onChange={(e) => setFrom(e.target.value)}
              className="h-11 rounded-xl border border-border bg-paper px-3 text-[15px] font-normal normal-case tracking-normal text-ink focus:border-ink focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-muted">
            Hasta
            <input
              type="date"
              value={to}
              min={from}
              onChange={(e) => setTo(e.target.value)}
              className="h-11 rounded-xl border border-border bg-paper px-3 text-[15px] font-normal normal-case tracking-normal text-ink focus:border-ink focus:outline-none"
            />
          </label>
        </div>
        <p className="mt-3 text-[13px] leading-snug text-ink-soft">
          {rangeLabel} · los platos del día de hoy ya pasados se excluyen automáticamente
        </p>
        <button
          type="button"
          onClick={() => {
            haptic.light()
            setTappedShortcut('dos')
            setFrom(today)
            setTo(defaultTo)
          }}
          className="mt-4 inline-flex min-h-[44px] items-center rounded-full border border-border bg-paper px-5 text-[14px] font-medium text-ink transition-colors hover:border-ink"
        >
          Dos semanas
        </button>
      </MenuSheet>

      {/* Añadir a mano */}
      <MenuSheet open={sheet === 'add'} onClose={() => setSheet(null)} eyebrow="Lista de la compra" title="Añadir a mano">
        {shoppingList && <AddManualItemForm listId={shoppingList.id} embedded onClose={() => setSheet(null)} />}
      </MenuSheet>
    </div>
    </LineWeekContext.Provider>
  )
}

/* ─────────────────────────────────────────── */

/** ‹ › beside the date chip: move the whole range a week back or forward. */
function WeekStep({ dir, onClick, disabled }: { dir: 'prev' | 'next'; onClick: () => void; disabled?: boolean }) {
  const Icon = dir === 'prev' ? ChevronLeft : ChevronRight
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={dir === 'prev' ? 'Semana anterior' : 'Semana siguiente'}
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-border bg-paper text-ink transition-colors before:absolute before:-inset-1 hover:border-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-border lg:h-[38px] lg:w-[38px]"
    >
      <Icon size={17} aria-hidden="true" />
    </button>
  )
}

/** 36 px pill (hit area stretched to 44 px), same as the /recipes chip row. */
function Chip({
  active,
  onClick,
  children,
  pressable,
  ariaHaspopup,
  shortcut,
}: {
  active: boolean
  onClick: () => void
  children: React.ReactNode
  pressable?: boolean
  ariaHaspopup?: boolean
  shortcut?: boolean
}) {
  return (
    <button
      type="button"
      aria-pressed={pressable ? active : undefined}
      aria-haspopup={ariaHaspopup ? 'dialog' : undefined}
      data-shortcut={shortcut ? '' : undefined}
      onClick={onClick}
      className={`relative h-9 shrink-0 whitespace-nowrap rounded-full border px-3.5 text-[14px] transition-colors before:absolute before:inset-x-0 before:-inset-y-1 active:scale-[0.97] lg:h-[38px] lg:px-4 ${
        active ? 'border-ink bg-ink font-medium text-cream' : 'border-border bg-paper text-ink hover:border-ink'
      }`}
    >
      {children}
    </button>
  )
}

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
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`-mb-px h-11 shrink-0 whitespace-nowrap border-b-2 text-[15px] transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink ${
        active ? 'border-ink font-semibold text-ink' : 'border-transparent text-ink-muted hover:text-ink'
      }`}
    >
      {children}
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

/** Aisles: sections on mobile, paper cards in 2 columns at lg+ (3 squeezed the names onto two lines). */
function AisleGrid({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-col gap-6 lg:grid lg:grid-cols-2 lg:items-start lg:gap-5">{children}</div>
}

function AisleSection({ aisle, count, children }: { aisle: Aisle; count: number; children: React.ReactNode }) {
  return (
    <section
      aria-label={aisleLabel(aisle)}
      className="lg:rounded-[20px] lg:border lg:border-border-soft lg:bg-paper lg:px-5 lg:pt-4 lg:pb-2"
    >
      <h2 className="flex items-baseline justify-between gap-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-ink-muted">
        {aisleLabel(aisle)}
        <span className="font-mono text-[12px] font-normal tracking-normal tabular-nums">{count}</span>
      </h2>
      <ul>{children}</ul>
    </section>
  )
}

function EmptyCard({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-[22px] border border-dashed border-border bg-paper px-6 py-10 text-center">
      <p className="font-serif-text text-[18px] font-medium italic text-ink-mid">{title}</p>
      {hint && <p className="mt-1.5 text-[14px] text-ink-soft">{hint}</p>}
    </div>
  )
}

/** `busy`: the list is being rebuilt (its id changes on every GET), so rows wait instead of writing to the old one. */
function BuyList({
  items,
  skipped = [],
  listId,
  aisle,
  busy,
}: {
  items: any[]
  skipped?: any[]
  listId: string
  aisle: Aisle | null
  busy?: boolean
}) {
  const checkItem = useCheckItem()
  const stockItem = useStockItem()
  const editLine = useEditMenuLine()
  // The line whose sheet is open (PRO-175): change the amount or leave it out.
  const [editing, setEditing] = useState<any | null>(null)
  // PRO-292: «Quitar» on the line itself, with «Deshacer»; «Añadir a la lista» on top.
  const undoable = useRemoveWithUndo(listId)
  const addField = <AddToListField listId={listId} disabled={busy} />

  const buyable = items.filter((i) => !i.inStock)
  const grouped = groupByAisle(buyable)
  const skippedHere = skipped.filter((i) => !aisle || i.aisle === aisle)
  const sheet = (
    <LineSheet item={editing} listId={listId} onClose={() => setEditing(null)} />
  )

  if (buyable.length === 0) {
    return (
      <>
        {addField}
        <EmptyCard title="Nada que comprar." />
        <SkippedLines items={skippedHere} busy={busy || editLine.isPending} onRestore={(it) => editLine.mutate({ listId, itemId: it.id, skipped: false })} />
        {sheet}
        {undoable.toast}
      </>
    )
  }

  let runningIndex = 0
  return (
    <>
    {addField}
    <AisleGrid>
      {AISLE_ORDER.filter((a) => !aisle || a === aisle).flatMap((a) => {
        const rows = grouped[a]
        if (!rows || rows.length === 0) return []
        const sorted = [...rows].sort((x, y) => x.name.localeCompare(y.name))
        return [
          <AisleSection key={a} aisle={a} count={sorted.length}>
            {sorted.map((item) => {
              const i = runningIndex++
              return (
                <ItemRow
                  key={item.id}
                  busy={busy}
                  item={item}
                  index={i}
                  listId={listId}
                  variant="buy"
                  onCheck={() => checkItem.mutate({ listId, itemId: item.id, checked: !item.checked })}
                  onStock={() => stockItem.mutate({ listId, itemId: item.id, inStock: true })}
                  onEdit={() => setEditing(item)}
                  onRemove={() => undoable.remove(item)}
                />
              )
            })}
          </AisleSection>,
        ]
      })}
    </AisleGrid>
    <SkippedLines items={skippedHere} busy={busy || editLine.isPending} onRestore={(it) => editLine.mutate({ listId, itemId: it.id, skipped: false })} />
    {sheet}
    {undoable.toast}
    </>
  )
}

/** «Quitado de esta compra» (PRO-175): menu lines the household won't buy for this list, to put back. */
function SkippedLines({ items, busy, onRestore }: { items: any[]; busy?: boolean; onRestore: (item: any) => void }) {
  if (items.length === 0) return null
  return (
    <section className="mt-6" aria-label="Quitado de esta compra" data-testid="shopping-skipped">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">Quitado de esta compra</h3>
      <ul>
        {items.map((item) => (
          <li key={item.id} className="flex items-center gap-2 border-b border-dashed border-border py-1.5 last:border-b-0">
            <p className="min-w-0 flex-1 break-words text-[15px] text-ink-soft line-through">{ingredientDisplayName(item.name)}</p>
            <button
              type="button"
              disabled={busy}
              onClick={() => onRestore(item)}
              className="relative h-8 shrink-0 whitespace-nowrap rounded-full bg-cream-deep px-3 text-[12px] font-medium text-ink-mid transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 hover:bg-ink hover:text-cream disabled:cursor-wait"
              aria-label={`Volver a añadir ${ingredientDisplayName(item.name)}`}
            >
              Volver a añadir
            </button>
          </li>
        ))}
      </ul>
    </section>
  )
}

const UNIT_WORD: Record<string, string> = { g: 'gramos', ml: 'ml', u: 'unidades', cda: 'cucharadas', cdita: 'cucharaditas' }

/**
 * Sheet for one line (PRO-175). Menu lines: change the amount (in the line's
 * unit), go back to the menu's, or «No lo compro esta semana». Manual lines:
 * any amount («2 paquetes») or remove. Staples: they are changed in Mis básicos.
 */
function LineSheet({ item, listId, onClose }: { item: any | null; listId: string; onClose: () => void }) {
  const editLine = useEditMenuLine()
  const patch = usePatchShoppingItem()
  const del = useDeleteShoppingItem()
  const haveAtHome = useHaveAtHome()
  const [draft, setDraft] = useState('')
  const [haveDraft, setHaveDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isManual = item?.kind === 'manual'
  const isStaple = item?.kind === 'staple'
  useEffect(() => {
    setError(null)
    if (item) setDraft(item.amountText ?? formatAmount(item.quantity))
    setHaveDraft(item?.haveQuantity > 0 ? formatAmount(item.haveQuantity) : '')
  }, [item])
  const done = { onSuccess: onClose, onError: () => setError('No se ha podido guardar. Prueba otra vez.') }
  const pending = editLine.isPending || patch.isPending || del.isPending || haveAtHome.isPending

  /** «Nos queda una cebolla» (PRO-182): the list buys only the rest. Empty = nothing at home. */
  function saveHave() {
    if (!item) return
    const amount = haveDraft.trim() ? parseShoppingAmount(haveDraft) : { quantity: 0 }
    if (!amount || !('quantity' in amount)) return setError(`Escribe un número (en ${UNIT_WORD[item.unit] ?? item.unit}).`)
    haveAtHome.mutate({ listId, itemId: item.id, quantity: amount.quantity }, done)
  }

  function save(e: React.FormEvent) {
    e.preventDefault()
    if (!item) return
    const amount = parseShoppingAmount(draft)
    if (isManual) {
      if (!amount) return setError('Escribe una cantidad: «2» o «2 paquetes».')
      patch.mutate({ listId, itemId: item.id, patch: 'quantity' in amount ? { quantity: amount.quantity, amountText: null } : { amountText: amount.amountText } }, done)
      return
    }
    if (!amount || !('quantity' in amount)) return setError(`Escribe un número (en ${UNIT_WORD[item.unit] ?? item.unit}).`)
    editLine.mutate({ listId, itemId: item.id, quantity: amount.quantity }, done)
  }

  return (
    <MenuSheet open={!!item} onClose={onClose} eyebrow="Lista de la compra" title={item ? ingredientDisplayName(item.name) : ''}>
      {item && isStaple ? (
        <div className="space-y-3">
          <p className="text-[15px] text-ink-soft">Es uno de tus básicos: su cantidad se cambia en Mis básicos.</p>
          {/* PRO-293: pause it from here. */}
          <HabitualSwitch key={item.id} item={item} listId={listId} />
          <Link href="/profile/staples" className="inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-cream">
            Ir a Mis básicos
          </Link>
        </div>
      ) : item ? (
        <form onSubmit={save} className="space-y-3" data-testid="line-sheet">
          <label className="block">
            <span className="mb-1 block text-[13px] text-ink-muted">
              {isManual ? 'Cantidad (un número o «2 paquetes»)' : `Cantidad a comprar, en ${UNIT_WORD[item.unit] ?? item.unit}`}
            </span>
            <input
              type="text"
              inputMode={isManual ? 'text' : 'decimal'}
              value={draft}
              maxLength={30}
              onChange={(e) => setDraft(e.target.value)}
              aria-label="Cantidad a comprar"
              className="h-11 w-full rounded-xl border border-border bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
            />
          </label>
          {!isManual && item.menuQuantity != null && (
            <p className="text-[13px] text-ink-muted">
              El menú pide {formatAmount(item.menuQuantity)} {item.menuUnit ?? item.unit}.{' '}
              <button
                type="button"
                disabled={pending}
                onClick={() => editLine.mutate({ listId, itemId: item.id, ...(item.menuUnit ? { unit: item.menuUnit } : { quantity: null }) }, done)}
                className="underline underline-offset-2 hover:text-ink"
              >
                Volver a lo del menú
              </button>
            </p>
          )}
          {error && <p className="text-[13px] text-terracotta-deep" role="alert">{error}</p>}
          <button
            type="submit"
            disabled={pending}
            className="min-h-[44px] w-full rounded-full bg-ink text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid disabled:opacity-40"
          >
            Guardar cantidad
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              isManual
                ? del.mutate({ listId, itemId: item.id }, done)
                : editLine.mutate({ listId, itemId: item.id, skipped: true }, done)
            }
            className="min-h-[44px] w-full rounded-full border border-border bg-paper text-[14px] font-medium text-ink-mid transition-colors hover:border-ink hover:text-ink disabled:opacity-40"
          >
            {isManual ? 'Quitar de la lista' : 'No lo compro esta semana'}
          </button>
          {!isManual && (
            <div className="mt-2 rounded-xl bg-cream-deep/60 p-3">
              <label className="block">
                <span className="mb-1 block text-[13px] text-ink-muted">
                  ¿Cuánto os queda en casa? (en {UNIT_WORD[item.unit] ?? item.unit})
                </span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={haveDraft}
                  maxLength={10}
                  placeholder="0"
                  onChange={(e) => setHaveDraft(e.target.value)}
                  aria-label="Cuánto queda en casa"
                  className="h-11 w-full rounded-xl border border-border bg-paper px-3 text-[15px] text-ink outline-none focus:border-ink"
                />
              </label>
              <button
                type="button"
                disabled={pending}
                onClick={saveHave}
                className="mt-2 min-h-[44px] w-full rounded-full border border-ink bg-paper text-[14px] font-medium text-ink transition-colors hover:bg-ink hover:text-cream disabled:opacity-40"
              >
                Comprar solo lo que falta
              </button>
            </div>
          )}
          {/* PRO-293: «Habitual» — comes back by itself on every new list. */}
          <HabitualSwitch key={item.id} item={item} listId={listId} />
        </form>
      ) : null}
    </MenuSheet>
  )
}

function StockList({ items, listId, aisle, busy }: { items: any[]; listId: string; aisle: Aisle | null; busy?: boolean }) {
  const stockItem = useStockItem()
  const inStock = items.filter((i) => i.inStock)
  const grouped = groupByAisle(inStock)

  if (inStock.length === 0) {
    return (
      <EmptyCard
        title='No tienes nada marcado como "en casa".'
        hint="Marca con el icono de paquete los items que ya tienes."
      />
    )
  }

  let runningIndex = 0
  return (
    <AisleGrid>
      {AISLE_ORDER.filter((a) => !aisle || a === aisle).flatMap((a) => {
        const rows = grouped[a]
        if (!rows || rows.length === 0) return []
        const sorted = [...rows].sort((x, y) => x.name.localeCompare(y.name))
        return [
          <AisleSection key={a} aisle={a} count={sorted.length}>
            {sorted.map((item) => {
              const i = runningIndex++
              return (
                <ItemRow
                  key={item.id}
                  busy={busy}
                  item={item}
                  index={i}
                  listId={listId}
                  variant="stock"
                  onCheck={() => {}}
                  onStock={() => stockItem.mutate({ listId, itemId: item.id, inStock: false })}
                />
              )
            })}
          </AisleSection>,
        ]
      })}
    </AisleGrid>
  )
}

/** 12.5 → "12,5"; whole numbers as they are. */
function formatAmount(n: number): string {
  return (Math.round(n * 10) / 10).toLocaleString('es-ES')
}

function ItemRow({
  item,
  index,
  variant,
  listId,
  onCheck,
  onStock,
  onEdit,
  onRemove,
  busy,
}: {
  item: any
  index: number
  variant: 'buy' | 'stock'
  listId: string
  onCheck: () => void
  onStock: () => void
  /** Opens the line's sheet: amount, «No lo compro esta semana» (PRO-175). */
  onEdit?: () => void
  /** «Quitar» with «Deshacer» (PRO-292). */
  onRemove?: () => void
  busy?: boolean
}) {
  const isManual = item.kind === 'manual'
  const buy = variant === 'buy'
  return (
    <motion.li
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: Math.min(index, 20) * 0.03, duration: 0.4 }}
      className="border-b border-dashed border-border py-1.5 last:border-b-0"
      data-testid="shopping-line"
    >
      <div className="flex items-center gap-2">
      {variant === 'buy' ? (
        <button
          type="button"
          onClick={onCheck}
          disabled={busy}
          className="group -ml-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline-2 focus-visible:outline-ink disabled:cursor-wait"
          aria-label="Marcar como comprado"
          aria-pressed={!!item.checked}
        >
          <span
            className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 transition-all ${
              item.checked ? 'border-ink bg-ink text-cream' : 'border-border bg-paper group-hover:border-ink'
            }`}
          >
            {item.checked && <Check size={15} strokeWidth={2.6} />}
          </span>
        </button>
      ) : (
        <div className="-ml-2 flex h-11 w-11 shrink-0 items-center justify-center" aria-hidden="true">
          <span className="flex h-[26px] w-[26px] items-center justify-center rounded-full bg-terracotta-deep/10">
            <Package size={14} className="text-terracotta-deep" />
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={onEdit}
        disabled={!onEdit || busy}
        aria-label={onEdit ? `Cambiar ${ingredientDisplayName(item.name)}` : undefined}
        className={`min-w-0 flex-1 text-left disabled:cursor-default ${item.checked ? 'opacity-50' : ''}`}
      >
        <span className={`block break-words text-[16px] leading-snug text-ink ${item.checked ? 'line-through' : ''}`}>
          {ingredientDisplayName(item.name)}
        </span>
        <span className="block font-mono text-[13px] tracking-tight text-ink-muted tabular-nums">
          {item.haveQuantity > 0 ? (
            // Part already bought / at home for an earlier menu (PRO-199).
            <span data-testid="shopping-missing">
              Te faltan {formatAmount(missingQuantity(item))} {item.unit}
              <span className="font-sans text-[12px]"> · ya tienes {formatAmount(item.haveQuantity)}</span>
            </span>
          ) : buy ? null : item.amountText ? (
            <span className="font-sans">{item.amountText}</span>
          ) : (
            <>
              {item.quantity} {item.unit}
            </>
          )}
          {item.menuQuantity != null && (
            // The household's own amount or unit (PRO-175, PRO-292).
            <span className="font-sans text-[12px]" data-testid="shopping-changed">
              {buy && !(item.haveQuantity > 0) ? '' : ' · '}cambiada (menú: {formatAmount(item.menuQuantity)} {UNIT_LABEL[item.menuUnit ?? item.unit] ?? item.unit})
            </span>
          )}
          {!isManual && <LineWeek weeks={item.weeks} />}
          {isManual && !isHabitual(item) && (
            <span className="ml-2 font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-terracotta-deep">
              Manual
            </span>
          )}
          {buy && isHabitual(item) && <HabitualTag />}
        </span>
      </button>

      {buy && <HabitualStar item={item} listId={listId} busy={busy} />}
      <button
        type="button"
        onClick={onStock}
        disabled={busy}
        className={`relative h-8 disabled:cursor-wait shrink-0 whitespace-nowrap rounded-full px-3 text-[12px] font-medium transition-colors before:absolute before:inset-x-0 before:-inset-y-1.5 ${
          variant === 'stock'
            ? 'bg-terracotta-deep text-cream hover:bg-ink'
            : 'bg-cream-deep text-ink-mid hover:bg-ink hover:text-cream'
        }`}
        aria-label={variant === 'stock' ? 'Quitar de en casa' : 'Marcar en casa'}
      >
        {variant === 'stock' ? 'Quitar' : 'En casa'}
      </button>
      </div>
      {buy && (
        // PRO-292: amount, unit, price and «Quitar», on the line itself.
        <div className="flex items-center gap-1.5 pb-1 pl-[44px]">
          <LineAmount item={item} listId={listId} busy={busy} />
          <span className="flex-1" />
          <ItemPriceField listId={listId} item={item} />
          {onRemove && <RemoveLineButton item={item} onRemove={onRemove} busy={busy} />}
        </div>
      )}
    </motion.li>
  )
}
