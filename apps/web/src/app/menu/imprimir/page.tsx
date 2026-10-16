"use client"

/**
 * /menu/imprimir?week=YYYY-MM-DD — «Imprimir la semana» (PRO-112,
 * specs/menus.md). One A4 landscape sheet with the 7 days in columns (each
 * meal: dish names and the first recipe's time) and, on a second sheet that
 * can be left out, the shopping list by aisle. «Imprimir» opens the
 * browser's print dialog, which also saves as PDF: nothing is generated on
 * the server. On screen the sheets are previewed under a small toolbar that
 * doesn't print.
 */
import { useMemo, useState } from "react"
import Link from "next/link"
import { ArrowLeft, Printer } from "lucide-react"
import { useAuth } from "@/lib/auth"
import { useMenu } from "@/hooks/useMenu"
import { useShoppingList } from "@/hooks/useShopping"
import { mondayOf } from "@/lib/addToMenu"
import { dateOfDay, weekRangeLabel, weekdayName } from "@/lib/menuDay"
import { AISLE_LABELS, formatQuantity, MEAL_LABELS } from "@/lib/labels"
import { printCell, printMealRows, printShoppingByAisle } from "@/lib/printWeek"

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

function weekFromUrl(): string {
  if (typeof window === "undefined") return mondayOf(new Date())
  const raw = new URLSearchParams(window.location.search).get("week")
  if (raw && /^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [y, m, d] = raw.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    if (date.getDay() === 1) return raw
  }
  return mondayOf(new Date())
}

const PRINT_CSS = `
@page { size: A4 landscape; margin: 10mm; }
@media print {
  body * { visibility: hidden !important; }
  #print-week, #print-week * { visibility: visible !important; }
  #print-week { position: absolute; left: 0; top: 0; width: 100%; }
  .print-sheet { box-shadow: none !important; border: 0 !important; margin: 0 !important; padding: 0 !important; width: auto !important; }
  .print-break { break-before: page; }
  .no-print { display: none !important; }
}
`

export default function PrintWeekPage() {
  const { user } = useAuth()
  const [weekStart] = useState(weekFromUrl)
  const [withList, setWithList] = useState(true)
  const { data: menu, isLoading } = useMenu(user?.id, weekStart)

  const days = (menu?.days ?? []) as never[]
  const rows = printMealRows(days)

  return (
    <div className="min-h-screen bg-cream px-4 py-4 lg:px-10">
      <style>{PRINT_CSS}</style>

      <div className="no-print mx-auto mb-4 flex max-w-[1180px] flex-wrap items-center gap-3">
        <Link href={`/menu?week=${weekStart}`} className="inline-flex h-11 items-center gap-1.5 rounded-full border border-border bg-paper px-4 text-[14px] font-medium text-ink">
          <ArrowLeft size={16} /> Volver
        </Link>
        <label className="inline-flex min-h-[44px] items-center gap-2 text-[14px] text-ink">
          <input type="checkbox" checked={withList} onChange={(e) => setWithList(e.target.checked)} className="h-5 w-5 accent-[#1A1612]" />
          Incluir la lista de la compra
        </label>
        <button
          type="button"
          onClick={() => window.print()}
          className="ml-auto inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream"
        >
          <Printer size={16} /> Imprimir
        </button>
        <p className="w-full text-[13px] text-ink-muted">En el diálogo de imprimir puedes elegir «Guardar como PDF».</p>
      </div>

      <div id="print-week" className="overflow-x-auto">
        <section
          data-testid="print-week-sheet"
          className="print-sheet mx-auto min-w-[980px] max-w-[1180px] rounded-2xl border border-border-soft bg-white p-6 text-[#1A1612]"
        >
          <header className="mb-4 flex items-baseline justify-between">
            <h1 className="font-serif-text text-[24px] font-[650]">Menú · {weekRangeLabel(weekStart).replace(/^Semana/, "semana")}</h1>
            <span className="text-[12px] tracking-[0.12em] text-[#7A7066] uppercase">Mimoia</span>
          </header>
          {isLoading ? (
            <p className="text-[14px]">Cargando…</p>
          ) : !menu || rows.length === 0 ? (
            <p className="text-[14px]">Esta semana aún no tiene menú.</p>
          ) : (
            <table className="w-full table-fixed border-collapse text-[12px] leading-snug">
              <thead>
                <tr>
                  <th className="w-[72px]" />
                  {Array.from({ length: 7 }, (_, i) => (
                    <th key={i} scope="col" data-testid="print-day" className="border-b border-[#1A1612] px-1.5 pb-1 text-left font-semibold capitalize">
                      {weekdayName(i)} {dateOfDay(weekStart, i).getDate()}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((meal) => (
                  <tr key={meal}>
                    <th scope="row" className="border-b border-[#DDD6C5] py-2 pr-2 text-left align-top text-[11px] font-semibold tracking-[0.08em] text-[#7A7066] uppercase">
                      {MEAL_LABELS[meal]}
                    </th>
                    {Array.from({ length: 7 }, (_, i) => {
                      const cell = printCell((days[i] as any)?.[meal])
                      return (
                        <td key={i} className="border-b border-[#DDD6C5] px-1.5 py-2 align-top">
                          {cell.names.map((n, k) => (
                            <div key={k} className="font-medium">{n}</div>
                          ))}
                          {cell.minutes != null && <div className="text-[11px] text-[#7A7066]">{cell.minutes} min</div>}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        {withList && <ShoppingSheet weekStart={weekStart} />}
      </div>
    </div>
  )
}

/** Second sheet; mounted only when the box is ticked, so no list is fetched otherwise. */
function ShoppingSheet({ weekStart }: { weekStart: string }) {
  const range = useMemo(() => ({ from: weekStart, to: iso(dateOfDay(weekStart, 6)) }), [weekStart])
  const list = useShoppingList(range)
  const aisles = list.data ? printShoppingByAisle(list.data.items ?? []) : []
  return (
    <section
      data-testid="print-shopping-sheet"
      className="print-sheet print-break mx-auto mt-6 min-w-[980px] max-w-[1180px] rounded-2xl border border-border-soft bg-white p-6 text-[#1A1612]"
    >
      <header className="mb-4 flex items-baseline justify-between">
        <h2 className="font-serif-text text-[22px] font-[650]">Lista de la compra</h2>
        <span className="text-[12px] tracking-[0.12em] text-[#7A7066] uppercase">Mimoia</span>
      </header>
      {list.isLoading ? (
        <p className="text-[14px]">Cargando…</p>
      ) : aisles.length === 0 ? (
        <p className="text-[14px]">No hay nada que comprar esta semana.</p>
      ) : (
        <div className="columns-3 gap-8 text-[12px]">
          {aisles.map((g) => (
            <div key={g.aisle} className="mb-4 break-inside-avoid">
              <h3 className="mb-1 text-[11px] font-semibold tracking-[0.08em] text-[#7A7066] uppercase">{AISLE_LABELS[g.aisle]}</h3>
              <ul>
                {g.items.map((it) => (
                  <li key={it.id} className="flex gap-2 py-0.5">
                    <span aria-hidden="true">☐</span>
                    <span className="flex-1">{it.name}</span>
                    {it.quantitySource !== "default" && <span className="text-[#7A7066]">{formatQuantity(it.quantity, it.unit)}</span>}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
