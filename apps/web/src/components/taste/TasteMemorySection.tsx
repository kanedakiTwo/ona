"use client"

/**
 * «Afina tu menú» in «Lo que recuerdo de ti» (PRO-146, specs/taste.md):
 * every recipe the user rated, to change or forget, plus what the session
 * noticed and the profile should confirm («¿No coméis carne?»).
 */
import Link from "next/link"
import type { TasteVerdict } from "@ona/shared"
import { useChangeTasteVerdict, useTasteStatus, useTasteVerdicts } from "@/hooks/useTaste"
import { SUB_EYEBROW, SUB_LIST } from "@/components/profile/SubPage"

const VERDICT_LABEL: Record<TasteVerdict, string> = {
  love: "Me encanta",
  like: "Me apetece",
  nope: "No para mí",
  skip: "Si sale, vale / no la conozco",
}

const FLAG_TEXT: Record<string, string> = {
  carne: "Dijiste «No para mí» a varios platos de carne seguidos. ¿No coméis carne? Si es así, añádelo en Perfil → Alergias e intolerancias o cuéntaselo a Mimo.",
  pescado: "Dijiste «No para mí» a varios platos de pescado seguidos. ¿No coméis pescado? Si es así, añádelo en Perfil → Alergias e intolerancias o cuéntaselo a Mimo.",
}

export function TasteMemorySection() {
  const verdicts = useTasteVerdicts()
  const status = useTasteStatus()
  const change = useChangeTasteVerdict()
  const rows = verdicts.data?.verdicts ?? []

  return (
    <section className="mt-8" aria-labelledby="taste-memory-title" data-testid="taste-memory">
      <h2 id="taste-memory-title" className={SUB_EYEBROW}>Afina tu menú</h2>
      <div className={`${SUB_LIST} mt-3`}>
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <span className="text-[15px] text-ink">
            {status.data ? `${status.data.rated} de ${status.data.total} recetas valoradas` : "Recetas valoradas"}
          </span>
          <Link href="/afinar" className="text-[14px] font-medium text-terracotta-deep">
            {rows.length ? "Seguir" : "Empezar"}
          </Link>
        </div>
        {(status.data?.flags ?? []).map((f) => (
          <p key={f} className="m-0 px-4 py-3 text-[14px] leading-relaxed text-ink-mid">{FLAG_TEXT[f]}</p>
        ))}
        {rows.map((r) => (
          <div key={r.recipeId} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <p className="m-0 truncate text-[15px] text-ink">{r.name}</p>
              {r.reason?.text && <p className="m-0 truncate text-[13px] text-ink-muted">«{r.reason.text}»</p>}
            </div>
            <label className="sr-only" htmlFor={`verdict-${r.recipeId}`}>Valoración de {r.name}</label>
            <select
              id={`verdict-${r.recipeId}`}
              value={r.verdict}
              disabled={change.isPending}
              onChange={(e) => change.mutate({ recipeId: r.recipeId, verdict: e.target.value as TasteVerdict })}
              className="min-h-[44px] rounded-full border border-border bg-paper px-3 text-[14px] text-ink"
            >
              {(Object.keys(VERDICT_LABEL) as TasteVerdict[]).map((v) => (
                <option key={v} value={v}>{VERDICT_LABEL[v]}</option>
              ))}
            </select>
            <button
              type="button"
              aria-label={`Olvidar ${r.name}`}
              disabled={change.isPending}
              onClick={() => change.mutate({ recipeId: r.recipeId, verdict: null })}
              className="min-h-[44px] px-2 text-[13px] font-medium text-ink-muted"
            >
              Olvidar
            </button>
          </div>
        ))}
      </div>
    </section>
  )
}
