"use client"

/**
 * PRO-387 (D-158, «primer acierto»): the two next steps of the first week
 * that /menu offers when nothing more urgent shows (lib/nextStep.ts).
 *
 * - `SendListCard`: «Manda la lista a quien hace la compra» → /shopping. Tapping
 *   it or «Ahora no» puts it away for the week (lib/weekSteps.ts).
 * - `LastNightCard`: «¿Qué tal la cena de ayer?» — «La hicimos» marks the meal
 *   eaten and records the cook (the same as «Marcar como cocinada», PRO-185);
 *   «No la hicimos» puts it away until tomorrow.
 */
import Link from "next/link"
import { useSetSlotEaten } from "@/hooks/useMenu"
import { useRecordCook } from "@/hooks/useCookLogs"
import { haptic } from "@/lib/pwa/haptics"
import { markLastNightAnswered, markListUsed, type LastNightDish } from "@/lib/weekSteps"

const card = "mx-5 mt-3 rounded-2xl border border-border-soft bg-paper px-4 py-4 lg:mx-0"
const eyebrow = "text-[11px] font-semibold uppercase tracking-[0.14em] text-terracotta-deep"
const primary = "inline-flex min-h-[44px] items-center rounded-full bg-ink px-5 text-[14px] font-semibold text-cream"
const secondary = "min-h-[44px] text-[14px] font-semibold text-ink-muted"

export function SendListCard({ weekStart }: { weekStart: string }) {
  return (
    <section data-testid="next-step-send-list" aria-labelledby="send-list-title" className={card}>
      <p className={eyebrow}>Siguiente paso</p>
      <h2 id="send-list-title" className="mt-1 font-serif-text text-[19px] font-[650] leading-snug text-ink">
        Manda la lista a quien hace la compra
      </h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">Ya está hecha con los platos de tu semana.</p>
      <div className="mt-3 flex items-center gap-4">
        <Link href="/shopping" onClick={() => markListUsed(weekStart)} className={primary}>
          Ver y mandar la lista
        </Link>
        <button type="button" onClick={() => markListUsed(weekStart)} className={secondary}>
          Ahora no
        </button>
      </div>
    </section>
  )
}

export function LastNightCard({ menuId, dish, today }: { menuId: string; dish: LastNightDish; today: string }) {
  const setEaten = useSetSlotEaten()
  const record = useRecordCook()
  const busy = setEaten.isPending || record.isPending
  const mealName = dish.meal === "dinner" ? "cena" : "comida"
  return (
    <section data-testid="next-step-last-night" aria-labelledby="last-night-title" className={card}>
      <p className={eyebrow}>Siguiente paso</p>
      <h2 id="last-night-title" className="mt-1 font-serif-text text-[19px] font-[650] leading-snug text-ink">
        ¿Qué tal la {mealName} de ayer?
      </h2>
      <p className="mt-1 text-[14px] leading-relaxed text-ink-mid">
        {dish.recipeName ? `¿Hicisteis «${dish.recipeName}»? ` : "¿La hicisteis? "}
        Apúntalo y el menú aprende lo que os gusta.
      </p>
      <div className="mt-3 flex items-center gap-4">
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            haptic.light()
            const slot = { menuId, day: dish.day, meal: dish.meal }
            record.mutate({ recipeId: dish.recipeId, menuId, dayIndex: dish.day, meal: dish.meal })
            setEaten.mutate({ ...slot, eaten: true }, { onSuccess: () => markLastNightAnswered(today) })
          }}
          className={`${primary} disabled:opacity-50`}
        >
          {busy ? "Guardando…" : "La hicimos"}
        </button>
        <button type="button" onClick={() => markLastNightAnswered(today)} className={secondary}>
          No la hicimos
        </button>
      </div>
    </section>
  )
}
