"use client"

/**
 * «Foto de la receta» in /recipes/new (PRO-145): «Generar con IA» (default:
 * Mimo makes it after saving, only if there is no own photo) or «Subir mi
 * foto» (camera or gallery). The file is held here and uploaded by the page
 * right after the recipe is created; the preview shows the 4:3 crop the
 * server will apply.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { Camera, Sparkles, X } from "lucide-react"
import { FormCard, choicePillClass } from "./RecipeFormUI"
import { OWN_IMAGE_MAX_BYTES } from "@/hooks/useRecipes"

export function NewRecipePhotoCard({
  file,
  onChange,
}: {
  file: File | null
  onChange: (file: File | null) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview)
  }, [preview])

  function pick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ""
    if (!f) return
    if (f.size > OWN_IMAGE_MAX_BYTES) {
      setError("La foto pesa más de 10 MB. Elige otra o redúcela.")
      return
    }
    setError(null)
    onChange(f)
  }

  return (
    <FormCard
      title={
        <>
          <span className="font-medium italic text-terracotta-deep">Foto</span> de la receta
        </>
      }
      description={
        file
          ? "Usaremos tu foto como foto principal. Se recorta a 4:3, como se ve aquí."
          : "Si no subes ninguna, Mimo la genera con IA al guardar."
      }
    >
      <div data-testid="new-recipe-photo">
        {preview ? (
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={preview}
              alt="Tu foto"
              data-testid="new-recipe-photo-preview"
              className="aspect-[4/3] w-full rounded-2xl bg-bone object-cover"
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              aria-label="Quitar mi foto"
              className="absolute right-2 top-2 inline-flex h-11 w-11 items-center justify-center rounded-full bg-paper/95 text-ink shadow-sm hover:bg-paper"
            >
              <X size={17} />
            </button>
          </div>
        ) : (
          <div className="flex aspect-[4/3] w-full flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-border bg-bone px-6 text-center">
            <Sparkles size={20} className="text-terracotta" aria-hidden />
            <span className="font-display text-[17px] italic leading-snug text-ink-soft">
              Mimo hará la foto al guardar
            </span>
          </div>
        )}
        <div className="mt-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap" role="group" aria-label="De dónde sale la foto">
          <button
            type="button"
            aria-pressed={!file}
            onClick={() => onChange(null)}
            className={`${choicePillClass(!file)} h-11 justify-center gap-2 px-3 sm:px-4`}
          >
            <Sparkles size={15} aria-hidden />
            Generar con IA
          </button>
          <button
            type="button"
            aria-pressed={!!file}
            onClick={() => inputRef.current?.click()}
            className={`${choicePillClass(!!file)} h-11 justify-center gap-2 px-3 sm:px-4`}
          >
            <Camera size={15} aria-hidden />
            {file ? "Cambiar mi foto" : "Subir mi foto"}
          </button>
          {/* image/* lets iPhones hand over a JPEG instead of HEIC. */}
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={pick}
            className="hidden"
            data-testid="new-recipe-photo-input"
          />
        </div>
        {error ? <p className="mt-2 text-[13px] italic text-terracotta-deep">{error}</p> : null}
        <p className="mt-2 text-[13px] leading-snug text-ink-muted">
          JPG, PNG, WebP o HEIC, hasta 10 MB. Tu foto no gasta del límite mensual de fotos con IA.
        </p>
      </div>
    </FormCard>
  )
}
