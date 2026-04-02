"use client"

import { RefreshCw } from "lucide-react"

interface GenerateButtonProps {
  onGenerate: () => void
  isLoading: boolean
}

export function GenerateButton({ onGenerate, isLoading }: GenerateButtonProps) {
  return (
    <button
      onClick={onGenerate}
      disabled={isLoading}
      className="inline-flex items-center gap-2 rounded-lg bg-black px-6 py-3 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
    >
      <RefreshCw size={16} className={isLoading ? "animate-spin" : ""} />
      {isLoading ? "Generando menu..." : "Genera tu primer menu"}
    </button>
  )
}
