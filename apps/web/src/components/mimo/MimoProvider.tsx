'use client'

/**
 * Mimo, the companion (D-023, specs/advisor.md): one assistant on every page.
 *
 *   - One brain: the same Claude assistant (`POST /assistant/:userId/chat`)
 *     for typing and talking. It gets the current page so "esta receta"
 *     or "siguiente" mean something.
 *   - Voice: record → `POST /stt` → the same chat in `mode: 'voice'` (short
 *     spoken replies) → read aloud (`POST /tts`, ElevenLabs, or the browser
 *     voice). In hands-free mode it listens again after speaking, until
 *     nobody talks.
 *   - "Hola Mimo" (Picovoice wake word, when set up) opens it hands-free.
 *   - The conversation survives navigation (sessionStorage), and pages
 *     refresh after Mimo changes something.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/lib/auth'
import { api } from '@/lib/api'
import { useVoice, type ServerVoice } from '@/hooks/useVoice'
import { recorderSupported, useRecorder } from '@/hooks/useRecorder'
import { useWakeWord, WAKE_PHRASE } from '@/hooks/useWakeWord'
import { emitCookingCommand } from '@/lib/cookingCommands'
import MimoPanel from './MimoPanel'
import MimoButton from './MimoButton'

export interface MimoMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  uiHint?: string
}

interface AssistantResponse {
  message: string
  skillUsed?: string
  data?: any
  uiHint?: string
  actionTaken?: boolean
}

export type MimoStatus = 'idle' | 'listening' | 'transcribing' | 'thinking' | 'speaking'

interface MimoContextValue {
  isOpen: boolean
  open: (opts?: { listen?: boolean; handsFree?: boolean }) => void
  close: () => void
  messages: MimoMessage[]
  clear: () => void
  status: MimoStatus
  error: string | null
  send: (text: string) => Promise<void>
  /** Tap the mic: start listening, or stop and send what was said. */
  toggleListening: () => void
  micLevel: number
  canListen: boolean
  handsFree: boolean
  setHandsFree: (v: boolean) => void
  speakReplies: boolean
  setSpeakReplies: (v: boolean) => void
  stopSpeaking: () => void
  voices: ServerVoice[]
  selectedVoice: string | null
  setVoice: (key: string) => void
  previewVoice: (key: string) => void
  /** "Hola Mimo" listener (profile setting). */
  wakeWord: { available: boolean; enabled: boolean; setEnabled: (v: boolean) => void; listening: boolean; phrase: string }
}

const MimoContext = createContext<MimoContextValue | undefined>(undefined)

export function useMimo(): MimoContextValue {
  const ctx = useContext(MimoContext)
  if (!ctx) throw new Error('useMimo must be used within MimoProvider')
  return ctx
}

const HISTORY_KEY = 'mimo.chat.v1'
const SPEAK_KEY = 'mimo.speak'
const WAKE_KEY = 'ona.voice.wakeword.enabled'
const MAX_KEPT = 40

/** Routes where Mimo has no button: sign-in, onboarding (it has its own voice flow), public pages. */
export function mimoHiddenOn(pathname: string | null): boolean {
  return /^\/(login|register|reset|onboarding|invites|lista|i\/|c\/|privacidad|terminos|aviso-legal|como-funciona|recipes-ona)(\/|$)/.test(pathname ?? '') || pathname === '/'
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = sessionStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : fallback
  } catch {
    return fallback
  }
}

