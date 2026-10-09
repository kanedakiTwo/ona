"use client"

import { useState, useRef, useCallback } from "react"
import { useExtractRecipeFromImage } from "@/hooks/useRecipes"
import { Camera, X, Loader2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ExtractedRecipe } from "@ona/shared"

interface PhotoRecipeUploadProps {
  onExtracted: (data: ExtractedRecipe) => void
}

type State = "idle" | "preview" | "processing" | "error"

export function PhotoRecipeUpload({ onExtracted }: PhotoRecipeUploadProps) {
  const [state, setState] = useState<State>("idle")
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState("")
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const extractMutation = useExtractRecipeFromImage()

  const handleFileSelect = useCallback((file: File) => {
    const allowed = ["image/jpeg", "image/png", "image/webp"]
    if (!allowed.includes(file.type)) {
      setErrorMessage("Solo se aceptan imagenes JPEG, PNG o WebP")
      setState("error")
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setErrorMessage("La imagen es demasiado grande (max 10MB)")
      setState("error")
      return
    }

    setSelectedFile(file)
    setPreviewUrl(URL.createObjectURL(file))
    setState("preview")
  }, [])

  function handleInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (file) handleFileSelect(file)
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) handleFileSelect(file)
  }

  function handleDragOver(e: React.DragEvent) {
    e.preventDefault()
  }

  async function handleAnalyze() {
    if (!selectedFile) return

    setState("processing")
    extractMutation.mutate(selectedFile, {
      onSuccess: (data) => {
        cleanup()
        onExtracted(data)
      },
      onError: (err) => {
        setErrorMessage(
          err.message || "Error al analizar la imagen. Intenta con otra foto."
        )
        setState("error")
      },
    })
  }

  function cleanup() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setSelectedFile(null)
    setState("idle")
    setErrorMessage("")
    if (inputRef.current) inputRef.current.value = ""
  }

  function handleRetry() {
    setErrorMessage("")
    setState("idle")
    if (inputRef.current) inputRef.current.value = ""
  }

  // Idle: drop zone
  if (state === "idle") {
    return (
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onClick={() => inputRef.current?.click()}
        className="flex min-h-[148px] cursor-pointer items-center justify-center rounded-[20px] border border-dashed border-border bg-paper p-5 text-center transition-colors hover:border-ink hover:bg-cream-deep"
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          capture="environment"
          onChange={handleInputChange}
          className="hidden"
        />
        <div className="flex flex-col items-center gap-2">
          <div className="flex h-11 w-11 items-center justify-center gap-1 rounded-full bg-paper text-ink">
            <Camera size={20} />
          </div>
          <p className="font-serif-text text-[17px] font-[650] text-ink">
            Crear desde foto
          </p>
          <p className="max-w-[260px] text-[13px] leading-snug text-ink-muted">
            Sube o fotografa una receta escrita para extraer los datos
          </p>
        </div>
      </div>
    )
  }

  // Preview: show image + analyze button
  if (state === "preview") {
    return (
      <div className="rounded-[20px] border border-border-soft bg-paper p-4">
        <div className="flex items-start gap-4">
          <div className="relative h-28 w-28 shrink-0 overflow-hidden rounded-2xl bg-bone">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Preview"
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-[14px] leading-snug text-ink-mid">
              Imagen seleccionada. Pulsa analizar para extraer la receta.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handleAnalyze}
                className="inline-flex h-11 items-center gap-2 rounded-full bg-ink px-5 text-[14px] font-semibold text-cream transition-colors hover:bg-ink-mid active:scale-[0.98]"
              >
                <Camera size={16} />
                Analizar receta
              </button>
              <button
                type="button"
                onClick={cleanup}
                className="inline-flex h-11 items-center gap-1 rounded-full border border-border bg-paper px-4 text-[14px] text-ink transition-colors hover:border-ink"
              >
                <X size={14} />
                Cancelar
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Processing: spinner
  if (state === "processing") {
    return (
      <div className="rounded-[20px] border border-border-soft bg-paper p-5">
        <div className="flex items-center gap-4">
          {previewUrl && (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl opacity-60">
              <img
                src={previewUrl}
                alt="Processing"
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-terracotta-deep" />
            <p className="text-[14px] text-ink-mid">Analizando receta con IA...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error
  return (
    <div className="rounded-[20px] border border-terracotta/40 bg-warn-bg p-4">
      <p className="text-[14px] text-terracotta-deep">{errorMessage}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex h-11 items-center gap-1 rounded-full border border-terracotta-deep bg-paper px-4 text-[14px] font-medium text-terracotta-deep transition-colors hover:bg-terracotta-deep hover:text-cream"
        >
          <RotateCcw size={14} />
          Reintentar
        </button>
        <button
          type="button"
          onClick={cleanup}
          className="inline-flex h-11 items-center px-3 text-[14px] text-ink-muted hover:text-ink"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
