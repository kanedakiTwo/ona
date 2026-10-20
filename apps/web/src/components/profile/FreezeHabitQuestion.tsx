"use client"

/**
 * «¿Congeláis la carne o el pescado cuando compráis?» in «Lo que recuerdo de
 * ti» (PRO-221): the same one-tap question as the sign-up. The answer is a
 * sentence in `prep_habits` (`applyFreezeAnswer`), which turns «hoy toca
 * descongelar» on («Sí»), on with the conditional text («A veces») or off («No»).
 */
import {
  FREEZE_ANSWERS,
  FREEZE_ANSWER_LABELS,
  FREEZE_QUESTION,
  applyFreezeAnswer,
  freezeAnswerFromHabits,
  type UserMemory,
} from "@ona/shared"
import { useUpdateMemory } from "@/hooks/useUserMemory"
import { cn } from "@/lib/utils"

export function FreezeHabitQuestion({ memory }: { memory: UserMemory | undefined }) {
  const update = useUpdateMemory()
  const habits = Array.isArray(memory?.prep_habits?.value) ? (memory!.prep_habits!.value as string[]) : []
  // No freezing habit = «No»: the thaw alert is off.
  const current = freezeAnswerFromHabits(habits) ?? (memory !== undefined ? "no" : null)

  return (
    <section className="mt-8 rounded-[20px] border border-border-soft bg-paper p-4" data-testid="memory-freeze">
      <h2 className="text-[15px] font-semibold text-ink">{FREEZE_QUESTION}</h2>
      <p className="mt-1 text-[13px] leading-snug text-ink-muted">
        Si congeláis, te avisamos el día antes de sacar del congelador lo que toca.
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={FREEZE_QUESTION}>
        {FREEZE_ANSWERS.map((answer) => {
          const selected = current === answer
          return (
            <button
              key={answer}
              type="button"
              aria-pressed={selected}
              disabled={update.isPending}
              onClick={() => {
                if (!selected) update.mutate({ key: "prep_habits", value: applyFreezeAnswer(habits, answer) })
              }}
              className={cn(
                "min-h-[44px] rounded-full border px-4 text-[14px] font-medium transition-colors disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                selected ? "border-ink bg-ink text-cream" : "border-border bg-paper text-ink hover:border-ink",
              )}
            >
              {FREEZE_ANSWER_LABELS[answer]}
            </button>
          )
        })}
      </div>
    </section>
  )
}
