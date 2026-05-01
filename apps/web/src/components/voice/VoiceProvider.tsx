'use client'

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useAuth } from '@/lib/auth'
import { useWakeWord } from '@/hooks/useWakeWord'
import { useRealtimeSession, type RealtimeTurn } from '@/hooks/useRealtimeSession'
import { appendVoiceTurns } from '@/lib/voiceMessages'
import VoiceOverlay from './VoiceOverlay'

const ENABLED_KEY = 'ona.voice.enabled'
const DEFAULT_SILENCE_MS = 20_000
const COOKING_SILENCE_MS = 120_000
const CONTEXT_TTL_MS = 30 * 60_000
const MAX_CONTEXT_TURNS = 12

const COOKING_SKILLS = new Set([
  'get_recipe_details',
  'recipe_variation',
])
const TOPIC_RESET_PHRASES = ['olvida eso', 'hablemos de otra cosa', 'cambiemos de tema']

interface VoiceModeContextValue {
  enabled: boolean
  setEnabled: (v: boolean) => void
  isWakeListening: boolean
  isOverlayOpen: boolean
  wakeError: string | null
}

const VoiceModeContext = createContext<VoiceModeContextValue | undefined>(undefined)

export function useVoiceMode() {
  const ctx = useContext(VoiceModeContext)
  if (!ctx) throw new Error('useVoiceMode must be used within VoiceProvider')
  return ctx
}

export default function VoiceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? ''

  const [enabled, setEnabledState] = useState(false)
  const [overlayOpen, setOverlayOpen] = useState(false)
  const [silenceWarning, setSilenceWarning] = useState<string | null>(null)
  const cachedContextRef = useRef<{ turns: RealtimeTurn[]; updatedAt: number }>({ turns: [], updatedAt: 0 })
  const initialContextForSession = useRef<RealtimeTurn[] | undefined>(undefined)

  useEffect(() => {
    const stored = typeof window !== 'undefined' ? localStorage.getItem(ENABLED_KEY) : null
    setEnabledState(stored === '1')
  }, [])

  const setEnabled = useCallback((v: boolean) => {
    setEnabledState(v)
    if (typeof window !== 'undefined') {
      localStorage.setItem(ENABLED_KEY, v ? '1' : '0')
    }
  }, [])

  const session = useRealtimeSession({
    userId,
    initialContext: initialContextForSession.current,
  })

  const persistAndClose = useCallback(() => {
    const fresh = session.transcripts
    if (fresh.length > 0) {
      appendVoiceTurns(fresh)
      const merged = [...cachedContextRef.current.turns, ...fresh].slice(-MAX_CONTEXT_TURNS)
      cachedContextRef.current = { turns: merged, updatedAt: Date.now() }
    }
    setSilenceWarning(null)
    session.disconnect()
    setOverlayOpen(false)
  }, [session])

  const startSession = useCallback(() => {
    const cache = cachedContextRef.current
    if (cache.turns.length > 0 && Date.now() - cache.updatedAt < CONTEXT_TTL_MS) {
      initialContextForSession.current = cache.turns
    } else {
      initialContextForSession.current = undefined
      cachedContextRef.current = { turns: [], updatedAt: 0 }
    }
    setOverlayOpen(true)
    setSilenceWarning(null)
    session.connect().catch(() => {})
  }, [session])

  const wake = useWakeWord({
    enabled: enabled && !!userId && !overlayOpen,
    onDetected: () => {
      if (!overlayOpen) startSession()
    },
  })

  // Topic reset detection on user transcripts
  useEffect(() => {
    const last = [...session.transcripts].reverse().find(t => t.role === 'user')
    if (!last) return
    const lower = last.content.toLowerCase()
    if (TOPIC_RESET_PHRASES.some(p => lower.includes(p))) {
      cachedContextRef.current = { turns: [], updatedAt: 0 }
    }
  }, [session.transcripts])

  // Idle/silence timer
  useEffect(() => {
    if (!overlayOpen || session.status !== 'connected') return

    const isCooking =
      session.lastToolName != null && COOKING_SKILLS.has(session.lastToolName)
    const idleMs = isCooking ? COOKING_SILENCE_MS : DEFAULT_SILENCE_MS
    const warnAt = Math.max(idleMs - 4000, idleMs / 2)

    const sinceActivity = Date.now() - session.lastActivityAt
    const remainingToWarn = warnAt - sinceActivity
    const remainingToClose = idleMs - sinceActivity

    let warnTimer: ReturnType<typeof setTimeout> | null = null
    let closeTimer: ReturnType<typeof setTimeout> | null = null

    if (remainingToWarn > 0) {
      warnTimer = setTimeout(() => {
        setSilenceWarning('Sigo aquí. Di "Hola Ona" para seguir.')
        try {
          session.sendUserText('[sistema: el usuario ha estado en silencio. Despídete brevemente diciendo: "Sigo aquí. Di Hola Ona para seguir." sin añadir nada más.]')
        } catch {}
      }, remainingToWarn)
    } else {
      setSilenceWarning('Sigo aquí. Di "Hola Ona" para seguir.')
    }

    if (remainingToClose > 0) {
      closeTimer = setTimeout(() => {
        persistAndClose()
      }, remainingToClose)
    } else {
      persistAndClose()
    }

    return () => {
      if (warnTimer) clearTimeout(warnTimer)
      if (closeTimer) clearTimeout(closeTimer)
    }
  }, [overlayOpen, session.status, session.lastActivityAt, session.lastToolName, persistAndClose, session])

  // Reset warning when activity resumes
  useEffect(() => {
    setSilenceWarning(null)
  }, [session.lastActivityAt])

  const ctxValue = useMemo<VoiceModeContextValue>(() => ({
    enabled,
    setEnabled,
    isWakeListening: wake.isListening,
    isOverlayOpen: overlayOpen,
    wakeError: wake.error,
  }), [enabled, setEnabled, wake.isListening, overlayOpen, wake.error])

  return (
    <VoiceModeContext.Provider value={ctxValue}>
      {children}
      {enabled && wake.isListening && !overlayOpen && (
        <button
          onClick={() => setEnabled(false)}
          className="fixed top-3 right-3 z-40 flex h-6 w-6 items-center justify-center rounded-full bg-[#2D6A4F]/90 text-white shadow-md backdrop-blur"
          aria-label="Modo manos libres activo. Toca para desactivar."
          title="Modo manos libres activo"
        >
          <span className="block h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
        </button>
      )}
      {overlayOpen && (
        <VoiceOverlay
          status={session.status}
          error={session.error}
          partialUserText={session.partialUserText}
          partialAssistantText={session.partialAssistantText}
          transcripts={session.transcripts}
          silenceWarning={silenceWarning}
          onClose={persistAndClose}
        />
      )}
    </VoiceModeContext.Provider>
  )
}