export default function MimoProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth()
  const userId = user?.id ?? ''
  const router = useRouter()
  const pathname = usePathname()
  const queryClient = useQueryClient()

  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<MimoMessage[]>([])
  const [status, setStatus] = useState<MimoStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [handsFree, setHandsFreeState] = useState(false)
  const [speakReplies, setSpeakRepliesState] = useState(false)
  const [wakeEnabled, setWakeEnabledState] = useState(false)

  const messagesRef = useRef<MimoMessage[]>([])
  messagesRef.current = messages
  const handsFreeRef = useRef(false)
  handsFreeRef.current = handsFree
  const pathRef = useRef(pathname)
  pathRef.current = pathname
  const busyRef = useRef(false)

  const recorder = useRecorder()
  const voice = useVoice({ lang: 'es-ES' })

  // Restore the conversation and preferences.
  useEffect(() => {
    setMessages(readJson<MimoMessage[]>(HISTORY_KEY, []))
    try {
      setSpeakRepliesState(localStorage.getItem(SPEAK_KEY) === '1')
      setWakeEnabledState(localStorage.getItem(WAKE_KEY) === '1')
    } catch {}
  }, [])
  useEffect(() => {
    try {
      sessionStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-MAX_KEPT)))
    } catch {}
  }, [messages])

  // Desktop: the page makes room for the 400 px column instead of hiding under it.
  useEffect(() => {
    document.documentElement.style.setProperty('--mimo-panel-width', isOpen ? '400px' : '0px')
  }, [isOpen])

  // `?mimo=1` (e.g. the old /advisor) opens the panel.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const url = new URL(window.location.href)
    if (url.searchParams.get('mimo') === '1') {
      setIsOpen(true)
      url.searchParams.delete('mimo')
      window.history.replaceState(null, '', url.pathname + (url.search ? url.search : '') + url.hash)
    }
  }, [pathname])

  const setSpeakReplies = useCallback((v: boolean) => {
    setSpeakRepliesState(v)
    try {
      localStorage.setItem(SPEAK_KEY, v ? '1' : '0')
    } catch {}
    if (!v) voice.stopSpeaking()
  }, [voice])

  const setHandsFree = useCallback((v: boolean) => {
    setHandsFreeState(v)
    handsFreeRef.current = v
    if (!v) recorder.cancel()
  }, [recorder])

  const append = (m: Omit<MimoMessage, 'id'>) =>
    setMessages((prev) => [...prev, { ...m, id: `${m.role[0]}-${Date.now()}-${prev.length}` }].slice(-MAX_KEPT))

  const listenRef = useRef<() => void>(() => {})

  /** One turn with the assistant. `spoken` = it came from the mic (short spoken reply). */
  const ask = useCallback(
    async (text: string, spoken: boolean) => {
      const question = text.trim()
      if (!question || !userId || busyRef.current) return
      busyRef.current = true
      setError(null)
      voice.stopSpeaking()
      const history = messagesRef.current.slice(-20).map(({ role, content }) => ({ role, content }))
      append({ role: 'user', content: question })
      setStatus('thinking')
      let reply = ''
      try {
        const res = await api.post<AssistantResponse>(`/assistant/${userId}/chat`, {
          message: question,
          history,
          mode: spoken ? 'voice' : 'text',
          context: { path: pathRef.current },
        })
        reply = res.message || 'No he podido responder.'
        append({ role: 'assistant', content: reply, uiHint: res.uiHint })

        // Same dispatchers the cook mode listens to.
        const d = res.data
        if (res.uiHint === 'cooking_navigate' && d?.recipeId) {
          const qs = typeof d.servings === 'number' ? `?servings=${d.servings}` : ''
          router.push(`/recipes/${d.recipeId}/cook${qs}`)
        } else if (res.uiHint === 'cooking_timer' && typeof d?.minutes === 'number') {
          emitCookingCommand({ type: 'timer.start', minutes: d.minutes, label: d.label ?? null })
        } else if (res.uiHint === 'cooking_step' && typeof d?.direction === 'string') {
          emitCookingCommand({ type: 'step.advance', direction: d.direction })
        }
        // The page behind may show what Mimo just changed (menu, list, recipe).
        if (res.actionTaken) queryClient.invalidateQueries()
      } catch (err: any) {
        const msg = err?.message || 'No he podido conectar.'
        setError(msg)
        append({ role: 'assistant', content: `No he podido responder: ${msg}` })
      } finally {
        busyRef.current = false
      }

      if (reply && (spoken || speakReplies)) {
        setStatus('speaking')
        await voice.speak(reply)
      }
      setStatus('idle')
      if (spoken && handsFreeRef.current) listenRef.current()
    },
    [userId, voice, router, queryClient, speakReplies],
  )

  const send = useCallback((text: string) => ask(text, false), [ask])

  // ── Listening ──
  const canListen = typeof window !== 'undefined' && (recorderSupported() || voice.sttSupported)

  const listen = useCallback(async () => {
    if (!userId || busyRef.current) return
    voice.stopSpeaking()
    setError(null)
    if (!recorderSupported()) {
      // Old browsers: the built-in recogniser, then the same turn.
      setStatus('listening')
      voice.startListening()
      return
    }
    setStatus('listening')
    const blob = await recorder.start()
    if (!blob) {
      setStatus('idle')
      if (recorder.lastError()) setError(recorder.lastError())
      if (handsFreeRef.current) setHandsFreeState(false) // nobody spoke: end the conversation quietly
      return
    }
    setStatus('transcribing')
    try {
      const form = new FormData()
      form.append('audio', blob, blob.type.includes('mp4') ? 'voz.m4a' : 'voz.webm')
      const { text } = await api.upload<{ text: string }>('/stt', form)
      if (!text?.trim()) {
        setStatus('idle')
        if (handsFreeRef.current) listenRef.current()
        return
      }
      await ask(text, true)
    } catch (err: any) {
      setStatus('idle')
      setError(err?.message || 'No te he entendido.')
    }
  }, [userId, voice, recorder, ask])
  listenRef.current = () => {
    void listen()
  }

  // Built-in recogniser fallback: its transcript becomes a spoken turn.
  useEffect(() => {
    if (!voice.isListening && status === 'listening' && !recorder.recording && voice.transcript) {
      void ask(voice.transcript, true)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voice.isListening])

  const toggleListening = useCallback(() => {
    if (status === 'listening') {
      if (recorder.recording) recorder.stop()
      else voice.stopListening()
      return
    }
    if (status === 'speaking') voice.stopSpeaking()
    void listen()
  }, [status, recorder, voice, listen])

  // ── Open / close ──
  const open = useCallback(
    (opts: { listen?: boolean; handsFree?: boolean } = {}) => {
      setIsOpen(true)
      if (opts.handsFree) setHandsFree(true)
      if (opts.listen) setTimeout(() => listenRef.current(), 150)
    },
    [setHandsFree],
  )
  const close = useCallback(() => {
    setIsOpen(false)
    setHandsFree(false)
    recorder.cancel()
    voice.stopSpeaking()
    setStatus('idle')
  }, [recorder, voice, setHandsFree])

  // ── "Hola Mimo" ──
  const wakeAccessKey = process.env.NEXT_PUBLIC_PICOVOICE_ACCESS_KEY ?? ''
  const wakeAvailable = wakeAccessKey.length > 0
  const setWakeEnabled = useCallback((v: boolean) => {
    setWakeEnabledState(v)
    try {
      localStorage.setItem(WAKE_KEY, v ? '1' : '0')
    } catch {}
  }, [])
  const wake = useWakeWord({
    enabled: wakeEnabled && wakeAvailable && !!userId && status === 'idle' && !handsFree,
    onDetected: () => open({ listen: true, handsFree: true }),
    accessKey: wakeAccessKey,
  })

  const value = useMemo<MimoContextValue>(
    () => ({
      isOpen,
      open,
      close,
      messages,
      clear: () => setMessages([]),
      status,
      error,
      send,
      toggleListening,
      micLevel: recorder.level,
      canListen,
      handsFree,
      setHandsFree,
      speakReplies,
      setSpeakReplies,
      stopSpeaking: () => {
        voice.stopSpeaking()
        setStatus('idle')
      },
      voices: voice.voices,
      selectedVoice: voice.selectedVoice,
      setVoice: voice.setVoice,
      previewVoice: (key: string) => {
        voice.setVoice(key)
        void voice.speak('Hola, soy Mimo. Así sueno con esta voz. ¿Qué cocinamos hoy?', key)
      },
      wakeWord: { available: wakeAvailable, enabled: wakeEnabled, setEnabled: setWakeEnabled, listening: wake.isListening, phrase: WAKE_PHRASE },
    }),
    [isOpen, open, close, messages, status, error, send, toggleListening, recorder.level, canListen, handsFree, setHandsFree, speakReplies, setSpeakReplies, voice, wakeAvailable, wakeEnabled, setWakeEnabled, wake.isListening],
  )

  const showButton = !!userId && !isOpen && !mimoHiddenOn(pathname)

  return (
    <MimoContext.Provider value={value}>
      {children}
      {showButton && <MimoButton pathname={pathname} onOpen={() => open()} listening={wake.isListening} />}
      {userId && isOpen && <MimoPanel />}
    </MimoContext.Provider>
  )
}
