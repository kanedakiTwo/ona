"use client"

import { useState } from "react"
import { Link2, Loader2, RotateCcw } from "lucide-react"
import { useExtractRecipeFromUrl } from "@/hooks/useRecipes"
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
  const [url, setUrl] = useState("")
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
    mutation.mutate(url.trim(), {
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
      className="rounded-xl border border-[#DDD6C5] bg-[#F2EDE0] p-4"
    >
      <div className="flex items-center gap-2 text-[#7A7066]">
        <Link2 size={16} />
        <span className="text-eyebrow">Importar desde URL</span>
      </div>
      <p className="mt-2 text-[12px] italic text-[#7A7066]">
        Pega un enlace a un artículo de receta o un vídeo de YouTube. ONA
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
            "flex-1 rounded-lg border bg-[#FAF6EE] px-3 py-2 text-[14px] text-[#1A1612] placeholder:text-[#7A7066] focus:outline-none focus:ring-1 disabled:opacity-60",
            state === "error"
              ? "border-[#C65D38] focus:border-[#C65D38] focus:ring-[#C65D38]"
              : "border-[#DDD6C5] focus:border-[#1A1612] focus:ring-[#1A1612]"
          )}
        />
        <button
          type="submit"
          disabled={!url || state === "submitting"}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#1A1612] px-4 py-2 text-[12px] font-medium uppercase tracking-[0.12em] text-[#FAF6EE] transition-all hover:bg-[#2D6A4F] active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
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

      {state === "error" && (
        <div className="mt-3 flex items-start justify-between gap-3 rounded-lg border border-[#C65D38] bg-[#FAF6EE] px-3 py-2 text-[12px] text-[#1A1612]">
          <p className="flex-1">{errorMessage}</p>
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1 text-[#7A7066] hover:text-[#1A1612]"
          >
            <RotateCcw size={12} />
            Reintentar
          </button>
        </div>
      )}
    </form>
  )
}
