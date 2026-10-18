"use client"

/**
 * «Cómo cocináis» on /profile (PRO-217, specs/household-profile.md): the
 * same four answers as the sign-up; a tap saves it in the household's ficha
 * (no «Guardar cambios»). Mimo changes it too (`set_cooking_style`).
 */
import { Check, CookingPot } from "lucide-react"
import { COOKING_STYLES, COOKING_STYLE_LABELS, cookingStyleParts } from "@ona/shared"
import { ProfileCard } from "@/app/profile/sections/ProfileCards"
import { useCookingStyle, useSetCookingStyle } from "@/hooks/useCookingStyle"
import { cn } from "@/lib/utils"

export function CookingStyleCard() {
  const state = useCookingStyle()
  const save = useSetCookingStyle()
  const current = save.isPending ? save.variables : state.data?.style ?? null
  const canEdit = state.data?.canEdit !== false

  return (
    <ProfileCard
      icon={CookingPot}
      title="Cómo cocináis"
      status={current ? cookingStyleParts(current).title : "Sin contestar"}
      data-testid="profile-cooking-style"
    >
      <p className="mt-3 text-[13px] leading-snug text-ink-muted">
        ¿Cómo cocináis en casa? También se lo puedes decir a Mimo.
      </p>
      <div className="mt-3 space-y-2" role="group" aria-label="¿Cómo cocináis en casa?">
        {COOKING_STYLES.map((style) => {
          const selected = current === style
          return (
            <button
              key={style}
              type="button"
              aria-pressed={selected}
              disabled={!canEdit || state.isLoading}
              onClick={() => {
                if (!selected) save.mutate(style)
              }}
              className={cn(
                "relative flex min-h-[48px] w-full items-center rounded-2xl border bg-paper px-4 py-2.5 pr-11 text-left text-[14px] leading-snug text-ink transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink",
                selected ? "border-ink ring-1 ring-ink" : "border-border-soft hover:border-ink",
              )}
            >
              {COOKING_STYLE_LABELS[style]}
              <span
                aria-hidden="true"
                className={cn(
                  "absolute right-3 top-1/2 flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-full border",
                  selected ? "border-ink bg-ink text-cream" : "border-border text-transparent",
                )}
              >
                <Check size={12} strokeWidth={2.5} />
              </span>
            </button>
          )
        })}
      </div>
      {save.isError && (
        <p role="alert" className="mt-2 text-[13px] text-terracotta-deep">
          No hemos podido guardarlo. Inténtalo otra vez.
        </p>
      )}
      {!canEdit && <p className="mt-2 text-[12px] italic text-ink-muted">Lo cambian los adultos del hogar.</p>}
    </ProfileCard>
  )
}
