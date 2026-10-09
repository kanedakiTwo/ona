"use client"

import { useState } from "react"
import { Link2, Loader2, RotateCcw } from "lucide-react"
import { useExtractRecipeFromUrl } from "@/hooks/useRecipes"
import { useAuth } from "@/lib/auth"
import { cn } from "@/lib/utils"

interface UrlRecipeImportProps {
  /** Called with the persisted recipe id once the API stores the new recipe. */
  onImported: (recipeId: string, warnings: string[]) => void
}

type State = "idle" | "submitting" | "error"

function isLikelyUrl(input: string): boolean {
  try {
    const u = new URL(input.trim())
    return u.protocol === "http:" || u.protocol === "https:"
  } catch {
    return false
  }
}

export function UrlRecipeImport({ onImported }: UrlRecipeImportProps) {
  const { user } = useAuth()
  const isAdmin = user?.role === "admin"
  const [url, setUrl] = useState("")
  const [asSystem, setAsSystem] = useState(false)
  const [state, setState] = useState<State>("idle")
  const [errorMessage, setErrorMessage] = useState("")
  const mutation = useExtractRecipeFromUrl()

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!isLikelyUrl(url)) {
      setErrorMessage("Introduce una URL válida (http:// o https://).")
      setState("error")
      return
    }

    setState("submitting")
    mutation.mutate({ url: url.trim(), asSystem: isAdmin && asSystem }, {
      onSuccess: (data) => {
        setState("idle")
        setUrl("")
        onImported(data.recipe.id, data.warnings ?? [])
      },
      onError: (err: any) => {
        // The API returns isRecipe:false with a Spanish reason for non-recipes,
        // and explanatory text for the no-captions case. Surface either.
        const apiData = err?.data ?? err?.response?.data
        if (apiData?.reason) {
          setErrorMessage(`No es una receta cocinable: ${apiData.reason}`)
        } else if (apiData?.error) {
          setErrorMessage(apiData.error)
        } else {
          setErrorMessage(err?.message ?? "Error al importar la receta.")
        }
        setState("error")
      },
    })
  }

  function reset() {
    setState("idle")
    setErrorMessage("")
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-[20px] border border-border-soft bg-paper p-4 sm:p-5"
    >
      <div className="flex items-center gap-2 text-ink">
        <Link2 size={16} aria-hidden />
        <span className="font-serif-text text-[17px] font-[650]">Importar desde URL</span>
      </div>
      <p className="mt-1.5 text-[13px] leading-snug text-ink-muted">
        Pega un enlace a un artículo de receta o un vídeo de YouTube. Mimoia
        extraerá los ingredientes y los pasos.
      </p>

      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        <input
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value)
            if (state === "error") reset()
          }}
          placeholder="https://..."
          disabled={state === "submitting"}
          className={cn(
            "h-11 w-full min-w-0 rounded-xl border bg-paper px-3.5 text-[16px] sm:flex-1 text-ink placeholder:text-ink-light focus:outline-none focus:ring-1 disabled:opacity-60 lg:text-[15px]",
            state === "error"
              ? "border-terracotta focus:border-terracotta focus:ring-terracotta"
              : "border-border-soft focus:border-ink focus:ring-ink"
          )}
        />
        <button
          type="submit"
          disabled={!url || state === "submitting"}
          className="inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
        >
          {state === "submitting" ? (
            <>
              <Loader2 size={14} className="animate-spin" />
              Importando...
            </>
          ) : (
            <>
              <Link2 size={14} />
              Importar receta
            </>
          )}
        </button>
      </div>

      {/* Admin-only: persist the imported recipe in the curated ONA
          catalogue instead of the user's own collection. The server
          re-checks the role before honouring the flag. */}
      {isAdmin && (
        <label className="mt-3 flex cursor-pointer items-start gap-2 text-[13px] text-ink-mid">
          <input
            type="checkbox"
            checked={asSystem}
            onChange={(e) => setAsSystem(e.target.checked)}
            disabled={state === "submitting"}
            className="mt-0.5 h-4 w-4 cursor-pointer accent-ink"
          />
          <span>
            <span className="font-medium text-ink">Añadir al catálogo Mimoia</span>{" "}
            — la receta queda como receta del sistema (sin autor),
            visible para todos en <code>/recipes-ona</code> y bajo
            “Selección Mimoia” en <code>/recipes</code>.
          </span>
        </label>
      )}

      {state === "error" && (
        <div className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-terracotta/40 bg-warn-bg px-3.5 py-2 text-[13px] text-ink">
          <p className="flex-1">{errorMessage}</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex min-h-11 shrink-0 items-center gap-1 text-ink-muted hover:text-ink"
          >
            <RotateCcw size={12} />
            Reintentar
          </button>
        </div>
      )}
    </form>
  )
}
