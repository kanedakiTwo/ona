"use client"

import { useState, useRef, useCallback } from "react"
import { useExtractRecipeFromImage } from "@/hooks/useRecipes"
import { Camera, Upload, X, Loader2, RotateCcw } from "lucide-react"
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
        className="cursor-pointer rounded-xl border-2 border-dashed border-gray-300 p-6 text-center transition-colors hover:border-gray-400 hover:bg-gray-50"
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
          <div className="flex items-center gap-2 text-gray-400">
            <Camera size={24} />
            <Upload size={20} />
          </div>
          <p className="text-sm font-medium text-gray-600">
            Crear desde foto
          </p>
          <p className="text-xs text-gray-400">
            Sube o fotografa una receta escrita para extraer los datos
          </p>
        </div>
      </div>
    )
  }

  // Preview: show image + analyze button
  if (state === "preview") {
    return (
      <div className="rounded-xl border border-gray-200 p-4">
        <div className="flex items-start gap-4">
          <div className="relative h-32 w-32 shrink-0 overflow-hidden rounded-lg">
            {previewUrl && (
              <img
                src={previewUrl}
                alt="Preview"
                className="h-full w-full object-cover"
              />
            )}
          </div>
          <div className="flex flex-1 flex-col gap-3">
            <p className="text-sm text-gray-600">
              Imagen seleccionada. Pulsa analizar para extraer la receta.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={handleAnalyze}
                className="inline-flex items-center gap-2 rounded-lg bg-black px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
              >
                <Camera size={16} />
                Analizar receta
              </button>
              <button
                type="button"
                onClick={cleanup}
                className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50"
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
      <div className="rounded-xl border border-gray-200 p-6">
        <div className="flex items-center gap-4">
          {previewUrl && (
            <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-lg opacity-60">
              <img
                src={previewUrl}
                alt="Processing"
                className="h-full w-full object-cover"
              />
            </div>
          )}
          <div className="flex items-center gap-3">
            <Loader2 size={20} className="animate-spin text-gray-500" />
            <p className="text-sm text-gray-600">Analizando receta con IA...</p>
          </div>
        </div>
      </div>
    )
  }

  // Error
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4">
      <p className="text-sm text-red-600">{errorMessage}</p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={handleRetry}
          className="inline-flex items-center gap-1 rounded-lg border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-100"
        >
          <RotateCcw size={14} />
          Reintentar
        </button>
        <button
          type="button"
          onClick={cleanup}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Cancelar
        </button>
      </div>
    </div>
  )
}
