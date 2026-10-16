"use client"

/**
 * Household-shared photo gallery for a recipe (PR 8C). Shows all uploaded
 * photos in chronological order (newest first), with an "Añadir foto"
 * button for authed household members.
 *
 * Photos are distinct from `recipes.image_url` (the canonical hero shot);
 * this is the "salió crujiente esta vez" cook-result wall.
 */
import { useRef, useState } from "react"
import { Camera, Check, Trash2, X, ImagePlus, ImageUp } from "lucide-react"
import {
  useDeleteRecipePhoto,
  useRecipePhotos,
  useUploadRecipePhoto,
  useUseRecipePhotoAsMain,
  type RecipePhoto,
} from "@/hooks/useRecipePhotos"

interface Props {
  recipeId: string
  /** Recipe author or admin: the lightbox offers «Usar como foto principal» (PRO-145). */
  canSetMain?: boolean
}

export function RecipePhotoGallery({ recipeId, canSetMain = false }: Props) {
  const { data: photos, isLoading } = useRecipePhotos(recipeId)
  const upload = useUploadRecipePhoto()
  const del = useDeleteRecipePhoto()
  const fileRef = useRef<HTMLInputElement | null>(null)
  const [caption, setCaption] = useState("")
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [viewer, setViewer] = useState<RecipePhoto | null>(null)
  const setMain = useUseRecipePhotoAsMain()
  const [mainId, setMainId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handlePickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 8 * 1024 * 1024) {
      setError("La foto es mayor de 8 MB. Comprime o elige otra.")
      return
    }
    setError(null)
    setPendingFile(f)
  }

  function handleUpload() {
    if (!pendingFile) return
    setError(null)
    upload.mutate(
      { recipeId, file: pendingFile, caption: caption.trim() || undefined },
      {
        onSuccess: () => {
          setPendingFile(null)
          setCaption("")
          if (fileRef.current) fileRef.current.value = ""
        },
        onError: (err) => setError(err.message),
      },
    )
  }

  if (isLoading) {
    return (
      <section className="mt-10">
        <div className="text-eyebrow text-[#7A7066]">Galería</div>
        <p className="mt-2 font-italic italic text-[#7A7066]">Cargando…</p>
      </section>
    )
  }

  return (
    <section className="mt-10">
      <div className="flex items-center justify-between mb-3">
        <div className="text-eyebrow text-[#7A7066]">Galería</div>
        {photos && photos.length > 0 && (
          <span className="text-[10px] uppercase tracking-[0.12em] text-[#A39A8E]">
            {photos.length} {photos.length === 1 ? "foto" : "fotos"}
          </span>
        )}
      </div>

      {error && (
        <div className="mb-3 rounded-xl bg-[#C65D38]/10 border border-[#C65D38]/30 px-4 py-2 text-[12px] text-[#C65D38]">
          {error}
        </div>
      )}

      {photos && photos.length > 0 && (
        <ul className="grid grid-cols-3 gap-2 mb-4">
          {photos.map((p) => (
            <li key={p.id} className="relative aspect-square overflow-hidden rounded-xl bg-[#F2EDE0]">
              <button
                type="button"
                onClick={() => {
                  setMain.reset()
                  setViewer(p)
                }}
                className="block h-full w-full"
                aria-label={p.caption ?? "Ver foto"}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.imageUrl}
                  alt={p.caption ?? ""}
                  className="h-full w-full object-cover transition-transform hover:scale-105"
                />
              </button>
              <button
                type="button"
                onClick={() => del.mutate({ recipeId, photoId: p.id })}
                aria-label="Eliminar foto"
                className="absolute top-1.5 right-1.5 rounded-full bg-[#FAF6EE]/95 backdrop-blur-sm p-1.5 text-[#7A7066] hover:bg-[#C65D38] hover:text-[#FAF6EE] shadow"
              >
                <Trash2 size={11} />
              </button>
              {p.caption && (
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#1A1612]/85 to-transparent px-2 py-1.5">
                  <p className="text-[10px] text-[#FAF6EE] leading-tight line-clamp-2">{p.caption}</p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Upload control */}
      {pendingFile ? (
        <div className="rounded-2xl border border-[#DDD6C5] bg-[#FFFEFA] p-3 space-y-2">
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={URL.createObjectURL(pendingFile)}
              alt="preview"
              className="h-16 w-16 rounded-lg object-cover"
            />
            <div className="flex-1 min-w-0">
              <div className="text-[12px] text-[#1A1612] truncate">{pendingFile.name}</div>
              <div className="text-[10px] uppercase tracking-[0.12em] text-[#A39A8E]">
                {(pendingFile.size / 1024).toFixed(0)} KB
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setPendingFile(null)
                setCaption("")
                if (fileRef.current) fileRef.current.value = ""
              }}
              aria-label="Descartar"
              className="rounded-full border border-[#DDD6C5] p-1.5 text-[#7A7066] hover:border-[#1A1612] hover:text-[#1A1612]"
            >
              <X size={11} />
            </button>
          </div>
          <input
            type="text"
            value={caption}
            onChange={(e) => setCaption(e.target.value)}
            placeholder="Pie de foto (opcional)"
            maxLength={280}
            className="w-full border-b border-[#DDD6C5] bg-transparent py-1.5 text-[13px] outline-none focus:border-[#1A1612]"
          />
          <button
            type="button"
            onClick={handleUpload}
            disabled={upload.isPending}
            className="inline-flex items-center gap-2 rounded-full bg-[#1A1612] px-5 py-2 text-[11px] uppercase tracking-[0.12em] text-[#FAF6EE] disabled:opacity-40"
          >
            <ImagePlus size={12} /> {upload.isPending ? "Subiendo…" : "Subir foto"}
          </button>
        </div>
      ) : (
        <>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/heic,image/heif"
            className="hidden"
            onChange={handlePickFile}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-full border border-dashed border-[#DDD6C5] bg-transparent px-4 py-2 text-[12px] uppercase tracking-[0.12em] text-[#7A7066] transition-all hover:border-[#1A1612] hover:text-[#1A1612]"
          >
            <Camera size={12} /> Añadir foto
          </button>
        </>
      )}

      {/* Lightbox */}
      {viewer && (
        <div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-[#1A1612]/90 p-4"
          onClick={() => setViewer(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Foto de la galería"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={viewer.imageUrl}
            alt={viewer.caption ?? "Foto"}
            className="max-h-[75vh] max-w-full rounded-2xl object-contain lg:max-w-[960px]"
          />
          {canSetMain && (
            <div className="flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
              {mainId === viewer.id && setMain.isSuccess ? (
                <span className="inline-flex h-11 items-center gap-2 rounded-full bg-[#2D6A4F] px-5 text-[14px] text-[#FAF6EE]">
                  <Check size={16} aria-hidden /> Ya es la foto principal
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setMainId(viewer.id)
                    setMain.mutate({ recipeId, photoId: viewer.id })
                  }}
                  disabled={setMain.isPending}
                  className="inline-flex h-11 items-center gap-2 rounded-full bg-[#FAF6EE] px-5 text-[14px] font-medium text-[#1A1612] transition-transform active:scale-[0.98] disabled:opacity-60"
                >
                  <ImageUp size={16} aria-hidden />
                  {setMain.isPending ? "Cambiando…" : "Usar como foto principal"}
                </button>
              )}
              {setMain.error && mainId === viewer.id ? (
                <span className="text-[13px] italic text-[#F2B9A2]">{setMain.error.message}</span>
              ) : null}
            </div>
          )}
          <button
            type="button"
            onClick={() => setViewer(null)}
            aria-label="Cerrar"
            className="absolute top-5 right-5 rounded-full bg-[#FAF6EE]/95 p-2 text-[#1A1612]"
          >
            <X size={18} />
          </button>
        </div>
      )}
    </section>
  )
}
