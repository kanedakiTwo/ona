"use client"

/**
 * "Vetadas esta semana" — collapsible list of the week's vetoed recipes with
 * "Levantar veto" per row. Only rendered when there is at least one veto.
 */
import { useEffect, useState } from "react"
import { Ban, ChevronDown } from "lucide-react"

export function BannedRecipesPanel({
  bannedRecipeIds,
  onUnban,
  className = "",
}: {
  bannedRecipeIds: string[]
  onUnban: (recipeId: string) => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  // The menu carries names on slots, but vetoed recipes might not be in any
  // slot any more. Fetch names on demand from /recipes/:id.
  const [names, setNames] = useState<Record<string, string>>({})
  useEffect(() => {
    if (!open) return
    const missing = bannedRecipeIds.filter((id) => !names[id])
    if (missing.length === 0) return
    Promise.all(
      missing.map((id) =>
        fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000"}/recipes/${id}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((j) => (j?.name ? ([id, j.name as string] as const) : null))
          .catch(() => null),
      ),
    ).then((pairs) => {
      const fresh: Record<string, string> = {}
      for (const p of pairs) if (p) fresh[p[0]] = p[1]
      if (Object.keys(fresh).length > 0) setNames((prev) => ({ ...prev, ...fresh }))
    })
  }, [open, bannedRecipeIds, names])

  return (
    <div className={`rounded-[22px] border border-border bg-paper px-4 py-2 ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex min-h-[44px] w-full items-center justify-between text-left"
      >
        <span className="flex items-center gap-2 text-[13px] font-medium text-ink-mid">
          <Ban size={14} />
          Vetadas esta semana ({bannedRecipeIds.length})
        </span>
        <ChevronDown size={16} className={`text-ink-soft transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <ul className="mb-2 mt-1 space-y-1 text-[14px] text-ink">
          {bannedRecipeIds.map((id) => (
            <li key={id} className="flex items-center justify-between gap-3 border-t border-border-soft pt-1">
              <span>{names[id] ?? "Cargando…"}</span>
              <button
                type="button"
                onClick={() => onUnban(id)}
                className="min-h-[44px] text-[13px] font-medium text-forest hover:text-ink"
              >
                Levantar veto
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
