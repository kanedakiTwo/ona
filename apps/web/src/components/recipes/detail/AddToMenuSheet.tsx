"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Check, Lock } from "lucide-react"
import { MenuSheet } from "@/components/menu/MenuSheet"
import { useAddMealSlot, useMenu, useRegenerateMeal } from "@/hooks/useMenu"
import { addToMenuSlots, mondayOf, type AddToMenuSlot } from "@/lib/addToMenu"
import { dateOfDay, weekdayName } from "@/lib/menuDay"
import { mealLabel } from "@/lib/labels"
import { haptic } from "@/lib/pwa/haptics"

/**
 * "Añadir al menú" from the recipe detail (PRO-04): a bottom sheet with the
 * 7 days of this week and, in each, comida / cena. Free slots take the
 * recipe; occupied ones show their dish and swap it for this one.
 */
export function AddToMenuSheet({
  open,
  onClose,
  userId,
  recipeId,
  recipeName,
}: {
  open: boolean
  onClose: () => void
  userId: string
  recipeId: string
  recipeName: string
}) {
  const weekStart = useMemo(() => mondayOf(new Date()), [])
  const { data: menu, isLoading, isError } = useMenu(open ? userId : undefined, weekStart)
  const addSlot = useAddMealSlot()
  const replaceSlot = useRegenerateMeal()
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const busy = addSlot.isPending || replaceSlot.isPending

  // useMenu's local `Menu` type predates multi-dish slots; the payload is
  // the shared `Menu` (dishes[]), as on /menu.
  const slots = useMemo(() => (menu ? addToMenuSlots(menu as never, recipeId) : []), [menu, recipeId])

  function close() {
    setDone(null)
    setError(null)
    onClose()
  }

  function place(s: AddToMenuSlot) {
    if (!menu || busy || s.action === "locked" || s.action === "already") return
    setError(null)
    const params = { menuId: menu.id, day: s.day, meal: s.meal, recipeId }
    const where = `${weekdayName(s.day)}, ${mealLabel(s.meal).toLowerCase()}`
    const onSuccess = () => {
      haptic.medium()
      setDone(where)
    }
    const onError = () => setError("No se ha podido añadir. Inténtalo otra vez.")
    if (s.action === "add") addSlot.mutate(params, { onSuccess, onError })
    else replaceSlot.mutate(params, { onSuccess, onError })
  }

  return (
    <MenuSheet open={open} onClose={close} eyebrow="Esta semana" title="Añadir al menú">
      {done ? (
        <div className="py-2" role="status">
          <p className="text-[15px] text-ink">
            «{recipeName}» está en tu menú: <span className="font-semibold">{done}</span>.
          </p>
          <div className="mt-4 flex gap-2.5">
            <Link
              href="/menu"
              className="flex h-11 flex-1 items-center justify-center rounded-full bg-[#1A1612] text-[15px] font-semibold text-[#FAF6EE]"
            >
              Ver mi menú
            </Link>
            <button
              type="button"
              onClick={close}
              className="flex h-11 flex-1 items-center justify-center rounded-full border border-[#DDD6C5] text-[15px] text-ink"
            >
              Seguir aquí
            </button>
          </div>
        </div>
      ) : isLoading ? (
        <p className="py-4 text-[14px] text-ink-muted">Cargando tu semana…</p>
      ) : isError ? (
        <p className="py-4 text-[14px] text-ink-muted">No se ha podido cargar tu menú. Inténtalo otra vez.</p>
      ) : !menu ? (
        <div className="py-2">
          <p className="text-[15px] text-ink">Aún no tienes menú esta semana.</p>
          <Link
            href="/menu"
            className="mt-4 flex h-11 items-center justify-center rounded-full bg-[#1A1612] text-[15px] font-semibold text-[#FAF6EE]"
          >
            Ir a mi menú
          </Link>
        </div>
      ) : (
        <>
          {error && (
            <p role="alert" className="mb-3 text-[14px] text-terracotta-deep">
              {error}
            </p>
          )}
          <ul className="flex flex-col gap-3" aria-label="Días de la semana">
            {Array.from({ length: 7 }, (_, day) => (
              <li key={day} className="rounded-2xl bg-[#FFFEFA] px-3 py-2.5">
                <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-muted">
                  {weekdayName(day)} {dateOfDay(weekStart, day).getDate()}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  {slots
                    .filter((s) => s.day === day)
                    .map((s) => (
                      <SlotButton key={s.meal} slot={s} disabled={busy} onClick={() => place(s)} />
                    ))}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </MenuSheet>
  )
}

function SlotButton({ slot, disabled, onClick }: { slot: AddToMenuSlot; disabled: boolean; onClick: () => void }) {
  const meal = mealLabel(slot.meal)
  const inert = slot.action === "locked" || slot.action === "already"
  const hint =
    slot.action === "locked"
      ? "Fijada"
      : slot.action === "already"
        ? "Ya está aquí"
        : slot.current
          ? `Sustituir ${slot.current}`
          : "Libre"
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || inert}
      aria-label={`${weekdayName(slot.day)}, ${meal}: ${hint}`}
      data-testid={`add-to-menu-${slot.day}-${slot.meal}`}
      className={`flex min-h-[52px] flex-col items-start justify-center rounded-xl border px-3 py-1.5 text-left transition-colors ${
        inert
          ? "cursor-not-allowed border-[#E8E2D3] opacity-60"
          : "border-[#DDD6C5] hover:border-[#1A1612] active:scale-[0.98]"
      }`}
    >
      <span className="flex items-center gap-1 text-[13px] font-semibold text-ink">
        {meal}
        {slot.action === "locked" && <Lock size={12} aria-hidden />}
        {slot.action === "already" && <Check size={12} aria-hidden />}
      </span>
      <span className="line-clamp-1 text-[12px] text-ink-muted">
        {slot.action === "replace" && slot.current ? slot.current : hint}
      </span>
    </button>
  )
}
