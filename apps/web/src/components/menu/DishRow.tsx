"use client"

import type { Dish } from "@ona/shared"
import { Coffee, Sparkles, X } from "lucide-react"

interface Props {
  dish: Dish
  onClickThumb?: () => void
  onRegenerate?: () => void
  onRemove?: () => void
  onEditNote?: () => void
}

export function DishRow({ dish, onClickThumb, onRegenerate, onRemove, onEditNote }: Props) {
  if (dish.kind === "note") {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-dashed border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2.5">
        <Coffee size={16} className="shrink-0 text-[#7A7066]" />
        <p className="flex-1 truncate text-[13px] italic text-[#4A4239]">{dish.text}</p>
        {onEditNote && (
          <button onClick={onEditNote} className="text-[10px] uppercase tracking-[0.12em] text-[#7A7066]">
            Editar
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} aria-label="Quitar">
            <X size={14} className="text-[#7A7066]" />
          </button>
        )}
      </div>
    )
  }

  // Recipe dish
  return (
    <div className="flex items-center gap-3 rounded-xl border border-[#DDD6C5] bg-[#FFFEFA] px-3 py-2.5">
      <button onClick={onClickThumb} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-[#F2EDE0]">
        {dish.imageUrl ? (
          <img src={dish.imageUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[#7A7066]">
            <Sparkles size={18} />
          </div>
        )}
      </button>
      <div className="min-w-0 flex-1">
        {dish.course && (
          <p className="m-0 text-[9px] uppercase tracking-[0.15em] text-[#7A7066]">
            {dish.course === "starter" ? "Entrante" : dish.course === "dessert" ? "Postre" : "Principal"}
          </p>
        )}
        <p className="truncate text-[13px] font-medium text-[#1A1612]">{dish.recipeName ?? "—"}</p>
        {dish.totalTime != null && <p className="text-[11px] text-[#7A7066]">{dish.totalTime} min</p>}
      </div>
      <div className="flex shrink-0 gap-2">
        {onRegenerate && (
          <button onClick={onRegenerate} className="text-[10px] uppercase tracking-[0.12em] text-[#C65D38]">
            Cambiar
          </button>
        )}
        {onRemove && (
          <button onClick={onRemove} aria-label="Quitar">
            <X size={14} className="text-[#7A7066]" />
          </button>
        )}
      </div>
    </div>
  )
}
