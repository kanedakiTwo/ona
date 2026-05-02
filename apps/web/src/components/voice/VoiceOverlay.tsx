'use client'

import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import type { RealtimeStatus, RealtimeTurn } from '@/hooks/useRealtimeSession'

interface VoiceOverlayProps {
  status: RealtimeStatus
  error: string | null
  partialUserText: string
  partialAssistantText: string
  transcripts: RealtimeTurn[]
  silenceWarning?: string | null
  onClose: () => void
}

export default function VoiceOverlay({
  status,
  error,
  partialUserText,
  partialAssistantText,
  transcripts,
  silenceWarning,
  onClose,
}: VoiceOverlayProps) {
  const orbScale = useOrbAmplitude(status === 'connected')

  const lastUser = partialUserText || lastByRole(transcripts, 'user')
  const lastAssistant = partialAssistantText || lastByRole(transcripts, 'assistant')

  const subtitle =
    error ? error
    : silenceWarning ? silenceWarning
    : status === 'connecting' ? 'Conectando…'
    : status === 'connected' && partialAssistantText ? partialAssistantText
    : status === 'connected' && partialUserText ? partialUserText
    : status === 'connected' ? (lastAssistant ?? 'Te escucho.')
    : status === 'error' ? 'No se pudo conectar.'
    : 'Sesión cerrada.'

  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-between bg-[#1A1612] px-6 py-10 text-white">
      <div className="flex w-full justify-end">
        <button
          onClick={onClose}
          aria-label="Cerrar modo voz"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white/80 active:bg-white/20"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div
          className="relative h-44 w-44 rounded-full bg-gradient-to-br from-[#C65D38] to-[#2D6A4F] shadow-[0_0_80px_rgba(198,93,56,0.45)] transition-transform duration-100"
          style={{ transform: `scale(${orbScale})` }}
        >
          <div className="absolute inset-2 rounded-full bg-gradient-to-br from-[#FAF6EE]/20 to-transparent" />
        </div>

        <p className="max-w-[280px] text-center text-[15px] leading-relaxed text-white/85 line-clamp-3">
          {subtitle}
        </p>

        {lastUser && (
          <p className="max-w-[280px] text-center text-[12px] text-white/45 line-clamp-2">
            tú: {lastUser}
          </p>
        )}
      </div>

      <p className="text-center text-[11px] text-white/40">
        Habla con normalidad. Puedes interrumpirla en cualquier momento.
      </p>
    </div>
  )
}

function lastByRole(turns: RealtimeTurn[], role: 'user' | 'assistant'): string | null {
  for (let i = turns.length - 1; i >= 0; i--) {
    if (turns[i].role === role) return turns[i].content
  }
  return null
}

function useOrbAmplitude(active: boolean): number {
  const [scale, setScale] = useState(1)
  const rafRef = useRef<number | null>(null)
  const phaseRef = useRef(0)

  useEffect(() => {
    if (!active) {
      setScale(1)
      return
    }
    function tick() {
      phaseRef.current += 0.06
      const wobble = 1 + 0.04 * Math.sin(phaseRef.current) + 0.02 * Math.sin(phaseRef.current * 2.7)
      setScale(wobble)
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [active])

  return scale
}
