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
  wakeAvailable: boolean
  isOverlayOpen: boolean
  wakeError: string | null
  openOverlay: () => void
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

  const wakeAccessKey = process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY ?? ''
  const wakeAvailable = wakeAccessKey.length > 0

  const wake = useWakeWord({
    enabled: enabled && wakeAvailable && !!userId && !overlayOpen,
    onDetected: () => {
      if (!overlayOpen) startSession()
    },
    accessKey: wakeAccessKey,
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

  // Auto-close overlay if connection died (error / closed). Show error briefly first.
  useEffect(() => {
    if (!overlayOpen) return
    if (session.status !== 'error' && session.status !== 'closed') return
    const t = setTimeout(() => {
      setOverlayOpen(false)
    }, session.error ? 3500 : 1500)
    return () => clearTimeout(t)
  }, [overlayOpen, session.status, session.error])

  const ctxValue = useMemo<VoiceModeContextValue>(() => ({
    enabled,
    setEnabled,
    isWakeListening: wake.isListening,
    wakeAvailable,
    isOverlayOpen: overlayOpen,
    wakeError: wake.error,
    openOverlay: () => {
      if (!overlayOpen && userId) startSession()
    },
  }), [enabled, setEnabled, wake.isListening, wakeAvailable, overlayOpen, wake.error, startSession, userId])

  return (
    <VoiceModeContext.Provider value={ctxValue}>
      {children}
      {enabled && !overlayOpen && userId && (
        <button
          onClick={() => startSession()}
          className="fixed top-3 right-3 z-40 flex h-10 w-10 items-center justify-center rounded-full bg-[#2D6A4F] text-white shadow-[0_4px_16px_rgba(45,106,79,0.35)] active:scale-95 transition-transform"
          aria-label={wake.isListening ? 'Modo voz activo. Toca o di "Hola Ona" para abrir.' : 'Abrir modo voz'}
          title={wake.isListening ? 'Hola Ona o toca' : 'Abrir modo voz'}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
            <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
            <line x1="12" y1="19" x2="12" y2="23" />
            <line x1="8" y1="23" x2="16" y2="23" />
          </svg>
          {wake.isListening && (
            <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-[#FAF6EE] animate-pulse" />
          )}
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
