"use client"

/**
 * PRO-271 (Seguridad): above «Generar mi menú» in a blank week, a clear but
 * non-blocking warning when someone in the household hasn't said their
 * allergies and diet (`GET /households/me/allergies`). «No ha contestado» is
 * not «contestó que ninguna»: whoever answered «ninguna» (consent with
 * nothing saved) doesn't see it.
 *
 *   - the caller hasn't answered → «Decir mis alergias» → /profile/casa/alergias;
 *   - other members haven't → their names, and that only they can say it.
 *
 * Mounted from `WeekPlanQuestions`, which lives right above the button.
 */
import Link from "next/link"
import { useQuery } from "@tanstack/react-query"
import { api } from "@/lib/api"
import { useAuth } from "@/lib/auth"

/** Mirrors `HouseholdAllergiesStatus` in apps/api/src/services/householdAllergies.ts. */
interface HouseholdAllergiesStatus {
  meAnswered: boolean
  pending: string[]
  anyAnswered: boolean
}

function names(list: string[]): string {
  if (list.length <= 1) return list.join("")
  return `${list.slice(0, -1).join(", ")} y ${list[list.length - 1]}`
}

export function HouseholdAllergiesNotice() {
  const { user } = useAuth()
  const { data } = useQuery({
    queryKey: ["household-allergies", user?.id],
    queryFn: () => api.get<HouseholdAllergiesStatus>("/households/me/allergies"),
    enabled: !!user?.id,
    staleTime: 30_000,
  })
  if (!data || (data.meAnswered && data.pending.length === 0)) return null

  return (
    <div
      role="status"
      data-testid="household-allergies-notice"
      className="mb-4 rounded-2xl border border-[#E8C9BB] bg-[#FDF3EE] px-4 py-3 text-left text-[13.5px] leading-snug text-ink"
    >
      {!data.meAnswered ? (
        <>
          <p className="font-semibold">
            {!data.anyAnswered && data.pending.length > 0
              ? "Nadie en casa nos ha dicho sus alergias ni su dieta."
              : "No sabemos tus alergias ni tu dieta."}
          </p>
          <p className="mt-1 text-ink-mid">
            El menú no puede evitar lo que no sabe. Dínoslo antes de generarlo; si no tienes ninguna, dínoslo también.
            {data.pending.length > 0 && ` Tampoco nos lo ${data.pending.length > 1 ? "han" : "ha"} dicho ${names(data.pending)}.`}
          </p>
          <Link
            href="/profile/casa/alergias?next=/menu"
            className="mt-2 inline-flex min-h-[40px] items-center rounded-full bg-ink px-4 text-[13.5px] font-semibold text-cream hover:bg-ink-mid"
          >
            Decir mis alergias
          </Link>
        </>
      ) : (
        <p>
          <span className="font-semibold">
            {names(data.pending)} aún no nos {data.pending.length > 1 ? "han" : "ha"} dicho sus alergias ni su dieta
          </span>
          , así que el menú no las tiene en cuenta. Solo puede decirlo cada persona, desde su perfil.
        </p>
      )}
    </div>
  )
}
